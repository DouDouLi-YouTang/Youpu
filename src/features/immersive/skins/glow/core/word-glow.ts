/**
 * 「流光」的逐字素辉光 —— 双层 text-shadow 的参数与关键帧。
 * 移植自 Folia `components/visualizer/wordGlow.ts`。
 *
 * 辉光层是**压在正文下面**的一层同样文字：字色透明，只出双层光晕。
 * 内层半径小、外层半径大，叠起来才有"近处亮、远处散"的衰减，单层给不出来。
 *
 * 本文件只算参数与关键帧，不碰 DOM；色彩 alpha 由调用方以 `WithAlpha` 注入。
 */

import { DROP_SHADOW_INNER_ALPHA, DROP_SHADOW_RADIUS_SCALE } from '../../shared/glow-blur-quantize'

/** 颜色 + alpha 的工具函数（由调用方注入，避免本层依赖具体色彩实现） */
export type WithAlpha = (color: string, alpha: number) => string

export {
  DROP_SHADOW_INNER_ALPHA,
  DROP_SHADOW_RADIUS_SCALE,
  isGlowBlurQuantized,
  quantizeShadowBlur
} from '../../shared/glow-blur-quantize'

/** 各档辉光半径（内层 / 外层），单位 px */
export const GLOW_RADII = {
  /** 单字素（或整词一个 span）：持续亮着 */
  sustained: { inner: 20, outer: 40 },
  /** 多字素词里的逐字素扫描 */
  sweep: { inner: 20, outer: 40 },
  /** 极短行：半径更小，避免糊成一片 */
  instant: { inner: 14, outer: 24 },
  /** 快速行：介于两者之间 */
  fast: { inner: 18, outer: 32 }
} as const

/** 持续辉光的 times：快速升起后保持到本词结束 */
export const SUSTAINED_TIMES = [0, 0.9, 1] as const
/** 逐字素扫描的 times：早期峰值后淡出，形成"扫过去"的感觉 */
export const SWEEP_TIMES = [0, 0.3, 1] as const
/** instant 档 times */
export const INSTANT_TIMES = [0, 0.35, 1] as const
/** fast 档 times */
export const FAST_TIMES = [0, 0.4, 1] as const

/** 逐字素扫描的时长放大系数：把淡出拉过后面几个字 */
export const SWEEP_DURATION_FACTOR = 6

/** text-shadow 形态的双层光晕 */
export function textShadowAt(color: string, inner: number, outer: number): string {
  return `0 0 ${inner}px ${color}, 0 0 ${outer}px ${color}`
}

/** drop-shadow 形态的同一组半径（内层更弱，见 DROP_SHADOW_INNER_ALPHA） */
export function dropShadowAt(
  color: string,
  inner: number,
  outer: number,
  withAlpha: WithAlpha
): string {
  const innerShadow = withAlpha(color, DROP_SHADOW_INNER_ALPHA)
  const innerRadius = inner * DROP_SHADOW_RADIUS_SCALE
  const outerRadius = outer * DROP_SHADOW_RADIUS_SCALE
  return `drop-shadow(0 0 ${innerRadius}px ${innerShadow}) drop-shadow(0 0 ${outerRadius}px ${color})`
}

/** 一次辉光脉冲的 text-shadow 关键帧 */
export interface GlowKeyframes {
  /** 辉光层只出影子不出字，所以字色恒为透明 */
  color: 'transparent'
  /** 与 peaks 等长的 text-shadow 序列；强度为 0 的帧是 `none` */
  textShadow: string[]
}

/**
 * 生成一次辉光脉冲的 text-shadow 关键帧。
 *
 * `peaks[i]` 是第 i 帧的强度（0–1）：0 表示完全没有光晕（`none`），
 * 1 表示满强度双层光晕。原实现就是 `none <-> 满强度` 的两态动画。
 */
export function buildGlowKeyframes(
  color: string,
  inner: number,
  outer: number,
  peaks: readonly number[]
): GlowKeyframes {
  return {
    color: 'transparent',
    textShadow: peaks.map((peak) => (peak > 0 ? textShadowAt(color, inner, outer) : 'none'))
  }
}

/** drop-shadow 形态的关键帧：字形上色 + opacity 承载 alpha 斜坡 + filter 承载半径 */
export interface GlowKeyframesQuantized {
  color: string
  opacity: number[]
  filter: string[]
}

/**
 * 生成 drop-shadow 形态的辉光关键帧。
 *
 * 三处与原实现一致、不要改：
 *  1. `color` 是**实色**（不是透明）：drop-shadow 投的是画出来的字形，透明字投不出影子；
 *  2. 半径随强度一起缩放（`inner * peak`）：光晕"长大"的过程必须保留，
 *     只渐变 opacity 会变成"整块光晕原地变亮"；
 *  3. `opacity` 直接吃 peaks：drop-shadow 的 alpha 插不进逐帧参数，
 *     原实现用图层透明度代替 text-shadow 那版的 alpha 斜坡。
 */
export function buildGlowKeyframesQuantized(
  color: string,
  inner: number,
  outer: number,
  peaks: readonly number[],
  withAlpha: WithAlpha
): GlowKeyframesQuantized {
  return {
    color,
    opacity: [...peaks],
    filter: peaks.map((peak) => dropShadowAt(color, inner * peak, outer * peak, withAlpha))
  }
}
