/**
 * 「浮名」文章排版顶层（移植规格书 §7.8）：选列数、搜文本密度，最后真正排一次。
 *
 * ## 这一步在解决什么
 *
 * 浮名的纸面高度是**算出来的**，不是排出来的：先把整首歌排成一篇多栏文章，量出
 * 「总高」，再问「离目标高度（视口 × 2.45）差多少」。差得多就换一套参数重排 ——
 * 于是同一首歌在不同窗口尺寸下都会得到大致「2.45 屏」的纸面，看起来像是被编排过。
 *
 * 三层循环的形状（与上游一致，见 §7.8）：
 * ```
 * for 列数 = maxColumns → 1:              // 从最宽的开始试
 *   8 次二分 densityScale ∈ [0.82, 1.42]   // 每次二分跑一次 measure 模式的完整排版
 * 最后用得分最高的那组参数跑一次 render     // 这一次才建 renderLines
 * ```
 * 所以最坏情况是 `4 × 8 = 32` 次完整排版 + 1 次全量。这也是为什么它必须被挪出
 * 渲染路径（§7.9：rAF → setTimeout(0/96) → 版本号）。
 *
 * ## 搜索本身是可中断的（性能修复，2026-10-14）
 *
 * 挪出渲染路径只解决了「什么时候开始」，没解决「跑起来之后占住主线程多久」：
 * 实测 50 行 ≈ 1.0s、120 行 ≈ 3.1s 是**一整段同步长任务**，期间一帧都出不来，
 * 表现为拖窗口 / 切歌时画面冻住。所以循环被拆成 {@link createArticleLayoutSearch}
 * 这个**可单步推进的状态机**，由 `article-layout-chunked.ts` 在尝试之间让出主线程。
 *
 * ⚠️ 拆的是**时机**不是**结果**：同步入口 `buildArticleLayout` 与分片入口驱动的是
 * 同一个状态机、同一批参数、同一个顺序，所以两者选中的列数 / 密度 / 文章逐字相同
 * （单测里有一条等价性断言钉住这一点）。
 *
 * ## 评分为什么「偏低全额、偏高只算 14%」
 *
 * 目标是「理想情况下整页要滚 2.45 屏」。排出来偏矮（内容不够铺满）会让画面显得空，
 * 所以全额惩罚；偏高只是多滚一点，视觉上完全可接受，因此只按 14% 计。
 * 这不是随手拍的权重 —— 它决定了「选更少的列 + 更大的字」还是「更多的列 + 更小的字」。
 *
 * ## 未确认项的处理（§18）
 *
 * 规格书没有确认上游 `import.meta.env.DEV` 的日志是否值得移植。本项目**不打印**，
 * 而是把采样结果放进返回值的 `timing` 字段（可选），由调用方决定记不记 ——
 * 因为 `core/` 里读 `import.meta.env` 会让 node 单测直接崩（实测），
 * 而把日志写进 core 又会把「纯算法」污染成有副作用的模块。
 */

import {
  createArticleLayoutAttempt,
  createAttemptTiming,
  type FumeArticleMeasure
} from './article-layout-attempt'
import { clamp } from './fume-math'
import type { FumeLayoutThemeKey } from './layout-key'
import type {
  FumeArticleLayout,
  FumeArticleLayoutMetrics,
  FumeLayoutAttemptOptions,
  FumeLayoutAttemptTiming,
  FumeLine,
  FumeViewportSize
} from './fume-types'

// ─────────────────────────── §7.8 的参数与阈值 ───────────────────────────

/** 纸张相对视口的宽度倍数：比视口宽 1.95 倍 —— 「多栏文章」的来源 */
export const FUME_PAPER_WIDTH_SCALE = 1.95
/** 纸张必须比视口至少宽这么多 px（窄窗口下避免纸太窄） */
export const FUME_PAPER_WIDTH_MIN_EXTRA_PX = 520
/** 纸张宽度钳制区间 */
export const FUME_PAPER_WIDTH_MIN_PX = 920
export const FUME_PAPER_WIDTH_MAX_PX = 2400

/** 视口高的下限（参与目标高度计算，避免极矮窗口把目标压到 0） */
export const FUME_LAYOUT_VIEWPORT_MIN_HEIGHT_PX = 240

/** 目标纸面高 = 视口高 × 2.45（理想情况下整页滚 2.45 屏） */
export const FUME_TARGET_HEIGHT_SCREENS = 2.45

/** 列数分档阈值（纸张越宽，能容纳的列越多） */
export const FUME_COLUMNS_MIN_PAPER_WIDTH_PX = 500
export const FUME_COLUMNS_THREE_MIN_PAPER_WIDTH_PX = 760
export const FUME_COLUMNS_FOUR_MIN_PAPER_WIDTH_PX = 1120

/** 列间距 = 纸张宽 × 该系数（按列数分三档），再钳到 [6, 14] */
export const FUME_GAP_RATIO_MANY_COLUMNS = 0.0065
export const FUME_GAP_RATIO_THREE_COLUMNS = 0.0085
export const FUME_GAP_RATIO_FEW_COLUMNS = 0.0115
export const FUME_GAP_MIN_PX = 6
export const FUME_GAP_MAX_PX = 14

