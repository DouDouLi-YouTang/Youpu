/**
 * 相机（移植规格书 §9.1–§9.6 + §9.8）：焦点、重定位时长、总览、桥接路径、背景视差。
 *
 * 「浮名的灵魂」在这里：它决定了你看到的是一篇**被读着的**文章，而不是一堆堆上去的字。
 * 本文件全是纯函数（不 mutate 任何状态），逐帧积分在 `camera-step.ts`。
 *
 * ## 单位
 *
 * 上游是**秒**，本项目是**毫秒**。规格书 §9 里带时间的常量（0.09 / 0.18 / 0.3 秒等）
 * 全部乘 1000 变成具名常量，函数体内不再出现秒制时间。
 * 距离与缩放是无量纲的，保持原值。
 *
 * ## 三种「看哪里」
 *
 * | 情形 | 目标 | 见 |
 * | --- | --- | --- |
 * | 有焦点块 | 块内的打印光标（可整数可浮点） | §9.2 |
 * | 没有焦点块 | 整页中心 + scale 1.18 | §9.7 步骤 1 |
 * | 总览 | 所有块的包围盒 + 内边距 | §9.4 |
 *
 * ## 跳线（direct）与桥接（overview）是两个不同的东西
 *
 * - **direct**：位移 ≥ 0.42 屏但没有总览可用时，走一条 `easeInOutCubic` 的直线；
 * - **overview**：位移 ≥ 2.75 屏且目标是区块时，先拉远到总览附近、滑过去、再推近
 *   （二次贝塞尔 + `easeOutCubic`）。
 *
 * 两者都靠 `retarget.bridgeWaypoint*` 承载路径点，缓动曲线不同，见 `camera-step.ts` 步骤 4。
 *
 * ## 为什么两种焦点函数要接收注入了测量层
 *
 * 焦点位置依赖**字素宽度**（`widthBetweenOffsets` / `resolveGlyphAdvance`），而那两个函数
 * 读的是 pretext 的 `prepared` 对象 —— 属于 §4 的测量层，与「准备文本」绑在一起。
 * 本层的定位是「可单测的纯算法」，不能 import 测量层（§15.1 的边界 1），
 * 所以把这两个度量以参数注入（`FumeBlockMeasure`）：F1 的单测传假函数，
 * F2 落地后由 `measure/text-measure.ts` 提供真实现。这样相机的全部几何逻辑
 * 都能在 node 环境里断言，且签名仍然只多一个参数。
 *
 * ## 设计口径提醒
 *
 * 世界坐标里 `block.x/y` 是**左上角**，而背景形状的 `x/y` 是**中心**（§12.1）。
 * 本文件所有返回值（焦点、总览中心）都是「注视点」语义，与 `block` 的角点口径不同 ——
 * 混用会让镜头偏半个区块。
 */

import { getLineRenderHints, getLineTransitionTimingMs } from '../../shared/render-hints'
import { clamp, easeInOutCubic, mix } from './fume-math'
import { resolvePrintedGraphemeCount } from './fume-reveal'
import type {
  FumeArticleLayout,
  FumeBackgroundScene,
  FumeBlock,
  FumeCameraTarget,
  FumeCameraViewTarget,
  FumeLine,
  FumeRenderLineSlice,
  FumeViewportSize
} from './fume-types'

/** 相机缩放下限：再小就看不清纸上的字 */
export const CAMERA_SCALE_MIN = 0.22

/** 相机缩放上限：再大就只剩一个字 */
export const CAMERA_SCALE_MAX = 2.24

/** `retarget.sourceLineIndex` 的哨兵：总览镜头。（`-1` 是「无目标」，不是同一个值） */
export const OVERVIEW_CAMERA_SOURCE = -2

/**
 * 长距离桥接的触发阈值：**屏幕上的距离达到 2.75 屏**才允许拉远绕行。
 *
 * 用「屏」而不是世界单位，是因为动画强度的观感与视口大小相关：
 * 视口越大，同样的世界距离不该触发更激进的运镜。
 */
export const FUME_CAMERA_TELEPORT_TRIGGER_SCREENS = 2.75

/** 跨行混合窗口（字素单位）：换行前后各 0.7 个字内让镜头平滑过渡 */
const CROSS_LINE_BLEND_WINDOW = 0.7

