import { defineStore } from 'pinia'

import type { LoginState, PhoneLoginOutcome, QrStatus, UserProfile } from '@/domain/user'
import { ApiError, toApiError } from '@/services/api/errors'
import {
  loginWithCaptcha as loginWithCaptchaRequest,
  performLogout,
  refreshLoginStatus,
  sendCaptchaCode as sendCaptchaCodeRequest,
  startQrLogin,
  type QrPollState
} from '@/services/auth-service'
import { resetAllPrivateData } from './private-data'

/**
 * QR-polling non-function handles (AbortController + nothing else here besides
 * an inflight flag) live at module scope, NOT in Pinia `actions`. Pinia's
 * options store wraps every `actions` member in an action proxy, which
 * corrupts non-function values — the documented pit in `player.store.ts`.
 *
 * Only one QR login can be in flight at a time; the module-level handles track
 * it. `cancelQrPolling()` is exported so the UI (LoginPage.vue) can stop the
 * loop on unmount.
 */
let qrAbort: AbortController | null = null
let qrInflight = false

/** localStorage key for persisted auth state. Used by both the persist config
 * and `logout` (which removes it outright on sign-out). */
const PERSIST_KEY = 'muice:auth'

/**
 * Cancel any in-flight QR polling loop. Safe to call when nothing is polling.
 * Called from `LoginPage.onBeforeUnmount` and from `logout`/`regenerateQr`.
 */
export function cancelQrPolling(): void {
  if (qrAbort) {
    qrAbort.abort()
    qrAbort = null
  }
  qrInflight = false
}