/** 文本密度二分的搜索区间与迭代次数 */
export const FUME_DENSITY_SCALE_MIN = 0.82
export const FUME_DENSITY_SCALE_MAX = 1.42
export const FUME_DENSITY_BISECTION_ITERATIONS = 8

/** 偏高（纸面比目标高）时的惩罚比例：允许略高，因为多出来的部分只是多滚一点 */
export const FUME_OVERFLOW_PENALTY_RATIO = 0.14

/**
 * 一次顶层搜索的耗时采样（可选返回）。
 *
 * 字段与上游 §7.9 的日志一一对应，只是**不在这里打印**（见文件头「未确认项」）。
 * `attempts` 是实际跑过的 `measure` 次数（单列窗口下会比 4×8 少）。
 */
export interface FumeArticleLayoutTiming {
  /** 实际跑过的 `measure` 模式次数 */
  attempts: number
  /** 各列数下的 measure 采样合计 */
  measure: FumeLayoutAttemptTiming
  /** 最后那次 `render` 模式的采样 */
  render: FumeLayoutAttemptTiming
  /** 最终选中的列数；`null` = 一次都没排成（理论上只有入参非法时） */
  bestColumns: number | null
  /** 最终选中的文本密度 */
  bestDensityScale: number | null
  /** 目标高度（= 视口高 × 2.45） */
  targetHeight: number
  /** 选中方案在 measure 阶段量到的高度 */
  bestHeight: number
  /** 最终文章高度 */
  finalHeight: number
}

/** `buildArticleLayout` 的返回值：文章 + 可选采样 */
export interface FumeArticleLayoutResult {
  article: FumeArticleLayout | null
  timing: FumeArticleLayoutTiming
}

/** 累加一份 attempt 采样（把每列的小计并进总量） */
function accumulateTiming(target: FumeLayoutAttemptTiming, source: FumeLayoutAttemptTiming): void {
  target.lines += source.lines
  target.prepareLayoutMs += source.prepareLayoutMs
  target.placementMs += source.placementMs
  target.renderDetailsMs += source.renderDetailsMs
}

/** 纸张宽度（§7.8）：比视口宽 1.95 倍、至少宽 520px，再钳到 [920, 2400] */
export function resolvePaperWidth(viewport: FumeViewportSize): number {
  return clamp(
    Math.max(
      viewport.width * FUME_PAPER_WIDTH_SCALE,
      viewport.width + FUME_PAPER_WIDTH_MIN_EXTRA_PX
    ),
    FUME_PAPER_WIDTH_MIN_PX,
    FUME_PAPER_WIDTH_MAX_PX
  )
}

/** 纸张宽度 → 最大列数（§7.8 的四档） */
export function resolveMaxColumns(paperWidth: number): number {
  if (paperWidth >= FUME_COLUMNS_FOUR_MIN_PAPER_WIDTH_PX) return 4
  if (paperWidth >= FUME_COLUMNS_THREE_MIN_PAPER_WIDTH_PX) return 3
  if (paperWidth >= FUME_COLUMNS_MIN_PAPER_WIDTH_PX) return 2
  return 1
}

/** 列间距：纸张宽 × 系数（按列数分档），再钳到 [6, 14] */
export function resolveColumnGap(paperWidth: number, columns: number): number {
  const ratio =
    columns >= 4
      ? FUME_GAP_RATIO_MANY_COLUMNS
      : columns === 3
        ? FUME_GAP_RATIO_THREE_COLUMNS
        : FUME_GAP_RATIO_FEW_COLUMNS
  return clamp(Math.round(paperWidth * ratio), FUME_GAP_MIN_PX, FUME_GAP_MAX_PX)
}

/**
 * 覆盖度得分（§7.8）：偏低全额惩罚，偏高只加 14%。
 *
 * 单独导出是为了让单测能**直接**断言这个权重 —— 它是「选参数」这一步唯一的判据，
 * 混在循环里就只能靠跑一整个列表间接观察，很难定位。
 */
export function resolveLayoutScore(height: number, targetHeight: number): number {
  const coveragePenalty = Math.abs(height - targetHeight)
  const overflowPenalty =
    height < targetHeight ? 0 : (height - targetHeight) * FUME_OVERFLOW_PENALTY_RATIO
  return coveragePenalty + overflowPenalty
}

/** `buildArticleLayout` 的入参（打包成一个对象，避免七个位置参数） */
export interface FumeArticleLayoutInput {
  lines: readonly FumeLine[]
  viewport: FumeViewportSize
  layoutTheme: FumeLayoutThemeKey
  lyricsFontScale: number
  heroScale: number
  measure: FumeArticleMeasure
  /** 时间源：生产传 `performance.now` 绑定，单测可传固定值序列 */
  now?: () => number
}

