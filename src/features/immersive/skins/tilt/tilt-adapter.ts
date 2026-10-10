/**
 * 「倾诉」适配层 —— **本项目（毫秒）与移植笔记（秒）之间唯一的换算点**。
 *
 * 为什么单独一层：core/ 下的纯算法是**单位无关**的（它只做比例运算），
 * 移植笔记 §5–§7 的阈值却都写成秒（0.25 / 0.04 / 0.05 / 0.2 / 0.9 / 1.2）。
 * 本文件把这些秒值一次性乘成毫秒常量，下游（布局 / 时序 / 渲染）只见到毫秒，
 * 不再出现任何 `* 1000` —— 换单位只需要改这一个文件。
 *
 * 同时承担另两件事：
 *  1. 数据形状适配：`LyricLine`(词级毫秒时间戳) → core 需要的 `TimedSpan`
 *  2. 排版数值解析：clamp 字号、用户字号倍率、可用宽度、溢出缩放（纯函数，可单测）
 */
import type { LyricLine, LyricWord } from '@/domain/lyric'
import { AFTERGLOW_FLOOR, clampPulseDuration } from './core/char-pulse'
import type { TimedSpan } from './core/char-timing'
import { SHORT_LAST_SEGMENT_SCALE } from './core/tilt-pick'

/** 秒 → 毫秒。全项目唯一的一处 `* 1000`。 */
const SECOND_MS = 1000

/**
 * 逐字脉冲上下界（笔记 §6：`clamp(endTime - startTime, 0.2, 0.9)`，单位秒）。
 * 交给 core 的 `clampPulseDuration` 时要的是**毫秒**，故在此换算好。
 */
export const PULSE_MIN_DURATION_MS = 0.2 * SECOND_MS
export const PULSE_MAX_DURATION_MS = 0.9 * SECOND_MS

/** 段落提前可见量（笔记 §7：`segment.start - 0.25`，让字先出来等声音） */
export const SEGMENT_LEAD_MS = 0.25 * SECOND_MS

/** 段内逐字淡入延迟（笔记 §7：非空格字序号 × 0.04 秒，倾斜段 0.05 秒） */
export const CHAR_FADE_DELAY_MS = 0.04 * SECOND_MS
export const TILT_CHAR_FADE_DELAY_MS = 0.05 * SECOND_MS

/** 逐字淡入动画时长。笔记未给值，取 0.4 秒（与 LyricLines 逐字过渡的手感一致）。 */
export const CHAR_FADE_DURATION_MS = 0.4 * SECOND_MS

/** 末行结束时间兜底的固定时长（笔记 §8.1.1：可用 player.durationMs，或固定值如 5 秒） */
export const FALLBACK_LINE_DURATION_MS = 5 * SECOND_MS

/**
 * seek 判定阈值：`ctx.currentTime()` 两次观测的差值超过它，就当作拖动进度条 /
 * 改偏移，重建逐字快照（对齐 LyricLines 内部 800ms 的 seek 检测思路）。
 *
 * 取值依据：本项目时间源是 `timeupdate` 节流后的快照（约 4Hz，见 useAudioElement 的
 * THROTTLE_MS = 250），正常播放每次观测间隔约 250ms；播放速率被钳在 [0.5, 1.5]
 * （player.store.setPlaybackRate），最快也就约 375ms。留 2.6 倍余量取 1000ms，
 * 既不会把正常播放误判成 seek，又能抓住跨行的跳转。
 */
export const SEEK_JUMP_MS = 1000

/**
 * 余晖升起时长系数（笔记 §6：`ramp = duration * 1.2`）。
 * core/char-pulse.ts 里的同名系数未导出，这里镜像一份供渲染层算动画时长；
 * 与 core 的一致性由 tilt-adapter.test.ts 断言（`getCharPulseIntensity(2.2) === AFTERGLOW_FLOOR`）。
 */
export const AFTERGLOW_RAMP_FACTOR = 1.2

/** 逐字脉冲动画的总时长系数 = 钟形(1) + 余晖升起(1.2)，见 core/char-pulse.ts */
export const PULSE_TOTAL_FACTOR = 1 + AFTERGLOW_RAMP_FACTOR

/** 脉冲峰值放大系数（笔记 §6：倾斜段 0.18 / 非倾斜 0.15，与 core.getCharPulseScale 一致） */
export const TILT_PULSE_SCALE = 0.18
export const PLAIN_PULSE_SCALE = 0.15

