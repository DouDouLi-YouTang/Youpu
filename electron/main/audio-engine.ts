import type { LowMemoryRestorePayload, PlaybackHandover } from '../../src/domain/low-memory'
import type { PlaybackMode, PlayableLevel, QueueItem } from '../../src/domain/player'
import { decideBgAdvance, type BgAdvanceTrigger } from '../../src/features/player/core/bg-advance'
import { createQueueItem, resolveQueueItemIndex } from '../../src/features/player/core/queue'
import { getPersonalFm } from '../../src/services/api/endpoints/fm.api'
import { getIntelligencePlaylist } from '../../src/services/api/endpoints/intelligence.api'
import { resolvePlayableTrack } from '../../src/services/player-service'
import { BgPlayerWindow, type BgPlayerEvent, type BgMetaOptions } from './bg-player'
import { resolvePlaybackCache, warmPlaybackCache } from './playback-cache'

/**
 * 常驻音频引擎:音频永远在隐藏的极小窗口里播放,主渲染进程只通过 IPC 发控制
 * 命令(播放/暂停/seek/变速/音量/输出设备),从不持有音频 —— 因此回收渲染进程
 * 对播放零影响,重建渲染进程也不需要“接管音频”,只恢复 UI 即可。
 *
 * 两套驱动模式:
 *  - 渲染层驱动(常态):ended/error 由渲染层编排(播放历史/心动/FM/错误提示/
 *    跳过倒计时等),引擎事件转发给渲染层;
 *  - 降级会话(渲染层已被低内存模式回收):主进程用回收前抓的快照建立会话,
 *    自动切歌/FM/心动由 decideBgAdvance 驱动,语义与渲染层一致;渲染层重建
 *    attach 时清除。
 */

interface EngineQueueState {
  items: QueueItem[]
  currentIndex: number
  mode: PlaybackMode
  shuffleOrder: number[]
}

interface DeputySession {
  queue: EngineQueueState
  currentItem: QueueItem | null
  volume: number
  muted: boolean
  rate: number
  sinkId: string
  level: PlayableLevel
  cookie: string
  fmMode: boolean
  sourcePlaylistId: number | null
  cacheEnabled: boolean
  cacheMaxBytes: number
  consecutiveFailures: number
  retriedCurrent: boolean
  advancing: boolean
}

/** 心动模式一次拉取的候选数量(与渲染层 player store 保持一致)。 */
const HEART_CANDIDATE_COUNT = 20

/** ended 后等待渲染层接管的宽限:渲染层切歌会立刻发新 load,超时仍未 load
 *  说明渲染层不在/初始化中,由降级会话推进(若存在)。 */
const ENDED_GRACE_MS = 600

let playerWindow: BgPlayerWindow | null = null
let windowReady: Promise<void> | null = null

/** 引擎实时状态(不管谁驱动都维护;渲染层重建对齐 UI 用)。 */
let engineUrl: string | null = null
let engineItem: QueueItem | null = null
let enginePositionMs = 0
let enginePlaying = false
let engineVolume = 1
let engineMuted = false
let engineRate = 1
/** 渲染层最近一次 load 的时间戳:ended 宽限期判断渲染层是否已接管切歌。 */
let lastLoadAt = 0

/** 降级会话(渲染层被回收时才存在)。 */
let deputy: DeputySession | null = null

/** 回收时抓的渲染层队列快照:即使没建降级会话(回收时未在播放),
 *  渲染层重建后的恢复载荷也要用它还原完整歌单(引擎只知道当前曲目)。 */
let lastQueueCapture: EngineQueueState | null = null

let rendererAlive: () => boolean = () => false
let stateListener: ((playing: boolean, songName: string | null) => void) | null = null
let rendererForwarder: ((event: BgPlayerEvent) => void) | null = null

/** index.ts 注入:判断渲染层当前是否可用(窗口存在且 webContents 活着)。 */
export function attachAudioEngine(options: { isRendererAlive: () => boolean }): void {
  rendererAlive = options.isRendererAlive
}

