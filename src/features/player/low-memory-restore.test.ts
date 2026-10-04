import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import type { LowMemoryRestorePayload, PlaybackHandover } from '@/domain/low-memory'
import type { QueueItem } from '@/domain/player'
import type { Song } from '@/domain/song'
import { PLAYBACK_HANDOVER_KEY } from './use-low-memory-restore'

/**
 * 低内存模式恢复窗口的回归测试:回收渲染进程后重建的那一代渲染层,必须把
 * 队列/曲目/播放状态对齐到音频引擎,并且不能被引擎随后的进度事件改回 idle。
 *
 * 主进程音频引擎(engineLoad / onEvent)用假的 IPC 替代,只验证渲染层编排。
 */

// 恢复暂停态后点播放会重新解析签名 URL:替换网络请求
vi.mock('@/services/player-service', () => ({
  resolvePlayableTrack: vi.fn(async (song: Song) => ({
    song,
    url: 'https://fresh.example/song.mp3',
    bitrate: 320_000,
    expiresAt: Date.now() + 3_600_000
  }))
}))

/** 引擎推送事件(与 electron/main/bg-player.ts 的 BgPlayerEvent 对齐)。 */
type EngineEvent =
  | {
      type: 'state'
      state: 'ready' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error'
      positionMs: number
      durationMs: number
    }
  | { type: 'position'; positionMs: number }

interface FakeDesktop {
  emit: (event: EngineEvent) => void
  /** 当前 localStorage 里的播放移交快照(回收渲染进程时主进程读的就是它)。 */
  handover: () => string | null
  volumeCalls: Array<[number, boolean]>
  rateCalls: number[]
  loadCalls: Array<{ url: string; autoplay: boolean; resumeAtMs?: number }>
  playCalls: number
}

function makeSong(id: number): Song {
  return {
    id,
    name: `歌 ${id}`,
    artists: [{ id: 1, name: '歌手' }],
    album: { id: 1, name: '专辑' },
    durationMs: 200_000,
    playableStatus: 'playable'
  }
}

function makeItem(id: number, uid: string): QueueItem {
  return { uid, songId: id, song: makeSong(id), source: 'playlist', addedAt: 1 }
}

/** 模拟主进程:队列与播放移交快照来自两份各自 parse 的 localStorage 数据。 */
function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function installDesktop(
  payload: LowMemoryRestorePayload | null,
  seededStorage: Record<string, string> = {}
): FakeDesktop {
  const listeners = new Set<(event: EngineEvent) => void>()
  const state = {
    volumeCalls: [] as Array<[number, boolean]>,
    rateCalls: [] as number[],
    loadCalls: [] as Array<{ url: string; autoplay: boolean; resumeAtMs?: number }>,
    playCalls: 0
  }
  const localStorageStub = new Map<string, string>(Object.entries(seededStorage))
  const sessionStorageStub = new Map<string, string>()

  vi.stubGlobal('window', {
    muiceDesktop: {
      audio: {
        load: async (command: { url: string; autoplay: boolean; resumeAtMs?: number }) => {
          state.loadCalls.push({
            url: command.url,
            autoplay: command.autoplay,
            resumeAtMs: command.resumeAtMs
          })
          return true
        },
        play: async () => {
          state.playCalls += 1
        },
        pause: async () => undefined,
        stop: async () => undefined,
        seek: async () => undefined,
        setVolume: async (value: number, muted: boolean) => {
          state.volumeCalls.push([value, muted])
        },
        setRate: async (value: number) => {
          state.rateCalls.push(value)
        },
        setSink: async () => undefined,
        setMeta: async () => undefined,
        attach: async () => payload,
        onEvent: (callback: (event: EngineEvent) => void) => {
          listeners.add(callback)
          return () => listeners.delete(callback)
        }
      }
    }
  })
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => localStorageStub.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      localStorageStub.set(key, value)
    },
    removeItem: (key: string): void => {
      localStorageStub.delete(key)
    }
  })
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string): string | null => sessionStorageStub.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      sessionStorageStub.set(key, value)
    }
  })

  return {
    ...state,
    handover: (): string | null => localStorageStub.get(PLAYBACK_HANDOVER_KEY) ?? null,
    get volumeCalls() {
      return state.volumeCalls
    },
    get rateCalls() {
      return state.rateCalls
    },
    get loadCalls() {
      return state.loadCalls
    },
    get playCalls() {
      return state.playCalls
    },
    emit: (event: EngineEvent) => {
      for (const listener of [...listeners]) listener(event)
    }
  }
}

/** 冷启动同一个渲染层:useLowMemoryRestore() → player.init() → applyLowMemoryRestore()。 */
async function boot(
  payload: LowMemoryRestorePayload | null,
  seededStorage: Record<string, string> = {}
) {
  const desktop = installDesktop(payload, seededStorage)
  setActivePinia(createPinia())
  const [{ usePlayerStore }, { usePlayQueueStore }, restore] = await Promise.all([
    import('@/stores/player.store'),
    import('@/stores/play-queue.store'),
    import('./use-low-memory-restore')
  ])
  const player = usePlayerStore()
  const queue = usePlayQueueStore()
  restore.useLowMemoryRestore()
  player.init()
  await restore.applyLowMemoryRestore()
  return { player, queue, desktop }
}

/** 放掉若干轮宏任务/微任务,等 watch 回调与 IPC 假实现的 promise 链跑完。 */
async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

