import type {
  AudioController,
  AudioControllerCallbacks,
  AudioSnapshot
} from '@/composables/useAudioElement'
import type { PlaybackState, QueueItem } from '@/domain/player'
import { isElectronRuntime } from './commands'

/**
 * IPC 版 AudioController:音频永远在主进程的引擎窗口(electron/main/audio-engine.ts)
 * 播放,本控制器只转发命令、接收状态 —— 渲染进程被回收/重建都不影响播放。
 *
 * 接口与 useAudioElement 完全一致,player store 无感切换;非 Electron 环境
 * (浏览器调试)仍走 useAudioElement 的本地 HTMLAudioElement。
 *
 * 状态语义差异:
 *  - load() 后立即本地置 loading(引擎 loadstart 事件不回传);
 *  - play() 的拒绝不会 reject —— 引擎侧 play 失败会以 error/paused 事件上报;
 *  - error 事件的 MediaError 不可得(在引擎进程),回调收到 null。
 */
/**
 * @param getItem 返回当前队列项:load 时随命令发给主进程,这样渲染层不在后
 *        主进程也知道“现在播的是哪首”(恢复载荷/SMTC 需要)。
 */
export function createRemoteAudioController(
  callbacks: AudioControllerCallbacks,
  getItem: () => QueueItem | null
): AudioController {
  const api = window.muiceDesktop?.audio
  if (!api) {
    throw new Error('remote audio unavailable — check shouldUseRemoteAudio() first')
  }

  let state: PlaybackState = 'idle'
  let currentTimeMs = 0
  let durationMs = 0
  let volume = 1
  let muted = false
  let rate = 1
  let sinkId = ''

  function snapshot(): AudioSnapshot {
    return { currentTimeMs, durationMs, volume, muted }
  }

  const unsubscribe = api.onEvent((event) => {
    switch (event.type) {
      case 'state': {
        state = event.state
        currentTimeMs = event.positionMs
        if (event.durationMs > 0) durationMs = event.durationMs
        callbacks.onStateChange?.(event.state, snapshot())
        if (event.state === 'ended') callbacks.onEnded?.()
        else if (event.state === 'error') callbacks.onError?.(null)
        break
      }
      case 'position':
        currentTimeMs = event.positionMs
        // 引擎侧已按 250ms 节流,这里直接转发驱动进度条/回写。
        // 走 onPosition 而不是 onStateChange:position 事件不带状态,而本控制器的
        // state 只在引擎的 state 事件里更新 —— 渲染进程重建后它是初始 idle,
        // 冒充状态回调会把 store 的 playing/paused 覆盖成 idle(界面显示暂停)。
        callbacks.onPosition?.(snapshot())
        break
    }
  })

  const controller: AudioController = {
    get state() {
      return state
    },
    get currentTimeMs() {
      return currentTimeMs
    },
    get durationMs() {
      return durationMs
    },
    get volume() {
      return volume
    },
    get muted() {
      return muted
    },
    get canPlay() {
      return state === 'ready' || state === 'playing' || state === 'paused'
    },
    get error() {
      return null
    },
    load(src, opts) {
      state = 'loading'
      currentTimeMs = 0
      durationMs = 0
      void api.load({
        url: src,
        resumeAtMs: opts?.resumeAt,
        autoplay: opts?.autoplay ?? false,
        volume,
        muted,
        rate,
        sinkId: sinkId || undefined,
        // store 里的 QueueItem 是 Vue reactive Proxy,IPC 结构化克隆无法克隆 Proxy,
        // 必须先转成纯对象(点歌没反应就是它抛 DataCloneError 炸掉了 playQueueItem)。
        item: toIpcSafe(getItem())
      })
      callbacks.onStateChange?.('loading', snapshot())
    },
    play() {
      void api.play()
      return Promise.resolve()
    },
    pause() {
      void api.pause()
    },
    stop() {
      state = 'idle'
      currentTimeMs = 0
      durationMs = 0
      void api.stop()
      callbacks.onStateChange?.('idle', snapshot())
    },
    seek(ms) {
      const clamped = Math.max(0, Math.min(ms, durationMs || ms))
      currentTimeMs = clamped
      void api.seek(clamped)
      // 与 position 事件同理:seek 只改进度,不携带状态,不能伪造状态回调
      callbacks.onPosition?.(snapshot())
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v))
      void api.setVolume(volume, muted)
    },
    setMuted(m) {
      muted = m
      void api.setVolume(volume, muted)
    },
    setPlaybackRate(r) {
      rate = Math.max(0.5, Math.min(1.5, r))
      void api.setRate(rate)
    },
    setSinkId(deviceId) {
      sinkId = deviceId
      return api.setSink(deviceId).then(() => undefined)
    },
    dispose() {
      unsubscribe()
    }
  }

  return controller
}

/** 当前是否应使用远端(引擎)音频控制器。 */
export function shouldUseRemoteAudio(): boolean {
  return isElectronRuntime() && Boolean(window.muiceDesktop?.audio)
}

/**
 * 跨 IPC 的纯数据深拷贝:剥离 Vue reactive Proxy(无法被结构化克隆)。
 * 只用于可序列化的领域对象(QueueItem/Song,无函数无循环引用)。
 */
function toIpcSafe<T>(value: T): T {
  if (value == null) return value
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return null as T
  }
}
