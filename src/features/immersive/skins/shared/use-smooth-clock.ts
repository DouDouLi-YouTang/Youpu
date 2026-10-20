import { computed, onBeforeUnmount, ref, type Ref } from 'vue'

import { useImmersiveSettingsStore } from '../../immersive-settings.store'
import { useLyricStore } from '@/stores/lyric.store'
import { usePlayerStore } from '@/stores/player.store'
import { audioBands } from '../../use-audio-bands'
import type { AudioBands } from '../../use-audio-bands'
import { stepClock, type ClockState } from './clock-core'
import { buildLineRenderEndTimes } from './line-timing'
import type { LyricLine } from '@/domain/lyric'
import { getAudioElement } from '@/app/providers/player-provider'

/**
 * 逐帧歌词时钟 + 六频带 —— 「流光」「浮名」的**公共上游**（Folia 系皮肤专用）。
 *
 * ## 为什么需要它（本项目与 Folia 的一处硬差异）
 *
 * Folia 的歌词时钟是 rAF 驱动的 MotionValue：`usePlaybackVisualizerBridge` 每个
 * `requestAnimationFrame` 读一次 `audioElement.currentTime` 再 `currentTime.set(...)`，
 * 因此它的可视化每帧都拿到**连续**的时间。
 *
 * 本项目不是这样：`useAudioElement` 的 `timeupdate` 被 `THROTTLE_MS = 250` 节流
 * （见 `src/composables/useAudioElement.ts`），`player.currentTimeMs` 每秒只跳约 4 次。
 * 直接把 4Hz 的时间喂给 Folia 的算法会有两类可见故障：
 *  1. **状态机抖动** —— 「流光」逐词状态是 `latest >= start - lookahead` 的区间判定，
 *     时间每 250ms 才走一格，词会在错误的帧上跳成 active；`词与词之间近于同时` 的快速
 *     行（renderHints 的 fast/instant 档，阈值低到 0.067s）整行会一起亮。
 *  2. **动画起步错位** —— 依赖「词的开始时间」算出的 CSS 动画负延迟，会以最多 250ms
 *     的误差起步。
 *
 * 所以本 hook 在**消费侧**做一个逐帧时钟：每帧外推 + 朝音频真值渐进收敛。
 * 算法本体（含全部常量与理由）在 `./clock-core.ts`，那里是纯函数、有单测；
 * 本文件只负责"接上播放器 + 跑 rAF + 给出读取面"。
 *
 * ⚠️ 本 hook **不改 player store、不碰 audio 元素、不新建 rAF 之外的东西**：
 * 定位是「只读消费方的适配层」。订阅计数与频带采样仍由 `useAudioBands()` 管。
 *
 * ⚠️ 时间仍是**毫秒**（本项目契约，见 `skins/types.ts` 的文件头）。Folia 算法是秒制，
 * 由各皮肤自己的适配层换算 —— 本 hook 不做那种换算。
 */

/** 六频带能量，0–1（对齐 Folia `AudioBandSignals` 的语义，少了 spectrum）。 */
export interface SkinAudioBands {
  /** 20–150Hz：底鼓 / 贝斯 */
  bass: number
  /** 150–400Hz：低中频，人声厚度 / 吉他低音区 */
  lowMid: number
  /** 400–1200Hz：中频，人声基音 */
  mid: number
  /** 1000–3500Hz：人声清晰度 */
  vocal: number
  /** 3500–12000Hz：高频，镲片 / 齿音 */
  treble: number
  /** 整体能量（bass+lowMid 的复合），Folia 的 audioPower */
  power: number
}

/**
 * 把四频带（本项目 `use-audio-bands` 的口径）映射到 Folia 的六频带。
 *
 * 为什么是近似而不是重采样：本项目只暴露 low/mid/high/power 四个 0–1 值，
 * 拿不到原始 FFT。Folia 的六个频带里，bass/lowMid 落在 low 的两个半区、
 * mid/vocal 落在 mid 的两个半区，treble 对应 high。用「同区间共用 + 相邻区间加权」
 * 既保住了各频带的量级，也保住了它们之间的相对差异（否则六变四就退化成同涨同落）。
 *
 * 映射表（左：本项目的 low/mid/high；右：Folia 的六频带）：
 *  - bass    = low               （20–150Hz 是 low 区间的低频半区，单独取 low 最接近）
 *  - lowMid  = low*0.6 + mid*0.4 （150–400Hz 横跨 low 的高频半区与 mid 的起始段）
 *  - mid     = mid               （400–1200Hz 基本就是 mid 区间）
 *  - vocal   = mid*0.65 + high*0.35（1000–3500Hz 从 mid 尾段跨到 high 首段）
 *  - treble  = high              （3500–12000Hz 就是 high 区间）
 *  - power   = power             （本项目 power = 20–8000Hz 均值，语义与 Folia 一致）
 *
 * ⚠️ 这是**刻意的近似**，不是等价还原：拿不到原始频谱就不可能等价。
 * 若将来把 `use-audio-bands` 扩成六频带，应删掉本函数并直接透传。
 */
