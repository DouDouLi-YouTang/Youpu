/**
 * 一次排版「尝试」（移植规格书 §7.7）：把过滤后的行逐块排版、装箱，产出
 * 指标（`measure` 模式）或完整文章（`render` 模式）。
 *
 * ## 为什么单独一个文件
 *
 * §7.8 的顶层搜索要跑「列数 × 8 次密度二分」次本函数，每次都要走完
 * 变体 → 字号二分 → 装箱这条完整链路；把它与搜索放在一起会让一个文件同时承担
 * 「怎么排一块」和「排几次」两件事，且单测很难只针对其中一件。
 *
 * ## 测量是注入的（§15.1 边界 3）
 *
 * `core/` 不许 import `measure/`。本文件需要四件会碰 DOM / pretext 的能力
 * （字体栈、canvas 字体串、字号二分、片段逐字素测量），全部从
 * {@link FumeArticleMeasure} 进来；**纯换算**（§4.2–§4.6、§4.9）则从
 * `./text-measure-pure.ts` 直接引用 —— 它们不碰 DOM，住在 core 本来就是对的位置，
 * 再包一层注入只会多一份没有收益的间接。
 *
 * ## 两种模式
 *
 * - `measure`：只算「排完有多高」，**不建** `renderLines` / `blocks`
 *   （这是列数与密度搜索的成本大头，§7.8 明说要省掉）；
 * - `render`：全量构建，最后按时间序补 `chronologicalBlocks` 等派生字段。
 */

import {
  chooseBlockVariant,
  chooseFallbackHeroBlockIndex,
  createPlacementState,
  placeBodyBlock,
  placeHeroBlock,
  resolveBlockGap,
  resolveBlockMetrics,
  resolveLineHeight,
  type FumeColumnGeometry,
  type CountRenderableGraphemes
} from './article-blocks'
import { seeded, splitGraphemes } from './fume-math'
import { buildWordRangesFromWords } from './fume-reveal'
import {
  buildGlyphOffsets,
  buildRenderSegments,
  buildSegmentMetas,
  buildWordRangeIndexByOffset,
  countRenderableGraphemes,
  cursorToGlobalOffset
} from './text-measure-pure'
import type { FumeLayoutThemeKey } from './layout-key'
import type {
  FumeArticleLayout,
  FumeArticleLayoutMetrics,
  FumeBlock,
  FumeBlockVariant,
  FumeLayoutAttemptOptions,
  FumeLayoutAttemptTiming,
  FumeLine,
  FumeRenderLineSlice,
  FumeViewportSize
} from './fume-types'
import { getLineRenderEndTimeMs } from '../../shared/render-hints'

/**
 * 一次字号二分的产物。
 *
 * 结构上与 `measure/text-measure.ts` 的 `FumePreparedSingleLine` **逐字段相同**，
 * 但 core 不能 import 那个模块（§15.1），所以这里声明形状、由真实对象结构化满足。
 */
export interface FumePreparedSingleLineLike {
  fontPx: number
  prepared: FumeBlock['prepared']
  layout: FumeBlock['layout']
}

/** 顶层搜索的轻量产物：只保留确定块高所需的字号与视觉行数。 */
export interface FumeMeasuredSingleLineLike {
  fontPx: number
  lineCount: number
}

/**
 * 从完整排版产物提取测量所需的两个字段。
 *
 * 测试夹具与旧的自定义测量实现只需提供 `prepareSingleLine`；生产实现会走更轻的
 * `measureSingleLine`。把兼容适配放在 core 内，接口仍是单一来源，调用点无需知道
 * 某个测量器是否实现了快路径。
 */
export function toMeasuredSingleLine(
  prepared: FumePreparedSingleLineLike
): FumeMeasuredSingleLineLike {
  return { fontPx: prepared.fontPx, lineCount: prepared.layout.lines.length }
}

interface FumeMeasureSingleLineInput {
  variant: FumeBlockVariant
  lyricsFontScale: number
  densityScale: number
  heroScale: number
  layoutTheme: FumeLayoutThemeKey
}

