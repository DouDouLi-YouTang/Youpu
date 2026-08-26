import type { UserProfile } from '@/domain/user'

interface UserProfileDto {
  userId: number
  nickname: string
  avatarUrl?: string
  signature?: string
  gender?: number
  province?: number
  city?: number
  birthday?: number
  backgroundUrl?: string
  userType?: number
  vipType?: number
}

export function mapUserDto(dto: UserProfileDto): UserProfile {
  return {
    userId: dto.userId,
    nickname: dto.nickname,
    avatarUrl: dto.avatarUrl,
    signature: dto.signature,
    vipType: dto.vipType
  }
}
