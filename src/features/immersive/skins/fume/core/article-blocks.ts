/**
 * 「浮名」文章排版的**区块变体选择与列高装箱**（移植规格书 §7.2–§7.5）。
 *
 * ## 为什么从 `article-layout.ts` 拆出来
 *
 * 规格书 §15.4 给了同一个建议：这一块回答的是「这一行排多大、往哪放」，而
 * `article-layout.ts` 回答的是「用几列、多密、排几次」。后者每次尝试都要重跑前者
 * （最多 4 列 × 8 次），拆开之后「装箱写错一位」与「搜索选错参数」在单测里
 * 不会再互相掩盖。
 *
 * ## 三处必须与上游同形的细节（改一位整张纸就变样）
 *
 * 1. **tie cursor 轮转**：列高并列是常态（歌曲开头所有列都在 `verticalMargin`），
 *    固定取第 0 列会把块全堆在左边。游标是**跨块**的可变状态，所以它作为参数
 *    显式传入传出（见 {@link FumePlacementState}），不做成模块级变量 ——
 *    模块级会让两次独立排版互相污染。
 * 2. **hero 不是「跨满两列」**：2 列时用 `columnWidth * 1.5 + gap * 0.5`，
 *    3/4 列才跨两列满宽；1 列时 hero 独占整张纸。
 * 3. **跨列 hero 的 x 还要补一段居中偏移**：把 `heroSpanWidth` 与 `blockWidth` 的差
 *    对半分，于是 2 列场景的 1.5 列 hero 落在两列之间而不是贴左列。
 *
 * ## 注入
 *
 * 本文件在 `core/` 里，**不许 import 测量层**（§15.1 边界 1），所以「这一行有几个
 * 可渲染字素」由调用方以 {@link CountRenderableGraphemes} 注入；`article-layout.ts`
 * 接到 §4.9 的实现上。
 */

import { seeded } from './fume-math'
import type { FumeBlockVariant } from './fume-types'

/** 变体选择只需要这两个字段（`FumeLine` 天然满足） */
export interface FumeVariantLine {
  fullText: string
  /** 本项目没有副歌元数据，恒为 `false`（§7.11）；分支保留以便将来接上 */
  isChorus?: boolean
}

/** 由测量层注入的「可渲染字素数」：空白不算、标点算（§4.9） */
export type CountRenderableGraphemes = (text: string) => number

// ───────────────────────── §7.2 变体选择的判据 ─────────────────────────

/** 副歌行不超过这个字数就一定给 hero */
export const FUME_HERO_CHORUS_MAX_GRAPHEMES = 22

/** 「够短」的字数区间：短于它没有标题感，长于它排不成一行大字 */
export const FUME_HERO_MIN_GRAPHEMES = 4
export const FUME_HERO_MAX_GRAPHEMES = 28

/** 离纸面中心超过这个比例就不给 hero（标题要落在视线中心附近） */
export const FUME_HERO_CENTER_LIMIT = 0.72

/** 每 6 块强制一块 hero，与种子阈值一起构成 hero 的节奏 */
export const FUME_HERO_INDEX_PERIOD = 6

/** 种子阈值：`> 0.965` 的行额外获得 hero（上游原样，改小会让 hero 突然变多） */
export const FUME_HERO_SEED_THRESHOLD = 0.965

/** fallback 允许的最长行（超过 36 字排成大字会撑破列宽） */
export const FUME_FALLBACK_HERO_MAX_GRAPHEMES = 36

// ───────────────────── §7.2 fallback 评分权重 ─────────────────────

const FALLBACK_COMFORT_MIN_GRAPHEMES = 6
const FALLBACK_COMFORT_MAX_GRAPHEMES = 22

