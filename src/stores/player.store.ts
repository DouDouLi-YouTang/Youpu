import { defineStore } from 'pinia'
import { h } from 'vue'

import { getMessage } from '@/app/message-holder'

import type {
  PlayableLevel,
  PlayableTrack,
  PlaybackState,
  QueueItem,
  QueueSource
} from '@/domain/player'
import type { Song } from '@/domain/song'
import {
  useAudioElement,
  type AudioController,
  type AudioSnapshot
} from '@/composables/useAudioElement'
import { getAudioElement } from '@/app/providers/player-provider'
import { ApiError, toApiError } from '@/services/api/errors'
import { recoverBackendForPlayback } from '@/services/api-server-maintenance'
import { resolvePlayableTrack } from '@/services/player-service'
import {
  getPlaybackCacheMaxBytes,
  resolveCachedSource,
  warmFromRemoteUrl
} from '@/services/playback-cache-service'
import { removePlaybackCacheEntry } from '@/platform/electron/cache'
import { getPersonalFm, trashFmSong } from '@/services/api/endpoints/fm.api'
import { getIntelligencePlaylist } from '@/services/api/endpoints/intelligence.api'
import { getLikeList, likeSong } from '@/services/api/endpoints/like.api'
import { usePlayQueueStore } from './play-queue.store'
import { usePlaybackHistoryStore } from './playback-history.store'
import { useAuthStore } from './auth.store'
import { useSettingsStore } from './settings.store'

/**
 * The audio controller is held in a module-level variable, NOT in Pinia
 * state or actions. Pinia's options store wraps every member of `actions`
 * in an action proxy, which corrupts non-function values (assigning an
 * object to an "action" slot makes it read back as a wrapped function, so
 * `this._controller.play` becomes undefined). Keeping it outside the store
 * avoids that entirely while still giving every action access via
 * `getController()`/`setController()`.
 */
let controller: AudioController | null = null

function getController(): AudioController {
  if (!controller) {
    throw new Error('player store not initialized — call init() during bootstrap')
  }
  return controller
}

/**
 * 播放失败自动跳过的 3 秒倒计时。期间顶部 message 实时显示 "3/2/1 秒后自动跳过" 并带
 * "取消"链接:用户取消则不跳过、改为暂停当前播放;倒计时归零则调用 onSkip(通常 next())。
 * 模块级持有 timer/key,新一次 playQueueItem 或 clearSkipCountdown 会清掉上一个,避免
 * 切歌后旧倒计时仍跳到错误的下一首。
 */
let skipCountdownTimer: ReturnType<typeof setInterval> | undefined
let skipCountdownKey: string | undefined

/** 心动模式一次请求的候选数量(/playmode/intelligence/list 的 count 参数)。 */
const HEART_CANDIDATE_COUNT = 20

function clearSkipCountdown(): void {
  if (skipCountdownTimer) {
    clearInterval(skipCountdownTimer)
    skipCountdownTimer = undefined
  }
  if (skipCountdownKey !== undefined) {
    getMessage().destroy(skipCountdownKey)
    skipCountdownKey = undefined
  }
}

function startSkipCountdown(reason: string, onSkip: () => void, onCancel: () => void): void {
  clearSkipCountdown()
  const key = `skip-${Date.now()}`
  skipCountdownKey = key
  let seconds = 3
  const cancel = () => {
    clearSkipCountdown()
    onCancel()
  }
  const show = () => {
    getMessage().warning({
      content: h('span', { style: 'display:inline-flex;align-items:center;gap:8px' }, [
        `${reason}，${seconds} 秒后自动跳过`,
        h(
          'a',
          { style: 'color:var(--color-primary,#1677ff);cursor:pointer', onClick: cancel },
          '取消'
        )
      ]),
      key,
      duration: 0
    })
  }
  show()
  skipCountdownTimer = setInterval(() => {
    seconds -= 1
    if (seconds <= 0) {
      clearSkipCountdown()
      onSkip()
    } else {
      show()
    }
  }, 1000)
}

/** 构造封面缓存协议 URL:muice-cover://<songId>?url=<encoded remoteUrl>。
 *  主进程按 songId 缓存,断网时命中本地仍可显示。coverUrl 缺失返回 null。 */
function buildCoverUrl(song: Song): string | null {
  if (!song.coverUrl) return null
  return `muice-cover://${song.id}?url=${encodeURIComponent(song.coverUrl)}`
}

