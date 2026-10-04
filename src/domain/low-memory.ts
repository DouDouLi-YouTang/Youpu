import type { PlaybackMode, PlayableLevel, PlaybackState, QueueItem } from './player'

/**
 * 低内存模式(共享域类型:主进程 memory-mode / bg-session、preload、渲染层共用,
 * 改名要三端同步)。
 *
 * 行为:开启后窗口最小化/隐藏到托盘,经短暂延迟:
 *  - 正在播放 → 播放移交给隐藏的后台播放器窗口(仅一个 <audio> 的极小页面,
 *    无 Vue/UI,内存远小于主渲染进程)继续播,随后销毁主渲染进程;
 *  - 未在播放 → 直接销毁主渲染进程。
 * 用户重新唤起窗口时渲染进程重建,先向主进程拉取恢复载荷,无缝接管回播放,
 * 再由主进程销毁后台播放器窗口。
 */
export type LowMemoryMode = 'off' | 'on'

/**
 * 渲染进程持续写入 localStorage 的播放移交快照(键 muice:playback-handover)。
 * 主进程在销毁主渲染进程前读取它,把播放原样交给后台播放器。
 */
export interface PlaybackHandover {
  /** 音频元素当前真实的 src(签名 URL / muice-cache:// / muice-file://)。 */
  url: string
  /** 正在播放的队列项(后台 MediaSession 与恢复后的 UI 都要用)。 */
  currentItem: QueueItem | null
  /** 播放位置(ms)。主进程以音频引擎上报的进度为准,渲染层的值只作兜底。 */
  positionMs: number
  /** playing/buffering/loading 视为“需要后台接管”,其余直接回收不接管。 */
  state: PlaybackState
  volume: number
  muted: boolean
  playbackRate: number
  level: PlayableLevel
  /** 音频输出设备 id(空串=系统默认)。 */
  sinkId: string
  /** 私人 FM 模式:后台播完自动拉下一首 FM。 */
  fmMode: boolean
  /** 心动模式来源歌单 id。 */
  sourcePlaylistId: number | null
  /** 登录 cookie,后台解析播放 URL / FM / 心动接口需要。 */
  cookie: string
  /** 播放缓存设置快照(后台切歌解析本地缓存时遵守)。 */
  cacheEnabled: boolean
  cacheMaxBytes: number
  writtenAt: number
}

/** 渲染进程重建时向主进程拉取的恢复载荷(没有后台会话时为 null)。 */
export interface LowMemoryRestorePayload {
  /** 回收时是否在播放(决定重建后是否自动续播)。 */
  playing: boolean
  /** 后台播放器的最新进度(ms)。 */
  positionMs: number
  /**
   * 后台播放器当前音源 URL(签名 URL / muice-cache:// / muice-file://)。
   * 渲染进程重建后直接复用它续播(后台正在播说明有效),省一次解析请求,
   * 让接管空档缩到最短。null 时回退为按 currentItem 重新解析。
   */
  url: string | null
  /** 后台会话的队列状态;后台切歌 / FM 换队会改动它,比 localStorage 持久化队列新。 */
  queue: {
    items: QueueItem[]
    currentIndex: number
    mode: PlaybackMode
    shuffleOrder: number[]
  } | null
  /** 后台正在(或暂停在)的曲目。 */
  currentItem: QueueItem | null
  fmMode: boolean
  sourcePlaylistId: number | null
  level: PlayableLevel
  volume: number
  muted: boolean
  /** 播放倍速(回收前的值,渲染层恢复 UI 用)。 */
  playbackRate: number
}

/** 低内存模式状态(设置页展示 + 渲染层判断用)。 */
export interface LowMemoryStatus {
  mode: LowMemoryMode
  /** 当前主渲染进程是否已被回收。 */
  released: boolean
  /** 上一次回收的时间戳(ms),未回收过为 null。 */
  releasedAt: number | null
  /** 回收/重建次数。 */
  releaseCount: number
  /** 后台播放器是否正在播(渲染进程已回收、音乐仍在继续)。 */
  backgroundPlaying: boolean
}
