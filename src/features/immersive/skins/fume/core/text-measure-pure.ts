/**
 * 「浮名」文本测量的**纯换算部分**（移植规格书 §4.2–§4.6、§4.9 的判定骨架）。
 *
 * ## 为什么它在 `core/` 而不在 `measure/`
 *
 * 规格书 §15.1 的硬边界是「`core/` 不许 import 测量层」——因为测量层会碰 DOM。
 * 但 §4 里真正容易写错的不是 canvas 调用，而是**字素偏移的换算**：
 * 「光标 → 全局字素」「区间 → 宽度」「行边界 → 可绘制片段」这三组换算全部只依赖
 * 数据形状（`prepared.segments` / `widths` / `breakableFitAdvances`），与 DOM 无关。
 * 而 `core/article-layout.ts`（§7.6 建渲染行）**必须**用到它们，却又不许 import
 * `measure/`。所以落点只能是 `core/`：换算住在 core，测量住在 measure，
 * 后者 import 前者 —— 依赖方向始终是 measure → core。
 *
 * 本文件**不许**出现 `document` / `canvas` / `pretext` 的导入 —— `prepared` 只以
 * **结构**参与（`FumePreparedLike`），于是单测能喂假数据把边界逐条钉住。
 *
 * ## 单位
 *
 * 长度一律是 CSS px（上游就是 px）。时间不参与本层。
 */

import { clamp, splitGraphemes } from './fume-math'
import type {
  FumeRenderLineSlice,
  FumeRenderSegmentSlice,
  FumeSegmentMeta,
  FumeWordRange
} from './fume-types'

/**
 * `prepared` 里本层真正读到的那部分（§4.4 / §4.6）。
 *
 * 之所以不直接标 `PreparedTextWithSegments`：那是个带 brand 的类型，只能由 `pretext`
 * 自己生产，单测就喂不进假数据了。这里只声明**结构**，真实对象天然满足它。
 */
export interface FumePreparedLike {
  /** 每个段的拟合宽度（与 `segments` 同下标） */
  widths: number[]
  /** 可断行段的逐字素推进量；不可断行的段为 `null` */
  breakableFitAdvances: (number[] | null)[]
  /** pretext 的分段文本（连续可断行的一段，通常是一串 CJK 或一个西文词） */
  segments: string[]
}

/** 区间测量只用到「段宽 + 段内推进量」这两件数据 */
export interface FumeSegmentMeasureSource {
  widths: number[]
  breakableFitAdvances: (number[] | null)[]
}

/** `buildSegmentMetas` 的返回值：整块字素 + 每段的字素区间 */
export interface FumeSegmentMetaResult {
  graphemes: string[]
  segmentMetas: FumeSegmentMeta[]
}

/**
 * 逐段数出字素区间（§4.2）。
 *
 * 为什么段信息必须单独建：`prepared.segments` 是**分段单位**（连续可断行的一段），
 * 不是视觉行；视觉行由 `layoutWithLines` 给出，两者之间靠各段累计的字素数换算
 * （§4.3 的光标换算、§4.5 的字素偏移都要用它）。
 *
 * 顺带把整块字素拼出来 —— 拼接顺序与段顺序一致，所以「整块字素下标」是全局量，
 * 与文本行边界无关（行只是它的一个切片区间）。
 */
export function buildSegmentMetas(prepared: FumePreparedLike): FumeSegmentMetaResult {
  const segmentMetas: FumeSegmentMeta[] = []
  const graphemes: string[] = []
  let graphemeCursor = 0

  for (const segment of prepared.segments) {
    const segmentGraphemes = splitGraphemes(segment)
    segmentMetas.push({
      graphemeStart: graphemeCursor,
      graphemeEnd: graphemeCursor + segmentGraphemes.length,
      graphemeCount: segmentGraphemes.length
    })
    graphemes.push(...segmentGraphemes)
    graphemeCursor += segmentGraphemes.length
  }

  return { graphemes, segmentMetas }
}

/**
 * 「布局光标」→「整块字素下标」（§4.3）。
 *
 * `layoutWithLines` 给的是 `{ segmentIndex, graphemeIndex }`，而本层其余部分
 * （字素数组、词区间、揭示进度）全部用**整块字素下标**。这个换算是两者之间唯一的桥。
 *
 * 两种越界都要兜住，且**兜法不同**：
 * - `segmentMetas` 为空（空文本）→ `0`；
 * - `segmentIndex` 越界 → **最后一段的末尾**（而不是 0）。游标越界只可能出现在
 *   「段落数比 pretext 认为的少」这种异常输入上，此时退回末尾能让行尾落在文本尾部，
 *   退成 0 则会让最后一行整体错位到开头。
 */