/** 中心权重：越靠近纸面中心越好 */
const FALLBACK_CENTER_WEIGHT = 0.62
/** 长度权重：比中心略轻（合适长度排出来更像标题） */
const FALLBACK_LENGTH_WEIGHT = 0.34
/** 副歌加成（本项目恒不生效，见 §7.11） */
const FALLBACK_CHORUS_WEIGHT = 0.28
/** 抖动幅度：只用来打破同分，不足以翻转量级 */
const FALLBACK_JITTER_WEIGHT = 0.04

/** 长度分档：舒服 / 勉强 / 只是「还能接受」 */
const FALLBACK_LENGTH_SCORE_COMFORTABLE = 1
const FALLBACK_LENGTH_SCORE_ACCEPTABLE = 0.72
const FALLBACK_LENGTH_SCORE_TOLERABLE = 0.36

// ─────────────────── §7.3 / §7.5 尺寸与间距常量 ───────────────────

/** 文本可用宽度下限：再窄 pretext 连一个字都排不下 */
export const FUME_MIN_INNER_WIDTH_PX = 120

/** hero 的块间距比例（相对行高）：标题要透气 */
export const FUME_HERO_BLOCK_GAP_RATIO = 0.2
/** body 的块间距比例（相对行高）：正文要密 */
export const FUME_BODY_BLOCK_GAP_RATIO = 0.08
/** 两档块间距的像素下限（`Math.round` 之后可能取到 0） */
export const FUME_HERO_MIN_BLOCK_GAP_PX = 6
export const FUME_BODY_MIN_BLOCK_GAP_PX = 2

/** 离纸面中心的偏离比例：`|index - total / 2| / max(total, 1)` */
function resolveCenteredRatio(index: number, total: number): number {
  return Math.abs(index - total / 2) / Math.max(total, 1)
}

/**
 * 一条歌词「天然」该不该是 hero（§7.2）。
 *
 * 判据按代价从低到高短路：**空行**直接淘汰 → **短副歌**直接通过 →
 * 其余看「够短 + 够居中 + （每 6 块 || 种子命中）」。
 *
 * `index` / `total` 用的是**过滤空行之后**的下标与总数，与上游一致：
 * 判断「是否居中」时分母不该被空行撑大，否则整首歌的 hero 会整体偏移。
 */
export function chooseNaturalBlockVariant(
  line: FumeVariantLine,
  index: number,
  total: number,
  countRenderable: CountRenderableGraphemes
): FumeBlockVariant {
  const graphemeCount = countRenderable(line.fullText)
  if (graphemeCount === 0) return 'body'

  if (line.isChorus && graphemeCount <= FUME_HERO_CHORUS_MAX_GRAPHEMES) return 'hero'

  const shortEnough =
    graphemeCount >= FUME_HERO_MIN_GRAPHEMES && graphemeCount <= FUME_HERO_MAX_GRAPHEMES
  const centered = resolveCenteredRatio(index, total) < FUME_HERO_CENTER_LIMIT
  const rhythmic = (index + 1) % FUME_HERO_INDEX_PERIOD === 0
  const seededHit = seeded(`${line.fullText}:${index}`) > FUME_HERO_SEED_THRESHOLD

  return shortEnough && centered && (rhythmic || seededHit) ? 'hero' : 'body'
}

/** 长度分档：越接近 6..22 越像标题 */
function resolveFallbackLengthScore(graphemeCount: number): number {
  if (
    graphemeCount >= FALLBACK_COMFORT_MIN_GRAPHEMES &&
    graphemeCount <= FALLBACK_COMFORT_MAX_GRAPHEMES
  ) {
    return FALLBACK_LENGTH_SCORE_COMFORTABLE
  }
  if (graphemeCount <= FUME_HERO_MAX_GRAPHEMES) return FALLBACK_LENGTH_SCORE_ACCEPTABLE
  return FALLBACK_LENGTH_SCORE_TOLERABLE
}

