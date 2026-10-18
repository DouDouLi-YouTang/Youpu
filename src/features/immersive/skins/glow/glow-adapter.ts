/**
 * 「流光」适配层 —— **本项目（毫秒）与 Folia 算法（秒）之间的唯一换算点**，
 * 同时负责把 store 的歌词形状映射成流光渲染层要的输入。
 *
 * 为什么单独一层（与 `tilt/tilt-adapter.ts` 同款做法）：
 *  - 纯算法层（`core/`）刻意是单位无关的 —— 它只做比例与区间运算，
 *    种子与被比较的时间都是"调用方给什么就用什么"；
 *  - Folia 的算法全是**秒**制（种子 `startTime`、lookahead 0.15、行宽阈值 0.10…），
 *    换算只发生在这一层，下游（组件 / 动画）只见到毫秒或已经算好的几何。
 *
 * 这样"换单位"永远只需要改这一个文件，不会在一堆公式里漏掉某一处 `/ 1000`。
 */

import type { LyricLine, LyricWord } from '@/domain/lyric'
import { resolveLineEndTimeMs } from '../shared/line-timing'
import { buildDisplayWords, type DisplayWord, type TimedWord } from './core/cjk-layout'
import type { AnimationIntensity } from './core/word-layout'

/**
 * 本项目的「流光」**固定档位**。
 *
 * 三个 Folia 系皮肤共享设置，但不套用经典排版滑杆，所以这里不是"用户可调默认值"
 * 而是"写死的值"：
 *  - `animationIntensity = 'normal'`：`calm` 会把散落布局整个收掉（所有行都居中、
 *    位移与旋转归零），丢掉这个面板最核心的特征；`chaotic` 的 baseSpread 60 /
 *    baseRotate 30 在窄窗口上会明显飞出屏幕。`normal` 是上游默认值。
 *  - 其余四项都取 Folia `DEFAULT_CLASSIC_TUNING` 的原值。
 */
export const GLOW_INTENSITY: AnimationIntensity = 'normal'
export const GLOW_ENABLE_WORD_ROTATION = true
export const GLOW_USE_LEGACY_LAYOUT = false
export const GLOW_WORD_SPACING = 0.7
export const GLOW_BREATHING_FLOAT_MULTIPLIER = 1

/**
 * 字重 —— **测量与渲染共用的唯一出处**。
 *
 * 逐词几何要用 canvas 量词宽（见 `glow-measure.ts`），而量宽时给 canvas 的字重必须与
 * 渲染时完全一致，否则量出的宽度与浏览器排出的宽度不是一回事，精确右边距会整体偏
 * （表现是词放大时互相压住，或间距大得离谱）。所以这里出一个常量，
 * `glow-word.scss` 的 `font-weight` 与测量调用都读它 —— 那边是 SCSS，无法 import TS，
 * 靠 `glow-adapter.test.ts` 锁住两边同值。
 *
 * Folia 的 700 是「主题字重」的兜底（`resolveThemeFontWeight(theme, 700)`）：
 * 本项目的 Folia 系皮肤不读设置面板，所以直接取兜底值。
 */
export const GLOW_FONT_WEIGHT = 700

/**
 * 主行字号倍率 —— **恒为 1**。
 *
 * 与「倾诉」的 `TILT_FONT_SCALE` 同理：流光的字号是它自己那套
 * `clamp(2.25rem, 6vw, 4.5rem)` 响应式档位，不读设置面板里的「歌词字体大小」。
 * 保留具名常量是为了让"这里本来可能有个用户倍率，但我们决定固定"留在代码里。
 */
export const GLOW_FONT_SCALE = 1

/** Folia 主行字号三锚点：`clamp(2.25rem, 6vw, 4.5rem)`（乘倍率后在适配层拼出来） */
export const GLOW_FONT_CLAMP_REM_MIN = 2.25
export const GLOW_FONT_CLAMP_VW = 6
export const GLOW_FONT_CLAMP_REM_MAX = 4.5

