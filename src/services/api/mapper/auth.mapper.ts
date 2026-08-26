import type { AccountResult, LoginStatusResult, QrCheckResult, UserProfile } from '@/domain/user'
import type {
  AccountResultDto,
  LoginStatusDto,
  ProfileDto,
  QrCheckDto,
  RefreshDto
} from '../types/dto'

/** Map a NetEase profile DTO to the domain `UserProfile` with safe defaults. */
export function mapProfileDto(dto: ProfileDto | null | undefined): UserProfile {
  return {
    userId: dto?.userId ?? 0,
    nickname: dto?.nickname ?? '',
    avatarUrl: dto?.avatarUrl ?? undefined,
    signature: dto?.signature ?? undefined,
    vipType: dto?.vipType ?? undefined
  }
}

/**
 * Map a QR-check DTO to the discriminated `QrCheckResult`. The mapper gives
 * safe defaults for missing fields (e.g. an 802 missing avatarUrl → empty
 * string), so the caller can branch on `code` without null-checking.
 */
export function mapQrCheckDto(dto: QrCheckDto): QrCheckResult {
  switch (dto.code) {
    case 800:
      return { code: 800 }
    case 801:
      return { code: 801 }
    case 802:
      return {
        code: 802,
        avatarUrl: dto.avatarUrl ?? '',
        nickname: dto.nickname ?? ''
      }
    case 803:
      return { code: 803, cookie: dto.cookie ?? '' }
  }
}

/**
 * Map a `/login/status` or `/user/account` DTO to the domain result.
 *
 * The two api-enhanced endpoints return DIFFERENT shapes: `login_status.js`
 * nests the account/profile payload under `data`, while `user_account.js`
 * returns it at the top level. We unwrap `dto.data ?? dto` to support both —
 * reading only `dto.data` would silently miss `/user/account`'s profile and
 * make a successful login look like "failed to load account".
 */
export function mapAccountResultDto(
  dto: LoginStatusDto | AccountResultDto
): LoginStatusResult & AccountResult {
  const root = dto.data ?? dto
  const account = root.account
    ? { id: root.account.id, userName: root.account.userName ?? undefined }
    : undefined
  const profile = root.profile ? mapProfileDto(root.profile) : undefined
  return { account, profile }
}

/**
 * Extract the refreshed cookie string from a `/login/refresh` DTO. Falls back
 * to the prior cookie when the response omits one.
 */
export function mapRefreshDto(dto: RefreshDto, fallbackCookie: string): string {
  return dto.cookie ?? fallbackCookie
}

export { mapAccountResultDto as mapLoginStatusDto }