/** 总览镜头的缩放上限：不真的缩到「整页全见」，留一点余量让字看得出形状 */
const OVERVIEW_SCALE_MAX = 0.72

/** 拿不到 renderHints 时的重定位时长兜底（上游 0.09 秒 → 毫秒） */
const DEFAULT_RETARGET_DURATION_MS = 90

/**
 * 焦点计算需要的字素度量（由测量层注入，见文件头）。
 *
 * 两个方法的语义与 §4.4 / §4.5 逐字对应，参数里都带 `block` 是为了让实现方能
 * 直接取到 `prepared` / `segmentMetas` / `renderLines`，不必在注入点再包一层闭包。
 */
export interface FumeBlockMeasure {
  /** §4.4：`widthBetweenOffsets(prepared, segmentMetas, startOffset, endOffset)` */
  widthBetweenOffsets(block: FumeBlock, startOffset: number, endOffset: number): number
  /** §4.5：`resolveGlyphAdvance(renderLine, graphemeIndex)` */
  resolveGlyphAdvance(block: FumeBlock, renderLineIndex: number, graphemeIndex: number): number
}

/** 一个世界坐标注视点 */
export interface FumeFocusPoint {
  x: number
  y: number
}

/** 空的渲染行列表时回落到区块中心（两种焦点函数共用） */
function resolveBlockCenter(block: FumeBlock): FumeFocusPoint {
  return { x: block.x + block.width * 0.5, y: block.y + block.height * 0.5 }
}

/** 找出 `offset` 落在哪一条渲染行上；越界时给最后一行 */
function findRenderLineIndex(renderLines: readonly FumeRenderLineSlice[], offset: number): number {
  const exactIndex = renderLines.findIndex((renderLine) => offset <= renderLine.end)
  return exactIndex >= 0 ? exactIndex : renderLines.length - 1
}

/**
 * 区块进场的焦点：**第一渲染行的左端中点**（§9.2 的 `resolveBlockEntryFocusPoint`）。
 *
 * 重定位刚开始时，相机先偏到这里（还没打印的第一个字），再滑向真正的打印光标
 * （`camera-step.ts` 的 `entryFocusBias`）。这制造了「刚进入这一块时先看到行首」的节奏 ——
 * 直接瞄准光标会让镜头一进场就落在块中间。
 */
export function resolveBlockEntryFocusPoint(block: FumeBlock): FumeFocusPoint {
  const firstRenderLine = block.renderLines[0]
  if (!firstRenderLine) return resolveBlockCenter(block)

  return {
    x: block.x + firstRenderLine.left,
    y: block.y + firstRenderLine.top + block.lineHeight * 0.5
  }
}

/**
 * 整数光标焦点（§9.2 的 `resolveSteppedBlockFocusPoint`）—— 给 `'stepped'` 跟随模式。
 *
 * 相机瞄准「第 N 个字」的字素边界：字与字之间镜头静止，推进时跳到下一个字的起点。
 * 注意 `x` 要**再钳一次**到 `[minX, maxX]`：`widthBetweenOffsets` 在字体回退时
 * 可能给出略超出行宽的值，不钳会让镜头越过行尾半格。
 */
export function resolveSteppedBlockFocusPoint(
  block: FumeBlock,
  printedCount: number,
  measure: FumeBlockMeasure
): FumeFocusPoint {
  if (block.renderLines.length === 0) return resolveBlockCenter(block)

  const effectiveOffset = clamp(printedCount, 0, block.graphemes.length)
  const targetLineIndex = findRenderLineIndex(block.renderLines, effectiveOffset)
  const targetLine = block.renderLines[targetLineIndex]
  const localOffset = clamp(effectiveOffset, targetLine.start, targetLine.end)
  const progressWidth = measure.widthBetweenOffsets(block, targetLine.start, localOffset)
  const minX = block.x + targetLine.left
  const maxX = minX + targetLine.width

  return {
    x: clamp(minX + progressWidth, minX, maxX),
    y: block.y + targetLine.top + block.lineHeight * 0.5
  }
}

