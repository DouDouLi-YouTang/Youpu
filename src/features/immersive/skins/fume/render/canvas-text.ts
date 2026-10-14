/**
 * 「浮名」Canvas 2D 文字绘制（移植规格书 §10.1–§10.3）—— 只含**静态**那一半。
 *
 * ## 本文件负责什么、不负责什么
 *
 * 负责：字体串与基线、静态区块快照（整块一张离屏 canvas）、以及把一行文字切成
 * 「裁剪运行」的几何与绘制。
 *
 * **不负责** `drawFumeLiveBlock`（§10.4 的逐字素实时绘制）—— 那一块与揭示进度、
 * 颜色拖尾、打印印章耦合，属于另一个提交。
 *
 * ## 分层：能用纯函数算的都先算出来
 *
 * 规格书 §15.1 要求能单测的部分不碰 canvas，而单测跑在 node（没有 canvas）。
 * 所以本文件刻意把每个几何量都拆成纯函数先算好：
 *
 * | 纯函数（可单测） | 薄层（碰 context，不单测） |
 * | --- | --- |
 * | {@link resolveSnapshotRasterScale} | |
 * | {@link resolveSnapshotPadding} | |
 * | {@link resolveSnapshotCanvasSize} | |
 * | {@link resolveTextRunClip} | `drawRenderTextRun` |
 * | | `createStaticBlockSnapshot` |
 *
 * 这样「裁剪矩形写错一位」「padding 少算辉光」这类**静默**错误都能在 node 里钉住，
 * 而剩下的薄层只是把算好的数字喂给 canvas API。
 *
 * ## 两处必须照抄、不要「优化」的写法（§10.3）
 *
 * 1. **纵向裁剪框随字宽增长**：`y = baseY - max(clipWidth, 1) - 64`、
 *    `height = max(128 + clipWidth * 2, 256)`。它不是为了「够高就行」——
 *    高度随 clipWidth 增长，从而在各种字号下都留出 ascent/descent 与辉光的余量。
 *    换成固定高度会在某些字号下把字顶或字底切掉。
 * 2. **`clipWidth <= 0` 直接返回**：零宽裁剪在部分 Chromium 版本上会让整个
 *    `fillText` 消失（而不是画不出东西），表现为「这一串字突然缺一段」。
 */

import type {
  FumeBlock,
  FumeRenderLineSlice,
  FumeRenderSegmentSlice,
  FumeStaticBlockSnapshot,
  FumeTheme
} from '../core/fume-types'
import { resolveFumeBaselineOffset } from '../core/block-frame'
import { resolveRenderLineOffset } from '../core/text-measure-pure'
import { buildFontSpec, resolveFumeFontFamily } from '../measure/text-measure'

// ─────────────────────────── §10.1 字体串与基线 ───────────────────────────

/**
 * 一个区块的 canvas 字体串（§10.1 的 `buildCanvasFont`）。
 *
 * 每次绘制前都要重设 `context.font`：同一个 context 上还跑着背景绘制与别的测量，
 * 任何一处改了字体都会串味，而 canvas 对「字体串非法」是**静默忽略**（保持上一个字体），
 * 于是错误表现为「某些块的字宽莫名其妙」，不会报错。
 *
 * 字体栈来自 §7.7 的 `resolveFumeFontFamily`（自定义族 → 内置衬线族 → 通用兜底），
 * 与排版测量用的是**同一个**来源 —— 这里若自己拼一份，快照的字形就会和布局算出来的
 * 列宽对不上。
 */
export function resolveFumeFontSpec(
  block: Pick<FumeBlock, 'fontPx' | 'variant'>,
  theme: FumeTheme
): string {
  return buildFontSpec(block.fontPx, block.variant, resolveFumeFontFamily(theme), theme)
}

/** canvas `textBaseline` 的取值（§10.1）：`middle` 让基线落在行中线上 */
export const FUME_TEXT_BASELINE = 'middle' as const

/** canvas `textAlign` 的取值（§10.1）：左对齐，横向位置全部由我们算 */
export const FUME_TEXT_ALIGN = 'left' as const

