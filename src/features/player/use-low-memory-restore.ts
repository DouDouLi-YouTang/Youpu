import { watch } from 'vue'

import type { LowMemoryRestorePayload, PlaybackHandover } from '@/domain/low-memory'
import type { Song } from '@/domain/song'
import { useAuthStore } from '@/stores/auth.store'
import { usePlayerStore } from '@/stores/player.store'
import { usePlayQueueStore } from '@/stores/play-queue.store'
import { useSettingsStore } from '@/stores/settings.store'
import { takeRendererRecreated } from './renderer-session'

/**
 * 低内存模式的渲染层配套。音频永远在主进程引擎窗口播放(渲染层只发控制命令),
 * 本模块只做两件事:
 *
 * 1. 持续把“播放状态快照”写入 localStorage(muice:playback-handover):主进程
 *    回收本渲染进程时读取它,为降级会话提供队列/音质/cookie/缓存设置等上下文,
 *    保证渲染层不在期间自动切歌(FM/心动/顺序)语义一致。
 *
 * 2. 本渲染进程启动(冷启动/重建/刷新)后,向主进程 attach 并拉取引擎当前
 *    状态(applyLowMemoryRestore):引擎在播或暂停在有曲目 → 恢复队列/曲目/
 *    进度到 store,让 UI 与引擎对齐。**不重新 load 音频** —— 播放从未中断,
 *    恢复的只是界面。currentTrack 直接对齐引擎正在播的 URL,用户后续的
 *    暂停/续播/切歌都走 IPC 命令。
 */

export const PLAYBACK_HANDOVER_KEY = 'muice:playback-handover'

/** 快照写入节流:回收延迟 8s,快照最多滞后半秒,足够。 */
const HANDOVER_WRITE_INTERVAL_MS = 500
/** 播放位置回写节流:引擎每 250ms 推一次进度,没必要每次都写 store。 */
const POSITION_WRITE_INTERVAL_MS = 1000

/** 与 player.store 的 buildCoverUrl 一致(改名要同步)。 */
function handoverCoverUrl(song: Song): string | null {
  if (!song.coverUrl) return null
  return `muice-cover://${song.id}?url=${encodeURIComponent(song.coverUrl)}`
}

/** 持续把播放状态快照写入 localStorage。 */
function startHandoverTracking(): void {
  const player = usePlayerStore()
  const queue = usePlayQueueStore()
  const settings = useSettingsStore()
  const auth = useAuthStore()

  let pending: ReturnType<typeof setTimeout> | null = null
  const write = (): void => {
    pending = null
    // 没有当前曲目时不写,并且必须把旧快照清掉:localStorage 跨应用重启保留,
    // 留着上一轮运行(或清空队列前)的快照,回收渲染进程时主进程会把它当成本次
    // 的当前曲目 —— 恢复窗口后播放栏凭空出现一首没在播的歌,队列也被它覆盖。
    if (!player.currentItem) {
      try {
        localStorage.removeItem(PLAYBACK_HANDOVER_KEY)
      } catch {
        // 清不掉只影响降级会话的上下文,不影响播放
      }
      return
    }
    const handover: PlaybackHandover = {
      // 音源 URL 在引擎窗口,渲染层只有 currentTrack 里记录的值(降级会话
      // 解析下一首时会自己再解析,这个 url 只作参考)
      url: player.currentTrack?.url ?? '',
      currentItem: player.currentItem,
      positionMs: player.currentTimeMs,
      state: player.state,
      volume: player.volume,
      muted: player.muted,
      playbackRate: player.playbackRate,
      level: player.level,
      sinkId: settings.audioOutputDeviceId,
      fmMode: player.fmMode,
      sourcePlaylistId: player.sourcePlaylistId,
      cookie: auth.cookie,
      cacheEnabled: settings.playbackCacheEnabled,
      cacheMaxBytes: settings.playbackCacheMaxBytes,
      writtenAt: Date.now()
    }
    try {
      localStorage.setItem(PLAYBACK_HANDOVER_KEY, JSON.stringify(handover))
    } catch {
      // 配额满等异常:回收时读不到快照,只影响降级切歌的上下文,不影响播放
    }
  }
  const schedule = (): void => {
    if (pending != null) return
    pending = setTimeout(write, HANDOVER_WRITE_INTERVAL_MS)
  }

  // 启动先对齐一次:本代次还没播过歌时把上一轮的残留快照清掉(见 write)。
  write()

  // 位置不触发写入(引擎有精确进度),只在状态/曲目/设置变化时写。
  watch(
    () => [
      player.state,
      player.volume,
      player.muted,
      player.playbackRate,
      player.level,
      player.currentItem,
      player.currentTrack,
      player.fmMode,
      player.sourcePlaylistId,
      queue.items.length,
      queue.currentIndex,
      queue.mode,
      auth.cookie,
      settings.audioOutputDeviceId,
      settings.playbackCacheEnabled,
      settings.playbackCacheMaxBytes
    ],
    schedule
  )
}