/**
 * 浮点光标焦点（§9.2 的 `resolveSmoothBlockFocusPoint`）—— 给 `'smooth'` 跟随模式。
 *
 * 与整数版的差别不止「不取整」：这里还有**跨行混合**。换行是文本的硬边界，
 * 但镜头不该跟着跳：
 * - 在本行、距行尾不到 0.7 个字 → 按 `easeInOutCubic` 混向下一行的**起点**；
 * - 刚折到新行、距行首不到 0.7 个字 → 混回上一行的**末尾**。
 *
 * 两个方向都要处理：只做「提前看下一行」，折行瞬间仍会跳，因为 `findRenderLineIndex`
 * 在那一刻已经把目标行切过去了。
 */
export function resolveSmoothBlockFocusPoint(
  block: FumeBlock,
  printedProgress: number,
  measure: FumeBlockMeasure
): FumeFocusPoint {
  if (block.renderLines.length === 0) return resolveBlockCenter(block)

  const effectiveOffset = clamp(printedProgress, 0, block.graphemes.length)

  const resolvePointOnRenderLine = (lineIndex: number, offset: number): FumeFocusPoint => {
    const targetLine =
      block.renderLines[lineIndex] ?? block.renderLines[block.renderLines.length - 1]
    const clampedOffset = clamp(offset, targetLine.start, targetLine.end)
    const baseOffset = Math.floor(clampedOffset)
    const fractionalOffset = clampedOffset - baseOffset
    const baseWidth = measure.widthBetweenOffsets(block, targetLine.start, baseOffset)
    const localGlyphIndex = baseOffset - targetLine.start
    const glyphAdvance =
      localGlyphIndex >= 0 && localGlyphIndex < targetLine.graphemes.length
        ? measure.resolveGlyphAdvance(block, lineIndex, localGlyphIndex)
        : 0
    const minX = block.x + targetLine.left
    const maxX = minX + targetLine.width

    return {
      x: clamp(minX + baseWidth + glyphAdvance * fractionalOffset, minX, maxX),
      y: block.y + targetLine.top + block.lineHeight * 0.5
    }
  }

  const targetLineIndex = findRenderLineIndex(block.renderLines, effectiveOffset)
  let point = resolvePointOnRenderLine(targetLineIndex, effectiveOffset)
  const currentLine = block.renderLines[targetLineIndex]

  if (targetLineIndex > 0 && effectiveOffset < currentLine.start + CROSS_LINE_BLEND_WINDOW) {
    const previousLine = block.renderLines[targetLineIndex - 1]
    const blend = easeInOutCubic(
      clamp(1 - (effectiveOffset - previousLine.end) / CROSS_LINE_BLEND_WINDOW, 0, 1)
    )
    const previousPoint = resolvePointOnRenderLine(targetLineIndex - 1, previousLine.end)
    point = {
      x: mix(point.x, previousPoint.x, blend),
      y: mix(point.y, previousPoint.y, blend)
    }
  } else if (
    targetLineIndex < block.renderLines.length - 1 &&
    effectiveOffset > currentLine.end - CROSS_LINE_BLEND_WINDOW
  ) {
    const nextLine = block.renderLines[targetLineIndex + 1]
    const blend = easeInOutCubic(
      clamp(
        (effectiveOffset - (currentLine.end - CROSS_LINE_BLEND_WINDOW)) / CROSS_LINE_BLEND_WINDOW,
        0,
        1
      )
    )
    const nextPoint = resolvePointOnRenderLine(targetLineIndex + 1, nextLine.start)
    point = {
      x: mix(point.x, nextPoint.x, blend),
      y: mix(point.y, nextPoint.y, blend)
    }
  }

  return point
}

/**
 * 某个区块该用多大的缩放（§9.3）。
 *
 * 逻辑是「让行高在屏幕上大约占短边的 11.5%，钳在 64..124px，再折算成缩放」：
 * 于是无论视口多大、块的 `lineHeight` 多小，**屏幕上的字高看起来都差不多**。
 * 外层 0.88..2.2 是安全网：`lineHeight` 异常小（空块）时不至于缩放到离谱。
 */