export function cursorToGlobalOffset(
  cursor: { segmentIndex: number; graphemeIndex: number },
  segmentMetas: readonly FumeSegmentMeta[]
): number {
  if (segmentMetas.length === 0) return 0

  const segment = segmentMetas[cursor.segmentIndex]
  if (!segment) return segmentMetas[segmentMetas.length - 1].graphemeEnd

  return clamp(
    segment.graphemeStart + cursor.graphemeIndex,
    segment.graphemeStart,
    segment.graphemeEnd
  )
}

/**
 * 单个段内、与 `[startOffset, endOffset)` 相交部分的宽度（§4.4 的私有函数）。
 *
 * 三条捷径按**代价从低到高**排列，顺序不能换：
 * 1. 整段被覆盖 → 直接用 `widths[i]`（pretext 量出来的拟合宽度，最准也最便宜）；
 * 2. 段内推进量可用 → 累加 `breakableFitAdvances`（可断行段的口径）；
 * 3. 都没有 → **按字素比例摊**（`fullWidth * 覆盖比例`）。
 *
 * 第 3 条是 O(1) 的近似：不可断行的段（整串西文词、`keep-all` 的块）没有逐字素推进量，
 * 而打印裁剪只需要一个「大致到这里」的 x。近似会略偏，但只在「词中间」才会被看到，
 * 而 §4.6 的 `measuredGlyphOffsets` 会在真正绘制时用 canvas 逐前缀修正。
 */
function getPartialSegmentWidth(
  source: FumeSegmentMeasureSource,
  segmentIndex: number,
  segmentMeta: FumeSegmentMeta,
  startOffset: number,
  endOffset: number
): number {
  const localStart = clamp(startOffset - segmentMeta.graphemeStart, 0, segmentMeta.graphemeCount)
  const localEnd = clamp(endOffset - segmentMeta.graphemeStart, 0, segmentMeta.graphemeCount)

  if (localEnd <= localStart) return 0

  const fullWidth = source.widths[segmentIndex] ?? 0
  if (localStart === 0 && localEnd === segmentMeta.graphemeCount) {
    return fullWidth
  }

  const breakableFitAdvances = source.breakableFitAdvances[segmentIndex]
  if (breakableFitAdvances && breakableFitAdvances.length > 0) {
    let width = 0
    for (let index = localStart; index < localEnd; index += 1) {
      width += breakableFitAdvances[index] ?? 0
    }
    return width
  }

  if (segmentMeta.graphemeCount === 0) return fullWidth
  return fullWidth * ((localEnd - localStart) / segmentMeta.graphemeCount)
}

/**
 * 两个**整块字素偏移**之间的宽度（§4.4）——相机、揭示、片段切分全靠它。
 *
 * 线性扫段：完全落在左边的段跳过，完全落在右边的段直接 `break`（段有序，后面的更靠右）。
 * 这是 O(段数)，而相机每帧会对同一块调用多次（§16.2）——真要掉帧时，
 * 第一个该加记忆化的地方就是这里（按 `(blockId, startOffset, endOffset)` 做帧内缓存），
 * 但现在提前加等于为一个还没测出来的问题发明一层抽象。
 *
 * `endOffset <= startOffset` 直接返回 0（调用处大量出现零宽区间，先短路更省）。
 */
export function widthBetweenOffsets(
  source: FumeSegmentMeasureSource,
  segmentMetas: readonly FumeSegmentMeta[],
  startOffset: number,
  endOffset: number
): number {
  if (endOffset <= startOffset) return 0

  let width = 0
  for (let segmentIndex = 0; segmentIndex < segmentMetas.length; segmentIndex += 1) {
    const meta = segmentMetas[segmentIndex]
    if (endOffset <= meta.graphemeStart) break
    if (startOffset >= meta.graphemeEnd) continue

    const sliceStart = Math.max(startOffset, meta.graphemeStart)
    const sliceEnd = Math.min(endOffset, meta.graphemeEnd)
    width += getPartialSegmentWidth(source, segmentIndex, meta, sliceStart, sliceEnd)
  }

  return width
}

