import { getCurrentInstance, onBeforeUnmount, reactive, ref } from 'vue'

import type { PlaybackState } from '@/domain/player'

/**
 * Snapshot of the audio element's playback position, pushed to callbacks on
 * `timeupdate` (throttled). Everything is in milliseconds to match the domain.
 */
export interface AudioSnapshot {
  currentTimeMs: number
  durationMs: number
  volume: number
  muted: boolean
}

export interface AudioControllerCallbacks {
  /** Fired when the current media finishes naturally. */
  onEnded?: () => void
  /** Fired when the element reports an error (src invalid / decode fail). */
  onError?: (error: MediaError | null) => void
  /** Fired whenever the derived `state` changes or on throttled timeupdate. */
  onStateChange?: (state: PlaybackState, snapshot: AudioSnapshot) => void
}

export interface AudioController {
  /** Current derived playback state. */
  readonly state: PlaybackState
  readonly currentTimeMs: number
  readonly durationMs: number
  readonly volume: number
  readonly muted: boolean
  readonly canPlay: boolean
  readonly error: MediaError | null
  /** Load a new source. `autoplay` starts playback once ready; `resumeAt`(ms)
   *  seeks to the given position on canplay (used by quality switch to keep progress). */
  load: (src: string, opts?: { autoplay?: boolean; resumeAt?: number }) => void
  play: () => Promise<void>
  pause: () => void
  /** Stop and reset to idle (clears the source). */
  stop: () => void
  seek: (ms: number) => void
  setVolume: (v: number) => void
  setMuted: (m: boolean) => void
  /** 切换音频输出设备(deviceId 来自 enumerateDevices,空串=系统默认)。 */
  setSinkId: (deviceId: string) => Promise<void>
  /** 播放倍速(0.5–2)。 */
  setPlaybackRate: (rate: number) => void
  dispose: () => void
}

const THROTTLE_MS = 250

/**
 * Wrap a raw `HTMLAudioElement` with reactive state and event-driven callbacks.
 *
 * This composable owns NO knowledge of API, stores or domain beyond the
 * `PlaybackState` shape — it only translates DOM media events into a clean
 * controller surface (per the architecture rule: "useAudioElement has no
 * API/store import").
 *
 * Event mapping:
 *  - `loadstart` / `waiting`  → `loading` / `buffering`
 *  - `canplay` / `loadedmetadata` → `ready`
 *  - `playing` → `playing`
 *  - `pause` → `paused` (unless we are mid-load)
 *  - `ended` → `ended` + `onEnded`
 *  - `error` → `error` + `onError`
 *  - `timeupdate` (throttled) → `onStateChange` with a position snapshot
 *
 * 倍速说明:
 *  使用 HTMLMediaElement.playbackRate。
 *  用户偏好「绝对顺滑」: preservesPitch=false(关闭保持音高)。
 *  这样走简单的重采样变速,0.5x/2x 更连贯,但音高会随速度变化。
 *  仍在 load/canplay/playing/seek 后反复应用 rate,防止浏览器重置为 1。
 */