function measureMeasureSingleLine(
  measure: FumeArticleMeasure,
  text: string,
  fontFamily: string,
  width: number,
  input: FumeMeasureSingleLineInput
): FumeMeasuredSingleLineLike {
  if (measure.measureSingleLine) {
    return measure.measureSingleLine(
      text,
      fontFamily,
      width,
      input.variant,
      input.lyricsFontScale,
      input.densityScale,
      input.heroScale,
      input.layoutTheme
    )
  }

  return toMeasuredSingleLine(
    measure.prepareSingleLine(
      text,
      fontFamily,
      width,
      input.variant,
      input.lyricsFontScale,
      input.densityScale,
      input.heroScale,
      input.layoutTheme
    )
  )
}

/**
 * 排版需要的测量能力（全部由 `measure/` 提供，见文件头）。
 *
 * 只列**会碰 DOM / pretext** 的四项：纯换算不在这里，它们直接来自
 * `text-measure-pure.ts`。
 */
export interface FumeArticleMeasure {
  /** 主题 → 字体栈（上游 `resolveThemeFontStack`；本项目由测量层给定） */
  resolveFontFamily(theme: FumeLayoutThemeKey): string
  /** canvas 字体串（§4.8） */
  buildFontSpec(
    fontPx: number,
    variant: FumeBlockVariant,
    fontFamily: string,
    theme: FumeLayoutThemeKey
  ): string
  /** 字号二分（§4.10）：唯一会调 pretext 的一步 */
  prepareSingleLine(
    text: string,
    fontFamily: string,
    width: number,
    variant: FumeBlockVariant,
    lyricsFontScale: number,
    densityScale: number,
    heroScale: number,
    theme: FumeLayoutThemeKey
  ): FumePreparedSingleLineLike
  /**
   * 与 `prepareSingleLine` 完全相同地搜索字号，但只返回行数。
   *
   * `measure` 模式只读取 `fontPx + lineCount`；这条接口避免为顶层搜索的
   * 上千个候选物化逐行文本。它不参与最终渲染，因此不会降低文章数据完整度。
   */
  measureSingleLine?(
    text: string,
    fontFamily: string,
    width: number,
    variant: FumeBlockVariant,
    lyricsFontScale: number,
    densityScale: number,
    heroScale: number,
    theme: FumeLayoutThemeKey
  ): FumeMeasuredSingleLineLike
  /** 片段逐字素实测偏移（§4.7） */
  measureSegmentGlyphOffsets(text: string, fontSpec: string): number[]
}

/** `buildArticleLayoutAttempt` 的公共入参（省得每个重载都抄一遍） */
export interface FumeAttemptContext {
  lines: readonly FumeLine[]
  viewport: FumeViewportSize
  layoutTheme: FumeLayoutThemeKey
  lyricsFontScale: number
  heroScale: number
  measure: FumeArticleMeasure
  /** 时间源：单测注入确定值，生产走 `performance.now` 由调用方给 */
  now: () => number
}

/** 过滤后的块条目：`index` 是**原始 lines 数组**里的下标 */
interface FumeFilteredEntry {
  line: FumeLine
  index: number
  /** 预先算好的排序键（同一键重复哈希等于白算，见下） */
  sortKey: number
}

/**
 * 过滤空行 + 按种子确定性打乱（§7.7）。
 *
 * 为什么打乱：严格按时间顺序堆叠会读起来像「一列一列贴着写」，而浮名的纸面是
 * 「被编排过」的 —— 同一首歌每次打开顺序相同（种子只含主题名与参数），所以是
 * **确定性的打乱**，不是随机。
 *
 * 为什么把种子**预计算**：比较函数会被调 O(n log n) 次，而每次都要重算 FNV ——
 * 几百行时这是白白烧掉的热点。预计算不改变排序结果（比较的仍是同一批值）。
 */
function buildFilteredEntries(lines: readonly FumeLine[], seedKey: string): FumeFilteredEntry[] {
  const entries: FumeFilteredEntry[] = []

  lines.forEach((line, index) => {
    if (line.fullText.trim().length === 0) return
    entries.push({ line, index, sortKey: seeded(`${seedKey}:${index}:${line.fullText}`) })
  })

  entries.sort((left, right) => left.sortKey - right.sortKey)
  return entries
}