/** 基线相对行顶的下移量（与 §8.3 的时序共用一份实现，见 `core/block-frame.ts`） */
export const resolveBaselineOffset = resolveFumeBaselineOffset

// ─────────────────────────── §10.2 静态快照的几何 ───────────────────────────

/** DPR 上限：超过 2 的屏幕按 2 渲染（内存换不来可见收益，见 §10.2） */
export const FUME_SNAPSHOT_MAX_RASTER_SCALE = 2

/** 快照留白的下限：即使字号很小也要留出辉光的余量 */
export const FUME_SNAPSHOT_MIN_PADDING_PX = 4

/** 留白 = 字号 × 该系数（给字形外扩与辉光） */
export const FUME_SNAPSHOT_FONT_PADDING_RATIO = 0.32

/** 辉光半径在留白里的占比（`shadowBlur + fontPx × 0.08`） */
export const FUME_SNAPSHOT_SHADOW_PADDING_RATIO = 0.08

/**
 * 快照的栅格缩放（§10.2）：`clamp(dpr, 1, 2)`。
 *
 * 上限 2 是刻意的：一块正文快照在 4K 屏上按 3 倍栅格化的显存是 2 倍的 2.25 倍，
 * 而浮名的纸面上同时存在几十块快照 —— 省下的显存换来的清晰度提升肉眼不可见。
 * 下限 1 则防止 `devicePixelRatio = 0`（部分嵌入式环境）把画布算成 0.
 *
 * 非有限值（`NaN` / `Infinity`）退化成 **1**，而不是照 clamp 语义钳到上限：
 * `devicePixelRatio` 是环境给的外部输入，读到非法值时该按「没有高清屏」处理，
 * 省显存；钳到 2 会让一次测量异常变成整页快照的显存翻四倍。
 */
export function resolveSnapshotRasterScale(devicePixelRatio: number | null | undefined): number {
  const dpr =
    typeof devicePixelRatio === 'number' && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1
  return Math.max(1, Math.min(FUME_SNAPSHOT_MAX_RASTER_SCALE, dpr))
}

/**
 * 快照四周的留白（§10.2）：字号与辉光半径的**较大值**，再与 4px 下限取 max。
 *
 * 为什么辉光项是 `shadowBlur + fontPx * 0.08` 而不是只取 `shadowBlur`：
 * 阴影是**以字形轮廓为中心**向外扩散的，除了 blur 本身还有一点轮廓外的自然外扩，
 * 用字号的一个小比例近似它。少算这一项的表现是「亮字的边缘被快照边界切一刀」。
 */
export function resolveSnapshotPadding(fontPx: number, shadowBlur = 0): number {
  return Math.ceil(
    Math.max(
      fontPx * FUME_SNAPSHOT_FONT_PADDING_RATIO,
      shadowBlur + fontPx * FUME_SNAPSHOT_SHADOW_PADDING_RATIO,
      FUME_SNAPSHOT_MIN_PADDING_PX
    )
  )
}

/** 快照画布的像素尺寸（含留白、再乘栅格缩放，且至少 1px） */
export interface FumeSnapshotCanvasSize {
  width: number
  height: number
}

/**
 * 快照画布的像素尺寸（§10.2）。
 *
 * 尺寸用**向上取整**而不是四舍五入：少一个像素就会在块的右/下边缘切掉一条，
 * 那一条恰好是辉光最亮的地方。`max(..., 1)` 兜住「区块尺寸为 0」的退化输入
 * （空块不该出现在文章里，但快照层不该因此造出一个宽 0 的 canvas）。
 */
export function resolveSnapshotCanvasSize(
  blockWidth: number,
  blockHeight: number,
  padding: number,
  rasterScale: number
): FumeSnapshotCanvasSize {
  return {
    width: Math.max(1, Math.ceil((blockWidth + padding * 2) * rasterScale)),
    height: Math.max(1, Math.ceil((blockHeight + padding * 2) * rasterScale))
  }
}

// ─────────────────────────── §10.3 裁剪文本运行 ───────────────────────────