/**
 * 整首歌没有任何天然 hero 时，强制提升一块（§7.2）。返回 `-1` = 不需要强制。
 *
 * 为什么必须有这条兜底：天然 hero 的三个条件都不宽（字数 4..28 + 居中 + 节奏），
 * 一首全是长句（或全是单字）的歌会**一块 hero 都没有**，纸面变成等大的一片小字。
 * 这不是「不好看」而已 —— 浮名的设计意图就是「一张有标题的纸」。
 *
 * 评分带一点种子抖动：同分是常态（所有行等长且对称时尤其如此），抖动让结果既确定
 * 又不像「机械地挑了第 n 块」。
 */
export function chooseFallbackHeroBlockIndex(
  entries: readonly { line: FumeVariantLine }[],
  countRenderable: CountRenderableGraphemes
): number {
  if (entries.length === 0) return -1

  // 有天然 hero 就什么都不做 —— 强制提升会挤掉原有节奏
  const hasNaturalHero = entries.some(
    ({ line }, blockIndex) =>
      chooseNaturalBlockVariant(line, blockIndex, entries.length, countRenderable) === 'hero'
  )
  if (hasNaturalHero) return -1

  let bestIndex = -1
  let bestScore = Number.NEGATIVE_INFINITY

  entries.forEach(({ line }, blockIndex) => {
    const graphemeCount = countRenderable(line.fullText)
    if (graphemeCount === 0) return

    const comfortable =
      graphemeCount >= FUME_HERO_MIN_GRAPHEMES && graphemeCount <= FUME_HERO_MAX_GRAPHEMES
    const acceptable = graphemeCount <= FUME_FALLBACK_HERO_MAX_GRAPHEMES
    if (!comfortable && !acceptable) return

    const centerScore = 1 - resolveCenteredRatio(blockIndex, entries.length)
    const lengthScore = resolveFallbackLengthScore(graphemeCount)
    const chorusScore = line.isChorus ? FALLBACK_CHORUS_WEIGHT : 0
    const jitter = seeded(`${line.fullText}:${blockIndex}:fallback-hero`) * FALLBACK_JITTER_WEIGHT
    const score =
      centerScore * FALLBACK_CENTER_WEIGHT +
      lengthScore * FALLBACK_LENGTH_WEIGHT +
      chorusScore +
      jitter

    if (score > bestScore) {
      bestScore = score
      bestIndex = blockIndex
    }
  })

  if (bestIndex >= 0) return bestIndex

  // 全是超长行：退化成「最短的那一块」。仍然全空 → -1（调用处会全是 body）
  let shortestIndex = -1
  let shortestCount = Number.POSITIVE_INFINITY
  entries.forEach(({ line }, blockIndex) => {
    const graphemeCount = countRenderable(line.fullText)
    if (graphemeCount > 0 && graphemeCount < shortestCount) {
      shortestCount = graphemeCount
      shortestIndex = blockIndex
    }
  })

  return shortestIndex
}

/** 变体 = 「被强制的那块给 hero」，否则走天然判断（§7.2） */
export function chooseBlockVariant(
  line: FumeVariantLine,
  index: number,
  total: number,
  forcedHeroIndex: number,
  countRenderable: CountRenderableGraphemes
): FumeBlockVariant {
  if (index === forcedHeroIndex) return 'hero'
  return chooseNaturalBlockVariant(line, index, total, countRenderable)
}

// ───────────────────────────── §7.3 区块宽度 ─────────────────────────────

/** 一次排版的列几何（由 §7.8 的参数与视口算出，全块共用） */
export interface FumeColumnGeometry {
  paperWidth: number
  columns: number
  gap: number
  columnWidth: number
  horizontalMargin: number
  verticalMargin: number
}

/** 一个区块的宽度三件套（§7.3） */
export interface FumeBlockMetrics {
  /** 跨列数：body 恒 1；hero 在单列时 1、多列时 2 */
  heroSpanColumns: number
  /** 跨列后能覆盖的宽度（用于算居中偏移） */
  heroSpanWidth: number
  blockWidth: number
  /** 文本可用宽度 = `max(blockWidth, 120)`（当前 paddingX = 0） */
  innerWidth: number
}