export function resolveCameraScaleForBlock(
  block: Pick<FumeBlock, 'lineHeight'>,
  viewport: FumeViewportSize
): number {
  const minViewportSide = Math.max(Math.min(viewport.width, viewport.height), 1)
  const targetLineHeight = clamp(minViewportSide * 0.115, 64, 124)
  return clamp(targetLineHeight / Math.max(block.lineHeight, 1), 0.88, 2.2)
}

/**
 * 一次「按行重定位」该飞多久（§9.3）。
 *
 * 三种过场档各一条公式，结果全部 ≤ 130ms —— **逐行推进的镜头几乎是瞬切 + 弹性收敛**，
 * 只有长距离移动（≥ 2.75 屏）才走 §9.6 的桥接绕行。
 *
 * 为什么 `none` 档还要按 `rawDuration` 缩放：极短行一个接一个时，固定 40ms 的镜头
 * 会让画面一直在动。跟着行的真实长度走，短行之间的镜头移动更轻。
 */
export function resolveCameraRetargetDurationMs(line: FumeLine): number {
  const hints = getLineRenderHints(line)
  if (!hints) return DEFAULT_RETARGET_DURATION_MS

  const transitionTiming = getLineTransitionTimingMs(
    hints.rawDurationMs,
    hints.lineTransitionMode,
    hints.wordRevealMode
  )

  if (hints.lineTransitionMode === 'none') {
    return clamp(Math.max(hints.rawDurationMs, 80) * 0.34, 40, 75)
  }

  if (hints.lineTransitionMode === 'fast') {
    return clamp(
      transitionTiming.enterDurationMs * 0.5 + transitionTiming.exitDurationMs * 0.12,
      55,
      95
    )
  }

  return clamp(
    transitionTiming.enterDurationMs * 0.44 + transitionTiming.linePassHoldMs * 0.22,
    75,
    130
  )
}

/**
 * 总览镜头的重定位时长（§9.3）：按短边缩放，钳在 380..580ms。
 *
 * 比逐行重定位慢一个数量级：总览是一次「拉远看全篇」的运镜，要让人看清过程。
 */
export function resolveOverviewRetargetDurationMs(viewport: FumeViewportSize): number {
  return clamp(Math.min(viewport.width, viewport.height) / 1.5, 380, 580)
}

/**
 * 总览镜头（§9.4）：把所有区块的包围盒 + 20% 内边距装进视口。
 *
 * 上限 0.72 与「别真的缩到整页全见」有关 —— 略近一点，纸上的字还看得出形状。
 * 没有区块时退化成「装进整张纸」再乘 0.92。
 */
export function resolveArticleOverviewCamera(
  article: Pick<FumeArticleLayout, 'blocks' | 'width' | 'height'>,
  viewport: FumeViewportSize
): FumeCameraViewTarget {
  if (article.blocks.length === 0) {
    const fitScale = Math.min(
      viewport.width / Math.max(article.width, 1),
      viewport.height / Math.max(article.height, 1)
    )
    return {
      x: article.width * 0.5,
      y: article.height * 0.5,
      scale: clamp(fitScale * 0.92, CAMERA_SCALE_MIN, OVERVIEW_SCALE_MAX)
    }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const block of article.blocks) {
    minX = Math.min(minX, block.x)
    minY = Math.min(minY, block.y)
    maxX = Math.max(maxX, block.x + block.width)
    maxY = Math.max(maxY, block.y + block.height)
  }

  const paddingX = clamp(viewport.width * 0.2, 120, 280)
  const paddingY = clamp(viewport.height * 0.2, 96, 220)
  const framedWidth = Math.max(maxX - minX + paddingX * 2, 1)
  const framedHeight = Math.max(maxY - minY + paddingY * 2, 1)
  const fitScale = Math.min(viewport.width / framedWidth, viewport.height / framedHeight)

  return {
    x: (minX + maxX) * 0.5,
    y: (minY + maxY) * 0.5,
    scale: clamp(fitScale, CAMERA_SCALE_MIN, OVERVIEW_SCALE_MAX)
  }
}