/** 余晖地板（转发 core 的常量，渲染层的 keyframes 末帧与它一致） */
export { AFTERGLOW_FLOOR }

/** §4 字号响应式锚点：`clamp(3.125rem, 6.875vw, 5.625rem)` */
export const FONT_CLAMP_REM_MIN = 3.125
export const FONT_CLAMP_VW = 6.875
export const FONT_CLAMP_REM_MAX = 5.625

/** 用户字号设置（16–64，默认 32）→ 倍率的基准：默认值即 1 倍 */
export const FONT_SCALE_BASE_PX = 32

/** 读不到根字号时的兜底（浏览器默认 16px） */
export const FALLBACK_REM_PX = 16

/** §3 可用宽度：`window.innerWidth * 0.85` */
export const AVAILABLE_WIDTH_RATIO = 0.85

/** §3 溢出比 ≥ 1.6 → 重新切分成更多段（而不是缩放） */
export const OVERFLOW_RESPLIT_RATIO = 1.6

/** §3 重切时最多比原段数多出的段数 */
export const EXTRA_SEGMENTS_ON_RESPLIT = 4

/** §3 等比缩放下限：倾斜段 0.5 / 非倾斜段 0.55 */
export const TILT_SCALE_FLOOR = 0.5
export const PLAIN_SCALE_FLOOR = 0.55

/** §4 倾斜段上下交错位移量 = 字号 px / 6 */
export const TILT_WAVE_DIVISOR = 6

/**
 * 段间距：`clamp(6px, 1.4vh, 20px)`，与 tilt-line.scss 的 `.tilt-line { gap }` 同源。
 *
 * 之所以要在 JS 里复刻：纵向「放不放得下」的判定必须把 (段数−1) 个间距算进去，
 * 否则算出的缩放会偏大一点点，几段叠起来正好把末段切掉。改这里就要同步改那边。
 */
export const SEGMENT_GAP_MIN_PX = 6
export const SEGMENT_GAP_VH = 1.4
export const SEGMENT_GAP_MAX_PX = 20

/** 段间距解析（视口高度 → px）。非法输入取下界，绝不返回 NaN */
export function resolveSegmentGapPx(viewportHeightPx: number): number {
  const scaled =
    (SEGMENT_GAP_VH / 100) * (Number.isFinite(viewportHeightPx) ? Math.max(viewportHeightPx, 0) : 0)
  return Math.min(Math.max(scaled, SEGMENT_GAP_MIN_PX), SEGMENT_GAP_MAX_PX)
}

/** §4 字重（固定值，不跟用户 lyricFontWeight —— 细字重是「倾诉」的排版气质） */
export const FONT_WEIGHT_PLAIN = 400
export const FONT_WEIGHT_TILT = 300

/** §4 字间距（em） */
export const LETTER_SPACING_EM_PLAIN = 0.08
export const LETTER_SPACING_EM_TILT = 0.15

/** §4 行高 */
export const LINE_HEIGHT_PLAIN = 1.35
export const LINE_HEIGHT_TILT = 1.25

/** 供渲染层复用的「末段过短」放大系数（core 已定义，转发避免两处写 1.18） */
export { SHORT_LAST_SEGMENT_SCALE }

/** 当前行的渲染输入（由 LyricLine 适配而来；毫秒） */
export interface TiltLineSource {
  text: string
  /** 行起始（毫秒） */
  timeMs: number
  /** 行结束（毫秒）。LyricLine 没有该字段，由 resolveLineEndMs 推算 */
  endMs: number
  words?: LyricWord[]
}

/**
 * 推算行结束时间（笔记 §8.1.1）。优先级：
 *  1. 有下一行 → 下一行的起始（歌词行的时间戳天然就是上一行的结束）
 *  2. 最后一行 → `player.durationMs`（能覆盖到曲末，避免末行拖太久）
 *  3. 都不行（时长未知 / 时间戳乱序）→ 固定 5 秒
 *
 * 该值同时用于「无 words 时整行时长的均匀分配」与段显示窗口的结束。
 */
