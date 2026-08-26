/**
 * 个人中心领域模型。
 *
 * 这些模型由 personal-center mapper 从 api-enhanced DTO 防御式映射而来,
 * 只保留 UI 需要的安全字段。绑定信息只暴露"已绑定/未绑定"状态,不含
 * 手机号/邮箱/token 等敏感明文。
 */
import type { Playlist } from './playlist'
import type { Song } from './song'

/** 个人中心顶部资料概览(基于 /user/account + /user/detail)。 */
export interface PersonalCenterProfile {
  userId: number
  nickname: string
  avatarUrl?: string
  signature?: string
  backgroundUrl?: string
  vipType?: number
  gender?: number
  /** 账号类型:0 普通用户,其它为网易音乐人/VIP 等。 */
  userType?: number
}

/** 用户统计数量(基于 /user/subcount)。各字段可能缺失。 */
export interface UserStats {
  /** 创建的歌单数量(部分接口不返回,从歌单列表长度推断)。 */
  playlistCount?: number
  /** 收藏的歌手数量。 */
  artistCount?: number
  /** 收藏的专辑数量。 */
  albumCount?: number
  /** 收藏的 MV 数量。 */
  mvCount?: number
  /** 收藏的播客/电台数量。 */
  djRadioCount?: number
}

/** 用户等级与听歌/登录进度(基于 /user/level)。 */
export interface UserLevelInfo {
  /** 当前等级。 */
  level: number
  /** 是否已达满级。 */
  full?: boolean
  /** 当前等级进度(0-100,由 mapper 归一化)。 */
  progress?: number
  /** 当前登录次数。 */
  nowLoginCount?: number
  /** 当前听歌次数。 */
  nowPlayCount?: number
  /** 升下一级需要的登录次数。 */
  nextLoginCount?: number
  /** 升下一级需要的听歌次数。 */
  nextPlayCount?: number
  /** 等级权益信息。 */
  info?: string
}

/** 绑定类型。 */
export type UserBindingType = 'phone' | 'email' | 'weibo' | 'wechat' | 'qq' | 'netease' | 'unknown'

/** 绑定安全摘要:只暴露类型与是否已绑定,不含敏感明文。 */
export interface UserBindingSummary {
  type: UserBindingType
  bound: boolean
}

/** 听歌记录条目(基于 /user/record)。 */
export interface UserPlayRecord {
  /** 播放次数(周榜/总榜)。 */
  playCount: number
  song: Song
}

/** 喜欢音乐概览(基于 /likelist)。 */
export interface UserLikedSongsOverview {
  /** 喜欢歌曲 id 列表(可能很长,UI 只取数量与首屏)。 */
  ids: number[]
  /** 数量。 */
  count: number
}

/** 收藏概览(基于 /artist/sublist、/album/sublist、/mv/sublist 首屏)。 */
export interface UserCollectionOverview {
  artists: { id: number; name: string; picUrl?: string }[]
  artistCount: number
  albums: { id: number; name: string; picUrl?: string; artistName?: string }[]
  albumCount: number
  mvs: { id: number; name: string; coverUrl?: string; artistName?: string }[]
  mvCount: number
}

/** 每日签到状态。 */
export interface DailySigninState {
  /** 是否已签到(当日)。 */
  signed: boolean
  /** 签到获得的积分(成功时)。 */
  point?: number
  /** 最近一次签到结果文案。 */
  message?: string
}

/** 个人中心各数据区块,用于独立加载/错误状态。 */
export type PersonalCenterSection =
  | 'profile'
  | 'stats'
  | 'level'
  | 'bindings'
  | 'playlists'
  | 'records'
  | 'likedSongs'
  | 'collections'
  | 'dailySignin'

/** 个人中心歌单分组(创建/收藏)。 */
export interface PersonalCenterPlaylists {
  created: Playlist[]
  subscribed: Playlist[]
}

/** 个人中心完整概览数据。 */
export interface PersonalCenterOverview {
  profile: PersonalCenterProfile | null
  stats: UserStats | null
  level: UserLevelInfo | null
  bindings: UserBindingSummary[]
  playlists: PersonalCenterPlaylists
  records: UserPlayRecord[]
  likedSongs: UserLikedSongsOverview
  collections: UserCollectionOverview
  dailySignin: DailySigninState
}
