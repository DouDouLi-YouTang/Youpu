/**
 * 「浮名」文本测量层里**唯一接触 DOM / pretext** 的一半（移植规格书 §4.1 / §4.7 / §4.8 / §4.10）。
 *
 * ## 为什么测量集中在这一个文件（§15.1 边界 2）
 *
 * 全文只有这里可以调 `prepareWithSegments` / `layoutWithLines` / `getContext('2d')`。
 * 于是「换测量后端」（比如将来换成 OffscreenCanvas 或预烘的字宽表）只需要改这里，
 * 而 §4 的**纯换算**逻辑（住在 `core/text-measure-pure.ts`，因为 §7.6 的建块也要用它）
 * 保持可单测、可读 —— 依赖方向是 measure → core（§15.1 的边界只禁反向）。
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
 * ## 二分里的候选判定：先问宽度模型，问不出来才真测量（性能修复，2026-10-17）
 *
 * 一次顶层搜索要跑 32 次完整排版 × 29 行 × 每个候选字号，也就是**上千次**「这行在
 * 这个字号下还排得成一行吗」。每次真测量都要 `prepare()`（内部逐片段 `measureText`，
 * 缓存键含字号），实测占了整次排版的 81%（21776 次 `measureText` / 1662ms）。
 *
 * 这些测量里绝大多数是**冗余**的：宽度随字号线性缩放（实测偏差 0.000244px），所以
 * `line-width-model.ts` 在参考字号下量一次，之后对每个候选只做一次乘法就能判定。
 * 模型只在**离阈值足够远**（> 0.5px 余量）时下结论，否则返回 `unsure` 由这里的
 * {@link measureSingleLineAt} 走真实 `prepare() + layout()` 复核 —— 于是「省下的测量」
 * 是纯收益，判定结论与逐候选真测量**逐字相同**。
 *
 * 唯一必须走精确路径的例外是**兜底那一档**（所有候选都排不成单行时用的最小字号）：
 * 它的 `lineCount` 会参与块高计算，不能是「2」这种占位值。见
 * {@link searchSingleLineCandidate} 的 `requireExact`。
 *
 * ## 单位
 *
 * 长度一律 CSS px、字号 px。本层不涉及时间。
 */

import {
  layout,
  layoutWithLines,
  prepare,
  prepareWithSegments,
  type LayoutLinesResult,
  type PreparedText,
  type PreparedTextWithSegments
} from '@chenglou/pretext'
import { rememberBounded } from '../../shared/bounded-cache'
import { FOLIA_SERIF_FAMILY } from '../../shared/folia-font'
import {
  FUME_BODY_LINE_HEIGHT_RATIO,
  FUME_HERO_LINE_HEIGHT_RATIO,
  resolveLineHeight
} from '../core/article-blocks'
import { splitGraphemes } from '../core/fume-math'
import type { FumeBlockVariant } from '../core/fume-types'
import type { FumeLayoutThemeKey } from '../core/layout-key'
import {
  FUME_WIDTH_MODEL_REFERENCE_FONT_PX,
  clearLineWidthModelCache,
  resolveLineWidthFit,
  resolveLineWidthModel,
  type FumeLineWidthFit
} from './line-width-model'
import { FUME_PRETEXT_OPTIONS } from './pretext-options'

/** hero / body 的默认字重（§4.8）：主题没给 `fontWeight` 时用这两个 */
export const FUME_HERO_FONT_WEIGHT = 780
export const FUME_BODY_FONT_WEIGHT = 640

/** 字号二分区间（§4.10）：hero 18..58、body 10..30，各迭代 8 次 */
export const FUME_HERO_FONT_PX_RANGE = { low: 18, high: 58 } as const
export const FUME_BODY_FONT_PX_RANGE = { low: 10, high: 30 } as const
const FONT_PX_BISECTION_ITERATIONS = 8