export function resolveLineEndMs(
  line: Pick<LyricLine, 'timeMs'>,
  nextLine: Pick<LyricLine, 'timeMs'> | null | undefined,
  playerDurationMs: number
): number {
  const start = line.timeMs
  if (nextLine && Number.isFinite(nextLine.timeMs) && nextLine.timeMs > start) {
    return nextLine.timeMs
  }
  if (Number.isFinite(playerDurationMs) && playerDurationMs > start) {
    return playerDurationMs
  }
  return start + FALLBACK_LINE_DURATION_MS
}

/**
 * `LyricWord[]` → core 的 `TimedSpan[]`（词级时间戳路径）。
 *
 * 返回 null 表示**不能用词级时间戳**，调用方应退化为整行均匀分配：
 *  - 没有 words（老歌只有行级 LRC，见笔记 §8.1）
 *  - `words.map(w => w.word).join('') !== lineText`（数据不自洽，硬用会让字素与段对不上号）
 *
 * 时间戳做单调化处理：起点不早于上一个词的起点（上游偶见的乱序数据不至于让动画倒退）。
 */
export function toWordSpans(
  words: readonly LyricWord[] | undefined,
  lineText: string
): TimedSpan[] | null {
  if (!words || words.length === 0) return null
  let joined = ''
  for (const word of words) joined += word.word
  if (joined !== lineText) return null

  const spans: TimedSpan[] = []
  let lastStart: number | null = null
  for (const word of words) {
    const rawStart = Number.isFinite(word.timeMs) ? word.timeMs : (lastStart ?? 0)
    const start: number = lastStart === null ? rawStart : Math.max(rawStart, lastStart)
    const rawDuration =
      Number.isFinite(word.durationMs) && word.durationMs > 0 ? word.durationMs : 0
    const end = start + rawDuration
    spans.push({ text: word.word, startTime: start, endTime: end })
    lastStart = start
  }
  return spans
}

/** 保留两位小数：时间值最终会写成 CSS 变量，抹掉浮点尾巴（如 440.00000000000006ms） */
export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 取单个字素的脉冲动画时长（毫秒，含余晖升起段） */
export function resolvePulseAnimationMs(startTime: number, endTime: number): number {
  return round2(
    clampPulseDuration(endTime - startTime, PULSE_MIN_DURATION_MS, PULSE_MAX_DURATION_MS) *
      PULSE_TOTAL_FACTOR
  )
}

/**
 * 解析 clamp 字号（笔记 §4）：`clamp(3.125rem, 6.875vw, 5.625rem)`。
 *
 * rem 与视口宽度都从外部传入（读 DOM 的事交给调用方），因此本函数可单测。
 * 输入不合法时退回下界，绝不返回 NaN —— 字号一旦是 NaN，整个面板会整片消失。
 */
export function resolveBaseFontPx(viewportWidthPx: number, remPx: number): number {
  const safeRem = Number.isFinite(remPx) && remPx > 0 ? remPx : FALLBACK_REM_PX
  const min = FONT_CLAMP_REM_MIN * safeRem
  const max = FONT_CLAMP_REM_MAX * safeRem
  const preferred = Number.isFinite(viewportWidthPx)
    ? (FONT_CLAMP_VW / 100) * Math.max(viewportWidthPx, 0)
    : 0
  return Math.min(Math.max(preferred, min), max)
}

/** 用户字号设置 → 倍率（默认 32px 即 1 倍；非法值不放大） */
export function resolveFontScale(lyricFontSizePx: number): number {
  if (!Number.isFinite(lyricFontSizePx) || lyricFontSizePx <= 0) return 1
  return lyricFontSizePx / FONT_SCALE_BASE_PX
}

/**
 * 可用宽度（笔记 §3）：以 `window.innerWidth * 0.85` 为预算。
 *
 * 面板宽度（clientWidth）只用来**收紧**这个预算。本面板是全屏歌词（没有封面列），
 * `.tilt-stage-inner` 的 `max-width: 85vw` 与这里的 0.85 同源，所以在常见窗口下
 * `min()` 取到的恒是 0.85vw，与笔记完全一致；只有极窄窗口（左右内边距触到 px 下限）
 * 才会由面板收紧，那时收紧到的是**真实可渲染宽度**，方向正确。
 */
export function resolveAvailableWidth(viewportWidthPx: number, panelWidthPx: number): number {
  const panel = Number.isFinite(panelWidthPx) && panelWidthPx > 0 ? panelWidthPx : 0
  const viewport = Number.isFinite(viewportWidthPx) && viewportWidthPx > 0 ? viewportWidthPx : 0
  if (viewport === 0) return panel
  const budget = viewport * AVAILABLE_WIDTH_RATIO
  return panel > 0 ? Math.min(budget, panel) : budget
}