/** 一个块的尺寸三件套（§7.5），算完就立刻用于装箱 */
interface FumeBlockSize {
  fontPx: number
  lineHeight: number
  blockGap: number
  blockHeight: number
}

function resolveBlockSizeFromCount(
  fontPx: number,
  lineCount: number,
  variant: FumeBlockVariant
): FumeBlockSize {
  // 与 §7.5 共用同一份取整实现：搜索与最终渲染的块高必须逐位相同
  const lineHeight = resolveLineHeight(fontPx, variant)
  return {
    fontPx,
    lineHeight,
    blockGap: resolveBlockGap(lineHeight, variant),
    // paddingY 恒为 0（§7.3），块高就是「视觉行数 × 行高」
    blockHeight: lineCount * lineHeight
  }
}

function resolveMeasuredBlockSize(
  prepared: FumeMeasuredSingleLineLike,
  variant: FumeBlockVariant
): FumeBlockSize {
  return resolveBlockSizeFromCount(prepared.fontPx, prepared.lineCount, variant)
}

/**
 * 建这个块的视觉行（§7.6）。
 *
 * 两个偏移口径容易混：
 * - `glyphOffsets` / `segments` 里的下标是**块内全局**字素下标（`start` 起算）；
 * - `segments[].localStart` 是**行内**下标（`start` 已减掉）。
 *
 * `left` 只有 hero 会非 0：`0.08` 的缩进让标题块整体右移一点（最多 8% 的剩余宽度），
 * 制造「标题不齐左」的观感 —— body 恒为 0，正文必须对齐才像文章。
 */
function buildRenderLines(
  line: FumeLine,
  prepared: FumePreparedSingleLineLike,
  variant: FumeBlockVariant,
  blockWidth: number,
  lineHeight: number,
  fontSpec: string,
  measure: FumeArticleMeasure
): {
  graphemes: string[]
  segmentMetas: FumeBlock['segmentMetas']
  renderLines: FumeRenderLineSlice[]
} {
  const { graphemes, segmentMetas } = buildSegmentMetas(prepared.prepared)

  const renderLines = prepared.layout.lines.map((layoutLine, lineIndex) => {
    const start = cursorToGlobalOffset(layoutLine.start, segmentMetas)
    const end = cursorToGlobalOffset(layoutLine.end, segmentMetas)
    const lineGraphemes = splitGraphemes(layoutLine.text)

    return {
      id: `${line.startTimeMs}-${lineIndex}`,
      text: layoutLine.text,
      start,
      end,
      graphemes: lineGraphemes,
      glyphOffsets: buildGlyphOffsets(prepared.prepared, segmentMetas, start, lineGraphemes.length),
      segments: buildRenderSegments(prepared.prepared, segmentMetas, start, end, (text) =>
        measure.measureSegmentGlyphOffsets(text, fontSpec)
      ),
      left: variant === 'hero' ? Math.max((blockWidth - layoutLine.width) * 0.08, 0) : 0,
      top: lineIndex * lineHeight,
      width: layoutLine.width
    }
  })

  return { graphemes, segmentMetas, renderLines }
}

/** 把一块拼成完整 `FumeBlock`（只有 `render` 模式会走） */
function buildBlock(
  line: FumeLine,
  sourceLineIndex: number,
  variant: FumeBlockVariant,
  prepared: FumePreparedSingleLineLike,
  size: FumeBlockSize,
  placement: { x: number; y: number },
  blockWidth: number,
  innerWidth: number,
  fontFamily: string,
  layoutTheme: FumeLayoutThemeKey,
  measure: FumeArticleMeasure
): FumeBlock {
  const fontSpec = measure.buildFontSpec(size.fontPx, variant, fontFamily, layoutTheme)
  const { graphemes, segmentMetas, renderLines } = buildRenderLines(
    line,
    prepared,
    variant,
    blockWidth,
    size.lineHeight,
    fontSpec,
    measure
  )
  const wordRanges = buildWordRangesFromWords(line.words, graphemes)

  return {
    id: `fume-${line.startTimeMs}-${sourceLineIndex}`,
    sourceLineIndex,
    line,
    variant,
    x: placement.x,
    y: placement.y,
    width: blockWidth,
    height: size.blockHeight,
    innerWidth,
    fontPx: size.fontPx,
    lineHeight: size.lineHeight,
    prepared: prepared.prepared,
    layout: prepared.layout,
    graphemes,
    segmentMetas,
    wordRanges,
    wordRangeIndexByOffset: buildWordRangeIndexByOffset(graphemes.length, wordRanges),
    colorRangeIndexByOffset: buildWordRangeIndexByOffset(graphemes.length, wordRanges, 'color'),
    renderLines
  }
}