/**
 * 行高系数（§4.10 / §7.5）：hero 1.02、body 1.06；行高**取整**（§17.3 第 4 条）。
 *
 * ⚠️ 这两个值的**真源在 `core/article-blocks.ts`**（那里还负责块间距与装箱），
 * 这里只是转出给既有调用点用。字号二分与 §7.5 的块高必须用同一个系数，
 * 两处各写一份的话「二分出来的行高」与「装箱用的行高」会在小数点后分叉。
 */
export { FUME_BODY_LINE_HEIGHT_RATIO, FUME_HERO_LINE_HEIGHT_RATIO }

/** 片段逐字素测量缓存上限（§4.7）：远大于一首歌的片段数，防止长会话无限增长 */
export const SEGMENT_MEASURE_CACHE_LIMIT = 2048

/**
 * `pretext` 预制结果缓存上限。
 *
 * 浮名的顶层搜索会反复排同一批歌词：4 列 × 8 次密度二分 = 32 次完整文章。
 * 每次的「文本 + 字体串」组合高度重复，而 `prepareWithSegments` 的分段与逐段
 * 测量恰好是这条链路里最贵的同步工作。缓存的是**完整 prepared 对象**（不是宽度
 * 摘要），后续 `layoutWithLines` 仍按各自的宽度和行高重新计算，因此结果不变。
 *
 * 4096 足够覆盖一首长歌在 4 列搜索中的所有候选（几百行 × 每行最多 9 个字号），
 * 又给长会话设了明确上界；淘汰规则沿用共享的 `rememberBounded`。
 */
export const PREPARED_TEXT_CACHE_LIMIT = 4096

/** 主题里影响字体串的字段（§4.8）：只要这一个，避免把整个主题拖进来 */
export interface FumeFontThemeInput {
  fontWeight?: number
}

/** 各字体风格档在 canvas 里用的兜底族（本项目只随包分发衬线字体，见下） */
const GENERIC_FALLBACK_BY_STYLE: Record<FumeLayoutThemeKey['fontStyle'], string> = {
  sans: 'system-ui, sans-serif',
  serif: 'serif',
  mono: 'ui-monospace, monospace'
}

/**
 * 主题 → canvas 用的字体栈（§7.7 的 `resolveThemeFontStack` 位置）。
 *
 * 上游会拼「自定义族 + 内置档位栈」两大段；本项目**只有一个随包分发的族**
 * （`FOLIA_SERIF_FAMILY`，见 `shared/folia-font.ts` 与 `assets/fonts/fonts.scss`），
 * 所以顺序是「主题自定义族 → 内置衬线族 → 该档位的通用兜底族」。
 *
 * 为什么不照抄上游那三条几十个族的长栈：那些族在本机大概率不存在，写进去只会让
 * canvas 与 CSS 的**实际**选字结果难以预测；而本项目已经把需要的字形随包带上了，
 * 少写几个不存在的候选反而让测量与渲染更容易对齐。主题若给了自定义族则排在最前，
 * 与上游「自定义优先」的语义一致。
 *
 * 返回的是**合法 CSS 字体栈**（可直接进 canvas `font` 简写），所以带空格的族名
 * 必须加引号 —— `Folia Noto Serif SC` 不加引号会被解析成三个族名。
 */
export function resolveFumeFontFamily(theme: FumeLayoutThemeKey): string {
  const customFamilies = [theme.fontFamily, ...(theme.fontFamilyStack ?? [])]
    .map((family) => family?.trim())
    .filter((family): family is string => Boolean(family))
    .map((family) => (family.includes(' ') ? `"${family}"` : family))

  const builtin = `"${FOLIA_SERIF_FAMILY}"`
  const fallback = GENERIC_FALLBACK_BY_STYLE[theme.fontStyle] ?? GENERIC_FALLBACK_BY_STYLE.serif

  // 自定义族里去重（主题栈有时会重复同一个族），但保留书写顺序 —— 顺序就是优先级
  const ordered = [...new Set(customFamilies)]
  return [...ordered, builtin, fallback].join(', ')
}

/** 一次字号二分的产物（§4.10）：字号 + pretext 的两个对象 */
export interface FumePreparedSingleLine {
  fontPx: number
  prepared: PreparedTextWithSegments
  layout: LayoutLinesResult
}