/** Folia 空态字号三锚点：`clamp(1.5rem, 3.5vw, 2.25rem)` */
export const GLOW_EMPTY_FONT_CLAMP_REM_MIN = 1.5
export const GLOW_EMPTY_FONT_CLAMP_VW = 3.5
export const GLOW_EMPTY_FONT_CLAMP_REM_MAX = 2.25

/** 读不到根字号时的兜底（浏览器默认 16px） */
const FALLBACK_REM_PX = 16

/** 整行容器宽度上限（Folia 的 `max-w-6xl` = 72rem） */
export const GLOW_LINE_MAX_WIDTH_REM = 72
/** 整行容器最小高度（Folia 的 `minHeight: '300px'`）—— 换行时高度不至于跳 */
export const GLOW_LINE_MIN_HEIGHT_PX = 300

/** 舞台高度（Folia 的 `h-[70vh]`） */
export const GLOW_STAGE_HEIGHT_VH = 70

/** 行跳转判定阈值（毫秒）：两次观测差值超过它即视为拖动进度 / 改偏移 */
export const SEEK_JUMP_MS = 1000

/**
 * 行结束时间无法推算时的兜底时长。
 *
 * 从共享层转发（**唯一出处**在 `shared/line-timing`）—— 三个皮肤各自写一份
 * 字面量时，"改了一处忘了另两处"不会有任何测试发现（三份都是 5000 就都通过）。
 */
export { FALLBACK_LINE_DURATION_MS } from '../shared/line-timing'

/**
 * 用 clamp 拼一个响应式字号字符串（三项**都**乘倍率）。
 *
 * 只乘中间一项是常见的移植错误：那样倍率在触到上下界时会失效
 * （大屏上不跟着放大、小窗口里压不下去）。Folia 用 `toFixed(3)`，这里保持一致。
 */
export function resolveClampFontSize(
  minRem: number,
  preferredVw: number,
  maxRem: number,
  scale = 1
): string {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  return (
    `clamp(${(minRem * safeScale).toFixed(3)}rem, ` +
    `${(preferredVw * safeScale).toFixed(3)}vw, ` +
    `${(maxRem * safeScale).toFixed(3)}rem)`
  )
}

/** 主行字号（倍率固定 1，但走同一个拼装函数，将来接设置不用改公式） */
export function resolveGlowFontSize(scale = GLOW_FONT_SCALE): string {
  return resolveClampFontSize(
    GLOW_FONT_CLAMP_REM_MIN,
    GLOW_FONT_CLAMP_VW,
    GLOW_FONT_CLAMP_REM_MAX,
    scale
  )
}

/** 空态字号 */
export function resolveGlowEmptyFontSize(scale = GLOW_FONT_SCALE): string {
  return resolveClampFontSize(
    GLOW_EMPTY_FONT_CLAMP_REM_MIN,
    GLOW_EMPTY_FONT_CLAMP_VW,
    GLOW_EMPTY_FONT_CLAMP_REM_MAX,
    scale
  )
}

/**
 * 主行字号在当前视口下的**像素值** —— 量词宽时必须知道它。
 *
 * Folia 用固定的 `rem = 16`（不是读出来的根字号）：它是从 `clamp()` 的三个锚点
 * 反推 `pxFontSize` 的，那三个锚点本身就是 rem/vw 写的，所以换算基准必须与
 * CSS 里 `1rem` 的定义一致 —— 而 Folia 假定它是 16。
 *
 * ⚠️ 本项目跟着**读真实根字号**：应用会把根字号设成非 16（缩放 / 高 DPI 下的
 * 字号设置都会），用 16 会让"量出来的宽度"与"浏览器排出来的宽度"系统性偏差，
 * 于是精确右边距全错 → 词在 active 放大时互相压住。
 *
 * 三个锚点的取法与 CSS `clamp(min, preferred, max)` 完全同构：
 * `max(min, min(preferred, max))`。
 */