interface AuthState {
  loginState: LoginState
  profile: UserProfile | null
  /** Session cookie. Persisted to localStorage (Sprint 1 temp; keychain TODO). */
  cookie: string
  qrStatus: QrStatus
  /** Base64 QR image dataURL, shown while `qrStatus` is scanning/confirming. */
  qrimg: string
  /** Human-readable QR status message for the UI. */
  qrMessage: string
  loading: boolean
  error: ApiError | null
  /** Set when the session was invalidated mid-use (401); drives the
   * "登录已过期" hint + redirect. Transient, not persisted. */
  expired: boolean
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    loginState: 'unknown',
    profile: null,
    cookie: '',
    qrStatus: 'idle',
    qrimg: '',
    qrMessage: '',
    loading: false,
    error: null,
    expired: false
  }),

  getters: {
    isLoggedIn(): boolean {
      return this.loginState === 'logged-in' && this.cookie !== ''
    },
    avatarUrl(): string | undefined {
      return this.profile?.avatarUrl
    },
    nickname(): string {
      return this.profile?.nickname ?? ''
    },
    userId(): number | undefined {
      return this.profile?.userId
    }
  },

  actions: {
    /**
     * Boot-time initialization. Verifies the persisted cookie (if any) and
     * settles `loginState` to `logged-in` or `logged-out`. Must not throw —
     * called from `main.ts` before/after mount. Safe to await but not required.
     */
    async init(): Promise<void> {
      if (this.cookie) {
        this.loading = true
        try {
          const result = await refreshLoginStatus(this.cookie)
          if (result) {
            this.profile = result.profile
            this.cookie = result.cookie
            this.loginState = 'logged-in'
          } else {
            this.clearSession()
          }
        } catch {
          // 网络错误(本地 server 未就绪等):保留 cookie + loginState 不清空,下次启动重试。
          // 若 cookie 实际已过期,后续用户态请求 401 会触发 handleUnauthorized 清空。
          // 此前无差别 clearSession 导致 dev 模式 server 启动慢时每次重启都丢登录态。
        }
        this.loading = false
      } else {
        this.loginState = 'logged-out'
      }
    },

    /**
     * Kick off a QR login. Generates the key + image (so `qrimg` is set before
     * the first poll) then polls `auth-service.startQrLogin`. Updates
     * `qrStatus` / `qrMessage` on each transition.
     *
     * Cancellation: the module-level AbortController is aborted by
     * `cancelQrPolling()` (called on page unmount / logout / regenerate).
     * When aborted, the store silently returns — no error state is set.
     */
    async startQrLogin(): Promise<void> {
      if (qrInflight) return
      qrInflight = true
      cancelQrPolling()
      const controller = new AbortController()
      qrAbort = controller

      this.qrStatus = 'generating'
      this.qrimg = ''
      this.qrMessage = '正在生成二维码…'
      this.error = null
      this.expired = false

      const onStatus = (status: QrPollState) => {
        if (status === 'scanning') {
          this.qrStatus = 'scanning'
          this.qrMessage = '请使用网易云音乐 App 扫码登录'
        } else if (status === 'confirming') {
          this.qrStatus = 'confirming'
          this.qrMessage = '扫描成功，请在手机上确认登录'
        } else if (status === 'authorized') {
          // 803 detected; profile fetch in flight. Immediate feedback so the
          // user isn't left waiting after authorizing on their phone.
          this.qrStatus = 'confirming'
          this.qrMessage = '登录成功，正在加载账号信息…'
        }
      }

      // The service hands the generated QR image back here before polling, so
      // the page can render the scannable code immediately and move to the
      // "waiting for scan" state.
      const onQrImage = (img: string) => {
        this.qrimg = img
        this.qrStatus = 'scanning'
        this.qrMessage = '请使用网易云音乐 App 扫码登录'
      }

      let outcome
      try {
        outcome = await startQrLogin({ signal: controller.signal, onStatus, onQrImage })
      } catch (error) {
        // startQrLogin swallows its own errors into `outcome.status === 'error'`,
        // but guard against any unexpected throw here.
        this.qrStatus = 'error'
        this.qrMessage = '登录失败，请重试'
        this.error = toApiError(error)
        qrInflight = false
        qrAbort = null
        return
      }

      // If aborted mid-flight, startQrLogin returns `{ status: 'cancelled' }`.
      // Don't overwrite a status already moved on by regenerate/logout.
      if (controller.signal.aborted) {
        qrInflight = false
        qrAbort = null
        return
      }

      switch (outcome.status) {
        case 'success':
          this.profile = outcome.profile
          this.cookie = outcome.cookie
          this.loginState = 'logged-in'
          this.qrStatus = 'logged-in'
          this.qrMessage = '登录成功'
          break
        case 'expired':
          this.qrStatus = 'expired'
          this.qrMessage = '二维码已过期，点击刷新'
          break
        case 'cancelled':
          // Silent — caller aborted intentionally.
          break
        case 'error':
          this.qrStatus = 'error'
          this.qrMessage = outcome.error.message || '登录失败，请重试'
          this.error = outcome.error
          break
      }

      qrInflight = false
      qrAbort = null
    },

    /** Regenerate the QR after expiry/error. Stops the old loop first. */
    async regenerateQr(): Promise<void> {
      cancelQrPolling()
      await this.startQrLogin()
    },

    /**
     * Send an SMS captcha to a phone. Throws ApiError (carrying the NetEase
     * message) on failure; the 60s resend countdown is enforced by the UI.
     */
    async sendCaptchaCode(phone: string): Promise<void> {
      await sendCaptchaCodeRequest(phone)
    },

    /**
     * Login with phone + SMS captcha. On success sets the session (profile +
     * cookie + loginState), the same as a successful QR login. Returns the
     * outcome so the form can render the error message.
     */
    async loginWithCaptcha(phone: string, captcha: string): Promise<PhoneLoginOutcome> {
      const outcome = await loginWithCaptchaRequest(phone, captcha)
      if (outcome.status === 'success') {
        this.profile = outcome.profile
        this.cookie = outcome.cookie
        this.loginState = 'logged-in'
      }
      return outcome
    },

    /**
     * Refresh login status + profile from the server. Used by the UI to
     * re-verify the session (e.g. after a 401 elsewhere). Does not throw.
     */
    async refreshLoginStatus(): Promise<void> {
      if (!this.cookie) return
      this.loading = true
      try {
        const result = await refreshLoginStatus(this.cookie)
        if (result) {
          this.profile = result.profile
          this.cookie = result.cookie
          this.loginState = 'logged-in'
        } else {
          this.clearSession()
        }
      } catch {
        // 网络错误(本地 server 未就绪等):保留 cookie + loginState,后续 401 触发
        // handleUnauthorized 清空(同 init)。JSDoc 契约:本 action 不抛错。
      }
      this.loading = false
    },

    /**
     * Log out: cancel polling, call server logout (best-effort), clear session.
     * Always resolves even if the server call fails — local sign-out must not
     * be blocked.
     */
    async logout(): Promise<void> {
      cancelQrPolling()
      const cookie = this.cookie
      this.clearSession()
      // Remove the persisted blob outright so no stale credential lingers in
      // localStorage (clearSession alone would leave an empty-but-present key).
      localStorage.removeItem(PERSIST_KEY)
      resetAllPrivateData()
      await performLogout(cookie)
    },

    /**
     * Session was invalidated mid-use (a user-private request returned 401).
     * Clear local session + private data and flag `expired` so the UI can show
     * "登录已过期". Does NOT call the server logout — the cookie is already
     * invalid. An `isLoggedIn` watcher (App.vue) handles the redirect to /login.
     */
    handleUnauthorized(): void {
      // 去重:多个请求同时 401 只标记一次(App.vue watch expired 弹 Modal 引导重新登录)
      if (this.expired) return
      cancelQrPolling()
      this.expired = true
    },

    /** 登录过期 Modal 确认后执行:清 session 触发 App.vue watch 跳转 login。 */
    confirmSessionExpiry(): void {
      localStorage.removeItem(PERSIST_KEY)
      resetAllPrivateData()
      this.clearSession()
    },

    clearError(): void {
      this.error = null
    },

    /** Reset all session state to logged-out. Does not touch the server. */
    clearSession(): void {
      this.loginState = 'logged-out'
      this.profile = null
      this.cookie = ''
      this.qrStatus = 'idle'
      this.qrimg = ''
      this.qrMessage = ''
      this.error = null
      this.expired = false
    }
  },

  persist: {
    key: PERSIST_KEY,
    pick: ['cookie', 'profile', 'loginState']
  }
})