interface PlayerState {
  state: PlaybackState
  currentItem: QueueItem | null
  currentTrack: PlayableTrack | null
  currentTimeMs: number
  durationMs: number
  volume: number
  muted: boolean
  /** 播放倍速(0.5–2)。 */
  playbackRate: number
  error: ApiError | null
  level: PlayableLevel
  /** 私人 FM 模式:播完自动拉下一首,下一首也走 FM。 */
  fmMode: boolean
  /** 当前队列来源歌单 id(心动模式需要,仅 playlist 来源时有值)。 */
  sourcePlaylistId: number | null
  /** 心动推荐请求进行中。并发点击下一首必须复用同一请求，不能用旧种子重复请求。 */
  intelligenceLoading: boolean
  /** 已喜欢歌曲 id 列表(登录后从 /likelist 拉取)。 */
  likedSongIds: number[]
  /** 切换音质后待恢复的播放进度(ms);syncState 在 ready 时 seek 并清空。 */
  pendingSeekMs: number | null
  /** 音质切换恢复进度后是否继续播放(切前在播则 true)。 */
  pendingPlayAfterSeek: boolean
  /** 当前正在播放的缓存条目键;null 表示当前加载的是远程 URL。缓存 source
   *  加载失败时据此回退远程(一次性,避免循环)。 */
  activeCacheKey: string | null
  /** 当前歌曲封面 URL(muice-cover:// 协议,主进程本地缓存)。null 表示无封面。 */
  currentCoverUrl: string | null
  /** FM 预拉缓冲队列:FmCard 预览封面用其第一首,startFm 优先复用,空则现拉。 */
  fmPrefetchSongs: Song[]
  /** handleError 重试标志:URL 过期/网络错误时重试 resolvePlayableTrack 一次,防止循环。切歌重置。 */
  errorRetried: boolean
}