export function useAudioElement(
  audio: HTMLAudioElement,
  callbacks: AudioControllerCallbacks = {}
): AudioController {
  const state = ref<PlaybackState>('idle')
  const currentTimeMs = ref(0)
  const durationMs = ref(0)
  const volume = ref(audio.volume)
  const muted = ref(audio.muted)
  const canPlay = ref(false)
  const error = ref<MediaError | null>(null)

  // Internal flag: suppresses the `pause`→`paused` transition while a new
  // source is being loaded (the element briefly pauses before loading).
  let isLoadingNext = false
  let lastEmit = 0
  // 待恢复进度(canplay 时 seek):音质切换时保留播放进度。
  let resumeAtMs: number | null = null
  /** 用户期望的倍速;load 后浏览器可能重置为 1,需反复应用。 */
  let desiredRate = 1
  /** Web Audio 图(惰性创建);仅用于 resume 音频时钟,不改路由以免破坏 setSinkId。 */
  let audioCtx: AudioContext | null = null
  /** 缓冲超时计时器:waiting 时启动,playing/canplay/pause 清除。超时触发 onError,
   *  避免网络挂起时永久卡在 buffering 不报错。 */
  let bufferingTimer: ReturnType<typeof setTimeout> | null = null
  const BUFFERING_TIMEOUT_MS = 20000

  function clearBufferingTimer(): void {
    if (bufferingTimer) {
      clearTimeout(bufferingTimer)
      bufferingTimer = null
    }
  }

  function snapshot(): AudioSnapshot {
    return {
      currentTimeMs: currentTimeMs.value,
      durationMs: durationMs.value,
      volume: volume.value,
      muted: muted.value
    }
  }

  function setState(next: PlaybackState) {
    if (state.value === next) return
    state.value = next
    callbacks.onStateChange?.(next, snapshot())
  }

  /**
   * 应用倍速:绝对顺滑模式 → preservesPitch=false。
   * 不做 WSOLA 保音高,走简单重采样,极端倍速更连贯。
   */
  function applyPlaybackRate(): void {
    const rate = Math.max(0.5, Math.min(1.5, desiredRate))
    const el = audio as HTMLAudioElement & {
      preservesPitch?: boolean
      mozPreservesPitch?: boolean
      webkitPreservesPitch?: boolean
    }
    // 关闭保持音高:更顺滑,音高随速度变
    el.preservesPitch = false
    el.mozPreservesPitch = false
    el.webkitPreservesPitch = false
    el.defaultPlaybackRate = rate
    if (Math.abs(el.playbackRate - rate) > 0.001) {
      el.playbackRate = rate
    }
  }

  /** 用户手势后确保 AudioContext 运行(避免时钟挂起导致卡顿感)。 */
  function ensureAudioClock(): void {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      if (!audioCtx) audioCtx = new Ctx()
      if (audioCtx.state === 'suspended') void audioCtx.resume()
    } catch {
      // AudioContext 不可用时忽略
    }
  }

  function maybeEmitTime() {
    const now = Date.now()
    if (now - lastEmit < THROTTLE_MS) return
    lastEmit = now
    callbacks.onStateChange?.(state.value, snapshot())
  }

  function onDurationChange() {
    durationMs.value = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0
  }
  function onTimeUpdate() {
    currentTimeMs.value = audio.currentTime * 1000
    // 某些内核在 seek/缓冲后会悄悄把 rate 拨回 1,定时校正
    if (Math.abs(audio.playbackRate - desiredRate) > 0.01) {
      applyPlaybackRate()
    }
    maybeEmitTime()
  }
  function onLoadStart() {
    isLoadingNext = true
    canPlay.value = false
    error.value = null
    setState('loading')
  }
  function onWaiting() {
    if (state.value === 'playing') setState('buffering')
    clearBufferingTimer()
    bufferingTimer = setTimeout(() => {
      bufferingTimer = null
      const err = audio.error
      error.value = err
      isLoadingNext = false
      setState('error')
      callbacks.onError?.(err)
    }, BUFFERING_TIMEOUT_MS)
  }
  function onLoadedMetadata() {
    onDurationChange()
    applyPlaybackRate()
  }
  function onCanPlay() {
    clearBufferingTimer()
    canPlay.value = true
    applyPlaybackRate()
    if (state.value === 'loading' || state.value === 'buffering') setState('ready')
    // 音质切换恢复进度:canplay 时 seek 到记录位置(在 autoplay 实际开始播放前,
    // 避免 play() 抢先从头播放)。
    if (resumeAtMs != null) {
      const ms = resumeAtMs
      resumeAtMs = null
      audio.currentTime = ms / 1000
      currentTimeMs.value = ms
      applyPlaybackRate()
      callbacks.onStateChange?.(state.value, snapshot())
    }
  }
  function onPlaying() {
    clearBufferingTimer()
    isLoadingNext = false
    applyPlaybackRate()
    ensureAudioClock()
    setState('playing')
  }
  function onPause() {
    clearBufferingTimer()
    if (isLoadingNext) return
    if (!audio.ended) setState('paused')
  }
  function onEnded() {
    setState('ended')
    currentTimeMs.value = 0
    callbacks.onEnded?.()
  }
  function onError() {
    const err = audio.error
    error.value = err
    isLoadingNext = false
    setState('error')
    callbacks.onError?.(err)
  }
  function onVolumeChange() {
    volume.value = audio.volume
    muted.value = audio.muted
    callbacks.onStateChange?.(state.value, snapshot())
  }
  function onRateChange() {
    // 若浏览器/扩展擅自改 rate,拉回用户设定
    if (Math.abs(audio.playbackRate - desiredRate) > 0.01) {
      applyPlaybackRate()
    }
  }

  audio.addEventListener('durationchange', onDurationChange)
  audio.addEventListener('timeupdate', onTimeUpdate)
  audio.addEventListener('loadstart', onLoadStart)
  audio.addEventListener('waiting', onWaiting)
  audio.addEventListener('loadedmetadata', onLoadedMetadata)
  audio.addEventListener('canplay', onCanPlay)
  audio.addEventListener('playing', onPlaying)
  audio.addEventListener('pause', onPause)
  audio.addEventListener('ended', onEnded)
  audio.addEventListener('error', onError)
  audio.addEventListener('volumechange', onVolumeChange)
  audio.addEventListener('ratechange', onRateChange)

  // 初始化时就开启保持音高
  applyPlaybackRate()

  const controller: AudioController = {
    get state() {
      return state.value
    },
    get currentTimeMs() {
      return currentTimeMs.value
    },
    get durationMs() {
      return durationMs.value
    },
    get volume() {
      return volume.value
    },
    get muted() {
      return muted.value
    },
    get canPlay() {
      return canPlay.value
    },
    get error() {
      return error.value
    },
    load(src, opts) {
      isLoadingNext = true
      canPlay.value = false
      error.value = null
      currentTimeMs.value = 0
      durationMs.value = 0
      resumeAtMs = opts?.resumeAt ?? null
      audio.src = src
      audio.load()
      // load 后立刻写一遍,metadata 后再写一遍(见 onLoadedMetadata/onCanPlay)
      applyPlaybackRate()
      setState('loading')
      if (opts?.autoplay) {
        ensureAudioClock()
        audio.play().catch(() => {
          /* autoplay rejection or source error — surfaced via events */
        })
      }
    },
    play() {
      isLoadingNext = false
      ensureAudioClock()
      applyPlaybackRate()
      return audio.play().catch((err: unknown) => {
        setState('paused')
        throw err
      })
    },
    pause() {
      audio.pause()
    },
    stop() {
      isLoadingNext = false
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      currentTimeMs.value = 0
      durationMs.value = 0
      canPlay.value = false
      setState('idle')
    },
    seek(ms) {
      const clamped = Math.max(0, Math.min(ms, durationMs.value || ms)) / 1000
      audio.currentTime = clamped
      currentTimeMs.value = ms
      // seek 后部分内核会重置 rate
      applyPlaybackRate()
      callbacks.onStateChange?.(state.value, snapshot())
    },
    setVolume(v) {
      const clamped = Math.max(0, Math.min(1, v))
      audio.volume = clamped
      volume.value = clamped
    },
    setMuted(m) {
      audio.muted = m
      muted.value = m
    },
    setPlaybackRate(rate) {
      desiredRate = Math.max(0.5, Math.min(1.5, rate))
      applyPlaybackRate()
    },
    setSinkId(deviceId) {
      // setSinkId 是 Chrome 扩展 API(HTMLMediaElement),TS lib.dom 未声明,用类型断言。
      const el = audio as HTMLAudioElement & {
        setSinkId?: (sinkId: string) => Promise<void>
      }
      return el.setSinkId ? el.setSinkId(deviceId) : Promise.resolve()
    },
    dispose() {
      clearBufferingTimer()
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadstart', onLoadStart)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('volumechange', onVolumeChange)
      audio.removeEventListener('ratechange', onRateChange)
      void audioCtx?.close()
      audioCtx = null
    }
  }

  // We use reactive proxies so Vue components watching the controller's
  // getters still track reactivity (the getters read refs above).
  void reactive(controller)
  // 仅在组件 setup 上下文中注册卸载钩子。player.store.init() 在 main.ts 启动阶段调用,
  // 此时无活跃组件实例,onBeforeUnmount 会触发 Vue 警告;controller 由模块级变量持有,
  // 不随组件卸载,无需(也无法)注册生命周期钩子。
  if (getCurrentInstance()) {
    onBeforeUnmount(() => controller.dispose())
  }

  return controller
}