/** §3 是否需要重切（溢出比 ≥ 1.6） */
export function shouldResplit(overflowRatio: number): boolean {
  return Number.isFinite(overflowRatio) && overflowRatio >= OVERFLOW_RESPLIT_RATIO
}

/**
 * §3 溢出缩放倍率：不溢出 → 1（绝不放大）；溢出 → 1/溢出比，但不低于字型下限
 * （倾斜段 0.5 / 非倾斜 0.55，见 TILT_SCALE_FLOOR / PLAIN_SCALE_FLOOR）。
 */
export function resolveOverflowScale(overflowRatio: number, hasTiltSegment: boolean): number {
  if (!Number.isFinite(overflowRatio) || overflowRatio <= 1) return 1
  const floor = hasTiltSegment ? TILT_SCALE_FLOOR : PLAIN_SCALE_FLOOR
  return Math.max(1 / overflowRatio, floor)
}

/**
 * 各段**文字**高度之和（px，不含段间距）。
 *
 * 每段渲染成一行（`white-space: nowrap`，见 tilt-line.scss），所以高度 = Σ 行高 × 段字号。
 * 倾斜段行高 1.25、其余 1.35（笔记 §4），末段命中「过短补偿」时字号还要 × 1.18。
 *
 * `fontPx` 是**未含纵向缩放**的字号：本函数回答「以这个字号排要多高」，
 * 缩放多少由 resolveHeightScale 决定。
 */
export function resolveTextHeightPx(params: {
  segmentCount: number
  fontPx: number
  /** 末段是否命中「过短补偿」（字号 × 1.18） */
  shortLast: boolean
  /** 倾斜段下标（null 表示没有倾斜段） */
  tiltIndex: number | null
}): number {
  const { segmentCount, fontPx, shortLast, tiltIndex } = params
  if (!Number.isFinite(fontPx) || fontPx <= 0 || segmentCount <= 0) return 0

  let total = 0
  for (let index = 0; index < segmentCount; index++) {
    const isTilt = index === tiltIndex
    const isShortLast = shortLast && index === segmentCount - 1
    const px = isShortLast ? fontPx * SHORT_LAST_SEGMENT_SCALE : fontPx
    total += px * (isTilt ? LINE_HEIGHT_TILT : LINE_HEIGHT_PLAIN)
  }
  return total
}

/** 段间距总和（px）。`segmentCount` 段之间共 (段数−1) 个间距 */
export function resolveSegmentGapTotalPx(segmentCount: number, viewportHeightPx: number): number {
  if (!Number.isFinite(segmentCount) || segmentCount <= 1) return 0
  return (segmentCount - 1) * resolveSegmentGapPx(viewportHeightPx)
}

/**
 * 纵向溢出缩放倍率：放得下 → 1（绝不放大）；放不下 → 按比例缩小，但不低于 `floor`。
 *
 * 与 resolveOverflowScale 同构，差别在于**只有文字高度能缩**：段间距是固定 px
 * （`clamp(6px, 1.4vh, 20px)`，跟字号无关），所以要从可用高度里先扣掉它，
 * 剩下的才是文字能占的份额。写成「(总高 / 可用高) 取倒数」就错了 ——
 * 段数一多间距占比上来，会把缩放算得偏大，末段仍然被切。
 */
export function resolveHeightScale(
  textHeightPx: number,
  gapTotalPx: number,
  availableHeightPx: number,
  floor: number
): number {
  const safeFloor = Number.isFinite(floor) && floor > 0 && floor <= 1 ? floor : 1
  if (
    !Number.isFinite(textHeightPx) ||
    !Number.isFinite(gapTotalPx) ||
    !Number.isFinite(availableHeightPx) ||
    textHeightPx <= 0 ||
    availableHeightPx <= 0
  ) {
    return 1
  }
  const gaps = Math.max(gapTotalPx, 0)
  if (textHeightPx + gaps <= availableHeightPx) return 1
  const roomForText = availableHeightPx - gaps
  if (roomForText <= 0) return safeFloor
  return Math.min(Math.max(roomForText / textHeightPx, safeFloor), 1)
}