beforeAll(async () => {
  // 首次 import 要转译整条依赖链(含 ant-design-vue),预热一次,
  // 否则第一个用例会把几秒的转译时间算进自己的超时。
  await import('@/stores/player.store')
  await import('@/stores/play-queue.store')
  await import('./use-low-memory-restore')
}, 60_000)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

/** 每个用例都要重建渲染层(controller 是模块级单例),所以统一 20s 超时。 */
const TEST_TIMEOUT = { timeout: 20_000 }

describe('低内存模式:恢复窗口后的状态同步', () => {
  it('引擎在播:恢复曲目/队列下标/音量倍速,进度事件不会把状态打回 idle', TEST_TIMEOUT, async () => {
    const items = [makeItem(1, 'uid-1'), makeItem(2, 'uid-2'), makeItem(3, 'uid-3')]
    const payload: LowMemoryRestorePayload = {
      playing: true,
      positionMs: 42_000,
      url: 'muice-cache://song/3',
      queue: {
        items: jsonClone(items),
        currentIndex: 2,
        mode: 'shuffle',
        shuffleOrder: [2, 0, 1]
      },
      currentItem: jsonClone(items[2]),
      fmMode: false,
      sourcePlaylistId: null,
      level: 'hires',
      volume: 0.35,
      muted: false,
      playbackRate: 1.25
    }
    const { player, queue, desktop } = await boot(payload)

    expect(player.state).toBe('playing')
    expect(player.currentItem?.uid).toBe('uid-3')
    expect(queue.currentIndex).toBe(2)
    expect(queue.mode).toBe('shuffle')
    expect(player.volume).toBe(0.35)
    expect(player.playbackRate).toBe(1.25)
    // 重建的 store 是初始值:绝不能把音量 1 / 倍速 1 推给正在播的引擎
    expect(desktop.volumeCalls).toEqual([[0.35, false]])
    expect(desktop.rateCalls).toEqual([1.25])

    // 恢复时队列进度已对齐(恢复载荷的精确进度)
    expect(queue.positionMs).toBe(42_000)

    // 引擎每 250ms 推一次进度:只更新进度,不改播放状态(旧实现在这里变 idle)
    desktop.emit({ type: 'position', positionMs: 43_500 })
    expect(player.state).toBe('playing')
    expect(player.currentTimeMs).toBe(43_500)
    // 队列持久化回写有 1s 节流:紧接着的一条进度不会立刻落盘
    await flush()
    expect(queue.positionMs).toBe(42_000)

    await new Promise((resolve) => setTimeout(resolve, 1_050))
    desktop.emit({ type: 'position', positionMs: 44_000 })
    await flush()
    expect(queue.positionMs).toBe(44_000)

    // 本代次的播放快照已落盘:回收渲染进程时主进程靠它建立降级会话
    const handover = JSON.parse(desktop.handover() ?? 'null') as PlaybackHandover | null
    expect(handover?.currentItem?.uid).toBe('uid-3')
    expect(handover?.volume).toBe(0.35)

    // 引擎真实的状态事件仍然照常同步
    desktop.emit({ type: 'state', state: 'paused', positionMs: 43_800, durationMs: 200_000 })
    expect(player.state).toBe('paused')
    expect(player.currentTimeMs).toBe(43_800)
  })

  it(
    '引擎暂停:时长为播放态的占位 0,点播放先用新签名 URL 重新解析而不是直接播旧 URL',
    TEST_TIMEOUT,
    async () => {
      const item = makeItem(1, 'uid-1')
      const payload: LowMemoryRestorePayload = {
        playing: false,
        positionMs: 30_000,
        url: 'https://expired.example/song.mp3',
        queue: { items: [jsonClone(item)], currentIndex: 0, mode: 'sequence', shuffleOrder: [] },
        currentItem: jsonClone(item),
        fmMode: false,
        sourcePlaylistId: null,
        level: 'hires',
        volume: 1,
        muted: false,
        playbackRate: 1
      }
      const { player, desktop } = await boot(payload)

      expect(player.state).toBe('paused')
      expect(player.currentTrack?.expiresAt).toBe(0)

      player.play()
      await flush()

      expect(desktop.playCalls).toBe(0)
      expect(desktop.loadCalls).toHaveLength(1)
      expect(desktop.loadCalls[0]).toMatchObject({
        url: 'https://fresh.example/song.mp3',
        autoplay: true,
        resumeAtMs: 30_000
      })
    }
  )

  it('上一轮运行遗留的播放快照会被清掉,不会在回收后恢复出不存在的曲目', TEST_TIMEOUT, async () => {
    const stale: PlaybackHandover = {
      url: 'https://stale.example/song.mp3',
      currentItem: makeItem(9, 'stale-uid'),
      positionMs: 12_000,
      state: 'paused',
      volume: 1,
      muted: false,
      playbackRate: 1,
      level: 'hires',
      sinkId: '',
      fmMode: false,
      sourcePlaylistId: null,
      cookie: '',
      cacheEnabled: false,
      cacheMaxBytes: 0,
      writtenAt: 1
    }
    const { player, desktop } = await boot(null, {
      [PLAYBACK_HANDOVER_KEY]: JSON.stringify(stale)
    })

    expect(player.currentItem).toBeNull()
    expect(desktop.handover()).toBeNull()
  })

  it('引擎没有曲目(回收前未在播):队列由持久化状态恢复为暂停态', TEST_TIMEOUT, async () => {
    const { player, queue } = await boot(null)

    expect(player.state).toBe('idle')
    expect(player.currentItem).toBeNull()
    expect(queue.currentIndex).toBe(-1)
  })
})