/**
 * 一个渲染行里每个字素相对行左边缘的 x 偏移（§4.5）。
 *
 * `offsets[i]` = 「从行首到第 i 个字素」的宽度，所以长度等于字素数（第 i 个字素的
 * **起点**）。末字的宽度要另看 `renderLine.width`（见 `resolveGlyphAdvance`）。
 *
 * 注意这里是 `startOffset + index`（不含第 index 个字素本身）—— 差一位会让整行的
 * 揭示前进一个字的宽度，而这种偏移在视觉上是「渐进错位」，肉眼很难当场发现。
 */
export function buildGlyphOffsets(
  source: FumeSegmentMeasureSource,
  segmentMetas: readonly FumeSegmentMeta[],
  startOffset: number,
  graphemeCount: number
): number[] {
  const offsets = new Array<number>(graphemeCount)
  for (let index = 0; index < graphemeCount; index += 1) {
    offsets[index] = widthBetweenOffsets(source, segmentMetas, startOffset, startOffset + index)
  }
  return offsets
}

/**
 * 第 `graphemeIndex` 个字素的推进量（§4.5）。
 *
 * 末字用**行宽**兜底（`glyphOffsets` 里没有它的右边界）：`width` 是 pretext 给出的
 * 拟合行宽，比「用倒数第二个偏移外推」稳 —— 后者在末字是宽字符时会把行尾算短。
 * 结果再取 `max(0)`：字体回退时逐段推进量可能给出负的差值（§4.5 原文「最小 0」）。
 */
export function resolveGlyphAdvance(
  renderLine: Pick<FumeRenderLineSlice, 'glyphOffsets' | 'graphemes' | 'width'>,
  graphemeIndex: number
): number {
  const currentOffset = renderLine.glyphOffsets[graphemeIndex] ?? 0
  const nextOffset =
    graphemeIndex < renderLine.graphemes.length - 1
      ? (renderLine.glyphOffsets[graphemeIndex + 1] ?? renderLine.width)
      : renderLine.width

  return Math.max(nextOffset - currentOffset, 0)
}

/**
 * 把一条渲染行拆成「可绘制片段」（§4.6）。
 *
 * 为什么需要这一层：绘制时**整行不能一次 `fillText`** —— 逐字素揭示要按字素裁剪，
 * 而裁剪的单位是「片段」：一个 pretext 段被行边界切出来的那一段。
 * 片段是绘制与测量之间的最小对齐单位（`x` / `width` 用 pretext 口径，
 * `measuredGlyphOffsets` 用 canvas 口径，见下）。
 *
 * `measureGlyphOffsets` 是**注入**的：它要调 canvas（§4.7），本文件保持无 DOM。
 * 单测传一个「每字 10px」的假函数，就能把切分与偏移的组合关系断言清楚。
 */
export function buildRenderSegments(
  source: FumePreparedLike,
  segmentMetas: readonly FumeSegmentMeta[],
  lineStart: number,
  lineEnd: number,
  measureGlyphOffsets: (text: string) => number[]
): FumeRenderSegmentSlice[] {
  const segments: FumeRenderSegmentSlice[] = []

  for (let segmentIndex = 0; segmentIndex < segmentMetas.length; segmentIndex += 1) {
    const meta = segmentMetas[segmentIndex]
    if (lineEnd <= meta.graphemeStart) break
    if (lineStart >= meta.graphemeEnd) continue

    const start = Math.max(lineStart, meta.graphemeStart)
    const end = Math.min(lineEnd, meta.graphemeEnd)
    if (end <= start) continue

    const isFullSegment = start === meta.graphemeStart && end === meta.graphemeEnd
    const segmentText = source.segments[segmentIndex] ?? ''
    const text = isFullSegment
      ? segmentText
      : splitGraphemes(segmentText)
          .slice(start - meta.graphemeStart, end - meta.graphemeStart)
          .join('')

    segments.push({
      text,
      start,
      end,
      localStart: start - lineStart,
      localEnd: end - lineStart,
      x: widthBetweenOffsets(source, segmentMetas, lineStart, start),
      width: widthBetweenOffsets(source, segmentMetas, start, end),
      isFullSegment,
      measuredGlyphOffsets: measureGlyphOffsets(text)
    })
  }

  return segments
}