/**
 * 由变体与列几何算区块宽度（§7.3）。
 *
 * 三档的意图各不相同：
 * - **1 列**：hero 就是整张纸（没有「跨列」可言），body 也是整列；
 * - **2 列**：hero 占 1.5 列 —— 跨满两列会让标题「横穿纸张」，视觉上比正文宽太多，
 *   1.5 列既压得住版面又留出呼吸；
 * - **3/4 列**：hero 跨两列满宽，因为列已经够窄，跨满是唯一装得下大字的宽度。
 */
export function resolveBlockMetrics(
  variant: FumeBlockVariant,
  geometry: FumeColumnGeometry
): FumeBlockMetrics {
  const { paperWidth, columns, gap, columnWidth } = geometry
  const heroSpanColumns = variant === 'hero' ? Math.min(columns, columns <= 1 ? 1 : 2) : 1
  const heroSpanWidth =
    heroSpanColumns > 1 ? columnWidth * heroSpanColumns + gap * (heroSpanColumns - 1) : paperWidth

  let blockWidth: number
  if (variant === 'hero') {
    if (heroSpanColumns === 1) blockWidth = paperWidth
    else if (columns === 2) blockWidth = columnWidth * 1.5 + gap * 0.5
    else blockWidth = heroSpanWidth
  } else {
    blockWidth = columnWidth
  }

  return {
    heroSpanColumns,
    heroSpanWidth,
    blockWidth,
    innerWidth: Math.max(blockWidth, FUME_MIN_INNER_WIDTH_PX)
  }
}

// ───────────────────────────── §7.4 列高装箱 ─────────────────────────────

/**
 * 装箱的跨块状态：列高 + 两个轮转游标（§7.4）。
 *
 * 只包含**会被块改变**的东西（列高、游标）。列几何是只读的，不塞进来 ——
 * 混在一起会让「哪些字段在变」看不出来。
 */
export interface FumePlacementState {
  columnHeights: number[]
  /** body 落列时的并列游标 */
  bodyColumnTieCursor: number
  /** 跨列 hero 落位时的并列游标 */
  heroPlacementTieCursor: number
}

/** 一个区块的落位结果（左上角世界坐标） */
export interface FumePlacement {
  x: number
  y: number
}

/** 区块落位需要的东西（宽度 + 高度 + 间距），都来自 §7.3 / §7.5 */
export interface FumePlacementBlockSize {
  heroSpanColumns: number
  heroSpanWidth: number
  blockWidth: number
  blockHeight: number
  blockGap: number
}

/** 开一次装箱：列高初值全是 `verticalMargin`，游标归零 */
export function createPlacementState(columns: number, verticalMargin: number): FumePlacementState {
  return {
    columnHeights: new Array<number>(columns).fill(verticalMargin),
    bodyColumnTieCursor: 0,
    heroPlacementTieCursor: 0
  }
}

/**
 * 把一个区块放进列里（§7.4），**原地更新** `state`。
 *
 * 两条路径的取舍完全不同：
 * - **单列 hero**（`heroSpanColumns === 1`）：它是「整张纸的标题」，必须等**所有**列
 *   都排到当前高度才能放 —— 否则标题会插进正文中间，把某一列截断。
 * - **跨列 hero**：找「最矮的落点」。覆盖高度取区间内各列的 `max`（被压住的所有列
 *   都要容得下它），并列时用游标轮转铺开。
 */
