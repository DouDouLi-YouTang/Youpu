import { app, BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { LowMemoryMode, LowMemoryStatus, PlaybackHandover } from '../../src/domain/low-memory'
import type { PlaybackMode, QueueItem } from '../../src/domain/player'
import { rememberRendererSnapshot } from './audio-engine'

/**
 * 低内存模式:窗口最小化/隐藏到托盘后,销毁主渲染进程(常驻 200–400MB,
 * 最小化并不会释放),只留主进程、后端与常驻音频引擎(electron/main/audio-engine.ts)。
 *
 * 音频从不依赖主渲染进程:播放一直发生在音频引擎窗口里,渲染层只通过 IPC 发
 * 控制命令 —— 因此回收是“直接销毁”,播放零中断;渲染层重建也只是恢复 UI 并
 * 重新连上控制通道,不存在移交/接管。
 *
 * 回收时主进程抓一份运行时状态快照(持久化队列 + 播放移交快照),用于:
 *  - 引擎正在播 → 建立降级会话,渲染层不在期间由主进程自动切歌(FM/心动/队列);
 *  - 渲染层重建后 → 作为恢复载荷的数据源(队列/曲目/音量等)。
 *
 * 与渲染层的约定(改名要同步):
 *   localStorage['muice:play-queue']         —— 队列(pinia 持久化,play-queue.store)
 *   localStorage['muice:playback-handover']  —— 播放状态快照(use-low-memory-restore 持续写)
 */

/** 回收前从主渲染进程一次性抓取的运行时状态。 */
export interface ReleaseCapture {
  queue: BgQueueCapture | null
  handover: PlaybackHandover | null
}

/** 降级会话需要的队列状态子集(与 audio-engine 的 EngineQueueState 结构一致)。 */
export interface BgQueueCapture {
  items: QueueItem[]
  currentIndex: number
  mode: PlaybackMode
  shuffleOrder: number[]
}

interface MemoryModeDeps {
  /** 重建主窗口(由 index.ts 提供,内部会重新 loadURL/loadFile)。 */
  recreateWindow: () => BrowserWindow
  /** 当前主窗口;可能为 null(已销毁)。 */
  getWindow: () => BrowserWindow | null
  /** 窗口已被自动回收销毁时,通知 index.ts 清空 mainWindow 引用。 */
  onWindowTornDown: () => void
}

/** 窗口隐藏后等待多久再回收渲染进程:给“误触最小化马上又点回来”留出缓冲。 */
// 8 秒是“误触最小化立刻点回来”的缓冲。测试时可用环境变量压短,便于自动化验证。
const RELEASE_DELAY_MS = Number(process.env.YOUPU_LOW_MEMORY_DELAY_MS) || 8000

const QUEUE_STORAGE_KEY = 'muice:play-queue'
const HANDOVER_STORAGE_KEY = 'muice:playback-handover'

let deps: MemoryModeDeps | null = null
let mode: LowMemoryMode = 'off'
let releaseTimer: ReturnType<typeof setTimeout> | null = null
let released = false
let releasedAt: number | null = null
let releaseCount = 0
let tearingDown = false

export function initLowMemoryMode(options: MemoryModeDeps): void {
  deps = options
}

export function setLowMemoryMode(next: LowMemoryMode): void {
  if (mode === next) return
  mode = next
  if (mode === 'off') {
    cancelScheduledRelease()
  }
}

/** memory-mode 自身维护的状态;backgroundPlaying 由 index.ts 合并(audio-engine 所有)。 */
export function getLowMemoryStatus(): Omit<LowMemoryStatus, 'backgroundPlaying'> {
  return { mode, released, releasedAt, releaseCount }
}

/** 在窗口上挂载低内存相关的监听。窗口每次重建都要重新挂一次。
 *  `canRelease` 是窗口形态层面的额外闸门(由 index.ts 提供,例如迷你模式不允许回收),
 *  返回 false 时直接取消回收计划。 */
export function attachWindow(win: BrowserWindow, canRelease?: () => boolean): void {
  const onHidden = (): void => {
    if (canRelease && !canRelease()) {
      cancelScheduledRelease()
      return
    }
    scheduleReleaseIfHidden()
  }
  const onVisible = (): void => {
    cancelScheduledRelease()
  }
  win.on('minimize', onHidden)
  win.on('hide', onHidden)
  win.on('restore', onVisible)
  win.on('show', onVisible)
  win.on('focus', onVisible)
}

/** 用户从托盘/任务栏唤起窗口:若渲染进程已被回收,先重建再显示。 */
export function ensureWindowVisible(): BrowserWindow | null {
  if (!released) {
    const existing = deps?.getWindow() ?? null
    if (existing && !existing.isDestroyed()) {
      existing.show()
      existing.focus()
      return existing
    }
  }
  return recreateNow()
}

function cancelScheduledRelease(): void {
  if (releaseTimer) {
    clearTimeout(releaseTimer)
    releaseTimer = null
  }
}

function scheduleReleaseIfHidden(): void {
  if (mode === 'off') return
  const win = deps?.getWindow() ?? null
  if (!win || win.isDestroyed()) return
  if (win.isVisible() && !win.isMinimized()) {
    cancelScheduledRelease()
    return
  }
  cancelScheduledRelease()
  releaseTimer = setTimeout(() => {
    releaseTimer = null
    void releaseRenderer()
  }, RELEASE_DELAY_MS)
}

/**
 * 一次 executeJavaScript 抓全回收所需状态:持久化队列、播放状态快照。
 * 任何一步失败都按“缺省”处理,不影响回收流程(播放不在渲染进程,丢快照
 * 只影响降级切歌与 UI 恢复,不影响音频)。
 */
async function captureRuntimeState(win: BrowserWindow): Promise<ReleaseCapture> {
  const script =
    '(function(){try{' +
    'return JSON.stringify({' +
    `q:localStorage.getItem(${JSON.stringify(QUEUE_STORAGE_KEY)}),` +
    `h:localStorage.getItem(${JSON.stringify(HANDOVER_STORAGE_KEY)})});}` +
    'catch(e){return null;}})()'
  let raw: string | null
  try {
    raw = (await win.webContents.executeJavaScript(script, true)) as string | null
  } catch (error) {
    console.warn('[low-memory] 抓取渲染进程状态失败:', error)
    return { queue: null, handover: null }
  }
  if (!raw) return { queue: null, handover: null }

  let parsed: { q?: string | null; h?: string | null }
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch {
    return { queue: null, handover: null }
  }

  let queue: BgQueueCapture | null = null
  if (parsed.q) {
    try {
      const state = JSON.parse(parsed.q) as Partial<{
        items: QueueItem[]
        currentIndex: number
        mode: PlaybackMode
        shuffleOrder: number[]
      }>
      if (Array.isArray(state.items)) {
        queue = {
          items: state.items,
          currentIndex: typeof state.currentIndex === 'number' ? state.currentIndex : -1,
          mode: state.mode ?? 'sequence',
          shuffleOrder: Array.isArray(state.shuffleOrder) ? state.shuffleOrder : []
        }
      }
    } catch {
      // 队列解析失败:渲染层重建后仍可从 pinia persist 恢复本地队列
    }
  }

  let handover: PlaybackHandover | null = null
  if (parsed.h) {
    try {
      handover = JSON.parse(parsed.h) as PlaybackHandover
    } catch {
      handover = null
    }
  }

  return { queue, handover }
}

/** 真正执行回收:抓快照(需要时建降级会话),然后销毁渲染进程。播放不受影响。 */
async function releaseRenderer(): Promise<void> {
  const win = deps?.getWindow() ?? null
  if (!win || win.isDestroyed() || tearingDown) return
  if (mode === 'off') return
  // 延迟期间窗口可能又被显示出来了
  if (win.isVisible() && !win.isMinimized()) return
  // 迷你模式是“边听边看”的场景,不回收
  if (win.isAlwaysOnTop()) return

  tearingDown = true
  try {
    const capture = await captureRuntimeState(win)
    // 无论回收时是否在播都记录快照:渲染层重建后的恢复载荷要用它还原完整歌单;
    // 引擎在播时 rememberRendererSnapshot 内部会同时建立降级会话(后台自动切歌)
    rememberRendererSnapshot(capture.queue, capture.handover)

    lastBounds = win.getBounds()
    const wasMaximized = win.isMaximized()
    // 用 destroy 而不是 close:close 会被 index.ts 的关闭确认流程拦下
    win.destroy()
    released = true
    releasedAt = Date.now()
    releaseCount += 1
    deps?.onWindowTornDown()
    console.log(
      `[low-memory] 已回收渲染进程(第 ${releaseCount} 次),释放约 200–400MB;音频在引擎中不受影响`,
      wasMaximized ? '(最大化)' : ''
    )
  } finally {
    tearingDown = false
  }
}

let lastBounds: Electron.Rectangle | null = null

/** 重建主窗口并显示;返回新窗口。 */
function recreateNow(): BrowserWindow | null {
  if (!deps) return null
  released = false
  const win = deps.recreateWindow()
  if (lastBounds) {
    try {
      win.setBounds(lastBounds)
    } catch {
      // 显示器变化导致旧位置非法时忽略
    }
  }
  return win
}

/** 应用退出前清掉定时器,避免退出过程中触发回收。 */
export function disposeLowMemoryMode(): void {
  cancelScheduledRelease()
  deps = null
}

/**
 * 低内存模式的配置持久化:存在 userData 下的一个极简 JSON 里,
 * 不引入额外依赖。渲染层通过 IPC 读写。
 * 旧版的 'on-idle' / 'always' 统一迁移为 'on'(音频引擎常驻后无需区分)。
 */
const CONFIG_FILE = 'low-memory.json'

const LEGACY_MODE_MAP: Record<string, LowMemoryMode> = {
  'on-idle': 'on',
  always: 'on'
}

export function normalizeLowMemoryModeValue(value: unknown): LowMemoryMode {
  if (value === 'off' || value === 'on') return value
  if (typeof value === 'string' && value in LEGACY_MODE_MAP) return LEGACY_MODE_MAP[value]
  return 'off'
}

export function loadPersistedMode(): LowMemoryMode {
  try {
    const raw = readFileSync(join(app.getPath('userData'), CONFIG_FILE), 'utf8')
    const parsed = JSON.parse(raw) as { mode?: unknown }
    if (parsed.mode === 'off' || parsed.mode === 'on') return parsed.mode
    if (typeof parsed.mode === 'string' && parsed.mode in LEGACY_MODE_MAP) {
      return LEGACY_MODE_MAP[parsed.mode]
    }
  } catch {
    // 首次运行或文件损坏,用默认值
  }
  // 迁移前默认 on-idle;音频引擎常驻后回收不中断播放,默认开启
  return 'on'
}