/** 主进程(index.ts)订阅播放状态变化,用来刷新托盘菜单文字。 */
export function onEngineStateChanged(
  cb: (playing: boolean, songName: string | null) => void
): void {
  stateListener = cb
}

function notifyStateChanged(): void {
  stateListener?.(enginePlaying, engineItem?.song.name ?? null)
}

/** index.ts 注入:把引擎事件转发给活跃渲染层(media-action 映射到 tray:command)。 */
export function setEngineEventForwarder(fn: ((event: BgPlayerEvent) => void) | null): void {
  rendererForwarder = fn
}

function forwardToRenderer(event: BgPlayerEvent): void {
  rendererForwarder?.(event)
}

export function isEnginePlaying(): boolean {
  return enginePlaying
}

/** app.ready 时创建常驻引擎窗口(应用生命周期内一直存在)。 */
export function initAudioEngine(): void {
  if (playerWindow && !playerWindow.isDestroyed()) return
  try {
    playerWindow = new BgPlayerWindow()
    attachWindowEvents(playerWindow)
    windowReady = playerWindow.ready
    windowReady.catch((error) => {
      console.warn('[audio-engine] 引擎窗口加载失败:', error)
      playerWindow?.destroy()
      playerWindow = null
      windowReady = null
    })
  } catch (error) {
    console.warn('[audio-engine] 创建引擎窗口失败:', error)
    playerWindow = null
    windowReady = null
  }
}

function attachWindowEvents(win: BgPlayerWindow): void {
  win.events.on('event', (event: BgPlayerEvent) => {
    handleEngineEvent(event)
  })
}

function handleEngineEvent(event: BgPlayerEvent): void {
  switch (event.type) {
    case 'state': {
      if (event.state === 'playing') {
        enginePlaying = true
        enginePositionMs = event.positionMs
        notifyStateChanged()
      } else if (event.state === 'paused') {
        enginePlaying = false
        enginePositionMs = event.positionMs
        notifyStateChanged()
      } else if (event.state === 'ended') {
        enginePlaying = false
        enginePositionMs = 0
        notifyStateChanged()
        handleEngineEnded()
      } else if (event.state === 'error') {
        enginePlaying = false
        notifyStateChanged()
        handleEngineError()
      }
      // buffering/ready:不打断 playing 标记,直接转发渲染层
      forwardToRenderer(event)
      break
    }
    case 'position':
      enginePositionMs = event.positionMs
      forwardToRenderer(event)
      break
    case 'media-action':
      routeMediaAction(
        event.action === 'prev' ? 'prev' : event.action === 'next' ? 'next' : 'play-pause'
      )
      break
  }
}

/** 系统媒体键/SMTC 动作:渲染层可用就转发给渲染层编排,否则降级处理。 */
export function routeMediaAction(action: 'play-pause' | 'prev' | 'next'): void {
  if (rendererAlive()) {
    forwardToRenderer({ type: 'media-action', action })
    return
  }
  if (!playerWindow) return
  if (action === 'play-pause') {
    if (enginePlaying) playerWindow.pause()
    else playerWindow.play()
    return
  }
  void deputyAdvance(action === 'next' ? 'next' : 'prev')
}

// ---------------------------------------------------------------------------
// 渲染层命令入口(音频控制全部走这里,与渲染层 AudioController 接口对应)
// ---------------------------------------------------------------------------

export interface EngineLoadCommand {
  url: string
  resumeAtMs?: number
  autoplay: boolean
  volume: number
  muted: boolean
  rate: number
  sinkId?: string
  /** 正在加载的队列项:引擎记录它,渲染层不在时也能知道“现在播的是哪首”。 */
  item: QueueItem | null
}

async function withEngine(fn: (win: BgPlayerWindow) => void): Promise<void> {
  if (!playerWindow || playerWindow.isDestroyed()) {
    initAudioEngine()
  }
  const win = playerWindow
  if (!win || !windowReady) return
  try {
    await windowReady
  } catch {
    return
  }
  fn(win)
}

