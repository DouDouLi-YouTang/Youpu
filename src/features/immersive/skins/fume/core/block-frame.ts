/**
 * 区块逐帧判定（移植规格书 §8）：在屏、时序、静态层（快照）清单。
 *
 * 本层回答三个问题，全部与渲染 API 无关（`getSnapshot` 是**注入**的回调）：
 * 1. 这个区块现在该不该画？（§8.2 在屏判定，先于任何昂贵计算）
 * 2. 它现在是「还没轮到 / 正在打印 / 已经唱过」哪一态，参数各是多少？（§8.3）
 * 3. 若要画静态快照，画哪几层、各自 alpha 多少？（§8.4）
 *
 * ## 单位
 *
 * 上游是**秒**，本项目是**毫秒**。规格书 §8 里带单位的三个常量
 * （`lineDuration` 的 0.18 秒地板、`colorTrailDuration` 的 0.45 / 1.45 秒钳制、
 * overscan 的 180px）都写进具名常量或参数默认值，函数体内不再出现秒制数字。
 * `overscan` 是**屏幕像素**，与时间无关，保持原值。
 *
 * ## 为什么静态快照要「双快照 alpha 叠加」（§8.4 的两条设计）
 *
 * `dimmed` 是一个**连续变化**的量（§6.2 的渐隐进度）。若每个 alpha 档都重建一张快照，
 * 长歌每一帧都要重画上百个区块的文字 —— 浮名的性能会直接崩掉。
 * 所以只做两张快照（standard / dimmed），用 `globalAlpha` 交叉淡化：
 * 连续变化的量用 alpha 表达，快照本身保持离散、可缓存。
 *
 * 顺带解决了「总览时要重新变清楚」：`dimAmount = baseDim * (1 - overviewTextRestoreProgress)`，
 * 拉远看整页时 `overviewTextRestoreProgress → 1`，于是 dimAmount → 0，
 * 纸痕自动淡回 standard，不需要第三张快照。
 */

import { colorWithAlpha } from '../../shared/color-mix'
import { getLineRenderEndTimeMs } from '../../shared/render-hints'
import { isCjk } from './fume-math'
import { resolveLinePassCutoffTime } from './fume-reveal'
import {
  resolvePassedDimAmount,
  resolvePassedTextStyle,
  type FumePassedTextStyle,
  type FumeTextHoldStyle
} from './text-style'
import type {
  FumeBlock,
  FumeBlockVariant,
  FumeCameraTarget,
  FumeTheme,
  FumeViewportSize
} from './fume-types'

/** 静态判定的在屏余量（屏幕 px）：区块刚出屏一点就先别画，回屏时也不用重算 */
export const FUME_BLOCK_OVERSCAN_PX = 180

/** 行时长下限（上游 0.18 秒 → 毫秒）：极短行的拖尾也要按至少 180ms 算 */
export const MIN_BLOCK_LINE_DURATION_MS = 180

/** 颜色拖尾时长的下限 / 上限（上游 0.45 / 1.45 秒 → 毫秒） */
export const MIN_COLOR_TRAIL_DURATION_MS = 450
export const MAX_COLOR_TRAIL_DURATION_MS = 1450

/** 区块的静态态：`null` = 必须逐字素实时绘制 */
export type FumeBlockStaticState = 'waiting' | 'passed' | null

/** 区块当前时刻的全部派生量（§8.3 的返回值） */
export interface FumeBlockTiming {
  /** 还没轮到时的字色 alpha（hero 更亮：标题即使没唱也看得出「这里有个标题」） */
  waitingOpacity: number
  /** 正在打印时的字色 alpha */
  activeOpacity: number
  effectiveTextHoldStyle: FumeTextHoldStyle
  passedStyle: FumePassedTextStyle
  /** 总览时用来恢复清晰的那份「标准样式」（恒为 standard 档） */
  transitionPassedStyle: FumePassedTextStyle
  /** 基线相对行顶的下移量（CJK 0.52 / 其它 0.5，见 §10.1） */
  baselineOffset: number
  /** 行渲染结束时间（= `getLineRenderEndTime`） */
  lineEndTimeMs: number
  /** 「唱过」判定窗口的截止（再与下一行起点取 min） */
  linePassCutoffTimeMs: number
  /** 揭示是否已完成 —— 判据是 `line.endTime`（**不是** renderEndTime） */
  hasRevealCompleted: boolean
  /** 「唱过」判定是否已完成 —— 判据是 `linePassCutoffTime` */
  hasPassCutoffReached: boolean
  /** 参与拖尾计算的时长（已过 180ms 地板） */
  lineDurationMs: number
  /** 颜色拖尾总时长（已钳到 450..1450ms） */
  colorTrailDurationMs: number
  staticState: FumeBlockStaticState
}