/** `measure` 模式：只出指标（§7.7 的短路出口用） */
export function buildArticleLayoutAttempt(
  context: FumeAttemptContext,
  options: FumeLayoutAttemptOptions & { mode: 'measure' }
): FumeArticleLayoutMetrics | null
/** `render` 模式（缺省）：出完整文章 */
export function buildArticleLayoutAttempt(
  context: FumeAttemptContext,
  options: FumeLayoutAttemptOptions & { mode?: 'render' }
): FumeArticleLayout | null
export function buildArticleLayoutAttempt(
  context: FumeAttemptContext,
  options: FumeLayoutAttemptOptions
): FumeArticleLayout | FumeArticleLayoutMetrics | null {
  const attempt = createArticleLayoutAttempt(context, options)
  let step = attempt.next()
  while (!step.done) step = attempt.next()
  return step.value
}

/**
 * 与 {@link buildArticleLayoutAttempt} **逐字等价**的分片版本（性能修复，见
 * `article-layout.ts` 文件头的说明）：每处理完一个块 `yield` 一次。
 *
 * 让出点是**块之间**而不是块内部：一次 `prepareSingleLine`（pretext 换行 + 字号二分）
 * 内部若被打断，前后两半就可能读到不同的测量缓存，那才是真正的行为变更。
 */