export async function engineLoad(cmd: EngineLoadCommand): Promise<void> {
  engineUrl = cmd.url
  engineItem = cmd.item
  enginePositionMs = cmd.resumeAtMs ?? 0
  engineVolume = cmd.volume
  engineMuted = cmd.muted
  engineRate = cmd.rate
  lastLoadAt = Date.now()
  await withEngine((win) => {
    win.load({
      url: cmd.url,
      resumeAtMs: cmd.resumeAtMs,
      autoplay: cmd.autoplay,
      volume: cmd.volume,
      muted: cmd.muted,
      rate: cmd.rate,
      sinkId: cmd.sinkId
    })
  })
}

export async function enginePlay(): Promise<void> {
  await withEngine((win) => win.play())
}

export async function enginePause(): Promise<void> {
  await withEngine((win) => win.pause())
}

export async function engineStop(): Promise<void> {
  engineUrl = null
  engineItem = null
  enginePositionMs = 0
  enginePlaying = false
  notifyStateChanged()
  await withEngine((win) => win.stop())
}

export async function engineSeek(ms: number): Promise<void> {
  enginePositionMs = ms
  await withEngine((win) => win.seek(ms))
}

export async function engineSetVolume(value: number, muted: boolean): Promise<void> {
  engineVolume = value
  engineMuted = muted
  await withEngine((win) => win.setVolume(value, muted))
}

export async function engineSetRate(value: number): Promise<void> {
  engineRate = value
  await withEngine((win) => win.setRate(value))
}

export async function engineSetSink(id: string): Promise<void> {
  await withEngine((win) => win.setSink(id))
}

/** 渲染层推送 SMTC 元数据(标题/艺术家/封面)。 */
export async function engineSetMeta(meta: BgMetaOptions): Promise<void> {
  await withEngine((win) => win.setMeta(meta))
}

/** 渲染层启动完成(接管控制权):清除降级会话与队列快照。 */
export function attachRenderer(): void {
  deputy = null
  lastQueueCapture = null
}

// ---------------------------------------------------------------------------
// 恢复载荷:渲染层重建/刷新后对齐 UI(不重新 load 音频,播放不受影响)
// ---------------------------------------------------------------------------

export function getEngineRestorePayload(): LowMemoryRestorePayload | null {
  if (!engineItem && !deputy && !lastQueueCapture) return null
  return {
    playing: enginePlaying,
    positionMs: enginePositionMs,
    url: engineUrl,
    queue: deputy?.queue ?? lastQueueCapture,
    currentItem: deputy?.currentItem ?? engineItem,
    fmMode: deputy?.fmMode ?? false,
    sourcePlaylistId: deputy?.sourcePlaylistId ?? null,
    volume: engineVolume,
    muted: engineMuted,
    playbackRate: deputy?.rate ?? engineRate
  }
}

// ---------------------------------------------------------------------------
// 降级会话:渲染层被回收后,由主进程按快照继续切歌
// ---------------------------------------------------------------------------

/**
 * 渲染层被回收时调用:记录队列快照(恢复载荷还原完整歌单用);
 * 引擎正在播则同时建立降级会话,渲染层不在期间由主进程自动切歌。
 */
export function rememberRendererSnapshot(
  queue: EngineQueueState | null,
  handover: PlaybackHandover | null
): void {
  const queueIndex = queue && queue.currentIndex >= 0 ? queue.currentIndex : -1
  const item =
    handover?.currentItem ?? (queueIndex >= 0 ? (queue?.items[queueIndex] ?? null) : null)
  const items = queue?.items?.length ? queue.items : item ? [item] : []

  lastQueueCapture = {
    items,
    // 必须按 uid 定位:handover 与队列是两份各自 JSON.parse 出来的数据,同一首歌
    // 的对象引用不同,indexOf 永远匹配不上(旧实现 Math.max(0, -1) 恒为 0,
    // 恢复窗口后队列高亮/下一首错位,降级会话也会从队首开始切歌)。
    currentIndex: resolveQueueItemIndex(items, item, queueIndex),
    mode: queue?.mode ?? 'sequence',
    shuffleOrder: queue?.shuffleOrder ?? []
  }

  if (isEnginePlaying() && items.length > 0) {
    deputy = {
      queue: lastQueueCapture,
      currentItem: item,
      volume: handover?.volume ?? 1,
      muted: handover?.muted ?? false,
      rate: handover?.playbackRate ?? 1,
      sinkId: handover?.sinkId ?? '',
      level: handover?.level ?? 'standard',
      cookie: handover?.cookie ?? '',
      fmMode: handover?.fmMode ?? false,
      sourcePlaylistId: handover?.sourcePlaylistId ?? null,
      cacheEnabled: handover?.cacheEnabled ?? false,
      cacheMaxBytes: handover?.cacheMaxBytes ?? 0,
      consecutiveFailures: 0,
      retriedCurrent: false,
      advancing: false
    }
    console.log(
      `[audio-engine] 降级会话已建立(队列 ${items.length} 首,当前:${item?.song.name ?? '无'})`
    )
  }
}