export function resolvePixelFontSize(
  viewportWidthPx: number,
  remPx: number,
  scale = GLOW_FONT_SCALE
): number {
  const rem = Number.isFinite(remPx) && remPx > 0 ? remPx : FALLBACK_REM_PX
  const width = Number.isFinite(viewportWidthPx) && viewportWidthPx > 0 ? viewportWidthPx : 0
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1

  const minPx = GLOW_FONT_CLAMP_REM_MIN * safeScale * rem
  const preferredPx = (GLOW_FONT_CLAMP_VW * safeScale * width) / 100
  const maxPx = GLOW_FONT_CLAMP_REM_MAX * safeScale * rem
  return Math.max(minPx, Math.min(preferredPx, maxPx))
}

/**
 * 推算行结束时间（毫秒）。优先级与 `tilt-adapter.resolveLineEndMs` **完全一致**，
 * 刻意不另立一套口径：
 *  1. 有下一行 → 下一行起始（歌词时间戳天然就是上一行的结束）；
 *  2. 最后一行 → 播放时长（覆盖到曲末，避免末行拖太久）；
 *  3. 都不行 → 固定 5 秒。
 */
export function resolveLineEndMs(
  line: Pick<LyricLine, 'timeMs'> & Pick<LyricLine, 'endTimeMs'>,
  nextLine: Pick<LyricLine, 'timeMs'> | null | undefined,
  playerDurationMs: number
): number {
  // 实现与口径的唯一出处是共享层（真实行时长优先 → 下一行起始 → 播放时长 → 5 秒）。
  // 三个皮肤各写一份的后果是同一首歌在三个面板里的镜头节奏会漂，见那边的文件头。
  return resolveLineEndTimeMs(line, nextLine, playerDurationMs)
}

/**
 * `LyricWord[]` → 显示词。
 *
 * 无逐字数据（老歌只有行级 LRC）或数据不自洽（`words` 拼不出整行）时，
 * **退化成"整行一个词"**：起止时间用整行的 `[startMs, endMs]`。
 *
 * 为什么不是返回空数组：流光只渲染"当前行"，若整行一个词都没有，画面会整个空掉；
 * 而整行一个词虽然丢掉了逐词散落，至少能正常显示与高亮 —— 这是"降级但要能看"的取舍，
 * 与 `tilt-adapter.toWordSpans` 返回 null 的语义不同（那边有别的降级路径）。
 */
export function resolveDisplayWords(
  lineText: string,
  words: readonly LyricWord[] | undefined,
  startMs: number,
  endMs: number
): DisplayWord[] {
  const timedWords = toTimedWords(words, lineText)
  if (timedWords.length === 0) {
    if (!lineText) return []
    return [{ text: lineText, startTime: startMs, endTime: endMs }]
  }
  return buildDisplayWords(lineText, timedWords)
}

/**
 * `LyricWord[]` → `TimedWord[]`；不可用时返回空数组（由调用方决定怎么降级）。
 *
 * 两处单调化（对齐 `tilt-adapter.toWordSpans` 的做法，同样是为了上游偶见的乱序数据）：
 *  1. 起点不早于上一个词的起点；
 *  2. 时长为负 / 非有限时当 0。
 *
 * ⚠️ 与 tilt 的差别：那边"拼不出整行"要返回 null 让调用方分叉；
 * 这边拼不出整行时返回 `[]`，因为流光的降级是唯一的（整行一个词），
 * 不需要让调用方再分一次叉。
 */
export function toTimedWords(
  words: readonly LyricWord[] | undefined,
  lineText: string
): TimedWord[] {
  if (!words || words.length === 0) return []

  let joined = ''
  for (const word of words) joined += word.word
  if (joined !== lineText) return []

  const result: TimedWord[] = []
  let lastStart: number | null = null
  for (const word of words) {
    const rawStart = Number.isFinite(word.timeMs) ? word.timeMs : (lastStart ?? 0)
    const start: number = lastStart === null ? rawStart : Math.max(rawStart, lastStart)
    const duration = Number.isFinite(word.durationMs) && word.durationMs > 0 ? word.durationMs : 0
    result.push({ text: word.word, startTime: start, endTime: start + duration })
    lastStart = start
  }
  return result
}
