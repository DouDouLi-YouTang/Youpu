import type { FoliaPaperBounds } from '../types'

/**
 * common 模式的三层落位 —— 规格 §2.1 的纯函数版。
 *
 * 为什么把三条一行的判断抽出来单测：每条都对应一种「看起来对、实际错」的写法，
 * 而且错了之后画面仍然「有东西」，不会有任何报错：
 *
 *  1. 主题底色层的 opacity 用 `opacity || 0.75` → `opacity = 0`（用户想完全露出流体底）
 *     被吃成 0.75，流体底永远被盖住一层。
 *  2. 把 `staticMode` 当成「暂停几何层」→ 首页关掉动态背景后还留着一批静态形状。
 *     正确语义是 `staticMode` **移除整层**，`paused` 才是切成静态快照。
 *  3. `disableGeometricBackground` 与 `disableVignette` 混用 → 关掉暗角时连形状一起没了。
 */

export interface CommonLayerPlan {
  /** 是否渲染流体封面底（`useCoverColorBg`） */
  showFluid: boolean
  /** 主题底色层的不透明度：开取色时用配置值，否则 1（完全盖住流体底） */
  backgroundOpacity: number
  /** 是否渲染几何层（`staticMode` 时整层消失） */
  showGeometric: boolean
  /** 是否显示几何层自带的暗角 */
  showVignette: boolean
}

/**
 * 把文章世界里的纸张边界换算成 CSS 绝对定位。
 *
 * Common 的外壳必须铺满整个文章世界：主题底色和流体封面都在外壳里，若外壳只覆盖
 * 纸张，纸张外会直接透出宿主浅色底。真正需要围绕纸张构图的是内部几何层，所以这里
 * 单独生成几何层的 frame。反向边界先归正；没有边界时让它回到外壳的 `inset: 0`
 * 兜底，避免旧调用方少传字段时几何层消失。
 */
export function resolveCommonGeometryStyle(
  bounds: FoliaPaperBounds | null | undefined
): Record<string, string> {
  if (!bounds) return { inset: '0' }

  const left = finite(bounds.left)
  const top = finite(bounds.top)
  const right = finite(bounds.right)
  const bottom = finite(bounds.bottom)
  const normalizedLeft = Math.min(left, right)
  const normalizedTop = Math.min(top, bottom)
  const normalizedRight = Math.max(left, right)
  const normalizedBottom = Math.max(top, bottom)

  return {
    left: `${normalizedLeft}px`,
    top: `${normalizedTop}px`,
    width: `${Math.max(normalizedRight - normalizedLeft, 1)}px`,
    height: `${Math.max(normalizedBottom - normalizedTop, 1)}px`,
    // 样式表里的 inset: 0 会被 left/top 覆盖；right/bottom 必须显式收回，
    // 否则绝对定位同时受左右/上下约束，宽度会再次被拉到整张世界。
    right: 'auto',
    bottom: 'auto'
  }
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

export function resolveCommonLayerPlan(input: {
  useCoverColorBg: boolean
  coverColorOpacity: number
  staticMode: boolean
  disableGeometricBackground: boolean
  disableVignette: boolean
}): CommonLayerPlan {
  return {
    showFluid: input.useCoverColorBg,
    // 用 ?? 的语义、不用 ||：0 是合法值（完全隐藏底色）
    backgroundOpacity: input.useCoverColorBg ? input.coverColorOpacity : 1,
    // staticMode 移除整层（不是暂停）：这条与几何层内部的 paused 是两回事
    showGeometric: !input.staticMode && !input.disableGeometricBackground,
    // 暗角开关独立于形状开关：关暗角不该连形状一起关掉
    showVignette: !input.disableVignette
  }
}