/** ended 后等待渲染层接管的宽限:渲染层切歌会立刻发新 load,超时仍未 load
 *  说明渲染层不在(已被回收),由降级会话推进。渲染层“活着但初始化中”的
 *  短暂窗口(<2s)撞上 ended 时可能丢失切歌——引擎停在暂停态,渲染层恢复后
 *  会看到暂停态并可手动继续,概率极低,不值得为它引入更复杂的握手。 */
function handleEngineEnded(): void {
  const loadMark = lastLoadAt
  setTimeout(() => {
    if (lastLoadAt !== loadMark) return // 渲染层已接管切歌(发出了新 load)
    if (enginePlaying) return // 已恢复播放(渲染层重播了当前曲)
    void deputyAdvance('ended')
  }, ENDED_GRACE_MS)
}

async function handleEngineError(): Promise<void> {
  if (!deputy) return
  const item = deputy.currentItem
  if (item && !deputy.retriedCurrent && !item.localFileUrl) {
    deputy.retriedCurrent = true
    const url = await resolveDeputySource(item)
    if (deputy && deputy.currentItem?.uid === item.uid && url) {
      engineLoad({
        url,
        resumeAtMs: enginePositionMs,
        autoplay: true,
        volume: deputy.volume,
        muted: deputy.muted,
        rate: deputy.rate,
        sinkId: deputy.sinkId || undefined,
        item
      })
      return
    }
  }
  await deputyAdvance('next')
}

// ---------------------------------------------------------------------------
// 降级切歌(复用渲染层语义的纯函数 + API 模块)
// ---------------------------------------------------------------------------

async function deputyAdvance(trigger: BgAdvanceTrigger): Promise<void> {
  const d = deputy
  if (!d || d.advancing) return
  d.advancing = true
  try {
    const decision = decideBgAdvance(
      {
        fmMode: d.fmMode,
        traversal: {
          itemsLength: d.queue.items.length,
          currentIndex: d.queue.currentIndex,
          mode: d.queue.mode,
          shuffleOrder: d.queue.shuffleOrder
        }
      },
      trigger
    )
    if (decision.kind === 'stop') {
      deputyStop()
      return
    }
    if (decision.kind === 'play') {
      await deputyPlay(d.queue.items[decision.index] ?? null)
      return
    }
    if (decision.kind === 'fm') {
      await deputyReplaceQueueWithFm()
      return
    }
    await deputyReplaceQueueWithHeart()
  } finally {
    if (deputy) deputy.advancing = false
  }
}

function deputyStop(): void {
  enginePause()
}

async function deputyPlay(item: QueueItem | null): Promise<void> {
  const d = deputy
  if (!d || !item) {
    deputyStop()
    return
  }
  d.currentItem = item
  d.queue.currentIndex = resolveQueueItemIndex(d.queue.items, item, d.queue.currentIndex)
  d.retriedCurrent = false
  engineItem = item
  const meta = metaForItem(item)
  const url = await resolveDeputySource(item)
  if (!deputy || deputy.currentItem?.uid !== item.uid) return
  if (!url) {
    d.consecutiveFailures += 1
    if (d.consecutiveFailures >= Math.min(Math.max(d.queue.items.length, 1), 5)) {
      console.warn('[audio-engine] 降级会话连续多首不可播,停止后台切歌(保留当前暂停态)')
      enginePause()
      return
    }
    await deputyAdvance('next')
    return
  }
  d.consecutiveFailures = 0
  void engineSetMeta(meta)
  await engineLoad({
    url,
    autoplay: true,
    volume: d.volume,
    muted: d.muted,
    rate: d.rate,
    sinkId: d.sinkId || undefined,
    item
  })
}

