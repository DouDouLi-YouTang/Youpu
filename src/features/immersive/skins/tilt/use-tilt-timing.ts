/**
 * 「倾诉」逐字时序 —— 把 core 的时间片算法落成**可直接喂给 CSS 动画**的逐字模型。
 *
 * 驱动方式：本项目的时间源 `ctx.currentTime()` 来自 `timeupdate`（约 4Hz，见
 * useAudioElement），逐字脉冲若靠每帧重算内联样式会一顿一顿的（还要为播放速率
 * 补偿时钟）。因此这里采用与 LyricLines 相同的做法 —— **CSS 动画 + 负延迟**：
 *  - 关键帧只写一次（tilt-line.scss），每个字通过 `--tilt-*-delay` / `--tilt-*-dur`
 *    提供自己的延迟与时长；
 *  - 延迟 = 字的绝对时间 − 动画时钟零点，负延迟表示「动画已经走到这里了」，
 *    所以挂载/重建后**首帧就落在正确相位**，不需要逐帧驱动；
 *  - 暂停定格交给 `animation-play-state: paused`（浏览器原生，绝不继续走）。
 *
 * 动画时钟零点（clockMs）在三种时机重建：切行、拖动进度条（时间跳变）、改歌词偏移。
 * 这正是 LyricLines「逐字快照」的等价物，只是快照内容是延迟而不是高亮进度。
 */
import {
  computed,
  ref,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref
} from 'vue'

import { buildCharTimings, buildCharTimingsFromWords, type CharTiming } from './core/char-timing'
import type { TiltSegmentLayout } from './use-tilt-layout'
import {
  CHAR_FADE_DELAY_MS,
  PLAIN_PULSE_SCALE,
  resolvePulseAnimationMs,
  round2,
  SEEK_JUMP_MS,
  SEGMENT_LEAD_MS,
  TILT_CHAR_FADE_DELAY_MS,
  TILT_PULSE_SCALE,
  TILT_WAVE_DIVISOR,
  toWordSpans,
  type TiltLineSource
} from './tilt-adapter'

/** 一个字素的动画模型（渲染时只负责把这些值写成 CSS 变量） */
export interface TiltCharModel {
  char: string
  isWhitespace: boolean
  /** 段内非空白字素序号（0 起，§7 的淡入延迟按它递增） */
  seq: number
  /** 倾斜段的上下交错位移（px），非倾斜段 / 空白字素为 0 */
  wavePx: number
  /** 脉冲峰值放大系数（倾斜 0.18 / 非倾斜 0.15，与 core.getCharPulseScale 一致） */
  peak: number
  /** 淡入动画延迟（ms，相对动画时钟零点，可为负） */
  fadeDelayMs: number
  /** 脉冲动画延迟（ms，相对动画时钟零点，可为负） */
  pulseDelayMs: number
  /** 脉冲动画时长（ms，含余晖升起段） */
  pulseDurationMs: number
  startTime: number
  endTime: number
}

/** 一个段（= 渲染上的一行）的动画模型 */
export interface TiltSegmentModel {
  /** 段在整行文本中的起始偏移，同时用作渲染 key */
  key: string
  text: string
  isTilt: boolean
  /** 命中「末段过短」补偿（字号 × 1.18，§2.4） */
  isShortLast: boolean
  chars: TiltCharModel[]
}

export interface TiltLineModel {
  text: string
  timeMs: number
  segments: TiltSegmentModel[]
}

/**
 * 构建一行的逐字动画模型（**纯函数**）。
 *
 * 时序规则（笔记 §7）：
 *  - 段可见起点 = 段内第一个非空白字素的起点 − 0.25s；段内没有非空白字素 → 整行起点
 *  - 段内逐字淡入延迟 = 非空白序号 × 0.04s（倾斜段 0.05s）
 *  - 逐字脉冲 = 字素自己的 [start, end]（§5：词级时间戳均分到字素；无 words 时整行均分）
 *  - 空白字素不参与序号，跟着前一个实字的延迟出现
 */