/**
 * 相机现在该盯着哪一块（§9.5）。
 *
 * 三级降级缺一不可：
 * 1. **当前行有对应区块** → 直接给它（最常见也最准）；
 * 2. **已唱完全篇** → 给时间序最后一块（否则末行结束后镜头会飞回开头）；
 * 3. **从后往前找第一块「已经打印过至少一个字」** → 给它。
 *
 * 第 3 条是「间奏 / 插曲时镜头看哪里」的答案：`currentLineIndex` 为 -1（还没有行匹配）时，
 * 镜头应该停在**最近有内容的那一块**，而不是回退到第一块。
 *
 * 这个循环是 O(块数)，每帧一次；块数是歌词行数（几百），可以接受。
 * **不要**在循环里调用测量函数（`widthBetweenOffsets` 之类）——
 * 那会把每帧的 O(n) 变成 O(n × 字素数)（§17.3 第 9 条）。
 */
export function resolveFocusBlock(
  article: FumeArticleLayout,
  currentLineIndex: number,
  currentTimeMs: number
): FumeBlock | null {
  if (currentLineIndex >= 0) {
    const active = article.blockBySourceLineIndex.get(currentLineIndex)
    if (active) return active
  }

  const chronologicalLastBlock =
    article.chronologicalBlocks[article.chronologicalBlocks.length - 1] ?? null
  if (chronologicalLastBlock && currentTimeMs >= article.lastChronologicalRenderEndTimeMs) {
    return chronologicalLastBlock
  }

  for (let index = article.chronologicalBlocks.length - 1; index >= 0; index -= 1) {
    const block = article.chronologicalBlocks[index]
    const printedCount = resolvePrintedGraphemeCount(
      block.line,
      block.wordRanges,
      block.graphemes.length,
      currentTimeMs
    )
    if (printedCount > 0) return block
  }

  return article.chronologicalBlocks[0] ?? null
}

/** `resolveOverviewFlightBridge` 的入参（平铺而非嵌套，便于调用处直接展开状态） */
export interface FumeOverviewFlightBridgeInput {
  fromX: number
  fromY: number
  fromScale: number
  targetX: number
  targetY: number
  targetScale: number
  overviewCamera: FumeCameraViewTarget | null
  viewport: FumeViewportSize
}

/** 桥接路径点（`null` 由调用方处理，本函数只返回有值或 `null`） */
export interface FumeOverviewFlightBridge {
  waypointX: number
  waypointY: number
  waypointScale: number
  /** 路径点落在这次飞行的第几成处（0..1）：决定贝塞尔前 / 后段的相对时长 */
  waypointPhase: number
  /** 飞行时长（毫秒） */
  durationMs: number
}

/**
 * 长距离桥接路径（§9.6）：两个区块隔得太远（≥ 2.75 屏）时插一个**靠近总览镜头**的路径点。
 *
 * 直觉：直接插值等于「穿墙飞行」，会看到大量空白。于是路径点被拉向总览中心
 * （`waypointCenterBias` 随距离从 0.18 增到 0.42），同时把 `waypointScale` 压到接近总览的缩放 ——
 * 视觉上就是「拉远、快速滑过去、再推进去」。`loftStrength` 是这次「抬升」的强度。
 *
 * 三条硬规则：
 * 1. 没有总览镜头 → `null`（不知道往哪绕）；
 * 2. `worldDistance <= 0` → `null`（同一点不需要飞）；
 * 3. `waypointScale` 的上限是 `endpointScale * 0.92` —— 保证路径点**确实比两端更远**，
 *    否则「拉远」一步会因为浮点噪声退化成直线，弧线就没了。
 *
 * 返回 `null` 时调用方应该退回 `'direct'`（直线）或 `'none'`（弹簧），见 `camera-step.ts` 步骤 3。
 */