export function* createArticleLayoutAttempt(
  context: FumeAttemptContext,
  options: FumeLayoutAttemptOptions
): Generator<void, FumeArticleLayout | FumeArticleLayoutMetrics | null, void> {
  const { lines, viewport, layoutTheme, lyricsFontScale, heroScale, measure, now } = context
  if (viewport.width <= 0 || viewport.height <= 0 || lines.length === 0) return null

  const {
    paperWidth,
    viewportHeight,
    columns,
    gap,
    densityScale,
    seedKey,
    mode = 'render',
    timing
  } = options
  const shouldBuildRenderDetails = mode === 'render'

  const geometry: FumeColumnGeometry = {
    paperWidth,
    columns,
    gap,
    columnWidth: (paperWidth - gap * (columns - 1)) / columns,
    horizontalMargin: Math.max(viewport.width * 0.86, 280),
    verticalMargin: Math.max(viewport.height * 0.82, 220)
  }
  const fontFamily = measure.resolveFontFamily(layoutTheme)

  const filteredLines = buildFilteredEntries(lines, seedKey)
  // §4.9 的「可渲染字素数」是纯换算，直接住 core；这里的注入只是把函数换个名字
  // 传下去，让 `article-blocks` 不必知道它来自哪一层。
  const countRenderable: CountRenderableGraphemes = countRenderableGraphemes

  const blocks: FumeBlock[] = []
  const placementState = createPlacementState(columns, geometry.verticalMargin)
  const forcedHeroIndex = chooseFallbackHeroBlockIndex(filteredLines, countRenderable)

  for (const [blockIndex, { line, index }] of filteredLines.entries()) {
    if (timing) timing.lines += 1
    const variant = chooseBlockVariant(
      line,
      blockIndex,
      filteredLines.length,
      forcedHeroIndex,
      countRenderable
    )
    const blockMetrics = resolveBlockMetrics(variant, geometry)

    const prepareStart = timing ? now() : 0
    let prepared: FumePreparedSingleLineLike | null = null
    let measured: FumeMeasuredSingleLineLike

    if (shouldBuildRenderDetails) {
      prepared = measure.prepareSingleLine(
        line.fullText,
        fontFamily,
        blockMetrics.innerWidth,
        variant,
        lyricsFontScale,
        densityScale,
        heroScale,
        layoutTheme
      )
      measured = toMeasuredSingleLine(prepared)
    } else {
      measured = measureMeasureSingleLine(
        measure,
        line.fullText,
        fontFamily,
        blockMetrics.innerWidth,
        {
          variant,
          lyricsFontScale,
          densityScale,
          heroScale,
          layoutTheme
        }
      )
    }
    if (timing) timing.prepareLayoutMs += now() - prepareStart

    const size = resolveMeasuredBlockSize(measured, variant)

    const placementStart = timing ? now() : 0
    const placement =
      variant === 'hero'
        ? placeHeroBlock(placementState, geometry, {
            heroSpanColumns: blockMetrics.heroSpanColumns,
            heroSpanWidth: blockMetrics.heroSpanWidth,
            blockWidth: blockMetrics.blockWidth,
            blockHeight: size.blockHeight,
            blockGap: size.blockGap
          })
        : placeBodyBlock(placementState, geometry, {
            blockHeight: size.blockHeight,
            blockGap: size.blockGap
          })
    if (timing) timing.placementMs += now() - placementStart

    // ⚠️ 这里用 `if` 包住而不是提前 `return`/`continue`：本函数是生成器，
    // `return` 会**终止整个生成器**（measure 模式只出指标、不建 renderLines，
    // 但循环必须走完才能算出列高），而 `continue` 会跳过下面的 `yield` ——
    // 偏偏 measure 模式才是耗时的那一半，最需要让出。
    if (shouldBuildRenderDetails && prepared) {
      const renderStart = timing ? now() : 0
      blocks.push(
        buildBlock(
          line,
          index,
          variant,
          prepared,
          size,
          placement,
          blockMetrics.blockWidth,
          blockMetrics.innerWidth,
          fontFamily,
          layoutTheme,
          measure
        )
      )
      if (timing) timing.renderDetailsMs += now() - renderStart
    }

    yield
  }

  const articleHeight = Math.max(0, ...placementState.columnHeights) + geometry.verticalMargin

  const metrics: FumeArticleLayoutMetrics = {
    width: paperWidth + geometry.horizontalMargin * 2,
    height: articleHeight,
    viewportHeight,
    columns,
    gap,
    paperBounds: {
      left: geometry.horizontalMargin,
      top: geometry.verticalMargin,
      right: geometry.horizontalMargin + paperWidth,
      // 用「最后一列的底」而不是 articleHeight：背景形状锚定在内容区周围，
      // 不是整张世界图（§7.7 末尾）
      bottom: Math.max(articleHeight - geometry.verticalMargin, geometry.verticalMargin)
    }
  }

  if (!shouldBuildRenderDetails) return metrics

  const chronologicalBlocks = [...blocks].sort(
    (left, right) => left.sourceLineIndex - right.sourceLineIndex
  )
  const blockBySourceLineIndex = new Map<number, FumeBlock>()
  for (const block of chronologicalBlocks) {
    blockBySourceLineIndex.set(block.sourceLineIndex, block)
  }

  return {
    ...metrics,
    blocks,
    blockBySourceLineIndex,
    chronologicalBlocks,
    firstRenderableStartTimeMs:
      chronologicalBlocks[0]?.line.startTimeMs ?? Number.POSITIVE_INFINITY,
    lastChronologicalRenderEndTimeMs:
      chronologicalBlocks.length > 0
        ? getLineRenderEndTimeMs(chronologicalBlocks[chronologicalBlocks.length - 1].line)
        : Number.NEGATIVE_INFINITY
  }
}

/** 便捷导出：只算块高用不到 `renderLines`，但调用处需要一致的测量口径 */
export function createAttemptTiming(): FumeLayoutAttemptTiming {
  return { lines: 0, prepareLayoutMs: 0, placementMs: 0, renderDetailsMs: 0 }
}