export const usePlayerStore = defineStore('player', {
  state: (): PlayerState => ({
    state: 'idle',
    currentItem: null,
    currentTrack: null,
    currentTimeMs: 0,
    durationMs: 0,
    volume: 1,
    muted: false,
    playbackRate: 1,
    error: null,
    level: 'standard',
    fmMode: false,
    sourcePlaylistId: null,
    intelligenceLoading: false,
    likedSongIds: [],
    pendingSeekMs: null,
    pendingPlayAfterSeek: false,
    activeCacheKey: null,
    currentCoverUrl: null,
    fmPrefetchSongs: [],
    errorRetried: false
  }),

  getters: {
    isPlaying(): boolean {
      return this.state === 'playing'
    },
    isLoading(): boolean {
      return this.state === 'loading' || this.state === 'buffering'
    },
    /** Human-readable reason when a song is not playable. */
    notPlayableReason(): string | null {
      const status = this.currentItem?.song.playableStatus
      switch (status) {
        case 'no-url':
          return '暂无播放源'
        case 'vip-required':
          return '需要 VIP 才可播放'
        case 'copyright-restricted':
          return '因版权限制不可播放'
        default:
          return null
      }
    },
    /** 当前歌曲封面 URL:优先用本地缓存协议(muice-cover://),未设则回退远程 coverUrl。 */
    coverUrl(): string | null {
      return this.currentCoverUrl ?? this.currentItem?.song.coverUrl ?? null
    },
    /** Current play queue (proxied from play-queue store). */
    queue(): QueueItem[] {
      return usePlayQueueStore().items
    },
    /** Current queue index (proxied from play-queue store). */
    currentIndex(): number {
      return usePlayQueueStore().currentIndex
    },
    /** Current playback mode (proxied from play-queue store). */
    mode(): import('@/domain/player').PlaybackMode {
      return usePlayQueueStore().mode
    },
    /** 当前歌是否已喜欢。 */
    isCurrentLiked(): boolean {
      const id = this.currentItem?.song.id
      return id != null && this.likedSongIds.includes(id)
    },
    /** FM 预拉第一首歌的封面(供 FmCard 默认预览),无预拉返回 null。 */
    fmPreviewCoverUrl(): string | null {
      const song = this.fmPrefetchSongs[0]
      return song ? buildCoverUrl(song) : null
    }
  },

  actions: {
    /**
     * Initialize the audio controller. Must be called once after the player
     * provider is ready (done in `main.ts`). Idempotent.
     */
    init(): void {
      if (controller) return
      const audio = getAudioElement()
      const c = useAudioElement(audio, {
        onEnded: () => this.handleEnded(),
        onError: (err) => this.handleError(err),
        onStateChange: (state, snapshot) => this.syncState(state, snapshot)
      })
      controller = c
      c.setVolume(this.volume)
      c.setMuted(this.muted)
      c.setPlaybackRate(this.playbackRate)
      // 应用持久化的输出设备(空串=系统默认)
      const settings = useSettingsStore()
      if (settings.audioOutputDeviceId) {
        void c.setSinkId(settings.audioOutputDeviceId)
      }
      // 用持久化的音质设置初始化播放音质(settingsStore.audioQuality 是音质单一数据源,
      // 播放栏/设置页改动都会经 setLevel 同步回 settings,重启后从此处恢复)。
      this.level = settings.audioQuality
      // 注册系统媒体通知交互(上一曲/下一曲/播放/暂停)
      this.setupMediaSession()
    },

    /** 注册系统媒体通知(MediaSession)的交互回调。 */
    setupMediaSession(): void {
      if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
      const ms = navigator.mediaSession
      ms.setActionHandler('play', () => this.play())
      ms.setActionHandler('pause', () => this.pause())
      ms.setActionHandler('previoustrack', () => this.previous())
      ms.setActionHandler('nexttrack', () => this.next())
    },

    /** 同步当前歌曲元数据(标题/艺术家/专辑/封面)到系统媒体通知。 */
    updateMediaSessionMetadata(): void {
      if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
      const song = this.currentItem?.song
      if (!song) {
        navigator.mediaSession.metadata = null
        return
      }
      // artwork 用远程 https URL:系统通知由 OS 渲染,无法访问 Electron renderer 注册的
      // muice-cover:// 自定义协议,需用可直链的 NCM CDN 封面。http->https 避免 mixed content。
      const cover = song.coverUrl?.replace(/^http:/, 'https:')
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.name,
        artist: song.artists.map((a) => a.name).join(' / '),
        album: song.album?.name ?? '',
        artwork: cover ? [{ src: cover, sizes: '512x512', type: 'image/jpeg' }] : []
      })
    },

    /** 同步播放状态到系统媒体通知(playing/paused)。
     *  loading/buffering 是切歌/缓冲过渡态,跳过更新保持上一次的 playbackState,
     *  避免 Windows SMTC 通知因短暂变 paused 而消失,等新歌 playing 再同步。 */
    updateMediaSessionPlaybackState(): void {
      if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
      if (this.state === 'loading' || this.state === 'buffering') return
      navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused'
    },

    /** Resolve and begin playback of a queue item. */
    async playQueueItem(item: QueueItem): Promise<void> {
      clearSkipCountdown()
      this.errorRetried = false
      // 切歌(非 setLevel 同曲重载)时丢弃 pendingSeekMs/activeCacheKey:await 期间旧值
      // 会被新歌误用--setLevel 设的 pendingSeekMs 让新歌从旧歌进度播、旧 activeCacheKey
      // 让 handleError 误删上一首缓存。setLevel 传同一 currentItem(uid 相同),保留。
      if (this.currentItem?.uid !== item.uid) {
        this.pendingSeekMs = null
        this.pendingPlayAfterSeek = false
        this.activeCacheKey = null
      }
      this.error = null
      this.currentItem = item
      this.currentCoverUrl = buildCoverUrl(item.song)
      this.updateMediaSessionMetadata()
      // 记录到本地播放历史(按账号/游客隔离),切歌即记
      usePlaybackHistoryStore().record(item.song)
      this.currentTrack = null
      this.currentTimeMs = 0
      this.durationMs = item.song.durationMs || 0
      this.state = 'loading'

      const auth = useAuthStore()
      if (item.localFileUrl) {
        this.fmMode = false
        this.sourcePlaylistId = null
        this.activeCacheKey = null
        this.currentTrack = {
          song: item.song,
          url: item.localFileUrl
        }
        // 本地文件:先 load 再在 canplay 后 play,避免部分协议源 autoplay 被拒绝静默失败
        getController().load(item.localFileUrl, { autoplay: true })
        // 兜底:若 800ms 内仍未进入 playing,再尝试一次 play()
        const uid = item.uid
        setTimeout(() => {
          if (this.currentItem?.uid !== uid) return
          if (this.state === 'ready' || this.state === 'paused' || this.state === 'loading') {
            void getController()
              .play()
              .catch(() => {
                /* handleError 会提示 */
              })
          }
        }, 800)
        return
      }

      let track: PlayableTrack | null
      try {
        track = await resolvePlayableTrack(item.song, this.level, auth.cookie || undefined)
      } catch (error) {
        const apiError = toApiError(error)
        if (this.currentItem?.uid !== item.uid) return

        // 登录过期:先标记 expired 弹 Modal(即使下方缓存命中能继续离线播放,也要提示重新登录)
        if (apiError.code === 'UNAUTHORIZED') auth.handleUnauthorized()

        // 远程解析失败(断网/后端不可达)时,先尝试本地播放缓存:之前播放过且命中的歌曲
        // 仍可离线播放(缓存文件经主进程 muice-cache:// 协议本地读取,不走网络)。
        // 命中则直接播放,跳过后续后端恢复/跳过流程。缓存存在即说明此前可播放,可安全回退。
        const cacheFallback = await resolveCachedSource(item.song, this.level)
        if (this.currentItem?.uid !== item.uid) return
        if (cacheFallback.hit && cacheFallback.sourceUrl) {
          this.currentTrack = { song: item.song, url: cacheFallback.sourceUrl }
          this.activeCacheKey = cacheFallback.cacheKey ?? null
          const resumeAt = this.pendingSeekMs
          const autoplay = this.pendingSeekMs == null ? true : this.pendingPlayAfterSeek
          this.pendingSeekMs = null
          this.pendingPlayAfterSeek = false
          getController().load(cacheFallback.sourceUrl, {
            autoplay,
            resumeAt: resumeAt ?? undefined
          })
          return
        }

        this.state = 'error'
        this.error = apiError
        const recovery = await recoverBackendForPlayback(apiError)
        if (this.currentItem?.uid !== item.uid) return
        if (recovery?.ok && recovery.restarted) {
          void this.playQueueItem(item)
          return
        }
        // 播放失败:3 秒倒计时后自动跳过,用户可取消(取消则暂停当前播放)
        // 登录过期:标记 expired 由 App.vue watch 弹 Modal,不显示"播放失败"倒计时
        if (apiError.code === 'UNAUTHORIZED') return
        startSkipCountdown(
          '播放失败',
          () => {
            if (this.currentItem?.uid === item.uid) this.next()
          },
          () => {
            this.pause()
          }
        )
        return
      }

      if (track == null) {
        // VIP or no playback URL available
        const reason = this.notPlayableReason ?? '暂无播放源'
        this.state = 'error'
        this.error = new ApiError({
          code: 'COPYRIGHT_RESTRICTED',
          message: reason
        })
        // Auto-skip to next song instead of staying in error state
        const { message } = await import('ant-design-vue')
        message.warning(reason + '，已跳过')
        setTimeout(() => {
          if (this.currentItem?.uid === item.uid) this.next()
        }, 500)
        return
      }

      this.currentTrack = track
      // 尝试命中本地播放缓存(不绕过可播放性校验:track 已解析成功)。
      const cacheResolution = await resolveCachedSource(item.song, this.level)
      if (this.currentItem?.uid !== item.uid) return

      // 音质切换(pendingSeekMs 有值):controller 在 canplay 时 seek 回进度,
      // autoplay 按切前播放状态决定(wasPlaying 则 autoplay=true 由 load 内部调 play,
      // 用户激活有效,避免 syncState 回调里手动 play 被 autoplay policy 拒绝)。
      const resumeAt = this.pendingSeekMs
      const autoplay = this.pendingSeekMs == null ? true : this.pendingPlayAfterSeek
      this.pendingSeekMs = null
      this.pendingPlayAfterSeek = false

      if (cacheResolution.hit && cacheResolution.sourceUrl) {
        this.currentTrack = { ...track, url: cacheResolution.sourceUrl }
        this.activeCacheKey = cacheResolution.cacheKey ?? null
        getController().load(cacheResolution.sourceUrl, {
          autoplay,
          resumeAt: resumeAt ?? undefined
        })
        return
      }

      this.activeCacheKey = null
      getController().load(track.url, { autoplay, resumeAt: resumeAt ?? undefined })
      // 后台预热缓存,不阻塞播放;失败只记录日志,不影响当前播放。
      // FM 模式下不预热:FM 连续自动播放,每首都写入会快速撑爆用户设置的缓存上限。
      // 读缓存(resolveCachedSource)仍保留 -- 命中已有缓存不增加占用量,还能省流量。
      if (!this.fmMode) warmFromRemoteUrl(track, this.level)
    },

    playLocalFile(song: Song, fileUrl: string, filePath: string): void {
      this.fmMode = false
      this.sourcePlaylistId = null
      const queue = usePlayQueueStore()
      if (queue.mode === 'heart') queue.setMode('sequence')
      const item = queue.playNowLocal(song, fileUrl, filePath)
      void this.playQueueItem(item)
    },

    /**
     * Replace the queue with a list and play the song at `index`.
     * Entry point for list-item clicks.
     */
    playFromList(
      songs: Song[],
      index: number,
      source: QueueSource,
      sourcePlaylistId?: number
    ): void {
      if (songs.length === 0) return
      // 非 FM 来源退出 FM 模式(startFm 用 source='fm' 不会触发清除)
      if (source !== 'fm') this.fmMode = false
      this.sourcePlaylistId = sourcePlaylistId ?? null
      const queue = usePlayQueueStore()
      const item = queue.replaceQueue(songs, index, source)
      if (item) this.playQueueItem(item)
    },

    play(): void {
      const track = this.currentTrack
      // URL 已过期(或 10 秒内过期):刷新签名 URL 再恢复播放,避免 audio.play() 触发 error
      if (track?.expiresAt && track.expiresAt <= Date.now() + 10 * 1000) {
        void this.refreshUrlAndPlay()
        return
      }
      void getController()
        .play()
        .catch(() => {
          /* surfaced via state change */
        })
    },

    /** URL 过期时重新获取签名 URL 并恢复播放(保留进度)。 */
    async refreshUrlAndPlay(): Promise<void> {
      const item = this.currentItem
      if (!item) return
      const resumeAt = this.currentTimeMs
      this.state = 'loading'
      try {
        const auth = useAuthStore()
        const newTrack = await resolvePlayableTrack(item.song, this.level, auth.cookie || undefined)
        if (this.currentItem?.uid !== item.uid) return
        if (!newTrack) {
          this.handleError(null)
          return
        }
        this.currentTrack = newTrack
        this.error = null
        getController().load(newTrack.url, { autoplay: true, resumeAt })
      } catch {
        if (this.currentItem?.uid !== item.uid) return
        this.handleError(null)
      }
    },

    pause(): void {
      getController().pause()
    },

    togglePlay(): void {
      if (this.isPlaying) this.pause()
      else this.play()
    },

    seek(ms: number): void {
      getController().seek(ms)
    },

    setVolume(v: number): void {
      this.volume = Math.max(0, Math.min(1, v))
      getController().setVolume(this.volume)
      // 调节音量时取消静音:否则 muted 仍为 true,音量滑块已动但音频无声
      if (this.muted) {
        this.muted = false
        getController().setMuted(false)
      }
    },

    toggleMute(): void {
      this.muted = !this.muted
      getController().setMuted(this.muted)
    },

    /** 设置播放倍速(0.5–1.5)。 */
    setPlaybackRate(rate: number): void {
      const clamped = Math.max(0.5, Math.min(1.5, rate))
      this.playbackRate = clamped
      getController().setPlaybackRate(clamped)
    },

    /** 切换音频输出设备(空串=系统默认)。 */
    applyOutputDevice(deviceId: string): Promise<void> {
      return getController().setSinkId(deviceId)
    },

    setLevel(level: PlayableLevel): void {
      if (this.level === level) return
      this.level = level
      // 同步回持久化的 settingsStore,使设置页与播放栏状态一致且重启后保留。
      useSettingsStore().audioQuality = level
      // 切换音质后恢复到当前进度,而非从头播放:记下进度与播放状态,playQueueItem
      // 重新加载(autoplay=false)后 syncState 在 ready 时 seek 回该位置并按原状态播放。
      if (this.currentItem && this.currentTimeMs > 0) {
        this.pendingSeekMs = this.currentTimeMs
        this.pendingPlayAfterSeek = this.isPlaying
      }
      // If something is loaded, re-resolve at the new quality.
      if (this.currentItem) {
        void this.playQueueItem(this.currentItem)
      }
    },

    next(): void {
      // FM 模式:下一首永远拉新的 FM 推荐
      if (this.fmMode) {
        void this.playNextFm()
        return
      }
      // 心动模式:按顺序推进本次推荐列表;列表播完(返回 null)才拉下一批。
      // 严格遵循 /playmode/intelligence/list 文档语义:一次拉取返回完整列表,
      // 依次播放,不再每首歌都重新以当前歌为种子拉取(那会丢弃队列并产生重复)。
      if (this.mode === 'heart') {
        const queue = usePlayQueueStore()
        const item = queue.next(false)
        if (item) this.playQueueItem(item)
        else void this.startIntelligence()
        return
      }
      const queue = usePlayQueueStore()
      const item = queue.next(false)
      if (item) this.playQueueItem(item)
      else this.state = 'idle'
    },

    previous(): void {
      const queue = usePlayQueueStore()
      const item = queue.previous()
      if (item) this.playQueueItem(item)
      else this.state = 'idle'
    },

    /** Called by the audio composable when a track ends naturally. */
    handleEnded(): void {
      // FM 模式:播完自动拉下一首 FM
      if (this.fmMode) {
        void this.playNextFm()
        return
      }
      // 心动模式:播完推进到推荐列表下一首;列表播完才拉下一批,避免每首都重拉。
      if (this.mode === 'heart') {
        const queue = usePlayQueueStore()
        const item = queue.next(true)
        if (item) void this.playQueueItem(item)
        else void this.startIntelligence()
        return
      }
      const queue = usePlayQueueStore()
      const item = queue.next(true)
      if (item) void this.playQueueItem(item)
      else this.state = 'idle'
    },

    /** Called by the audio composable on a media error. */
    async handleError(err: MediaError | null): Promise<void> {
      // 本地下载文件播放失败:不要走远程回退/自动跳过,直接提示
      if (this.currentItem?.localFileUrl || this.currentItem?.localFilePath) {
        this.state = 'error'
        this.error = new ApiError({
          code: 'UNKNOWN',
          message: '本地文件播放失败，文件可能已损坏或格式不受支持'
        })
        const { message } = await import('ant-design-vue')
        message.error('本地文件播放失败，请检查文件是否完整')
        this.pause()
        return
      }

      // 若当前加载的是本地缓存 source,先回退到远程 URL(一次性,避免循环)。
      if (this.activeCacheKey && this.currentItem) {
        const failedKey = this.activeCacheKey
        const item = this.currentItem
        this.activeCacheKey = null
        void removePlaybackCacheEntry(failedKey, getPlaybackCacheMaxBytes())
        try {
          const auth = useAuthStore()
          const track = await resolvePlayableTrack(item.song, this.level, auth.cookie || undefined)
          if (this.currentItem?.uid === item.uid && track) {
            this.currentTrack = track
            // 重置 error 态:否则 load() 触发的 syncState('loading'/'playing') 被
            // syncState 守卫(state==='error' && audioState!=='error')拦截,状态永久卡 error
            this.state = 'loading'
            this.error = null
            getController().load(track.url, { autoplay: true })
            return
          }
          if (this.currentItem?.uid !== item.uid) return
        } catch {
          if (this.currentItem?.uid !== item.uid) return
          // 远程也失败 → 落入下方常规错误处理
        }
      }
      // 远程 URL 失败:尝试重新获取 URL 重试一次(URL 过期/网络恢复),防止循环
      if (this.currentItem && !this.errorRetried) {
        this.errorRetried = true
        const item = this.currentItem
        const resumeAt = this.currentTimeMs
        try {
          const auth = useAuthStore()
          const newTrack = await resolvePlayableTrack(
            item.song,
            this.level,
            auth.cookie || undefined
          )
          if (this.currentItem?.uid !== item.uid) return
          if (newTrack) {
            this.errorRetried = false
            this.currentTrack = newTrack
            this.state = 'loading'
            this.error = null
            getController().load(newTrack.url, { autoplay: true, resumeAt })
            return
          }
        } catch {
          if (this.currentItem?.uid !== item.uid) return
        }
      }
      void err
      this.state = 'error'
      if (!this.error) {
        this.error = new ApiError({
          code: 'UNKNOWN',
          message: '播放失败，请稍后重试'
        })
      }
      // 播放失败:3 秒倒计时后自动跳过,用户可取消(取消则暂停当前播放)
      startSkipCountdown(
        '播放失败',
        () => this.next(),
        () => this.pause()
      )
    },

    /** Mirror the audio controller's state + position into the store. */
    syncState(audioState: PlaybackState, snapshot: AudioSnapshot): void {
      // Ignore transient non-error states while we're in an error state set
      // by playQueueItem (e.g. not-playable).
      if (this.state === 'error' && audioState !== 'error') return
      this.state = audioState
      this.currentTimeMs = snapshot.currentTimeMs
      if (snapshot.durationMs > 0) this.durationMs = snapshot.durationMs
      this.updateMediaSessionPlaybackState()
    },

    /**
     * Play the queue item at the given index directly (used by play queue UI).
     */
    playAt(index: number): void {
      const queue = usePlayQueueStore()
      if (index < 0 || index >= queue.items.length) return
      queue.currentIndex = index
      const item = queue.current
      if (item) void this.playQueueItem(item)
    },

    /**
     * Remove a queue item by index. If removing the current item, auto-play
     * the next one (or stop if queue is empty).
     */
    removeFromQueue(index: number): void {
      const queue = usePlayQueueStore()
      if (index < 0 || index >= queue.items.length) return
      const wasPlaying = index === queue.currentIndex && this.isPlaying
      const item = queue.items[index]
      if (item) queue.remove(item.uid)
      // If we removed the current playing item, play what's now at currentIndex
      if (wasPlaying) {
        const next = queue.current
        if (next) void this.playQueueItem(next)
        else this.state = 'idle'
      }
    },

    /**
     * Clear the entire play queue and stop playback.
     */
    clearQueue(): void {
      const queue = usePlayQueueStore()
      queue.clear()
      this.state = 'idle'
      this.currentItem = null
      this.currentTrack = null
      getController().stop()
      this.updateMediaSessionMetadata()
      this.updateMediaSessionPlaybackState()
    },

    /**
     * Cycle through playback modes: sequence → repeat-all → repeat-one → shuffle.
     */
    toggleMode(): void {
      if (this.fmMode) return
      const queue = usePlayQueueStore()
      const modes: import('@/domain/player').PlaybackMode[] = [
        'sequence',
        'repeat-all',
        'repeat-one',
        'shuffle',
        'heart'
      ]
      const idx = modes.indexOf(queue.mode)
      let next = modes[(idx + 1) % modes.length]
      // heart 需登录 + 来源歌单,不满足则跳过到下一档
      if (next === 'heart') {
        const auth = useAuthStore()
        if (!auth.isLoggedIn || !this.sourcePlaylistId) {
          next = modes[(idx + 2) % modes.length]
        }
      }
      queue.setMode(next)
      // 进入心动模式:把队列缩减为只剩当前歌,后续 next/handleEnded 队列耗尽
      // (queue.next 返回 null) 时触发 startIntelligence 拉取心动推荐替换队列。
      // 当前歌继续播完不中断,符合 /playmode/intelligence/list 文档语义--
      // 一次拉取返回完整列表,依次播放,而非每首歌重新以当前歌为种子拉取。
      if (next === 'heart' && this.currentItem) {
        queue.replaceQueue([this.currentItem.song], 0, 'playlist')
      }
    },

    /**
     * 预拉私人 FM 推荐填充缓冲队列:供 FmCard 预览封面 + startFm 复用,
     * 使预览封面与实际播放的第一首一致。仅已登录且队列空时拉,静默失败
     * (预览失败不影响功能,用户点播放时 startFm 会现拉)。
     */
    async prefetchFm(): Promise<void> {
      if (this.fmPrefetchSongs.length > 0) return
      const auth = useAuthStore()
      if (!auth.isLoggedIn) return
      try {
        this.fmPrefetchSongs = await getPersonalFm(auth.cookie)
      } catch {
        /* 静默:预览封面失败不阻塞功能 */
      }
    },

    /** 启动私人 FM:拉一首推荐并播放,开启 fm 模式(播完自动拉下一首)。 */
    async startFm(): Promise<boolean> {
      const auth = useAuthStore()
      if (!auth.isLoggedIn) {
        const { message } = await import('ant-design-vue')
        message.warning('私人 FM 需要登录后使用')
        return false
      }
      try {
        // 优先复用预拉队列(FmCard 挂载时预拉),封面预览与实际播放第一首一致;空则现拉。
        let songs: Song[]
        if (this.fmPrefetchSongs.length > 0) {
          songs = this.fmPrefetchSongs
          this.fmPrefetchSongs = []
        } else {
          songs = await getPersonalFm(auth.cookie)
        }
        if (songs.length === 0) {
          const { message } = await import('ant-design-vue')
          message.warning('私人 FM 暂无推荐')
          return false
        }
        this.fmMode = true
        usePlayQueueStore().setMode('sequence')
        this.playFromList(songs, 0, 'fm')
        return true
      } catch (error) {
        this.state = 'error'
        const apiError = toApiError(error)
        this.error = apiError
        if (apiError.code === 'UNAUTHORIZED') {
          auth.handleUnauthorized()
        } else {
          const { message } = await import('ant-design-vue')
          message.error('私人 FM 获取失败')
        }
        return false
      }
    },

    /** FM 模式拉下一首推荐(由 next/handleEnded 触发)。 */
    async playNextFm(): Promise<void> {
      const auth = useAuthStore()
      try {
        const songs = await getPersonalFm(auth.cookie)
        if (songs.length > 0) this.playFromList(songs, 0, 'fm')
        else this.state = 'idle'
      } catch (error) {
        this.state = 'error'
        const apiError = toApiError(error)
        this.error = apiError
        // 登录过期:getPersonalFm 走 requestWithCookie,api-client 已触发 unauthorizedHandler
        // (-> handleUnauthorized 标记 expired 弹 Modal)。此处显式调用为防御性兜底,
        // 对齐「401 统一弹 Modal」约定(handleUnauthorized 内部去重,重复调用安全)。
        if (apiError.code === 'UNAUTHORIZED') auth.handleUnauthorized()
      }
    },

    /**
     * 心动模式入口:基于当前歌 + 其来源歌单调用 /playmode/intelligence/list,
     * 把返回的完整推荐列表替换为播放队列,由 next/handleEnded 依次推进播放。
     * 队列播完后由它们再次调用本方法拉取下一批(以最后一首为新种子)。
     *
     * 严格遵循文档语义:一次请求返回完整列表依次播放,不每首歌重拉。
     * 请求尚未返回前,快速连点下一首不能以旧种子重复发请求(intelligenceLoading 守卫)。
     */
    async startIntelligence(): Promise<void> {
      if (this.intelligenceLoading) return

      const auth = useAuthStore()
      if (!auth.isLoggedIn) {
        const { message } = await import('ant-design-vue')
        message.warning('心动模式需要登录后使用')
        return
      }
      const songId = this.currentItem?.song.id
      const songUid = this.currentItem?.uid
      const pid = this.sourcePlaylistId
      if (!songId || !songUid || !pid) return

      this.intelligenceLoading = true
      try {
        const songs = await getIntelligencePlaylist(songId, pid, auth.cookie, HEART_CANDIDATE_COUNT)
        // 请求期间用户可能已经切歌、切换播放模式或换了来源歌单；此时丢弃旧响应，
        // 不允许它覆盖用户当前正在播放的队列。
        if (
          this.currentItem?.uid !== songUid ||
          this.mode !== 'heart' ||
          this.sourcePlaylistId !== pid
        ) {
          return
        }
        // 排除当前正在播放的歌(智能接口可能返回它,不排除会立刻重播),
        // 并对同一次响应去重,保持队列唯一。不额外排除更早的播放历史--
        // 文档语义是依次播放本次返回的完整列表,跨批次的去重交给服务端推荐。
        const seen = new Set<number>()
        const candidates = songs.filter((song) => {
          if (song.id === songId) return false
          if (seen.has(song.id)) return false
          seen.add(song.id)
          return true
        })
        if (candidates.length === 0) {
          const { message } = await import('ant-design-vue')
          message.warning('心动模式暂无未播放的推荐')
          return
        }
        // 心动模式保留来源歌单 id,以便连续心动
        this.playFromList(candidates, 0, 'playlist', pid)
      } catch (error) {
        // 与成功响应一样，旧请求失败也不能把用户后来切换的播放状态改成 error。
        if (
          this.currentItem?.uid !== songUid ||
          this.mode !== 'heart' ||
          this.sourcePlaylistId !== pid
        ) {
          return
        }
        this.state = 'error'
        const apiError = toApiError(error)
        this.error = apiError
        if (apiError.code === 'UNAUTHORIZED') {
          auth.handleUnauthorized()
        } else {
          const { message } = await import('ant-design-vue')
          message.error('心动模式获取失败')
        }
      } finally {
        this.intelligenceLoading = false
      }
    },

    /** 登录后加载喜欢列表(初始化已喜欢状态)。 */
    async loadLikedList(uid: number, cookie: string): Promise<void> {
      try {
        this.likedSongIds = await getLikeList(uid, cookie)
      } catch {
        // 静默失败,不影响播放
      }
    },

    /** 切换当前播放歌喜欢状态(转发给 toggleLikeSong)。 */
    async toggleLike(): Promise<void> {
      const songId = this.currentItem?.song.id
      if (!songId) return
      await this.toggleLikeSong(songId)
    },

    /**
     * 切换指定歌曲喜欢状态(已喜欢→取消,未喜欢→喜欢)。
     * 支持歌曲列表右键喜欢任意一首,不限于当前播放歌。未登录弹 Modal 引导登录。
     */
    async toggleLikeSong(songId: number): Promise<void> {
      const auth = useAuthStore()
      if (!auth.isLoggedIn) {
        const { Modal } = await import('ant-design-vue')
        Modal.confirm({
          title: '需要登录后才能喜欢',
          content: '是否现在前往登录?',
          okText: '前往登录',
          cancelText: '取消',
          centered: true,
          onOk: async () => {
            const { router } = await import('@/app/router')
            void router.push('/login')
          }
        })
        return
      }
      const liked = this.likedSongIds.includes(songId)
      try {
        await likeSong(songId, !liked, auth.cookie)
        if (liked) {
          this.likedSongIds = this.likedSongIds.filter((id) => id !== songId)
        } else {
          this.likedSongIds = [...this.likedSongIds, songId]
        }
      } catch {
        const { message } = await import('ant-design-vue')
        message.error('操作失败')
      }
    },

    /**
     * FM 垃圾桶:把当前播放歌扔进垃圾桶并拉下一首 FM 推荐。
     * 仅 FM 模式可用(影响私人 FM 后续推荐)。未登录弹 Modal 引导登录。
     */
    async dislikeCurrentFm(): Promise<void> {
      const songId = this.currentItem?.song.id
      if (!songId) return
      const auth = useAuthStore()
      if (!auth.isLoggedIn) {
        const { Modal } = await import('ant-design-vue')
        Modal.confirm({
          title: '需要登录后才能操作',
          content: '是否现在前往登录?',
          okText: '前往登录',
          cancelText: '取消',
          centered: true,
          onOk: async () => {
            const { router } = await import('@/app/router')
            void router.push('/login')
          }
        })
        return
      }
      try {
        await trashFmSong(songId, auth.cookie)
        // 垃圾桶成功后拉下一首 FM(跳过且标记不感兴趣,影响后续推荐)
        void this.playNextFm()
      } catch (error) {
        const apiError = toApiError(error)
        // 登录过期:trashFmSong 走 requestWithCookie,api-client 已触发 unauthorizedHandler
        // (-> handleUnauthorized 标记 expired 弹 Modal)。此处显式调用为防御性兜底,
        // 对齐「401 统一弹 Modal」约定(handleUnauthorized 内部去重,重复调用安全)。
        if (apiError.code === 'UNAUTHORIZED') {
          auth.handleUnauthorized()
          return
        }
        const { message } = await import('ant-design-vue')
        message.error('操作失败')
      }
    }
  }
})