async function deputyReplaceQueueWithFm(): Promise<void> {
  const d = deputy
  if (!d) return
  if (!d.cookie) {
    deputyStop()
    return
  }
  try {
    const songs = await getPersonalFm(d.cookie)
    if (!deputy) return
    if (songs.length === 0) {
      deputyStop()
      return
    }
    d.queue = {
      items: songs.map((song) => createQueueItem(song, 'fm', Date.now())),
      currentIndex: 0,
      mode: 'sequence',
      shuffleOrder: []
    }
    await deputyPlay(d.queue.items[0] ?? null)
  } catch (error) {
    console.warn('[audio-engine] 降级拉取私人 FM 失败:', error)
    deputyStop()
  }
}

async function deputyReplaceQueueWithHeart(): Promise<void> {
  const d = deputy
  if (!d) return
  const seedSongId = d.currentItem?.song.id ?? null
  const pid = d.sourcePlaylistId
  if (!seedSongId || !pid || !d.cookie) {
    deputyStop()
    return
  }
  try {
    const songs = await getIntelligencePlaylist(seedSongId, pid, d.cookie, HEART_CANDIDATE_COUNT)
    if (!deputy) return
    const seen = new Set<number>()
    const candidates = songs.filter((song) => {
      if (song.id === seedSongId) return false
      if (seen.has(song.id)) return false
      seen.add(song.id)
      return true
    })
    if (candidates.length === 0) {
      deputyStop()
      return
    }
    d.queue = {
      items: candidates.map((song) => createQueueItem(song, 'playlist', Date.now())),
      currentIndex: 0,
      mode: 'heart',
      shuffleOrder: []
    }
    await deputyPlay(d.queue.items[0] ?? null)
  } catch (error) {
    console.warn('[audio-engine] 降级拉取心动推荐失败:', error)
    deputyStop()
  }
}

/** 降级会话解析音源;null=不可播(跳过),异常也按跳过处理。 */
async function resolveDeputySource(item: QueueItem): Promise<string | null> {
  const d = deputy
  if (!d) return null
  if (item.localFileUrl) return item.localFileUrl
  try {
    const track = await resolvePlayableTrack(item.song, d.level, d.cookie || undefined)
    if (!track) return null
    if (d.cacheEnabled && d.cacheMaxBytes > 0) {
      const hit = await resolvePlaybackCache({
        songId: item.song.id,
        level: d.level,
        maxBytes: d.cacheMaxBytes
      })
      if (hit.hit && hit.sourceUrl) return hit.sourceUrl
    }
    // 预热缓存镜像渲染层行为:FM 连续自动播放不预热,避免快速撑爆缓存上限。
    if (!d.fmMode) {
      void warmPlaybackCache({
        songId: item.song.id,
        level: d.level,
        remoteUrl: track.url,
        bitrate: track.bitrate,
        durationMs: item.song.durationMs,
        sourceExpiresAt: track.expiresAt,
        maxBytes: d.cacheMaxBytes
      }).catch(() => undefined)
    }
    return track.url
  } catch {
    return null
  }
}

function metaForItem(item: QueueItem): BgMetaOptions {
  return {
    title: item.song.name,
    artist: item.song.artists.map((a) => a.name).join(' / '),
    album: item.song.album?.name ?? '',
    artworkUrl: item.song.coverUrl?.replace(/^http:/, 'https:') ?? null
  }
}

/** 应用退出:销毁引擎窗口。 */
export function destroyAudioEngine(): void {
  deputy = null
  playerWindow?.stop()
  playerWindow?.destroy()
  playerWindow = null
  windowReady = null
}