/**
 * 顶层入口（§7.8）：返回文章与采样。
 *
 * `timing` 一定会返回（即使没排成），这样调用方不必处理 `undefined`；
 * `article` 在「视口非正 / 没有可排的行 / 所有尝试都失败」时为 `null`。
 *
 * ⚠️ 这是**同步长任务**：同步跑 `32` 次完整排版 + 1 次全量。调用方必须按 §7.9
 * 把它放到 rAF → setTimeout 之后，绝不能在 `computed` 里直接调。
 */
export function buildArticleLayout(input: FumeArticleLayoutInput): FumeArticleLayoutResult {
  const search = createArticleLayoutSearch(input)
  let step = search.next()
  while (!step.done) step = search.next()
  return step.value
}

/**
 * 与 {@link buildArticleLayout} **逐字等价**的分片版本（性能修复，见文件头）。
 *
 * 每 `yield` 一次 = 「刚跑完一次完整排版，可以让出主线程了」。让出的时机是
 * **尝试之间**而不是尝试内部：一次尝试（一次字号二分 + 装箱）本身就包含
 * `pretext` 换行与逐字素测量，切碎了会让同一次二分的前后两半读到不同的输入，
 * 那才是真正的行为变更。以尝试为界则是纯粹的调度变更。
 *
 * 返回值的语义与同步版完全一致：生成器跑完时 `value` 就是
 * {@link FumeArticleLayoutResult}，中途 `value` 是 `undefined`。
 */
export function* createArticleLayoutSearch(
  input: FumeArticleLayoutInput
): Generator<void, FumeArticleLayoutResult, void> {
  const { lines, viewport, layoutTheme, lyricsFontScale, heroScale, measure } = input
  const now = input.now ?? (() => performance.now())

  const timing: FumeArticleLayoutTiming = {
    attempts: 0,
    measure: createAttemptTiming(),
    render: createAttemptTiming(),
    bestColumns: null,
    bestDensityScale: null,
    targetHeight: 0,
    bestHeight: 0,
    finalHeight: 0
  }

  if (viewport.width <= 0 || viewport.height <= 0 || lines.length === 0) {
    return { article: null, timing }
  }

  const paperWidth = resolvePaperWidth(viewport)
  const viewportHeight = Math.max(viewport.height, FUME_LAYOUT_VIEWPORT_MIN_HEIGHT_PX)
  const maxColumns = resolveMaxColumns(paperWidth)
  const targetHeight = viewportHeight * FUME_TARGET_HEIGHT_SCREENS
  const layoutSeedKey = layoutTheme.name
  timing.targetHeight = targetHeight

  const attemptContext = {
    lines,
    viewport,
    layoutTheme,
    lyricsFontScale,
    heroScale,
    measure,
    now
  }

  let bestScore = Number.POSITIVE_INFINITY
  let bestOptions: (FumeLayoutAttemptOptions & { mode: 'render' }) | null = null

  // 从最宽的列数开始试；纸张越宽，越有机会把纸面压到目标高度
  for (let columns = maxColumns; columns >= 1; columns -= 1) {
    const gap = resolveColumnGap(paperWidth, columns)
    const seedKey = `${layoutSeedKey}:${columns}:${paperWidth}`
    const columnTiming = createAttemptTiming()
    let low = FUME_DENSITY_SCALE_MIN
    let high = FUME_DENSITY_SCALE_MAX

    for (let iteration = 0; iteration < FUME_DENSITY_BISECTION_ITERATIONS; iteration += 1) {
      const densityScale = (low + high) / 2
      timing.attempts += 1

      // ⚠️ `yield*` 而不是直接调用：把内层「每排完一块」的让出点**透传**出去。
      // 若在这里直接跑同步版，一次尝试（约 30ms）就成了一片的最小粒度，
      // 拖窗口时仍会有可感的顿挫。
      const metrics = (yield* createArticleLayoutAttempt(attemptContext, {
        paperWidth,
        viewportHeight,
        columns,
        gap,
        densityScale,
        seedKey,
        mode: 'measure',
        timing: columnTiming
      })) as FumeArticleLayoutMetrics | null
      if (!metrics) continue

      const score = resolveLayoutScore(metrics.height, targetHeight)
      if (score < bestScore) {
        bestScore = score
        timing.bestHeight = metrics.height
        bestOptions = {
          paperWidth,
          viewportHeight,
          columns,
          gap,
          densityScale,
          seedKey,
          mode: 'render',
          timing: timing.render
        }
        timing.bestColumns = columns
        timing.bestDensityScale = densityScale
      }

      // 纸面偏矮 → 加密（字变小、行变多）；偏高 → 减密
      if (metrics.height < targetHeight) low = densityScale
      else high = densityScale
    }

    accumulateTiming(timing.measure, columnTiming)
  }

  // 最后那次 render 是**全量构建**（建 renderLines / blocks），代价与一次 measure
  // 同级，所以它前面也留一个让出点，免得它和上一片拼成一段双倍长的阻塞
  yield
  const article = bestOptions
    ? ((yield* createArticleLayoutAttempt(attemptContext, bestOptions)) as FumeArticleLayout | null)
    : null
  timing.finalHeight = article?.height ?? 0

  return { article, timing }
}
