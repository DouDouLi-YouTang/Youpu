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