/**
 * 一次绘制的样式键（§10.3 的 `buildTextStyleKey`）。
 *
 * 用途是「相邻字素的样式一样就合并成一次绘制」。`shadowBlur` 取三位小数：
 * 逐字素算出来的 blur 是浮点，尾数抖动会让本该合并的 run 被拆开，
 * 而三位小数已经远超视觉可分辨的精度（§16 的 `quantizeShadowBlur` 更粗，
 * 那是另一层「整像素化」的优化，不能替代这里的量化）。
 */
export function buildTextStyleKey(
  fillStyle: string,
  shadowBlur: number,
  shadowColor: string
): string {
  return `${fillStyle}|${shadowColor}|${shadowBlur.toFixed(3)}`
}

/**
 * 一个裁剪运行的矩形（相对**世界坐标**，调用方直接 `rect()`）。
 *
 * `width <= 0` 表示这次运行什么都不画 —— 调用方必须据此跳过 `fillText`，
 * 因为零宽裁剪在部分 Chromium 版本上会让整段文字消失（见文件头）。
 */
export interface FumeTextRunClip {
  x: number
  y: number
  width: number
  height: number
}

/** 纵向裁剪框的横向附加量：高度 = `128 + clipWidth * 2`（见文件头第 1 条） */
const RUN_CLIP_WIDTH_GROWTH = 2
/** 纵向裁剪框的固定高度基数 */
const RUN_CLIP_BASE_HEIGHT = 128
/** 纵向裁剪框的高度下限 */
const RUN_CLIP_MIN_HEIGHT = 256
/** 纵向裁剪框向上溢出的余量 */
const RUN_CLIP_UPWARD_MARGIN = 64

/**
 * 把「行内的一段字素区间」算成裁剪矩形（§10.3）。
 *
 * ## 下标为什么这么绕
 *
 * 三个坐标系同时出现在这一小段里，差一位的表现是「打印到一半的字被切掉半个」：
 *
 * | 名字 | 参照物 |
 * | --- | --- |
 * | `runStart` / `runEnd` | **行内**字素下标（调用方按行遍历） |
 * | `segment.localStart` | 同上，但由片段记录 |
 * | `measuredGlyphOffsets[i]` | 片段内第 i 个字素的**实测**左边界 |
 *
 * 于是片段内下标 = `行内下标 - segment.localStart`，两端都要钳到
 * `[0, measuredGlyphOffsets.length - 1]`（表的最后一项是整段右边界，所以最大合法下标
 * 就是 `length - 1`）。
 *
 * ## 两条兜底路径
 *
 * `measuredGlyphOffsets` 理论上总是够长（长度 = 字素数 + 1），但它是**实测**数据，
 * 来自可能失败的 canvas 测量（无 DOM 时全是 0，见 §4.7）。越界时退回 pretext 口径的
 * `resolveRenderLineOffset`，而不是返回 0 —— 返回 0 会让裁剪框突然缩到片段开头，
 * 表现是「这一段字整段消失」。
 */
export function resolveTextRunClip(
  renderLine: Pick<FumeRenderLineSlice, 'glyphOffsets' | 'graphemes' | 'width'>,
  segment: Pick<FumeRenderSegmentSlice, 'localStart' | 'x' | 'measuredGlyphOffsets'>,
  runStart: number,
  runEnd: number,
  baseX: number,
  baseY: number
): FumeTextRunClip {
  const segmentRunStart = Math.max(runStart - segment.localStart, 0)
  const segmentRunEnd = Math.min(
    runEnd - segment.localStart,
    segment.measuredGlyphOffsets.length - 1
  )

  const clipLeft =
    segment.measuredGlyphOffsets[segmentRunStart] ??
    resolveRenderLineOffset(renderLine, runStart) - segment.x
  const clipRight =
    segment.measuredGlyphOffsets[segmentRunEnd] ??
    resolveRenderLineOffset(renderLine, runEnd) - segment.x

  const clipWidth = Math.max(clipRight - clipLeft, 0)

  return {
    x: baseX + segment.x + clipLeft,
    y: baseY - Math.max(clipWidth, 1) - RUN_CLIP_UPWARD_MARGIN,
    width: clipWidth,
    height: Math.max(RUN_CLIP_BASE_HEIGHT + clipWidth * RUN_CLIP_WIDTH_GROWTH, RUN_CLIP_MIN_HEIGHT)
  }
}

