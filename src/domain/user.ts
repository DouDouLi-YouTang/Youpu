/**
 * Auth / login domain model.
 *
 * The UI and stores only ever see these types — raw NetEase DTOs are mapped to
 * them in the auth mapper. Field names follow the readable convention used
 * across the domain layer (`avatarUrl` retained because it is the canonical
 * NetEase field name and is already readable).
 */

/** Logged-in user profile. Stored (persisted) on `auth.store`. */
export interface UserProfile {
  userId: number
  nickname: string
  avatarUrl?: string
  signature?: string
  vipType?: number
}

/** Auth lifecycle state. `'unknown'` until `init()` finishes its cookie check. */
export type LoginState = 'logged-out' | 'logged-in' | 'unknown'

/**
 * QR-login flow status, surfaced to the UI.
 *
 * - `idle`        — no active login attempt
 * - `generating`  — requesting QR key / image
 * - `scanning`    — QR shown, waiting for scan (801)
 * - `confirming`  — scanned, awaiting phone confirmation (802)
 * - `logged-in`   — authorized (803), about to redirect
 * - `expired`     — QR timed out (800), user can regenerate
 * - `error`       — a non-business error occurred
 */
export type QrStatus =
  | 'idle'
  | 'generating'
  | 'scanning'
  | 'confirming'
  | 'logged-in'
  | 'expired'
  | 'error'

/** Result of a single QR check poll, discriminated by `code`. */
export type QrCheckResult =
  | { code: 800 }
  | { code: 801 }
  | { code: 802; avatarUrl: string; nickname: string }
  | { code: 803; cookie: string }

/** Login status verification result (from `/login/status` or `/user/account`). */
export interface LoginStatusResult {
  account?: { id: number; userName?: string }
  profile?: UserProfile
}

/** `/user/account` result is structurally identical to `LoginStatusResult`. */
export type AccountResult = LoginStatusResult

/**
 * Outcome of a full QR-login attempt, returned by `auth-service.startQrLogin`.
 * The store translates each variant into a `QrStatus` / `LoginState` update.
 */
export type QrLoginOutcome =
  | { status: 'success'; profile: UserProfile; cookie: string }
  | { status: 'expired' }
  | { status: 'cancelled' }
  | { status: 'error'; error: import('@/services/api/errors').ApiError }

/**
 * Outcome of a phone + SMS-captcha login attempt (auth-service.loginWithCaptcha).
 * No polling loop, so there is no expired/cancelled variant — only success/error.
 */
export type PhoneLoginOutcome =
  | { status: 'success'; profile: UserProfile; cookie: string }
  | { status: 'error'; error: import('@/services/api/errors').ApiError }