export function toSkinBands(bands: AudioBands): SkinAudioBands {
  return {
    bass: bands.low,
    lowMid: bands.low * 0.6 + bands.mid * 0.4,
    mid: bands.mid,
    vocal: bands.mid * 0.65 + bands.high * 0.35,
    treble: bands.high,
    power: bands.power
  }
}

/** 逐帧时钟 + 频带的读取面（全部是即时读取，不建立响应式依赖）。 */
export interface SmoothClock {
  /** 当前歌词时间（毫秒，已含 `settings.lyricOffset`），逐帧连续 */
  time(): number
  /** 是否正在播放（暂停时时钟不外推） */
  isPlaying(): boolean
  /** 逐帧读取六频带；未播放 / 图未建起来时是全 0 */
  bands(): SkinAudioBands
  /** 当前歌词行下标（-1 = 尚未到首行）。同一个 rAF 里算出，与 `time()` 同帧 */
  currentLineIndex(): number
  /**
   * 订阅本帧回调（在 `time()` 更新之后、同一帧内同步调用）。
   *
   * ## 为什么要有它，而不是每个消费方自己跑一条 rAF
   *
   * 「流光」的一行有十几个词，每个词都要按时间判一次三态。若每个词各跑一条 rAF：
   *  1. 一屏就是十几条独立回调，浏览器要逐个调度，且**互相之间不在同一帧**——
   *     `time()` 读的是同一份值，但读的时刻差半帧，边界上的词会在不同帧翻转；
   *  2. 更糟的是多行切换（`AnimatePresence` 同时挂着新旧两行）时回调数翻倍。
   *
   * 订阅制把「逐帧」这件事收敛成**一条** rAF：所有词在同一帧里拿到同一个时间，
   * 状态翻转天然同步。回调里**不要**写响应式状态以外的东西，也不要建立响应式依赖。
   *
   * 返回值是退订函数；调用方必须在卸载时退订（`use-glow-word-status` 负责这件事）。
   */
  onFrame(callback: () => void): () => void
}

/** 创建时钟时可选的覆盖项 */
export interface UseSmoothClockOptions {
  /**
   * 行源覆盖（含插曲行的那一份，见 `shared/interlude-lines`）。
   *
   * ⚠️ 必须与渲染层用的是**同一个数组**：时钟用一份、渲染用另一份时，
   * 下标会指向两套数组里不同的行 —— 表现是「画面在唱 A 句、时钟以为在 B 句」，
   * 且只在补了插曲行的歌上出现（很难查）。不传就用 store 的原始行。
   */
  lines?: Ref<readonly LyricLine[]>
}

/**
 * 创建逐帧时钟。**必须在组件 setup 中调用**（会注册 rAF 循环与卸载钩子）。
 *
 * 行下标与时间在**同一个 rAF** 里算出（而不是分成两个 hook 各跑一条 rAF）：
 * 两条独立循环会各差半帧，导致「时间已经进了下一行、下标还停在上一行」——
 * 换行的那一帧正是动画最显眼的一帧。
 */
