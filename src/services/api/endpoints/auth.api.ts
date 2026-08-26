import type { AccountResult, LoginStatusResult, QrCheckResult, UserProfile } from '@/domain/user'
import { ApiError } from '../errors'
import { request, requestWithCookie } from '../api-client'
import { mapAccountResultDto, mapQrCheckDto, mapRefreshDto } from '../mapper/auth.mapper'
import type {
  AccountResultDto,
  CaptchaSentDto,
  LoginCellphoneDto,
  LoginStatusDto,
  QrCheckDto,
  QrCreateDto,
  QrKeyDto,
  RefreshDto
} from '../types/dto'

/**
 * Auth endpoints. All use `requestWithCookie` (not `request`) because:
 * 1. The QR-check 800/801/802/803 codes are business states whitelisted by
 *    `requestWithCookie` — `request` would throw them as SERVER_ERROR.
 * 2. Login/refresh responses embed the session cookie in the body, which
 *    `requestWithCookie` captures into `result.cookie`.
 *
 * Cookie is passed in the POST body (`{ cookie }`) for the endpoints that need
 * a session, because api-enhanced assembles its `query` from req.query + req.body.
 *
 * Every call sets `noCache: true`: api-enhanced caches 200 responses for 2
 * minutes keyed on URL + header-cookies (NOT the body), so without busting it
 * the QR poll would read a stale state for seconds and login-status checks could
 * return outdated auth state. Freshness is mandatory for the whole auth flow.
 */

/** Request a QR-login unikey. */
export async function getQrKey(): Promise<{ unikey: string }> {
  const { data } = await requestWithCookie<QrKeyDto>({
    url: '/login/qr/key',
    method: 'POST',
    noCache: true,
    params: { type: 3 }
  })
  return { unikey: data.data?.unikey ?? '' }
}

/** Generate the QR image (base64 dataURL) for a key. */
export async function getQrCreate(
  key: string,
  opts?: { withImg?: boolean }
): Promise<{ qrurl: string; qrimg: string }> {
  const { data } = await requestWithCookie<QrCreateDto>({
    url: '/login/qr/create',
    method: 'POST',
    noCache: true,
    params: {
      key,
      qrimg: opts?.withImg ?? true,
      platform: 'pc'
    }
  })
  return {
    qrurl: data.data?.qrurl ?? '',
    qrimg: data.data?.qrimg ?? ''
  }
}

/**
 * Poll the QR-login state for a key. Returns a discriminated `QrCheckResult`.
 * The 800/801/802/803 codes never throw — they are returned as data.
 */
export async function checkQrStatus(key: string): Promise<QrCheckResult> {
  const { data } = await requestWithCookie<QrCheckDto>({
    url: '/login/qr/check',
    method: 'POST',
    noCache: true,
    params: { key, type: 3 }
  })
  return mapQrCheckDto(data)
}

/** Verify an existing session cookie. Returns account/profile or empty fields. */
export async function getLoginStatus(cookie: string): Promise<LoginStatusResult> {
  const { data } = await requestWithCookie<LoginStatusDto>({
    url: '/login/status',
    method: 'POST',
    noCache: true,
    params: { cookie }
  })
  return mapAccountResultDto(data)
}

/** Refresh a session; returns the new cookie (or the old one if none returned). */
export async function refreshLogin(cookie: string): Promise<{ cookie: string }> {
  const { data } = await requestWithCookie<RefreshDto>({
    url: '/login/refresh',
    method: 'POST',
    noCache: true,
    params: { cookie }
  })
  return { cookie: mapRefreshDto(data, cookie) }
}

/** Server-side logout. Return value is ignored. */
export async function logout(cookie: string): Promise<void> {
  await requestWithCookie({
    url: '/logout',
    method: 'POST',
    noCache: true,
    params: { cookie }
  })
}

/** Fetch account/profile with a session cookie. */
export async function getAccount(cookie: string): Promise<AccountResult> {
  const { data } = await requestWithCookie<AccountResultDto>({
    url: '/user/account',
    method: 'POST',
    noCache: true,
    params: { cookie }
  })
  return mapAccountResultDto(data)
}

/** Send an SMS verification code to a phone (/captcha/sent). Throws on failure. */
export async function sendCaptcha(phone: string): Promise<void> {
  const data = await request<CaptchaSentDto>({
    url: '/captcha/sent',
    method: 'POST',
    noCache: true,
    params: { phone, ctcode: '86' }
  })
  // NetEase signals "sent too frequently" with a 200 + data:false, not a 4xx.
  if (data.data === false) {
    throw new ApiError({
      code: 'RATE_LIMITED',
      message: data.message || '验证码发送太频繁，请稍后再试'
    })
  }
}

/** Login with phone + SMS captcha (/login/cellphone). Returns the session cookie. */
export async function loginCellphone(phone: string, captcha: string): Promise<{ cookie: string }> {
  const { data, cookie } = await requestWithCookie<LoginCellphoneDto>({
    url: '/login/cellphone',
    method: 'POST',
    noCache: true,
    params: { phone, captcha, ctcode: '86' }
  })
  return { cookie: cookie ?? data.cookie ?? '' }
}

/** Re-exported for callers that need the raw profile mapper. */
export { mapAccountResultDto } from '../mapper/auth.mapper'

/** Convenience: map an account result to just the profile (or null). */
export function profileFromAccountResult(result: AccountResult): UserProfile | null {
  return result.profile && result.profile.userId ? result.profile : null
}