/**
 * 字素偏移 → 词区间下标（§4.9）。
 *
 * 绘制时每个字素都要问「我属于哪个词」（决定颜色与揭示进度），若每次都线性找区间，
 * 一帧就是 O(字素 × 词数)。这里预建一张等长查找表，把每帧的查询压成 O(1)。
 *
 * 区间可能**重叠或倒序**（歌词数据的词比文本多/少时），所以不能在第一次命中时就停 ——
 * 按下标从小到大覆盖写，最后一个覆盖到的区间获胜；这也让「后一个词吞掉前一个词的尾空白」
 * 时下标落在后一个词上，与 §5.1 的吞空白规则一致。
 *
 * `rangeKind = 'color'` 时用 `colorStart/colorEnd`（着色区间可以比揭示区间更窄，
 * 见 §2.2 的 `FumeWordRange` 注释）。
 */
export function buildWordRangeIndexByOffset(
  graphemeCount: number,
  wordRanges: readonly FumeWordRange[],
  rangeKind: 'timing' | 'color' = 'timing'
): number[] {
  const indices = new Array<number>(graphemeCount).fill(-1)

  for (let rangeIndex = 0; rangeIndex < wordRanges.length; rangeIndex += 1) {
    const range = wordRanges[rangeIndex]
    const start = rangeKind === 'color' ? range.colorStart : range.start
    const end = rangeKind === 'color' ? range.colorEnd : range.end

    for (let offset = start; offset < end && offset < graphemeCount; offset += 1) {
      indices[offset] = rangeIndex
    }
  }

  return indices
}

/**
 * 「会被画出来」的字素数（§4.9）——空白不算，**标点算**。
 *
 * 用途是 §7.2 的区块变体选择（决定这一行够不够格当 hero）与 §7.3 的宽度估算。
 * 判据故意是「字素里有没有非空白字符」而不是「`trim()` 之后长度 > 0」：
 * 全角空格、制表符这些都应被跳过，而单个标点（如「。」）是一行里真实占位的字。
 */
export function countRenderableGraphemes(text: string): number {
  return splitGraphemes(text).filter((value) => value.trim().length > 0).length
}

/**
 * 行内局部偏移 → 行内 x（§4.9）。
 *
 * 三点边界要**原样**：`<= 0` → 0（不是 `glyphOffsets[0]`，因为行首偏移量由
 * `left` 单独承载）；`>= 字素数` → 行宽（末字右边界不在表里）；中间才查表。
 */
export function resolveRenderLineOffset(
  renderLine: Pick<FumeRenderLineSlice, 'glyphOffsets' | 'graphemes' | 'width'>,
  localOffset: number
): number {
  if (localOffset <= 0) return 0
  if (localOffset >= renderLine.graphemes.length) return renderLine.width
  return renderLine.glyphOffsets[localOffset] ?? renderLine.width
}

/**
 * 片段内某字素的实测 x 偏移（§4.9）。
 *
 * `measuredGlyphOffsets` 的长度是「字素数 + 1」（末尾是整段宽），所以下标上限是
 * `length - 1`。越界钳到两端而不是返回 0：返回 0 会让越界字素的 x 突然跳回片段开头。
 */
export function resolveSegmentGlyphOffset(
  segment: Pick<FumeRenderSegmentSlice, 'start' | 'measuredGlyphOffsets'>,
  globalOffset: number
): number {
  const localOffset = clamp(
    globalOffset - segment.start,
    0,
    segment.measuredGlyphOffsets.length - 1
  )
  return segment.measuredGlyphOffsets[localOffset] ?? 0
}

/**
 * 片段内某字素的**实测**推进量（§4.9）。
 *
 * 与 `resolveSegmentGlyphOffset` 的唯一差别是下标上限：要取到 `[i+1]`，
 * 所以最多到 `length - 2`。上限写成 `length - 1` 会读到末尾那个「整段宽」，
 * 让末字素的推进量变成「从它起点到整段末尾」——只有单字素片段才偶然正确。
 */
export function resolveSegmentGlyphAdvance(
  segment: Pick<FumeRenderSegmentSlice, 'start' | 'measuredGlyphOffsets'>,
  globalOffset: number
): number {
  const localOffset = clamp(
    globalOffset - segment.start,
    0,
    segment.measuredGlyphOffsets.length - 2
  )
  const current = segment.measuredGlyphOffsets[localOffset] ?? 0
  const next = segment.measuredGlyphOffsets[localOffset + 1] ?? current
  return Math.max(next - current, 0)
}
