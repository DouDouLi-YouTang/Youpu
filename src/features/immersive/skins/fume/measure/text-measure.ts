/**
 * 「浮名」文本测量层里**唯一接触 DOM / pretext** 的一半（移植规格书 §4.1 / §4.7 / §4.8 / §4.10）。
 *
 * ## 为什么测量集中在这一个文件（§15.1 边界 2）
 *
 * 全文只有这里可以调 `prepareWithSegments` / `layoutWithLines` / `getContext('2d')`。
 * 于是「换测量后端」（比如将来换成 OffscreenCanvas 或预烘的字宽表）只需要改这里，
 * 而 §4 的全部换算逻辑（在 `text-measure-pure.ts`）保持可单测、可读。
 *
 * ## 无 DOM 时的行为（**不是**抛错）
 *
 * pretext 在 node 下会直接抛错（它需要 OffscreenCanvas 或 DOM canvas）。而本模块会被
 * `article-layout` 在浏览器里调用、被单测在 node 里 import（单测只调纯函数部分），所以：
 * - `measureSegmentGlyphOffsets` 在无 DOM 时返回**全 0 但长度正确**的数组（§4.7）；
 * - 字号二分 `buildPreparedSingleLine` 仍会走 pretext，**调用方负责 try/catch**
 *   （与「倾诉」的 `use-tilt-layout.ts` 同款策略：拿不到测量就让这一批退化成不缩放，
 *   面板照常显示，绝不白屏）。
 *
 * ## 字号是搜出来的，不是算出来的
 *
 * 二分区间 `[18,58]`（hero）/ `[10,30]`（body）只是**搜索区间**，不是结果钳制：
 * 命中结果还要乘 `lyricsFontScale × densityScale × heroScale`，所以最终字号可以超出区间
 * （§4.10 的关键点）。
 *
 * ## 单位
 *
 * 长度一律 CSS px、字号 px。本层不涉及时间。
 */

import {
  layoutWithLines,
  prepareWithSegments,
  type LayoutLinesResult,
  type PrepareOptions,
  type PreparedTextWithSegments
} from '@chenglou/pretext'
import { rememberBounded } from '../../shared/bounded-cache'
import { splitGraphemes } from '../core/fume-math'
import type { FumeBlockVariant } from '../core/fume-types'

/** pretext 的预制参数（§4.1）：`pre-wrap` 保留空白，歌词里的空格才不会被吃掉 */
const FUME_PRETEXT_OPTIONS = { whiteSpace: 'pre-wrap' } satisfies PrepareOptions

/** hero / body 的默认字重（§4.8）：主题没给 `fontWeight` 时用这两个 */
export const FUME_HERO_FONT_WEIGHT = 780
export const FUME_BODY_FONT_WEIGHT = 640

/** 字号二分区间（§4.10）：hero 18..58、body 10..30，各迭代 8 次 */
export const FUME_HERO_FONT_PX_RANGE = { low: 18, high: 58 } as const
export const FUME_BODY_FONT_PX_RANGE = { low: 10, high: 30 } as const
const FONT_PX_BISECTION_ITERATIONS = 8

/** 行高系数（§4.10 / §7.5）：hero 1.02、body 1.06；行高**取整**（§17.3 第 4 条） */
export const FUME_HERO_LINE_HEIGHT_RATIO = 1.02
export const FUME_BODY_LINE_HEIGHT_RATIO = 1.06

/** 片段逐字素测量缓存上限（§4.7）：远大于一首歌的片段数，防止长会话无限增长 */
export const SEGMENT_MEASURE_CACHE_LIMIT = 2048

/** 主题里影响字体串的字段（§4.8）：只要这一个，避免把整个主题拖进来 */
export interface FumeFontThemeInput {
  fontWeight?: number
}

/** 一次字号二分的产物（§4.10）：字号 + pretext 的两个对象 */
export interface FumePreparedSingleLine {
  fontPx: number
  prepared: PreparedTextWithSegments
  layout: LayoutLinesResult
}

/**
 * 字重归一化（上游 `normalizeFontWeight`）：100..900、10 的倍数。
 *
 * 非数字 / `NaN` / `Infinity` 一律返回 `null`，交给调用方用档位默认值 ——
 * 主题数据来自用户输入，直接信它会让 canvas 拿到 `780.5px` 这类非法字体串，
 * 而 canvas 对非法 `font` 是**静默忽略**（保持上一个字体），量出来的宽度就串味了。
 */
export function normalizeFontWeight(fontWeight: unknown): number | null {
  if (typeof fontWeight !== 'number' || !Number.isFinite(fontWeight)) return null
  const clamped = Math.min(900, Math.max(100, fontWeight))
  return Math.round(clamped / 10) * 10
}

/** 主题字重 → 实际字重；没给就用档位默认（hero 780 / body 640） */
export function resolveThemeFontWeight(
  theme: FumeFontThemeInput | null | undefined,
  fallback: number
): number {
  return normalizeFontWeight(theme?.fontWeight) ?? fallback
}

/**
 * canvas 用的字体串（§4.8）。
 *
 * 格式是 canvas `font` 属性的简写语法：`<weight> <size>px <family>`。顺序与空格都被
 * canvas 严格要求；`fontFamily` 里若含空格必须已带引号（由调用方保证 ——
 * 它的来源是 CSS 字体栈，本来就是合法 CSS）。
 */
export function buildFontSpec(
  fontPx: number,
  variant: FumeBlockVariant,
  fontFamily: string,
  theme: FumeFontThemeInput | null | undefined
): string {
  const fontWeight = resolveThemeFontWeight(
    theme,
    variant === 'hero' ? FUME_HERO_FONT_WEIGHT : FUME_BODY_FONT_WEIGHT
  )
  return `${fontWeight} ${fontPx}px ${fontFamily}`
}

