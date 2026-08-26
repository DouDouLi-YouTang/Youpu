import { defineStore } from 'pinia'

/**
 * 全部沉浸式播放页设置。键名 / 写入目标对齐参考项目；默认值按本项目自定义
 * refined-now-playing-netease 的 settings-menu.html 与 main.js 绑定函数。
 *
 * 命名约定：保持参考项目原始 kebab-case 设置键，便于与参考实现逐项对照；
 * 仅在外层包裹 TypeScript 字面量联合类型约束取值范围。
 */

export type DisplayMode = 'all' | 'lyric-only' | 'cover-only'
export type ColorScheme = 'dark' | 'light' | 'auto'
export type AccentColorVariant = 'off' | 'primary' | 'secondary' | 'tertiary'
export type CoverHAlign = 'left' | 'center'
export type CoverVAlign = 'bottom' | 'middle'
export type SongInfoAlign = 'left' | 'center'
export type BackgroundType = 'fluid' | 'blur' | 'gradient' | 'solid' | 'none'
export type KaraokeAnimation = 'float' | 'slide'
export type LyricAlignmentPct = 30 | 50
export type LyricTiming = 'smooth' | 'sharp' | 'lazy' | 'easeout'
export type ContributorDisplay = 'show' | 'hover' | 'hide'
/** remain = 显示剩余; total = 显示已播(点击切换) */
export type TimeIndicator = 'remain' | 'total'

/** 流体帧率上限档位 → 实际 fps。0=∞ */
export const FLUID_FPS_MAP: Record<number, number> = { 0: 5, 1: 10, 2: 30, 3: 60, 4: Infinity }
/** 流体模糊档位 → 实际 px */
export const FLUID_BLUR_MAP: Record<number, number> = { 5: 32, 6: 64, 7: 128 }

/** 四种动画曲线 → CSS timing-function。对齐参考项目 main.js bindSelectGroupToClasses('lyric-animation-timing') */
export const LYRIC_TIMING_MAP: Record<LyricTiming, string> = {
  smooth: 'cubic-bezier(0.18, 0.77, 0.58, 0.99)',
  sharp: 'cubic-bezier(0.54, 0, 0.16, 1)',
  lazy: 'cubic-bezier(0.32, 0.72, 0, 1)',
  easeout: 'cubic-bezier(0, 0.55, 0.45, 1)'
}

export interface ImmersiveSettings {
  // ── 外观 ──
  displayMode: DisplayMode
  centerLyric: boolean
  autoHideMiniSongInfo: boolean
  colorScheme: ColorScheme
  accentColorVariant: AccentColorVariant
  textShadow: boolean
  textGlow: boolean
  alwaysShowBottomBar: boolean
  bottomProgressbar: boolean
  enableProgressbarPreview: boolean
  timeIndicator: TimeIndicator

  // ── 封面 ──
  coverHAlign: CoverHAlign
  coverVAlign: CoverVAlign
  songInfoAlign: SongInfoAlign
  rectangleCover: boolean
  albumSize: 200 | 400 | 600 | 800
  coverBlurryShadow: boolean

  // ── 背景 ──
  backgroundType: BackgroundType
  staticFluid: boolean
  gradientBgDynamic: boolean
  bgBlur: number // 0–128 px, default 90
  bgDim: number // 0–100, default 55
  bgDimForGradientBg: number // default 45
  bgDimForFluidBg: number // default 30
  bgBlurForNoneBgMask: number // default 0
  bgDimForNoneBgMask: number // default 0

  // ── 歌词 ──
  lyricFontWeight: number // 100–900, default 700
  lyricFontSize: number // 16–64 px, default 32
  lyricRomajiSizeEm: number // 0.3–1.5 em, default 0.6
  lyricTranslationSizeEm: number // 0.3–1.5 em, default 1
  lyricFade: boolean
  lyricZoom: boolean
  lyricBlur: boolean
  lyricRotate: boolean
  rotateCurvature: number // 10–80 deg, default 25
  karaokeAnimation: KaraokeAnimation
  currentLyricAlignmentPercentage: LyricAlignmentPct
  lyricStagger: boolean
  lyricAnimationTiming: LyricTiming
  lyricGlow: boolean
  lyricOffset: number // -10000–10000 ms, default 0
  lyricContributorsDisplay: ContributorDisplay

  // ── 字体 ──
  customFont: boolean
  /** 字体回退链(多选)。旧持久化可能是 string，需 normalizeFontFamily 迁移。 */
  customFontFamily: string[]

  // ── 实验 ──
  fluidMaxFramerate: 0 | 1 | 2 | 3 | 4 // → FLUID_FPS_MAP
  fluidBlur: 5 | 6 | 7 // → FLUID_BLUR_MAP
  presentationMode: boolean
}

export const useImmersiveSettingsStore = defineStore('immersive-settings', {
  state: (): ImmersiveSettings => ({
    // 外观（默认值按本项目自定义（参考 main.js bindCheckboxToClass 第二参数 / selectGroup default））
    displayMode: 'all',
    centerLyric: true,
    autoHideMiniSongInfo: false,
    colorScheme: 'dark',
    accentColorVariant: 'primary',
    textShadow: true,
    textGlow: false,
    alwaysShowBottomBar: false,
    bottomProgressbar: false,
    enableProgressbarPreview: true,
    timeIndicator: 'total',

    // 封面
    coverHAlign: 'center',
    coverVAlign: 'middle',
    songInfoAlign: 'center',
    rectangleCover: false,
    // 默认 800(沿用作者偏好)。ImmersiveCover 会再与 20vw/42vh 取 min,即便很大也不易撑破布局。
    albumSize: 800,
    coverBlurryShadow: true,

    // 背景（background-type 默认 fluid，对齐 main.js 渲染处 getSetting('background-type','fluid')）
    backgroundType: 'fluid',
    staticFluid: false,
    gradientBgDynamic: true,
    bgBlur: 90,
    bgDim: 55,
    bgDimForGradientBg: 45,
    bgDimForFluidBg: 30,
    bgBlurForNoneBgMask: 0,
    bgDimForNoneBgMask: 0,

    // 歌词
    lyricFontWeight: 500,
    lyricFontSize: 32,
    lyricRomajiSizeEm: 0.6,
    lyricTranslationSizeEm: 1,
    lyricFade: true,
    lyricZoom: true,
    lyricBlur: false,
    lyricRotate: false,
    rotateCurvature: 25,
    karaokeAnimation: 'float',
    currentLyricAlignmentPercentage: 50,
    // stagger 参考项目默认 true（getSetting('lyric-stagger', true)），我们已实现错位延迟 + 200ms 提前量
    lyricStagger: true,
    lyricAnimationTiming: 'lazy',
    lyricGlow: true,
    lyricOffset: 0,
    lyricContributorsDisplay: 'hover',

    // 字体
    customFont: true,
    customFontFamily: ['Microsoft JhengHei UI', 'Microsoft JhengHei'],

    // 实验
    fluidMaxFramerate: 4,
    fluidBlur: 7,
    presentationMode: false
  }),
  actions: {
    /**
     * 迁移旧持久化的 customFontFamily(string)→ string[],幂等。
     * pinia-plugin-persistedstate 恢复时旧 string 值会覆盖默认 [],
     * 需在首次使用前调用一次转成数组。
     */
    normalizeFontFamily() {
      if (!Array.isArray(this.customFontFamily)) {
        this.customFontFamily = this.customFontFamily
          ? [this.customFontFamily as unknown as string]
          : []
      }
    }
  },
  persist: true
})