/**
 * 画一段裁剪运行（§10.3 的 `drawRenderTextRun`）。
 *
 * 这是「薄层」：几何全在 {@link resolveTextRunClip} 里算好了，这里只做
 * `save → rect → clip → fillText → restore`。`save/restore` 是必需的 ——
 * 裁剪区是 context 状态的一部分，不复原会把后面所有绘制一起裁掉。
 *
 * `context.fillStyle` / 辉光由调用方设好：一次 run 只画一种样式（这正是 run 的定义）。
 */
export function drawRenderTextRun(
  context: CanvasRenderingContext2D,
  renderLine: Pick<FumeRenderLineSlice, 'glyphOffsets' | 'graphemes' | 'width'>,
  segment: Pick<FumeRenderSegmentSlice, 'text' | 'localStart' | 'x' | 'measuredGlyphOffsets'>,
  runStart: number,
  runEnd: number,
  baseX: number,
  baseY: number
): void {
  if (!segment.text || runEnd <= runStart) return

  const clip = resolveTextRunClip(renderLine, segment, runStart, runEnd, baseX, baseY)
  if (clip.width <= 0) return

  context.save()
  context.beginPath()
  context.rect(clip.x, clip.y, clip.width, clip.height)
  context.clip()
  context.fillText(segment.text, baseX + segment.x, baseY)
  context.restore()
}

// ───────────────────── §10.2 快照的绘制计划（纯）与薄层 ─────────────────────

/** 快照里一条要 `fillText` 的字：位置相对**快照画布**（已含留白、未含栅格缩放） */
export interface FumeSnapshotLinePlan {
  text: string
  x: number
  y: number
}

/**
 * 一张静态快照的完整绘制计划（§10.2）。
 *
 * 把「画什么、画在哪」与「怎么驱动 canvas」分开，是本文件能被单测的关键：
 * 计划里已经含了字体串、留白、画布像素尺寸、基线与每行的落点，
 * 于是 `fillText` 的坐标对不对、留白够不够，都能在 node 里直接断言。
 */
export interface FumeSnapshotPlan {
  /** canvas 字体串（已含字重 / 字号 / 字体栈） */
  fontSpec: string
  /** 四周留白（世界 px） */
  padding: number
  /** 画布像素宽（已乘栅格缩放） */
  canvasWidth: number
  /** 画布像素高（已乘栅格缩放） */
  canvasHeight: number
  /** 栅格缩放（写进 `setTransform`） */
  rasterScale: number
  /** 基线相对行顶的下移量 */
  baselineOffset: number
  /** 每条视觉行的绘制位置（按 `renderLines` 顺序） */
  lines: FumeSnapshotLinePlan[]
}

/**
 * 算出快照的绘制计划（§10.2 的纯部分）。
 *
 * 三件事必须一起看，因为它们是同一个坐标系：
 * 1. 画布是「块尺寸 + 两侧留白」再乘栅格缩放；
 * 2. `setTransform(rasterScale, ...)` 之后，画布上的绘图坐标是**世界 px**，
 *    所以每次 `fillText` 都要整体偏移 `padding`；
 * 3. 基线是「行顶 + `baselineOffset`」，与 §8.3 的实时绘制共用一份实现。
 *
 * `lines[].x` 用 `renderLine.left + padding` 而不是只加 padding：hero 的行有
 * 0.08 的右移缩进（§7.6），忽略它会让快照里的标题与实时绘制的位置差一截 ——
 * 而快照与实时绘制会在「正在打印 → 刚唱过」的那一刻交接，错位会直接跳出来。
 */
export function resolveStaticSnapshotPlan(
  block: Pick<
    FumeBlock,
    'fontPx' | 'variant' | 'width' | 'height' | 'lineHeight' | 'line' | 'renderLines'
  >,
  theme: FumeTheme,
  shadowBlur: number,
  rasterScale: number
): FumeSnapshotPlan {
  const padding = resolveSnapshotPadding(block.fontPx, shadowBlur)
  const size = resolveSnapshotCanvasSize(block.width, block.height, padding, rasterScale)
  const baselineOffset = resolveBaselineOffset(block.lineHeight, block.line.fullText)

  return {
    fontSpec: resolveFumeFontSpec(block, theme),
    padding,
    canvasWidth: size.width,
    canvasHeight: size.height,
    rasterScale,
    baselineOffset,
    lines: block.renderLines.map((renderLine) => ({
      text: renderLine.text,
      x: renderLine.left + padding,
      y: renderLine.top + baselineOffset + padding
    }))
  }
}