/** 模块级复用的测量 canvas：逐片段新建会反复分配后备缓冲，播放期间变成 GC 抖动 */
let segmentMeasureCanvas: HTMLCanvasElement | null = null

const segmentMeasureCache = new Map<string, number[]>()

/**
 * 逐字素量出**实际绘制宽度**的前缀偏移（§4.7）。
 *
 * 为什么要单独量一遍：pretext 的宽度是**换行拟合宽度**，而 `fillText` 的裁剪
 * 需要**实际绘制宽度**。两者在有 emoji / 字体回退时并不相等（§4.6 的说明），
 * 所以每个片段用 canvas 逐前缀量一次真实宽度。
 *
 * 两条退化路径都返回「长度正确、内容全 0」的数组而不是抛错：全 0 会让该片段的裁剪
 * 退化成「一次画完」（等价于不做逐字素裁剪），比整行不显示轻得多。
 * 返回长度恒为「字素数 + 1」，末尾是整段宽度。
 */
export function measureSegmentGlyphOffsets(text: string, fontSpec: string): number[] {
  const cacheKey = `${fontSpec}__${text}`
  const cached = segmentMeasureCache.get(cacheKey)
  if (cached) return cached

  const graphemes = splitGraphemes(text)
  const offsets = new Array<number>(graphemes.length + 1).fill(0)

  if (typeof document === 'undefined') return offsets

  if (!segmentMeasureCanvas) {
    segmentMeasureCanvas = document.createElement('canvas')
  }
  const context = segmentMeasureCanvas.getContext('2d')
  if (!context) return offsets

  // 每次都设字体：别的测量（背景、流光）可能改过同一个 context 的 font
  context.font = fontSpec

  // 逐前缀整串测量，而不是「逐字素量宽再累加」：跨字素的 kerning / 连字 / shaping
  // 只有在整串测量时才正确。
  let prefix = ''
  for (let count = 1; count <= graphemes.length; count += 1) {
    prefix += graphemes[count - 1]
    offsets[count] = context.measureText(prefix).width
  }

  return rememberBounded(segmentMeasureCache, cacheKey, offsets, SEGMENT_MEASURE_CACHE_LIMIT)
}

/**
 * 清空片段测量缓存。
 *
 * 字体文件加载完成后**必须**调：字体栈字符串一个字都没变（只是同一个栈从兜底字形
 * 换成了真字形），缓存键不会失效，于是所有片段会一直用兜底字量出的宽度。
 * 这条与「倾诉」`use-tilt-layout.ts` 里 `clearCache()` 的取舍同源。
 */
export function clearSegmentMeasureCache(): void {
  segmentMeasureCache.clear()
}

/** 一行文本在某个字号下的 `prepared` + `layout`（§4.10 二分循环体里的一步） */
function prepareSingleLineAt(
  text: string,
  fontFamily: string,
  width: number,
  variant: FumeBlockVariant,
  candidateFontPx: number,
  theme: FumeFontThemeInput | null | undefined
): FumePreparedSingleLine {
  const fontSpec = buildFontSpec(candidateFontPx, variant, fontFamily, theme)
  const prepared = prepareWithSegments(text, fontSpec, FUME_PRETEXT_OPTIONS)
  const lineHeight = Math.round(
    candidateFontPx *
      (variant === 'hero' ? FUME_HERO_LINE_HEIGHT_RATIO : FUME_BODY_LINE_HEIGHT_RATIO)
  )

  return {
    fontPx: candidateFontPx,
    prepared,
    layout: layoutWithLines(prepared, width, lineHeight)
  }
}

/**
 * 字号二分（§4.10）：找出「这一行还塞得进区块宽度、保持单行」的字号。
 *
 * 判据是「能不能排成一行」：8 次二分，能排成单行就记下来并继续放大，否则缩小。
 * 8 次都排不成单行（长行 / 窄块）→ 用**最小字号**兜底再排一次，此时结果允许多行
 * （`layout.lineCount > 1`），后续 §7.6 会按视觉行切片。
 *
 * ⚠️ 本函数会调 pretext，在无 canvas 的环境里会抛错。调用方（布局调度 / 测试）
 * 负责 try/catch 并把失败降级成「这一批先不排」。
 */
export function buildPreparedSingleLine(
  text: string,
  fontFamily: string,
  width: number,
  variant: FumeBlockVariant,
  lyricsFontScale: number,
  densityScale: number,
  heroScale: number,
  theme: FumeFontThemeInput | null | undefined
): FumePreparedSingleLine {
  const range = variant === 'hero' ? FUME_HERO_FONT_PX_RANGE : FUME_BODY_FONT_PX_RANGE
  const variantScale = variant === 'hero' ? heroScale : 1

  let low = range.low
  let high = range.high
  let best: FumePreparedSingleLine | null = null

  for (let iteration = 0; iteration < FONT_PX_BISECTION_ITERATIONS; iteration += 1) {
    const candidateFontPx = ((low + high) / 2) * lyricsFontScale * densityScale * variantScale
    const candidate = prepareSingleLineAt(text, fontFamily, width, variant, candidateFontPx, theme)

    if (candidate.layout.lineCount <= 1) {
      best = candidate
      low = (low + high) / 2
    } else {
      high = (low + high) / 2
    }
  }

  if (best) return best

  const fallbackFontPx = range.low * lyricsFontScale * densityScale * variantScale
  return prepareSingleLineAt(text, fontFamily, width, variant, fallbackFontPx, theme)
}
