/**
 * 个人中心私有接口。
 *
 * 全部需要登录 cookie,使用 `requestWithCookie({ noCache: true })` 避免
 * api-enhanced 2 分钟缓存导致跨账号/过期数据残留。uid + cookie 由调用方
 * (personal-center store) 从 auth.store 传入,本层不导入 store。
 */
import type {
  DailySigninState,
  PersonalCenterProfile,
  UserBindingSummary,
  UserCollectionOverview,
  UserLevelInfo,
  UserLikedSongsOverview,
  UserPlayRecord,
  UserStats
} from '@/domain/personal-center'
import type { Playlist } from '@/domain/playlist'
import { requestWithCookie } from '../api-client'
import {
  mapDailySignin,
  mapLikedSongsOverview,
  mapPersonalCenterProfile,
  mapUserBindings,
  mapUserCollection,
  mapUserLevel,
  mapUserPlayRecords,
  mapUserStats
} from '../mapper/personal-center.mapper'
import { mapPlaylistDto } from '../mapper/playlist.mapper'
import type {
  AlbumSublistResponseDto,
  ArtistSublistResponseDto,
  DailySigninDto,
  MvSublistResponseDto,
  PlaylistDto,
  UserBindingResponseDto,
  UserLevelDto,
  UserRecordResponseDto,
  UserSubcountDto
} from '../types/dto'

interface UserDetailResponseDto {
  code: number
  profile: {
    userId: number
    nickname: string
    avatarUrl?: string | null
    signature?: string | null
    backgroundUrl?: string | null
    vipType?: number | null
    gender?: number | null
    userType?: number | null
  } | null
}

/** /user/detail:当前账号更丰富的资料字段。 */
export async function getPersonalProfile(
  uid: number,
  cookie: string
): Promise<PersonalCenterProfile> {
  const { data } = await requestWithCookie<UserDetailResponseDto>({
    url: '/user/detail',
    method: 'POST',
    noCache: true,
    cookie,
    params: { uid }
  })
  if (!data.profile) throw new Error('未获取到用户资料')
  return mapPersonalCenterProfile(data.profile)
}

/** /user/subcount:用户统计数量。 */
export async function getUserStats(cookie: string): Promise<UserStats> {
  const { data } = await requestWithCookie<UserSubcountDto>({
    url: '/user/subcount',
    method: 'POST',
    noCache: true,
    cookie
  })
  return mapUserStats(data)
}

/** /user/level:用户等级与听歌/登录进度。 */
export async function getUserLevel(cookie: string): Promise<UserLevelInfo | null> {
  const { data } = await requestWithCookie<UserLevelDto>({
    url: '/user/level',
    method: 'POST',
    noCache: true,
    cookie
  })
  return mapUserLevel(data)
}

/** /user/binding:绑定安全摘要(不含敏感明文)。 */
export async function getUserBindings(uid: number, cookie: string): Promise<UserBindingSummary[]> {
  const { data } = await requestWithCookie<UserBindingResponseDto>({
    url: '/user/binding',
    method: 'POST',
    noCache: true,
    cookie,
    params: { uid }
  })
  return mapUserBindings(data)
}

/** /user/playlist:当前账号创建与收藏的歌单。 */
export async function getPersonalPlaylists(
  uid: number,
  cookie: string,
  limit = 100
): Promise<Playlist[]> {
  const { data } = await requestWithCookie<{ code: number; playlist?: PlaylistDto[] }>({
    url: '/user/playlist',
    method: 'POST',
    noCache: true,
    cookie,
    params: { uid, limit }
  })
  return (data.playlist ?? []).map(mapPlaylistDto)
}

/** /user/record:听歌记录(周榜 type=1 / 总榜 type=0)。 */
export async function getUserPlayRecords(
  uid: number,
  cookie: string,
  type: 0 | 1 = 1
): Promise<UserPlayRecord[]> {
  const { data } = await requestWithCookie<UserRecordResponseDto>({
    url: '/user/record',
    method: 'POST',
    noCache: true,
    cookie,
    params: { uid, type }
  })
  return mapUserPlayRecords(data)
}

/** /likelist:喜欢歌曲 id 列表。 */
export async function getLikedSongsOverview(
  uid: number,
  cookie: string
): Promise<UserLikedSongsOverview> {
  const { data } = await requestWithCookie<{ code: number; ids?: number[] }>({
    url: '/likelist',
    noCache: true,
    cookie,
    params: { uid }
  })
  return mapLikedSongsOverview(data.ids ?? [])
}

/** /artist/sublist + /album/sublist + /mv/sublist:收藏概览(首屏)。 */
export async function getUserCollections(
  cookie: string,
  limit = 8
): Promise<UserCollectionOverview> {
  const [artists, albums, mvs] = await Promise.all([
    requestWithCookie<ArtistSublistResponseDto>({
      url: '/artist/sublist',
      method: 'POST',
      noCache: true,
      cookie,
      params: { limit }
    }),
    requestWithCookie<AlbumSublistResponseDto>({
      url: '/album/sublist',
      method: 'POST',
      noCache: true,
      cookie,
      params: { limit }
    }),
    requestWithCookie<MvSublistResponseDto>({
      url: '/mv/sublist',
      method: 'POST',
      noCache: true,
      cookie,
      params: { limit }
    })
  ])
  return mapUserCollection(artists.data, albums.data, mvs.data)
}

/** /daily_signin:每日签到。 */
export async function dailySignin(cookie: string): Promise<DailySigninState> {
  const { data } = await requestWithCookie<DailySigninDto>({
    url: '/daily_signin',
    method: 'POST',
    noCache: true,
    cookie
  })
  return mapDailySignin(data)
}