/** `createStaticBlockSnapshot` 的入参（打包成对象，避免五个位置参数） */
export interface FumeStaticSnapshotInput {
  block: Pick<
    FumeBlock,
    'fontPx' | 'variant' | 'width' | 'height' | 'lineHeight' | 'line' | 'renderLines'
  >
  theme: FumeTheme
  /** 字色（已含 alpha，由 §8.4 的 `resolveFumeStaticLayers` 算好） */
  fillStyle: string
  /** 辉光半径；0 = 不发光（waiting 态） */
  shadowBlur?: number
  /** 辉光颜色；缺省透明 */
  shadowColor?: string
  /** 覆盖栅格缩放（缺省取 `window.devicePixelRatio`；单测 / 截图场景可显式传入） */
  rasterScale?: number
}

/**
 * 建一张静态区块快照（§10.2）—— 整块一张离屏 canvas。
 *
 * ## 为什么是「整块一张」而不是「一行一张」
 *
 * 快照的用途是让 `passed` / `waiting` 的块在每帧只花一次 `drawImage`（§11.3）。
 * 如果按行拆开，一个 40 行的块每帧要 40 次 `drawImage`，块数一多就退化回
 * 「每帧重画整页」。整块一张还能让辉光在**行与行之间**自然叠加
 * （分开画会在每行边缘出现横向接缝）。
 *
 * ## 返回 `null` 的两种情形
 *
 * - 没有 `document`（node / 无 DOM 环境）；
 * - 拿不到 2d context（极端内存压力下浏览器会返回 null）。
 *
 * 两种情形都由调用方回落到实时绘制（§11.3 的 `if (layers)` 分支），
 * 所以这里**不抛错**：快照是性能优化，不是必须成功的路径。
 *
 * ## 三条必须按顺序做的事
 *
 * 1. **先设 `canvas.width/height` 再 `setTransform`**：改尺寸会重置 context 状态
 *    （包括变换矩阵），顺序反了变换会丢；
 * 2. 每次都重设 `font` / `textAlign` / `textBaseline`：context 是复用的，
 *    上游（背景绘制、片段测量）可能改过它们；
 * 3. **结束时把 `shadowBlur` 归零、`shadowColor` 置透明**：否则下一个使用者
 *    会继承辉光设置，表现是「页面上突然多出一圈莫名其妙的发光」。
 */
export function createStaticBlockSnapshot(
  input: FumeStaticSnapshotInput
): FumeStaticBlockSnapshot | null {
  if (typeof document === 'undefined') return null

  const { block, theme, fillStyle, shadowBlur = 0, shadowColor = 'transparent' } = input
  const rasterScale =
    input.rasterScale ??
    resolveSnapshotRasterScale(typeof window === 'undefined' ? undefined : window.devicePixelRatio)
  const plan = resolveStaticSnapshotPlan(block, theme, shadowBlur, rasterScale)

  const canvas = document.createElement('canvas')
  canvas.width = plan.canvasWidth
  canvas.height = plan.canvasHeight

  const context = canvas.getContext('2d')
  if (!context) return null

  context.setTransform(plan.rasterScale, 0, 0, plan.rasterScale, 0, 0)
  context.font = plan.fontSpec
  context.textAlign = FUME_TEXT_ALIGN
  context.textBaseline = FUME_TEXT_BASELINE
  context.fillStyle = fillStyle
  context.shadowBlur = shadowBlur
  context.shadowColor = shadowColor

  for (const line of plan.lines) {
    context.fillText(line.text, line.x, line.y)
  }

  context.shadowBlur = 0
  context.shadowColor = 'transparent'

  return { canvas, padding: plan.padding }
}
