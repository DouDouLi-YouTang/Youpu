/**
 * 个人中心 mapper:把 api-enhanced DTO 防御式映射为稳定 domain 模型。
 *
 * 绑定信息只保留"类型 + 是否已绑定",绝不暴露手机号/邮箱/token 明文。
 */
import type {
  DailySigninState,
  PersonalCenterProfile,
  UserBindingSummary,
  UserBindingType,
  UserCollectionOverview,
  UserLevelInfo,
  UserLikedSongsOverview,
  UserPlayRecord,
  UserStats
} from '@/domain/personal-center'
import type { Song } from '@/domain/song'
import type {
  AlbumSublistResponseDto,
  ArtistSublistResponseDto,
  DailySigninDto,
  MvSublistResponseDto,
  UserBindingItemDto,
  UserBindingResponseDto,
  UserLevelDto,
  UserRecordItemDto,
  UserRecordResponseDto,
  UserSubcountDto
} from '../types/dto'
import { mapSongDto } from './song.mapper'

/** 扩展的 /user/detail profile DTO(比 UserProfileDto 多几个字段)。 */
interface UserDetailProfileDto {
  userId: number
  nickname: string
  avatarUrl?: string | null
  signature?: string | null
  backgroundUrl?: string | null
  vipType?: number | null
  gender?: number | null
  userType?: number | null
}

export function mapPersonalCenterProfile(dto: UserDetailProfileDto): PersonalCenterProfile {
  return {
    userId: dto.userId,
    nickname: dto.nickname,
    avatarUrl: dto.avatarUrl ?? undefined,
    signature: dto.signature ?? undefined,
    backgroundUrl: dto.backgroundUrl ?? undefined,
    vipType: dto.vipType ?? undefined,
    gender: dto.gender ?? undefined,
    userType: dto.userType ?? undefined
  }
}

export function mapUserStats(dto: UserSubcountDto): UserStats {
  return {
    playlistCount: dto.playlistCount ?? undefined,
    artistCount: dto.artistCount ?? undefined,
    albumCount: dto.albumCount ?? undefined,
    mvCount: dto.mvCount ?? undefined,
    djRadioCount: dto.djRadioCount ?? undefined
  }
}

export function mapUserLevel(dto: UserLevelDto): UserLevelInfo | null {
  const data = dto.data
  if (!data || data.level == null) return null
  return {
    level: data.level,
    full: data.full ?? undefined,
    progress: data.progress ?? undefined,
    nowLoginCount: data.nowLoginCount ?? undefined,
    nowPlayCount: data.nowPlayCount ?? undefined,
    nextLoginCount: data.nextLoginCount ?? undefined,
    nextPlayCount: data.nextPlayCount ?? undefined,
    info: data.info ?? undefined
  }
}

function bindingTypeFromCode(code?: number | null): UserBindingType {
  switch (code) {
    case 1:
      return 'phone'
    case 2:
      return 'email'
    case 3:
      return 'weibo'
    case 4:
      return 'wechat'
    case 5:
      return 'qq'
    case 10:
      return 'netease'
    default:
      return 'unknown'
  }
}

export function mapUserBindings(dto: UserBindingResponseDto): UserBindingSummary[] {
  const list = dto.bindings ?? dto.binding ?? []
  return list.map((item: UserBindingItemDto) => ({
    type: bindingTypeFromCode(item.type),
    bound: !item.expired
  }))
}

export function mapUserPlayRecords(dto: UserRecordResponseDto): UserPlayRecord[] {
  const list = dto.weekData ?? dto.allData ?? []
  return list
    .filter(
      (
        item: UserRecordItemDto
      ): item is UserRecordItemDto & { song: NonNullable<UserRecordItemDto['song']> } =>
        Boolean(item.song)
    )
    .map((item) => ({
      playCount: item.playCount ?? 0,
      song: mapSongDto(item.song) as Song
    }))
}

export function mapLikedSongsOverview(ids: number[]): UserLikedSongsOverview {
  const safe = Array.isArray(ids) ? ids.filter((id) => Number.isFinite(id)) : []
  return { ids: safe, count: safe.length }
}

export function mapUserCollection(
  artists: ArtistSublistResponseDto,
  albums: AlbumSublistResponseDto,
  mvs: MvSublistResponseDto
): UserCollectionOverview {
  const artistList = artists.data?.artists ?? []
  const albumList = albums.data?.albums ?? []
  const mvList = mvs.data?.mvs ?? []

  return {
    artists: artistList.map((a) => ({
      id: a.id,
      name: a.name,
      picUrl: a.picUrl ?? undefined
    })),
    artistCount: artists.data?.count ?? artistList.length,
    albums: albumList.map((a) => ({
      id: a.id,
      name: a.name,
      picUrl: a.picUrl ?? undefined,
      artistName: a.artist?.name ?? a.artists?.[0]?.name ?? undefined
    })),
    albumCount: albums.data?.count ?? albumList.length,
    mvs: mvList.map((m) => ({
      id: m.id,
      name: m.name ?? m.title ?? '',
      coverUrl: m.cover ?? m.imgurl ?? undefined,
      artistName: m.artistName ?? m.artists?.[0]?.name ?? undefined
    })),
    mvCount: mvs.data?.count ?? mvList.length
  }
}

export function mapDailySignin(dto: DailySigninDto): DailySigninState {
  // 网易云:code 200 成功(含 point),code -2 已签到,其它失败。
  if (dto.code === 200) {
    return {
      signed: true,
      point: dto.point ?? undefined,
      message: dto.point != null ? `签到成功，积分 +${dto.point}` : '签到成功'
    }
  }
  if (dto.code === -2) {
    return { signed: true, message: '今日已签到' }
  }
  return {
    signed: false,
    message: dto.msg ?? dto.message ?? '签到失败，请稍后重试'
  }
}