/**
 * 启动钩子:必须在 main.ts 里、pinia 安装后立即调用(player.init() 之前)。
 * 开启快照写入与位置回写。
 */
export function useLowMemoryRestore(): void {
  takeRendererRecreated()
  startHandoverTracking()

  // 播放位置回写 store → queue.positionMs(回收时随快照留给降级会话/暂停恢复)。
  const player = usePlayerStore()
  const queue = usePlayQueueStore()
  let lastWrittenAt = 0
  watch(
    () => player.currentTimeMs,
    (ms) => {
      if (!player.currentItem) return
      const now = Date.now()
      if (now - lastWrittenAt < POSITION_WRITE_INTERVAL_MS) return
      lastWrittenAt = now
      queue.setPosition(ms)
    }
  )
}

/**
 * 启动后与音频引擎对齐:必须在 main.ts 里、usePlayerStore().init() 之后调用
 * (音量恢复会走控制器)。向主进程 attach(接管控制权,清除降级会话)并拉取
 * 引擎当前状态 —— 若引擎在播/暂停在有曲目,恢复队列与曲目到 store,UI 对齐,
 * 音频不动。
 */
export async function applyLowMemoryRestore(): Promise<void> {
  const api = window.muiceDesktop
  const payload = api?.audio ? await api.audio.attach().catch(() => null) : null
  const player = usePlayerStore()
  const queue = usePlayQueueStore()

  if (payload?.currentItem) {
    restoreFromEngine(payload)
  } else if (queue.items.length > 0 && !player.currentItem) {
    // 引擎没有曲目(冷启动或回收时未在播放):队列由 pinia persist 恢复,
    // 这里恢复当前曲目指针为暂停态;用户点播放时 player.play() 会解析并续播。
    const item = queue.current
    if (item) {
      player.currentItem = item
      player.currentCoverUrl = handoverCoverUrl(item.song)
      player.durationMs = item.song.durationMs || 0
      player.currentTimeMs = queue.positionMs
      player.state = 'paused'
      player.updateMediaSessionMetadata()
    }
  }
}

/** 从引擎状态恢复 store(UI 对齐,不碰音频)。 */
function restoreFromEngine(payload: LowMemoryRestorePayload): void {
  const player = usePlayerStore()
  const queue = usePlayQueueStore()

  // 渲染层不在期间降级会话可能已切歌/FM 换队:payload.queue 比本地持久化队列新
  if (payload.queue && payload.queue.items.length > 0) {
    queue.items = payload.queue.items
    queue.currentIndex = payload.queue.currentIndex
    queue.mode = payload.queue.mode
    queue.shuffleOrder = payload.queue.shuffleOrder
  } else if (payload.currentItem && !queue.items.some((i) => i.uid === payload.currentItem?.uid)) {
    queue.items = [payload.currentItem]
    queue.currentIndex = 0
  }

  player.fmMode = payload.fmMode
  player.sourcePlaylistId = payload.sourcePlaylistId
  // 音量/倍速恢复到引擎当前值并同步控制器(setVolume 会取消静音,故先音量后静音)
  player.setVolume(payload.volume)
  player.setPlaybackRate(payload.playbackRate)
  if (payload.muted !== player.muted) player.toggleMute()

  const item = payload.currentItem
  if (item) {
    player.currentItem = item
    player.currentCoverUrl = handoverCoverUrl(item.song)
    player.durationMs = item.song.durationMs || 0
    player.currentTimeMs = payload.positionMs
    queue.setPosition(payload.positionMs)
    // currentTrack 对齐引擎正在播的 URL(纯 UI 占位,不 load 音频):
    //  - 引擎在播:expiresAt 给最大值,避免 play() 误判 URL 过期重新解析
    //  - 引擎暂停:expiresAt 置 0,用户点播放时 play() 走 refreshUrlAndPlay
    //    重新解析(签名 URL 可能已过期),并按 currentTimeMs 续播
    if (payload.url) {
      player.currentTrack = {
        song: item.song,
        url: payload.url,
        expiresAt: payload.playing ? Number.MAX_SAFE_INTEGER : 0
      }
    }
    player.state = payload.playing ? 'playing' : 'paused'
    player.updateMediaSessionMetadata()
  }
}
