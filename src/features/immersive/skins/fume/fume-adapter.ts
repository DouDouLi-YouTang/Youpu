/**
 * 「浮名」的调参适配层 —— 把 Folia 的 `FumeTuning` 与本项目的定案写成常量。
 *
 * ## 为什么需要这一层（与「流光」的 `glow-adapter.ts` 同构）
 *
 * 浮名**没有设置面板**（用户 2026-10-14 拍板，与「倾诉」一致）。Folia 那一堆
 * 面板字段在本项目里全部内置成常量，但**不能**把它们内联散落到各处：
 *  - 布局缓存键（§7.1）要吃 `heroScale` 与字体栈；
 *  - 每帧绘制要吃 `glowIntensity`、`backgroundObjectOpacity`、`showText` / `staticMode`；
 *  - 时间轴要吃 `cameraTrackingMode` / `cameraSpeed`。
 *
 * 一旦内联，同一个"默认值"就有了好几个出处；将来接设置面板时更不知道要改几处。
 * 所以这里集中一份，**唯一**的取值出处，其余模块只引用常量。
 *
 * ## 为什么 `disableGeometricBackground` 不在这里
 *
 * 它描述的是「外壳的几何背景要不要让位」，属于**皮肤与外壳的约定**，不是画布参数
 * （见 §12.6）。浮名自己的做法是「铺纯色底 + 自绘背景」，所以在 `SkinFume.vue`
 * 里直接体现，不进这份调参表。
 */

import type { FumeCameraTrackingMode } from './core/fume-types'

/** 浮名在本项目里的内置调参（§14.1 的默认列，全部照抄上游默认值） */
export const FUME_TUNING = Object.freeze({
  /**
   * `true` = 不画「打印印章」方块（§10.5）。
   * 默认 **false**：印章是浮名的招牌视觉之一（字落下时砸一个方块），不能默认关掉。
   */
  hidePrintSymbols: false,
  /** 相机跟随模式：`smooth` = 按浮点打印进度连续滑动（上游默认） */
  cameraTrackingMode: 'smooth' as FumeCameraTrackingMode,
  /** 相机速度倍率（1 = 上游默认；运行时钳在 [0.55, 1.85]） */
  cameraSpeed: 1,
  /** 辉光强度（1 = 上游默认；运行时钳在 [0, 1.8]） */
  glowIntensity: 1,
  /**
   * 背景形状不透明度倍率（0.5 = 上游默认）。
   *
   * ⚠️ 用法是**再乘 2**（§11.3 的每帧流程），所以 0.5 等效系数 1.0。
   * 这一层额外乘 2 是上游的历史行为，照抄即可 —— 直接传 0.5 给绘制层
   * 会让所有背景形状暗一半。
   */
  backgroundObjectOpacity: 0.5,
  /**
   * 唱过文字的保留比例（1 = 永不淡出）。
   *
   * 本项目恒为 1：§14.1 的定案里 `textHoldRatio >= 1` 会让
   * 「已唱过 = dimmed 与快照交叉淡出」这两条路径**永不进入**。
   */
  textHoldRatio: 1
})

/** `true` = 画打印印章（`hidePrintSymbols` 取反；调用方读这个更直观） */
export const FUME_SHOW_PRINT_STAMP = !FUME_TUNING.hidePrintSymbols

/** 背景不透明度倍率的**实际**系数（`backgroundObjectOpacity * 2`，见上） */
export const FUME_BACKGROUND_OPACITY_MULTIPLIER = FUME_TUNING.backgroundObjectOpacity * 2

/**
 * 无文章（前奏 / 加载中）时背景自转的墙钟漂移系数（§12.7）。
 *
 * 上游是 `time + now * 0.00018`，`now` 是墙钟毫秒。**数值照抄**：
 * 这一项目的是让背景在前奏里也缓慢转动 —— 严格跟播放进度会让前奏期间完全静止。
 */
export const FUME_IDLE_TIME_DRIFT = 0.00018

/**
 * 背景场景种子：`${seed ?? 'fume'}:${theme.name}`（§7.10）。
 *
 * ⚠️ 种子**含主题名**：换主题时背景会重掷一套形状，与上游一致。
 * 不带主题名会让「切主题后背景不变」，看起来像没生效。
 */
export function resolveFumeBackgroundSeed(
  seed: string | number | undefined,
  themeName: string
): string {
  return `${seed === undefined ? 'fume' : String(seed)}:${themeName}`
}