/** 一张静态快照的描述（渲染层按 key 缓存；`fill` / 阴影都是算好的字符串） */
export interface FumeSnapshotSpec {
  key: string
  fill: string
  shadowBlur: number
  shadowColor: string
}

/** 静态层判定的逐帧输入 */
export interface FumeStaticLayerInput {
  timeMs: number
  theme: FumeTheme
  passedGlowBase: number
  passedFadeDurationMs: number
  overviewTextRestoreProgress: number
  /** 快照栅格缩放（= `clamp(dpr, 1, 2)`），参与缓存键 */
  snapshotScale: number
}

/** 要画的一层：快照对象 + alpha（由渲染层 `globalAlpha` 承载） */
export interface FumeStaticLayer<T> {
  snapshot: T
  alpha: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * 辉光基量（§8.1）。
 *
 * 两个基量各自对应「正在唱」与「唱过」：`chaotic` 让亮点更亮、余辉更久，
 * `calm` 反过来。注意它们**不是**乘同一个系数 —— chaotic 的余辉（0.95）几乎是
 * normal（0.62）的 1.5 倍，而活跃辉光只高 25%。这个不对称是上游刻意的：
 * 强度档主要改变「纸上留下多少光」，而不是「当前这个字有多亮」。
 */
export function resolveFumeGlowBases(
  animationIntensity: FumeTheme['animationIntensity'],
  glowIntensity: number
): { activeGlowBoost: number; passedGlowBase: number } {
  return {
    activeGlowBoost:
      (animationIntensity === 'chaotic' ? 1.15 : animationIntensity === 'calm' ? 0.72 : 0.92) *
      glowIntensity,
    passedGlowBase:
      (animationIntensity === 'chaotic' ? 0.95 : animationIntensity === 'calm' ? 0.35 : 0.62) *
      glowIntensity
  }
}

/**
 * 世界 → 屏幕的 x 变换（§8.2 与 §11.3 的 canvas 变换等价）。
 *
 * 抽成共享函数不是为了复用几行乘法，而是为了防止两处各写一份后**悄悄分叉**：
 * 一旦分叉，就会出现「相机认为区块在屏内、canvas 却把它画到屏外」的空白帧。
 * 调用方：`isFumeBlockOnScreen`、stage 的实时裁剪框（F5）、调试覆盖层。
 */
export function worldToScreenX(
  worldX: number,
  camera: Pick<FumeCameraTarget, 'x'>,
  viewport: Pick<FumeViewportSize, 'width'>,
  scale: number
): number {
  return viewport.width * 0.5 + (worldX - camera.x) * scale
}

/** 世界 → 屏幕的 y 变换（见 {@link worldToScreenX} 的说明） */
export function worldToScreenY(
  worldY: number,
  camera: Pick<FumeCameraTarget, 'y'>,
  viewport: Pick<FumeViewportSize, 'height'>,
  scale: number
): number {
  return viewport.height * 0.5 + (worldY - camera.y) * scale
}

/**
 * 区块是否落在「视口 + overscan」的矩形内（§8.2）。
 *
 * 用**世界矩形 → 屏幕矩形**的相交判定，而不是「区块中心在屏内」：
 * 一块宽 900px 的正文只要有任何一角在屏内就该画，否则拖动镜头时会出现
 * 「半个块突然出现」的切口。四项全部在屏外才算离屏（即返回 `false`）。
 */
export function isFumeBlockOnScreen(
  block: Pick<FumeBlock, 'x' | 'y' | 'width' | 'height'>,
  camera: Pick<FumeCameraTarget, 'x' | 'y' | 'scale'>,
  viewport: FumeViewportSize,
  overscan = FUME_BLOCK_OVERSCAN_PX
): boolean {
  const screenScale = camera.scale
  const screenLeft = worldToScreenX(block.x, camera, viewport, screenScale)
  const screenTop = worldToScreenY(block.y, camera, viewport, screenScale)
  const screenRight = screenLeft + block.width * screenScale
  const screenBottom = screenTop + block.height * screenScale

  return !(
    screenRight < -overscan ||
    screenLeft > viewport.width + overscan ||
    screenBottom < -overscan ||
    screenTop > viewport.height + overscan
  )
}

/**
 * 一个区块在当前时刻的时序与样式（§8.3）。
 *
 * `staticState` 是**渲染分流的唯一依据**：
 * - `'waiting'` / `'passed'` → 用离屏快照，每帧只 `drawImage`；
 * - `null` → 必须逐字素实时绘制（颜色拖尾 / 揭示动画都在这个区间里）。
 *
 * ⚠️ 两处边界**必须原样保留**（§17.3 第 6 条）：
 * `time < startTime` 才是 waiting（`<=` 会让「刚好在起点」的块走快照，
 * 那一帧会看到明显的跳变），`time >= lineEndTime + colorTrailDuration` 才是 passed。
 *
 * ⚠️ `hasRevealCompleted` 用 `line.endTimeMs`，`hasPassCutoffReached` 用
 * `linePassCutoffTimeMs`（§17.3 第 7 条）：最后一行没有「下一行」时，
 * 前者一到行尾就为真（所有字都算唱完），而后者要等拖尾窗口结束。
 * 合并这两个值会让最后一行的拖尾凭空少一段。
 *
 * @param nextLineStartTimeMs 数组里的**下一行**（`lines[sourceLineIndex + 1]`）起始时间；
 *                            不是「时间上的下一行」，也不是 null 就能省略的哨兵 ——
 *                            传错会让拖尾跨进下一行的镜头（§17.3 第 6 条）
 */
export function resolveFumeBlockTiming(
  block: Pick<FumeBlock, 'variant' | 'lineHeight' | 'line'>,
  timeMs: number,
  nextLineStartTimeMs: number | null | undefined,
  textHoldRatio: number
): FumeBlockTiming {
  const waitingOpacity = block.variant === 'hero' ? 0.06 : 0.035
  const activeOpacity = block.variant === 'hero' ? 0.985 : 0.92
  const effectiveTextHoldStyle: FumeTextHoldStyle = textHoldRatio >= 1 ? 'standard' : 'dimmed'
  const passedStyle = resolvePassedTextStyle(block.variant, effectiveTextHoldStyle)
  const transitionPassedStyle = resolvePassedTextStyle(block.variant, 'standard')
  const baselineOffset = block.lineHeight * (isCjk(block.line.fullText) ? 0.52 : 0.5)
  const lineEndTimeMs = getLineRenderEndTimeMs(block.line)
  const linePassCutoffTimeMs = resolveLinePassCutoffTime(block.line, nextLineStartTimeMs)
  const hasRevealCompleted = timeMs >= block.line.endTimeMs
  const hasPassCutoffReached = timeMs >= linePassCutoffTimeMs
  const lineDurationMs = Math.max(
    lineEndTimeMs - block.line.startTimeMs,
    MIN_BLOCK_LINE_DURATION_MS
  )
  // hero 的拖尾比 body 短（0.42 vs 0.52）：大标题字大、颜色本身就抢眼，
  // 拖尾再长会让整页都是彩色残影
  const colorTrailDurationMs = clamp(
    lineDurationMs * (block.variant === 'hero' ? 0.42 : 0.52),
    MIN_COLOR_TRAIL_DURATION_MS,
    MAX_COLOR_TRAIL_DURATION_MS
  )
  const staticState: FumeBlockStaticState =
    timeMs < block.line.startTimeMs
      ? 'waiting'
      : timeMs >= lineEndTimeMs + colorTrailDurationMs
        ? 'passed'
        : null

  return {
    waitingOpacity,
    activeOpacity,
    effectiveTextHoldStyle,
    passedStyle,
    transitionPassedStyle,
    baselineOffset,
    lineEndTimeMs,
    linePassCutoffTimeMs,
    hasRevealCompleted,
    hasPassCutoffReached,
    lineDurationMs,
    colorTrailDurationMs,
    staticState
  }
}

/** 一张快照的 `shadowBlur`：只与字号、辉光基量、样式倍率有关（§8.4） */
function resolveSnapshotShadowBlur(
  block: Pick<FumeBlock, 'fontPx'>,
  passedGlowBase: number,
  style: FumePassedTextStyle
): number {
  return (2 + block.fontPx * 0.1) * 0.65 * passedGlowBase * style.glowMultiplier
}

/**
 * 一个静态区块要画的快照层（§8.4），**从下到上**排序。
 *
 * 返回 `null` 有两种含义，调用方按同一种方式处理即可：**这张区块不能走快照** ——
 * 要么 `staticState` 是 `null`（正在打印），要么主快照拿不到（离屏画布创建失败）。
 * 两种情况下调用方都应该回落到实时绘制，所以没必要区分。
 *
 * `getSnapshot` 由渲染层注入：它负责「按 key 查缓存 → 没有就现场创建一张」。
 * 本层只管**描述**要什么样的图，不碰任何 canvas API —— 这样 §8.4 的全部
 * 分支（等待 / 唱过 / dim 交叉淡出 / 总览恢复清晰）都能在 node 环境单测。
 */
export function resolveFumeStaticLayers<T>(
  block: Pick<FumeBlock, 'id' | 'fontPx'> & { variant: FumeBlockVariant },
  timing: FumeBlockTiming,
  input: FumeStaticLayerInput,
  getSnapshot: (spec: FumeSnapshotSpec) => T | undefined
): FumeStaticLayer<T>[] | null {
  const {
    staticState,
    effectiveTextHoldStyle,
    passedStyle,
    waitingOpacity,
    lineEndTimeMs,
    colorTrailDurationMs
  } = timing
  if (!staticState) return null

  // 快照按「态 + 样式档」缓存：waiting 与 passed 的字色 alpha 不同，
  // dim 的 standard / dimmed 也是两张不同的图，key 里都要体现
  const cacheStyleKey = staticState === 'passed' ? effectiveTextHoldStyle : 'base'
  const snapshot = getSnapshot({
    key: `${block.id}:${staticState}:${cacheStyleKey}:${input.snapshotScale}`,
    fill: colorWithAlpha(
      input.theme.primaryColor,
      staticState === 'waiting' ? waitingOpacity : passedStyle.opacity
    ),
    shadowBlur:
      staticState === 'waiting'
        ? 0
        : resolveSnapshotShadowBlur(block, input.passedGlowBase, passedStyle),
    shadowColor:
      staticState === 'waiting'
        ? 'transparent'
        : colorWithAlpha(input.theme.primaryColor, passedStyle.shadowAlphaBase)
  })
  if (!snapshot) return null

  if (staticState === 'passed' && effectiveTextHoldStyle === 'dimmed') {
    const passedAtMs = lineEndTimeMs + colorTrailDurationMs
    const baseDimAmount = resolvePassedDimAmount(
      input.timeMs,
      passedAtMs,
      input.passedFadeDurationMs
    )
    // 总览时纸痕「重新变清楚」：它们这时是内容，不是干扰
    const dimAmount = baseDimAmount * (1 - input.overviewTextRestoreProgress)
    const standardSnapshot = getSnapshot({
      key: `${block.id}:passed:standard:${input.snapshotScale}`,
      fill: colorWithAlpha(input.theme.primaryColor, timing.transitionPassedStyle.opacity),
      shadowBlur: resolveSnapshotShadowBlur(
        block,
        input.passedGlowBase,
        timing.transitionPassedStyle
      ),
      shadowColor: colorWithAlpha(
        input.theme.primaryColor,
        timing.transitionPassedStyle.shadowAlphaBase
      )
    })

    if (standardSnapshot) {
      if (dimAmount <= 0) {
        // 还没开始变暗：只需要 standard 一张，省一次 drawImage
        return [{ snapshot: standardSnapshot, alpha: 1 }]
      }
      if (dimAmount < 1) {
        return [
          { snapshot: standardSnapshot, alpha: 1 - dimAmount },
          { snapshot, alpha: dimAmount }
        ]
      }
    }
  }

  return [{ snapshot, alpha: 1 }]
}