/** 顶层搜索只需要知道字号与行数；不要为每个候选物化整行文本 */
export interface FumeMeasuredSingleLine {
  fontPx: number
  lineCount: number
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
 * 两条路径的预制缓存为什么不共用一条：
 *
 * - 渲染路径要 `prepareWithSegments()`（多一份 `segments` 数组，`buildRenderLines`
 *   靠它把光标换算回字素下标）；
 * - 测量路径只要宽度与行数，`prepare()` 不做那份数组、也不算 bidi 层级
 *   （`computeSegmentLevels`）。
 *
 * 两者的产物形状不同，混在一条缓存里要么让测量路径拿到多余的 `segments`，
 * 要么让渲染路径少字段。键都是「完整字体串 + 文本」，所以两条缓存之间也不会串味。
 */
const preparedTextCache = new Map<string, PreparedTextWithSegments>()
const preparedMeasureTextCache = new Map<string, PreparedText>()

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
 * 清空文本测量缓存。
 *
 * 字体文件加载完成后**必须**调：字体栈字符串一个字都没变（只是同一个栈从兜底字形
 * 换成了真字形），缓存键不会失效，于是所有片段会一直用兜底字量出的宽度。
 * prepared 缓存同理 —— 它保存的也是按字体串测出来的分段宽度。这条与「倾诉」
 * `use-tilt-layout.ts` 里 `clearCache()` 的取舍同源。
 */
export function clearSegmentMeasureCache(): void {
  segmentMeasureCache.clear()
  preparedTextCache.clear()
  preparedMeasureTextCache.clear()
  // 宽度模型存的是「参考字号下量出来的宽度」，字体文件到位后同样过期
  clearLineWidthModelCache()
}

/**
 * 取 `(文本, 字体串)` 对应的 prepared；未命中时才调用 pretext。
 *
 * 键里必须同时有文本与完整字体串：只按文本缓存会让 hero / body 的字重互相串用；
 * 只按字体串缓存则会把同一字体的不同歌词混在一起。两者都用 `\0` 分隔，避免
 * 歌词里的任意字符把两个不同组合拼成同一个键。
 */
function resolvePreparedText(text: string, fontSpec: string): PreparedTextWithSegments {
  const cacheKey = `${fontSpec}\0${text}`
  const cached = preparedTextCache.get(cacheKey)
  if (cached) return cached

  const prepared = prepareWithSegments(text, fontSpec, FUME_PRETEXT_OPTIONS)
  return rememberBounded(preparedTextCache, cacheKey, prepared, PREPARED_TEXT_CACHE_LIMIT)
}

/**
 * 测量路径的等价物：`prepare()` 而不是 `prepareWithSegments()`。
 *
 * 顶层搜索只读 `lineCount`，而 `prepareWithSegments` 额外的 `segments` 数组与
 * `computeSegmentLevels` 的 bidi 扫描在它这里一点用都没有 —— 顶层搜索会调用上千次，
 * 每次都白算一份。
 */
function resolvePreparedMeasureText(text: string, fontSpec: string): PreparedText {
  const cacheKey = `${fontSpec}\0${text}`
  const cached = preparedMeasureTextCache.get(cacheKey)
  if (cached) return cached

  const prepared = prepare(text, fontSpec, FUME_PRETEXT_OPTIONS)
  return rememberBounded(preparedMeasureTextCache, cacheKey, prepared, PREPARED_TEXT_CACHE_LIMIT)
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
  const prepared = resolvePreparedText(text, fontSpec)
  // 与 §7.5 共用同一份取整实现：二分时的行高必须与装箱时的行高逐位相同
  const lineHeight = resolveLineHeight(candidateFontPx, variant)

  return {
    fontPx: candidateFontPx,
    prepared,
    layout: layoutWithLines(prepared, width, lineHeight)
  }
}

/**
 * 与 {@link prepareSingleLineAt} 共用字号、字体与行高口径，但只统计行数。
 *
 * `layout` 与 `layoutWithLines` 内部走同一个换行器，前者不创建每行文本、光标与宽度
 * 对象。顶层搜索会调用这一步上千次，却只读取 `lineCount`，因此物化整行是纯浪费。
 *
 * `requireExact` 为 `false` 时先问宽度模型（见 `line-width-model.ts`）：模型给出
 * `fit` / `overflow` 就直接返回，只有 `unsure` 才真的走 `prepare() + layout()`。
 * 模型说 `overflow` 时返回的 `lineCount` 是 **2**（占位，只用于 `<= 1` 比较）；
 * 需要**真实行数**的调用点（兜底那一档的块高）必须传 `requireExact: true`。
 */
function measureSingleLineAt(
  text: string,
  fontFamily: string,
  width: number,
  variant: FumeBlockVariant,
  candidateFontPx: number,
  theme: FumeFontThemeInput | null | undefined,
  requireExact: boolean
): FumeMeasuredSingleLine {
  if (!requireExact) {
    const verdict = resolveFastSingleLineFit(
      text,
      fontFamily,
      width,
      variant,
      candidateFontPx,
      theme
    )
    if (verdict === 'fit') return { fontPx: candidateFontPx, lineCount: 1 }
    if (verdict === 'overflow') return { fontPx: candidateFontPx, lineCount: 2 }
  }

  const fontSpec = buildFontSpec(candidateFontPx, variant, fontFamily, theme)
  const prepared = resolvePreparedMeasureText(text, fontSpec)
  const lineHeight = resolveLineHeight(candidateFontPx, variant)

  return {
    fontPx: candidateFontPx,
    lineCount: layout(prepared, width, lineHeight).lineCount
  }
}

/**
 * 问宽度模型这一次候选能不能排成一行；模型不适用（含 emoji / 硬换行 / 读不到内部字段）
 * 时返回 `null`，调用方照旧走真实测量。
 *
 * 参考字体串**必须**由 {@link buildFontSpec} 拼：字重（主题覆盖或档位默认）、字体栈、
 * 字号三项任一不同都会让模型与实际排版用的不是同一种字，而那是**静默**的错。
 */
function resolveFastSingleLineFit(
  text: string,
  fontFamily: string,
  width: number,
  variant: FumeBlockVariant,
  candidateFontPx: number,
  theme: FumeFontThemeInput | null | undefined
): FumeLineWidthFit | null {
  const referenceFontSpec = buildFontSpec(
    FUME_WIDTH_MODEL_REFERENCE_FONT_PX,
    variant,
    fontFamily,
    theme
  )
  const model = resolveLineWidthModel(text, referenceFontSpec, FUME_WIDTH_MODEL_REFERENCE_FONT_PX)
  if (!model) return null

  return resolveLineWidthFit(model, candidateFontPx, width)
}

/**
 * 字号二分的公共骨架。
 *
 * 候选字号的生成顺序、区间、迭代次数与「最好候选」的更新时机必须只有这一份；
 * 测量与渲染两条路径只在「一次候选怎么排」上不同。这样以后调整二分参数时，
 * 不会出现搜索阶段选出的字号与最终渲染阶段算出的字号分叉。
 *
 * `evaluate` 的第二个入参是 `requireExact`：二分**循环里**一律传 `false`
 * （模型答得出来就别测量），**兜底那一次**必须传 `true` —— 那一档的 `lineCount` 会
 * 参与块高计算，不接受模型给出的占位值。
 */
function searchSingleLineCandidate<T>(
  variant: FumeBlockVariant,
  lyricsFontScale: number,
  densityScale: number,
  heroScale: number,
  evaluate: (candidateFontPx: number, requireExact: boolean) => { candidate: T; lineCount: number }
): T {
  const range = variant === 'hero' ? FUME_HERO_FONT_PX_RANGE : FUME_BODY_FONT_PX_RANGE
  const variantScale = variant === 'hero' ? heroScale : 1

  let low = range.low
  let high = range.high
  let best: T | null = null

  for (let iteration = 0; iteration < FONT_PX_BISECTION_ITERATIONS; iteration += 1) {
    const candidateFontPx = ((low + high) / 2) * lyricsFontScale * densityScale * variantScale
    const result = evaluate(candidateFontPx, false)

    if (result.lineCount <= 1) {
      best = result.candidate
      low = (low + high) / 2
    } else {
      high = (low + high) / 2
    }
  }

  if (best) return best

  const fallbackFontPx = range.low * lyricsFontScale * densityScale * variantScale
  return evaluate(fallbackFontPx, true).candidate
}

/**
 * 字号二分（§4.10）：找出「这一行还塞得进区块宽度、保持单行」的字号。
 *
 * 判据是「能不能排成一行」：8 次二分，能排成单行就记下来并继续放大，否则缩小。
 * 8 次都排不成单行（长行 / 窄块）→ 用**最小字号**兜底再排一次，此时结果允许多行
 * （`layout.lineCount > 1`），后续 §7.6 会按视觉行切片。
 *
 * ⚠️「8 次二分的候选」走的是**宽度模型**（见 {@link buildMeasuredSingleLine}），只有
 * 模型答不上来（余量落在安全带内、含 emoji、含硬换行）才真的测量。所以这里的真实
 * `prepareWithSegments()` 调用**只有最后那一次** —— 它同时就是渲染要用的那一次。
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
  const measured = buildMeasuredSingleLine(
    text,
    fontFamily,
    width,
    variant,
    lyricsFontScale,
    densityScale,
    heroScale,
    theme
  )
  const prepared = prepareSingleLineAt(text, fontFamily, width, variant, measured.fontPx, theme)

  // 自愈：宽度模型与真实换行不一致时（理论上只在 pretext 换了走线实现后可能发生），
  // 整块退回**逐候选精确**搜索。不能只把这一行的行数改掉 —— 字号本身也是搜索的结果，
  // 两个阶段若各按各的判据选字号，测量阶段的块高与渲染阶段的块高就会对不上。
  if (prepared.layout.lineCount === measured.lineCount) return prepared

  const exact = buildMeasuredSingleLine(
    text,
    fontFamily,
    width,
    variant,
    lyricsFontScale,
    densityScale,
    heroScale,
    theme,
    { exact: true }
  )
  if (exact.fontPx === measured.fontPx) return prepared
  return prepareSingleLineAt(text, fontFamily, width, variant, exact.fontPx, theme)
}

/** {@link buildMeasuredSingleLine} 的可选开关 */
export interface FumeMeasuredSingleLineOptions {
  /**
   * `true` = 完全跳过宽度模型，每个候选都真实测量（自愈路径与单测用）。
   *
   * 生产路径只在 `buildPreparedSingleLine` 的自愈分支里传它；顶层搜索永远走模型。
   */
  exact?: boolean
}

/**
 * 顶层搜索专用字号二分：只返回字号与行数，不物化逐行文本。
 *
 * 与 {@link buildPreparedSingleLine} 共用 {@link searchSingleLineCandidate}，
 * 所以搜索结果逐位相同；区别只在单次候选调 `layout` 而不是 `layoutWithLines`。
 */
export function buildMeasuredSingleLine(
  text: string,
  fontFamily: string,
  width: number,
  variant: FumeBlockVariant,
  lyricsFontScale: number,
  densityScale: number,
  heroScale: number,
  theme: FumeFontThemeInput | null | undefined,
  options?: FumeMeasuredSingleLineOptions
): FumeMeasuredSingleLine {
  const requireExact = options?.exact === true

  return searchSingleLineCandidate(
    variant,
    lyricsFontScale,
    densityScale,
    heroScale,
    (candidateFontPx, candidateRequiresExact) => {
      const candidate = measureSingleLineAt(
        text,
        fontFamily,
        width,
        variant,
        candidateFontPx,
        theme,
        requireExact || candidateRequiresExact
      )
      return { candidate, lineCount: candidate.lineCount }
    }
  )
}
