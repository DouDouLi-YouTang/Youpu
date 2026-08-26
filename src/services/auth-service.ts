import type { PhoneLoginOutcome, QrLoginOutcome, UserProfile } from '@/domain/user'
import { ApiError, toApiError } from './api/errors'
import {
  checkQrStatus,
  getAccount,
  getLoginStatus,
  getQrCreate,
  getQrKey,
  loginCellphone,
  logout as logoutEndpoint,
  profileFromAccountResult,
  refreshLogin,
  sendCaptcha
} from './api/endpoints/auth.api'

export interface StartQrLoginOptions {
  /** Polling interval in ms. Default 2000. */
  intervalMs?: number
  /** Max poll attempts. Default 150 (~5 min at 2s). */
  maxAttempts?: number
  /** External cancel signal. Aborting stops the loop with `{ status: 'cancelled' }`. */
  signal?: AbortSignal
  /** Called on each QR-state transition (for UI feedback mid-poll). */
  onStatus?: (status: QrPollState) => void
  /**
   * Called once with the generated QR image (base64 dataURL) as soon as
   * `getQrCreate` succeeds, before polling begins. The store uses this to render
   * the scannable code — without it the UI would spin forever.
   */
  onQrImage?: (qrimg: string) => void
}

/** Mid-poll state hints surfaced to the store via `onStatus`. */
export type QrPollState = 'scanning' | 'confirming' | 'authorized'

const DEFAULT_INTERVAL_MS = 1000
const DEFAULT_MAX_ATTEMPTS = 150
const NETWORK_RETRY_MAX = 3
const NETWORK_RETRYABLE_CODES = new Set<ApiError['code']>(['NETWORK_ERROR', 'TIMEOUT'])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Backoff schedule for transient network retries (1s, 2s, 4s). */
function backoffDelay(attempt: number): number {
  return 1000 * 2 ** attempt
}

/**
 * Run the QR-login flow end to end:
 * 1. Request a QR key.
 * 2. Generate the QR image (base64).
 * 3. Poll `checkQrStatus` until 803 (success), 800 (expired), external cancel,
 *    or a non-retryable error.
 *
 * On 803, the returned cookie is used to fetch the account profile before
 * resolving `{ status: 'success' }`.
 *
 * Transient network errors (`NETWORK_ERROR` / `TIMEOUT`) retry up to 3 times
 * with exponential backoff; other ApiErrors abort the loop as `{ status: 'error' }`.
 *
 * This service is stateless — it holds no Pinia state and no module-level
 * handles. The caller (auth.store) owns the AbortController / timers and
 * passes `signal` in for cancellation.
 */
export async function startQrLogin(opts: StartQrLoginOptions = {}): Promise<QrLoginOutcome> {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const signal = opts.signal

  let key: string
  try {
    key = (await getQrKey()).unikey
  } catch (error) {
    return { status: 'error', error: toApiError(error) }
  }

  try {
    const created = await getQrCreate(key, { withImg: true })
    if (!created.qrimg) {
      return {
        status: 'error',
        error: new ApiError({ code: 'SERVER_ERROR', message: '二维码生成失败，请重试' })
      }
    }
    opts.onQrImage?.(created.qrimg)
  } catch (error) {
    return { status: 'error', error: toApiError(error) }
  }

  let networkRetries = 0

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) return { status: 'cancelled' }

    let result
    try {
      result = await checkQrStatus(key)
    } catch (error) {
      const apiError = toApiError(error)
      if (NETWORK_RETRYABLE_CODES.has(apiError.code) && networkRetries < NETWORK_RETRY_MAX) {
        await sleep(backoffDelay(networkRetries))
        networkRetries += 1
        // Do not advance the attempt counter on a retryable failure: re-poll
        // the same state. `continue` here keeps `attempt` stable for this loop
        // pass by decrementing before the for-step.
        attempt -= 1
        continue
      }
      return { status: 'error', error: apiError }
    }

    // A successful (non-retryable) response resets the network-retry counter.
    networkRetries = 0

    switch (result.code) {
      case 801:
        opts.onStatus?.('scanning')
        break
      case 802:
        opts.onStatus?.('confirming')
        break
      case 800:
        return { status: 'expired' }
      case 803: {
        const cookie = result.cookie
        if (!cookie) {
          return {
            status: 'error',
            error: new ApiError({
              code: 'SERVER_ERROR',
              message: '登录成功但未返回凭证'
            })
          }
        }
        // Authorized — give the UI immediate feedback before the (network)
        // account fetch so the user isn't left staring at "confirm on phone".
        opts.onStatus?.('authorized')
        try {
          const account = await getAccount(cookie)
          const profile = profileFromAccountResult(account)
          if (!profile) {
            // Cookie is valid but profile fetch returned nothing usable.
            // Surface as error so the store can offer a manual retry.
            return {
              status: 'error',
              error: new ApiError({
                code: 'SERVER_ERROR',
                message: '登录成功但获取账号资料失败'
              })
            }
          }
          return { status: 'success', profile, cookie }
        } catch (error) {
          return { status: 'error', error: toApiError(error) }
        }
      }
    }

    // Wait for the next interval, but bail out early if cancelled mid-wait.
    if (signal?.aborted) return { status: 'cancelled' }
    await sleep(intervalMs)
  }

  // Exhausted all attempts without a terminal state — treat as expired.
  return { status: 'expired' }
}