export function resolveOverviewFlightBridge(
  input: FumeOverviewFlightBridgeInput
): FumeOverviewFlightBridge | null {
  const { fromX, fromY, fromScale, targetX, targetY, targetScale, overviewCamera, viewport } = input
  if (!overviewCamera) return null

  const safeScale = Math.max(fromScale, targetScale, overviewCamera.scale, 0.001)
  const minViewportSide = Math.max(Math.min(viewport.width, viewport.height), 1)
  const worldDistance = Math.hypot(fromX - targetX, fromY - targetY)
  const screenDistance = worldDistance * safeScale

  if (
    worldDistance <= 0 ||
    screenDistance < minViewportSide * FUME_CAMERA_TELEPORT_TRIGGER_SCREENS
  ) {
    return null
  }

  const loftStrength = clamp(
    (screenDistance / minViewportSide - FUME_CAMERA_TELEPORT_TRIGGER_SCREENS) / 3.4,
    0,
    1
  )
  const midpointX = mix(fromX, targetX, 0.5)
  const midpointY = mix(fromY, targetY, 0.5)
  const waypointCenterBias = mix(0.18, 0.42, loftStrength)
  const waypointX = mix(midpointX, overviewCamera.x, waypointCenterBias)
  const waypointY = mix(midpointY, overviewCamera.y, waypointCenterBias)

  const endpointScale = Math.max(fromScale, targetScale, 0.001)
  const loftedScale = endpointScale * mix(0.62, 0.4, loftStrength)
  const overviewLimitedScale = overviewCamera.scale * mix(1.85, 1.55, loftStrength)
  const waypointScale = clamp(
    Math.max(loftedScale, overviewLimitedScale),
    CAMERA_SCALE_MIN,
    Math.max(endpointScale * 0.92, CAMERA_SCALE_MIN)
  )

  const distanceFromStart =
    Math.hypot(waypointX - fromX, waypointY - fromY) * Math.max(fromScale, waypointScale, 0.001)
  const distanceToTarget =
    Math.hypot(targetX - waypointX, targetY - waypointY) *
    Math.max(targetScale, waypointScale, 0.001)
  const totalLegDistance = distanceFromStart + distanceToTarget
  const waypointPhase =
    totalLegDistance <= 0 ? 0.36 : clamp(distanceFromStart / totalLegDistance, 0.26, 0.44)

  return {
    waypointX,
    waypointY,
    waypointScale,
    waypointPhase,
    durationMs: clamp(260 + (screenDistance / (minViewportSide * 5.5)) * 280, 300, 680)
  }
}

/** 背景视差的四个常数（§9.8）：背景比文字慢、略小、整体下移 */
export const FUME_BACKGROUND_PARALLAX_X = 0.9
export const FUME_BACKGROUND_PARALLAX_Y = 0.74
export const FUME_BACKGROUND_SCALE_FACTOR = 0.94
export const FUME_BACKGROUND_VERTICAL_OFFSET_RATIO = 0.22

/** 背景层「看向哪里」（§9.8 的返回值） */
export interface FumeBackgroundView {
  backgroundCenterX: number
  backgroundCenterY: number
  backgroundCameraX: number
  backgroundCameraY: number
  backgroundScale: number
}

/**
 * 背景视差视图（§9.8）。
 *
 * 三条差异合起来把背景钉在「更远的一层」上：
 * - x 只跟相机的 90%、y 只跟 74%（背景比纸慢，于是有深度）；
 * - 整体**下移**最多 180px 世界单位（`viewport.height * 0.22 / scale`）；
 * - 缩放略小（× 0.94）。
 *
 * 下移量按 `1 / scale` 折算，所以「屏幕上看是 22% 视口高」是恒定的 ——
 * 与呼吸浮动同理（见 `camera-step.ts` 步骤 2）。
 */
export function resolveFumeBackgroundView(
  backgroundScene: Pick<FumeBackgroundScene, 'width' | 'height'>,
  camera: FumeCameraTarget,
  viewport: FumeViewportSize
): FumeBackgroundView {
  const screenScale = camera.scale
  const backgroundCenterX = backgroundScene.width * 0.5
  const backgroundCenterY = backgroundScene.height * 0.5
  const backgroundVerticalOffset = clamp(
    (viewport.height * FUME_BACKGROUND_VERTICAL_OFFSET_RATIO) / Math.max(screenScale, 0.001),
    48,
    180
  )

  return {
    backgroundCenterX,
    backgroundCenterY,
    backgroundCameraX: mix(backgroundCenterX, camera.x, FUME_BACKGROUND_PARALLAX_X),
    backgroundCameraY:
      mix(backgroundCenterY, camera.y, FUME_BACKGROUND_PARALLAX_Y) - backgroundVerticalOffset,
    backgroundScale: clamp(
      screenScale * FUME_BACKGROUND_SCALE_FACTOR,
      CAMERA_SCALE_MIN,
      CAMERA_SCALE_MAX
    )
  }
}
