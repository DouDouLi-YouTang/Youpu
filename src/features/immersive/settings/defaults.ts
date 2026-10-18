/**
 * 沉浸设置面板各 slider 的默认值，供 reset 按钮还原。
 * 取值来源：参考项目 settings-menu.html 的 default 属性；其中 albumSize /
 * lyricFontWeight / fluidBlur 已修正为 App 实际出厂默认值，须与
 * immersive-settings.store.ts 的 state 初始值保持一致（否则全新安装、用户没动过
 * 滑块时，这几个滑块的「已改动」圆点就会亮着，点 reset 还会跳到从未用过的值）。
 */
export const DEFAULTS = {
  albumSize: 800,
  bgBlur: 90,
  bgDim: 55,
  bgDimForGradientBg: 45,
  bgDimForFluidBg: 30,
  bgBlurForNoneBgMask: 0,
  bgDimForNoneBgMask: 0,
  lyricFontWeight: 500,
  lyricFontSize: 32,
  lyricRomajiSizeEm: 0.6,
  lyricTranslationSizeEm: 1,
  rotateCurvature: 25,
  lyricOffset: 0,
  fluidMaxFramerate: 4,
  fluidBlur: 7
} as const

/** DEFAULTS 的字段名（即所有带 reset 圆点的 slider 字段） */
export type DefaultField = keyof typeof DEFAULTS

/** Folia 三主题共用设置里带 reset 圆点的 slider 默认值。 */
export const FOLIA_DEFAULTS = {
  backgroundOpacity: 100,
  backgroundBlur: 0
} as const

export type FoliaField = keyof typeof FOLIA_DEFAULTS

/** a-slider 的 @change 收 number | number[]，统一收成 number */
export function num(v: number | number[]): number {
  return Array.isArray(v) ? v[0] : v
}