export function useSmoothClock(options: UseSmoothClockOptions = {}): SmoothClock {
  const player = usePlayerStore()
  const settings = useImmersiveSettingsStore()
  const lyric = useLyricStore()

  /** 行源（见 `UseSmoothClockOptions.lines`） */
  const lines = computed<readonly LyricLine[]>(() => options.lines?.value ?? lyric.lines)

  /** 本帧算出的时间（毫秒，含 lyricOffset） */
  const frameTime = ref(0)
  /** 本帧算出的当前行下标（-1 = 尚未到首行） */
  const frameLineIndex = ref(-1)
  /** 时钟状态（`clock-core` 的不可变状态；只在 rAF 内更新） */
  let clock: ClockState | null = null
  /** 上一帧的墙上时刻（算帧间隔用） */
  let lastStamp: number | null = null

  /**
   * 本帧回调订阅者。
   *
   * 用 `Set` 而不是数组：退订是 O(1)，且遍历中新增 / 删除订阅者不会让下标错位
   * （`for...of` 遍历 Set 时删除已访问项是安全的，新增项会在本轮被访问到 ——
   * 新增的订阅者本来就是本帧才挂上来的，多跑一次无副作用）。
   */
  const frameCallbacks = new Set<() => void>()

  /**
   * 音频真值（毫秒，含 lyricOffset）。
   *
   * 优先直读音频元素 —— 这是 Folia 的做法（`audioElement.currentTime`），也是本项目里
   * **唯一**不受 250ms 节流影响的时间源。元素不可用（图没建起来 / 非浏览器环境）时
   * 退回 store 的离散值：降级成 4Hz 也比抛错强。
   */
  let audioEl: HTMLAudioElement | null = null
  try {
    audioEl = getAudioElement()
  } catch {
    // provider 未初始化 —— 退回 store 离散时间
    audioEl = null
  }

  function readTargetMs(): number {
    const offset = settings.lyricOffset
    if (audioEl) {
      const seconds = audioEl.currentTime
      // 元素时间在切歌瞬间可能是 NaN / 负值（src 已换但 metadata 未到）：
      // 此时退回 store 的离散值，避免把 NaN 灌进时钟
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000 + offset
    }
    return player.currentTimeMs + offset
  }

  let rafId: number | null = null

  /**
   * 当前行下标 —— 上游 `findLatestActiveLineIndex` 的**窗口**语义，含 stagger 提前 200ms。
   *
   * ## 为什么不是「最后一个已开始的行」
   *
   * 本项目改造前的写法是「遍历到第一个未开始的行，取它前面那个」—— 那个下标一旦前进
   * 就**再也不会回到 -1**，于是：
   *  - 长间奏（前奏 / 间奏 / 尾奏）期间舞台一直停着上一句，而上游会把它清空；
   *  - 副字幕也没有机会回退到"最近一句唱完的行"（上游 `getRecentCompletedLine`
   *    只在 `currentLineIndex === -1` 时才去找上一句）。
   *
   * 上游的判据是**从后往前找第一行「已开始且还没结束」**：
   * `time >= startTime && time <= renderEndTime`，找不到就是 -1。
   * 这里的 `renderEndTime` 含**出场补白**（行唱完之后留一小段给退场动画），
   * 所以下标不是在行的最后一个字唱完的瞬间就跳走，而是等退场动画播完 ——
   * 否则上一行的 exit 动画会被下一行抢掉，两行在视觉上叠在一起。
   *
   * ⚠️ `renderEndTime` 的推算要读 `shared/render-hints`（与两个皮肤同一张档位表）。
   * 本函数在 rAF 里逐帧跑，所以**不能**每帧重算提示 —— 按行下标缓存，
   * 只有下标真的变了才重算一次（见 `renderEndTimes` 的说明）。
   */
  function resolveLineIndex(t: number): number {
    const currentLines = lines.value
    for (let index = currentLines.length - 1; index >= 0; index -= 1) {
      const line = currentLines[index]
      if (t < line.timeMs) continue
      if (t <= resolveLineRenderEndTimeMs(index)) return index
    }
    return -1
  }

  /**
   * 逐行的 `renderEndTime` 缓存（毫秒）。下标只在换行时变，所以这份数组只在
   * 行数组或播放时长变化时重建 —— 不在每帧重算（见 `resolveLineIndex` 的说明）。
   *
   * ⚠️ 用 `===` 比引用而不是比内容：store 的行数组是**整份替换**的
   * （`loadLyric` 直接赋值），所以引用不变就说明行没变。
   */
  let renderEndTimes: number[] = []
  let renderEndTimesForLines: readonly LyricLine[] | null = null
  let renderEndTimesForDuration = Number.NaN

  function resolveLineRenderEndTimeMs(index: number): number {
    const currentLines = lines.value
    if (
      renderEndTimesForLines !== currentLines ||
      renderEndTimesForDuration !== player.durationMs ||
      renderEndTimes.length !== currentLines.length
    ) {
      renderEndTimes = buildLineRenderEndTimes(currentLines, player.durationMs)
      renderEndTimesForLines = currentLines
      renderEndTimesForDuration = player.durationMs
    }
    return renderEndTimes[index] ?? Number.NEGATIVE_INFINITY
  }

  function tick(): void {
    rafId = requestAnimationFrame(tick)

    const stamp = performance.now()
    const deltaMs = lastStamp === null ? 0 : stamp - lastStamp
    lastStamp = stamp

    clock = stepClock({
      previous: clock,
      targetMs: readTargetMs(),
      deltaMs,
      isPlaying: player.isPlaying,
      playbackRate: player.playbackRate
    })
    frameTime.value = clock.timeMs

    // 下标按「未加 stagger 的时钟」算，再自行加提前量 —— 与 useActiveLyricIndex 同口径
    const stagger = settings.lyricStagger ? 200 : 0
    frameLineIndex.value = resolveLineIndex(frameTime.value + stagger)

    // 订阅者在时间与下标都更新完之后才被调用 —— 它们读到的必然是**同一帧**的完整快照
    for (const callback of frameCallbacks) callback()
  }

  rafId = requestAnimationFrame(tick)
  onBeforeUnmount(() => {
    if (rafId !== null) cancelAnimationFrame(rafId)
    rafId = null
    frameCallbacks.clear()
  })

  return {
    time: () => frameTime.value,
    isPlaying: () => player.isPlaying,
    bands: () => toSkinBands(audioBands.value),
    currentLineIndex: () => frameLineIndex.value,
    onFrame: (callback: () => void): (() => void) => {
      frameCallbacks.add(callback)
      return () => {
        frameCallbacks.delete(callback)
      }
    }
  }
}