export function buildTiltLineModel(params: {
  source: TiltLineSource
  segments: readonly TiltSegmentLayout[]
  /** 最终字号 px（已含用户倍率与溢出缩放） */
  fontPx: number
  /** 动画时钟零点：这些延迟都相对它 */
  clockMs: number
}): TiltLineModel {
  const { source, segments, fontPx, clockMs } = params
  const spans = toWordSpans(source.words, source.text)
  const timings: CharTiming[] = spans
    ? buildCharTimingsFromWords(spans)
    : buildCharTimings(source.text, source.timeMs, source.endMs)

  const models = segments.map<TiltSegmentModel>((segment) => {
    const from = segment.offset
    const to = from + segment.text.length
    const segmentChars = timings.filter((timing) => timing.index >= from && timing.index < to)

    // §7：段的窗口起点由段内第一个词的起点决定（没有词则退化为整行起点）
    const anchorMs = segmentChars.find((timing) => !timing.isWhitespace)?.startTime ?? source.timeMs
    const baseFadeDelayMs = anchorMs - SEGMENT_LEAD_MS - clockMs
    const fadeStepMs = segment.isTilt ? TILT_CHAR_FADE_DELAY_MS : CHAR_FADE_DELAY_MS

    let seq = 0
    let lastFadeDelayMs: number | null = null
    const chars = segmentChars.map<TiltCharModel>((timing) => {
      let fadeDelayMs: number
      if (timing.isWhitespace) {
        // 空白无可见性（opacity 不影响布局），让它跟前一个实字一起出现即可
        fadeDelayMs = lastFadeDelayMs ?? baseFadeDelayMs
      } else {
        fadeDelayMs = baseFadeDelayMs + seq * fadeStepMs
        seq += 1
      }
      lastFadeDelayMs = fadeDelayMs

      const charSeq = timing.isWhitespace ? seq : seq - 1
      const wavePx =
        segment.isTilt && !timing.isWhitespace
          ? (charSeq % 2 === 0 ? -1 : 1) * (fontPx / TILT_WAVE_DIVISOR)
          : 0

      return {
        char: timing.char,
        isWhitespace: timing.isWhitespace,
        seq: charSeq,
        wavePx: round2(wavePx),
        peak: segment.isTilt ? TILT_PULSE_SCALE : PLAIN_PULSE_SCALE,
        fadeDelayMs: round2(fadeDelayMs),
        pulseDelayMs: round2(timing.startTime - clockMs),
        pulseDurationMs: resolvePulseAnimationMs(timing.startTime, timing.endTime),
        startTime: timing.startTime,
        endTime: timing.endTime
      }
    })

    return {
      key: `${segment.offset}`,
      text: segment.text,
      isTilt: segment.isTilt,
      isShortLast: segment.isShortLast,
      chars
    }
  })

  return { text: source.text, timeMs: source.timeMs, segments: models }
}

/** useTiltTiming 入参：ComputedRef 或 getter 均可，内部用 toValue 读以保证响应式依赖成立 */
export interface UseTiltTimingOptions {
  /** 当前时间（毫秒，已含歌词偏移） */
  time: MaybeRefOrGetter<number>
  /** 行身份（歌曲 + 行下标）。变化即切行，重建时钟零点 */
  lineKey: MaybeRefOrGetter<string>
  /** 需要强制重同步的输入（本项目传 lyricOffset）。变化即重建时钟零点 */
  resyncKey: MaybeRefOrGetter<unknown>
  source: MaybeRefOrGetter<TiltLineSource | null>
  segments: MaybeRefOrGetter<readonly TiltSegmentLayout[] | null>
  fontPx: MaybeRefOrGetter<number>
}

/**
 * 逐字时序（响应式外壳）。返回：
 *  - `model`：当前行的逐字模型（布局未就绪 / 无行时为 null）
 *  - `epoch`：快照代数，用作 DOM key —— 每次重建都会 +1，强制重挂载让 CSS 动画时钟归零
 *  - `resync`：显式请求重同步（点击行内 seek 用；下一次时间更新时生效）
 */
export function useTiltTiming(options: UseTiltTimingOptions): {
  model: ComputedRef<TiltLineModel | null>
  epoch: Ref<number>
  resync: () => void
  resyncNow: () => void
} {
  const clockMs = ref(toValue(options.time))
  const epoch = ref(0)

  let lastLineKey = ''
  let lastResyncKey: unknown = Symbol('initial')
  let lastTimeMs = clockMs.value
  let resyncRequested = false

  function snapshot(): void {
    clockMs.value = toValue(options.time)
    lastTimeMs = clockMs.value
    epoch.value += 1
  }

  // flush 默认 'pre'：快照必须在渲染前就绪，否则本帧会先用旧延迟渲染、再重建 —— 动画会闪一下
  watch(
    [() => toValue(options.lineKey), () => toValue(options.resyncKey), () => toValue(options.time)],
    ([lineKey, resyncKey, now]) => {
      const switched = lineKey !== lastLineKey
      const forced = resyncKey !== lastResyncKey
      const jumped = Math.abs(now - lastTimeMs) > SEEK_JUMP_MS
      lastLineKey = lineKey
      lastResyncKey = resyncKey
      lastTimeMs = now
      if (switched || forced || jumped || resyncRequested) {
        resyncRequested = false
        snapshot()
      }
    },
    { immediate: true }
  )

  const model = computed<TiltLineModel | null>(() => {
    const source = toValue(options.source)
    const segments = toValue(options.segments)
    const fontPx = toValue(options.fontPx)
    if (!source || !segments || segments.length === 0) return null
    if (!Number.isFinite(fontPx) || fontPx <= 0) return null
    return buildTiltLineModel({ source, segments, fontPx, clockMs: clockMs.value })
  })

  return {
    model,
    epoch,
    resync: (): void => {
      resyncRequested = true
    },
    /**
     * 立即重建快照（不等下一次时间更新）。
     *
     * 给「歌词区被卸载后又挂载」用：`TiltLine` 在「仅封面」模式下会被 `v-if` 卸载，
     * 回来后它的 CSS 动画从零重播，但快照里的延迟还是离开时那一刻算的 ——
     * 于是整行相位滞后「离开的时长」，已唱完的字会再浮现一遍。
     * 这里显式重取一次当前时间，把相位拉回正确位置。
     */
    resyncNow: (): void => {
      snapshot()
    }
  }
}