export function placeHeroBlock(
  state: FumePlacementState,
  geometry: FumeColumnGeometry,
  size: FumePlacementBlockSize
): FumePlacement {
  const { columns, columnWidth, gap, horizontalMargin } = geometry
  const { heroSpanColumns, heroSpanWidth, blockWidth, blockHeight, blockGap } = size

  if (heroSpanColumns <= 1) {
    // 跨整纸：必须等所有列都到那儿（见上方注释），落位后只推进第 0 列
    const y = Math.max(...state.columnHeights)
    state.columnHeights[0] = y + blockHeight + blockGap
    return { x: horizontalMargin, y }
  }

  const candidateStarts: number[] = []
  let bestHeight = Number.POSITIVE_INFINITY

  for (let startColumn = 0; startColumn <= columns - heroSpanColumns; startColumn += 1) {
    let coveredHeight = 0
    for (
      let columnIndex = startColumn;
      columnIndex < startColumn + heroSpanColumns;
      columnIndex += 1
    ) {
      coveredHeight = Math.max(coveredHeight, state.columnHeights[columnIndex] ?? 0)
    }

    if (coveredHeight < bestHeight) {
      bestHeight = coveredHeight
      candidateStarts.length = 0
      candidateStarts.push(startColumn)
    } else if (coveredHeight === bestHeight) {
      candidateStarts.push(startColumn)
    }
  }

  const targetStart =
    candidateStarts.length > 0
      ? candidateStarts[state.heroPlacementTieCursor % candidateStarts.length]
      : 0
  state.heroPlacementTieCursor += 1

  const y = bestHeight
  const x =
    horizontalMargin +
    targetStart * (columnWidth + gap) +
    Math.max((heroSpanWidth - blockWidth) * 0.5, 0)

  for (
    let columnIndex = targetStart;
    columnIndex < targetStart + heroSpanColumns;
    columnIndex += 1
  ) {
    state.columnHeights[columnIndex] = y + blockHeight + blockGap
  }

  return { x, y }
}

/** body 落位：找最矮的列，并列时游标轮转（§7.4 的另一半） */
export function placeBodyBlock(
  state: FumePlacementState,
  geometry: FumeColumnGeometry,
  size: Pick<FumePlacementBlockSize, 'blockHeight' | 'blockGap'>
): FumePlacement {
  const { columns, columnWidth, gap, horizontalMargin } = geometry
  const candidateColumns: number[] = []
  let minHeight = Number.POSITIVE_INFINITY

  for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
    const height = state.columnHeights[columnIndex] ?? 0
    if (height < minHeight) {
      minHeight = height
      candidateColumns.length = 0
      candidateColumns.push(columnIndex)
    } else if (height === minHeight) {
      candidateColumns.push(columnIndex)
    }
  }

  const targetColumn =
    candidateColumns[state.bodyColumnTieCursor % Math.max(candidateColumns.length, 1)] ?? 0
  state.bodyColumnTieCursor += 1

  const y = state.columnHeights[targetColumn] ?? 0
  state.columnHeights[targetColumn] = y + size.blockHeight + size.blockGap

  return { x: horizontalMargin + targetColumn * (columnWidth + gap), y }
}

// ───────────────────────── §7.5 行高与块间距 ─────────────────────────

/** hero 的行高系数（与测量层的二分循环共用同一对常量） */
export const FUME_HERO_LINE_HEIGHT_RATIO = 1.02
/** body 的行高系数 */
export const FUME_BODY_LINE_HEIGHT_RATIO = 1.06

/** 行高：**必须取整**（§17.3 第 4 条：浮点行高会让基线亚像素抖动） */
export function resolveLineHeight(fontPx: number, variant: FumeBlockVariant): number {
  const ratio = variant === 'hero' ? FUME_HERO_LINE_HEIGHT_RATIO : FUME_BODY_LINE_HEIGHT_RATIO
  return Math.round(fontPx * ratio)
}

/** 块间距：hero 与 body 用不同比例与不同像素下限（§7.5） */
export function resolveBlockGap(lineHeight: number, variant: FumeBlockVariant): number {
  if (variant === 'hero') {
    return Math.max(Math.round(lineHeight * FUME_HERO_BLOCK_GAP_RATIO), FUME_HERO_MIN_BLOCK_GAP_PX)
  }
  return Math.max(Math.round(lineHeight * FUME_BODY_BLOCK_GAP_RATIO), FUME_BODY_MIN_BLOCK_GAP_PX)
}