/**
 * Verify a persisted session cookie. Returns the profile + (possibly refreshed)
 * cookie when the session is valid, or `null` when logged out / invalid.
 *
 * `login_refresh` is best-effort: NetEase's token refresh endpoint can return a
 * non-200 even for a still-valid session, so a refresh failure must NOT log the
 * user out. We mint a fresh cookie when we can, then treat `login/status` as the
 * source of truth — logged in iff it returns a profile. On any status failure,
 * return `null` (boot-time check must never throw — callers fall back to
 * `logged-out`).
 */
export async function refreshLoginStatus(
  cookie: string
): Promise<{ profile: UserProfile; cookie: string } | null> {
  if (!cookie) return null

  // Try to refresh the cookie, but tolerate failure — fall back to the existing
  // one, which may still validate against /login/status.
  let activeCookie = cookie
  try {
    const refreshed = await refreshLogin(cookie)
    if (refreshed.cookie) activeCookie = refreshed.cookie
  } catch {
    // ignore; keep the existing cookie
  }

  // 故意不 catch getLoginStatus:网络错误(本地 server 未就绪等)让它抛出,由 init()
  // 区分"网络错误(保留 cookie 下次重试)"与"业务未登录(清空)"。此前统一 catch 成 null
  // 会导致 dev 模式 server 启动慢时 init() 误判 cookie 过期、清空登录态,每次重启都需重新登录。
  const status = await getLoginStatus(activeCookie)
  if (status.profile && status.profile.userId) {
    return { profile: status.profile, cookie: activeCookie }
  }
  return null
}

/** Server-side logout. Always resolves; transport errors are swallowed so a
 * server hiccup never blocks local sign-out. */
export async function performLogout(cookie: string): Promise<void> {
  try {
    await logoutEndpoint(cookie)
  } catch {
    // Local logout must not be blocked by a server failure.
  }
}

/**
 * Send an SMS verification code to a phone. The 60s resend countdown is owned
 * by the UI (PhoneLoginForm.vue); this just forwards to the endpoint and lets
 * the ApiError propagate so the form can surface the server's message.
 */
export async function sendCaptchaCode(phone: string): Promise<void> {
  await sendCaptcha(phone)
}

/**
 * Login with phone + SMS captcha. On success resolves the profile + session
 * cookie (fetched via the same account path the QR flow uses); any failure is
 * normalized into { status: 'error', error } so the caller can show the NetEase
 * message (e.g. "验证码错误").
 */
export async function loginWithCaptcha(phone: string, captcha: string): Promise<PhoneLoginOutcome> {
  try {
    const { cookie } = await loginCellphone(phone, captcha)
    if (!cookie) {
      return {
        status: 'error',
        error: new ApiError({ code: 'SERVER_ERROR', message: '登录成功但未返回凭证' })
      }
    }
    const account = await getAccount(cookie)
    const profile = profileFromAccountResult(account)
    if (!profile) {
      return {
        status: 'error',
        error: new ApiError({ code: 'SERVER_ERROR', message: '登录成功但获取账号资料失败' })
      }
    }
    return { status: 'success', profile, cookie }
  } catch (error) {
    return { status: 'error', error: toApiError(error) }
  }
}
