/**
 * 沉浸设置的**纯数据层**：类型 / 常量 / 默认值 / 字段名派生。
 *
 * 这些设置**属于「经典」面板** —— 沉浸页唯一有设置的外观那一套。
 * 「倾诉」**没有自己的设置**（2026-10-11 用户定）：它的外观全部固定（背景恒为「几何」、
 * 永不显示封面、歌词排版与字体用内置值），只沿用少数沉浸页通用项（明暗主题、专辑主色、
 * 底栏四项、演示模式、歌词偏移）—— 那些读的是同一份设置，不是另开一份。
 * 所以这里只有一个扁平字段集，`skin`（当前在放哪个面板）也不在这里：它是全局项，只活在 store。
 *
 * 为什么单独一个文件：
 *  1. `immersive-settings.migrate.ts` 需要 `ImmersiveSettings` 与 `createDefaultSettings()`，
 *     而 store 又需要 migrate —— 两边直接互相 import 会成环。ESM 下环会让先被求值的那一侧
 *     读到未初始化的绑定（`const` 是 TDZ，直接抛 ReferenceError）：谁先加载谁崩，
 *     而"谁先加载"取决于模块图的巧合，不取决于代码意图。本文件不依赖 store / migrate，
 *     是安全的共同上游。
 *  2. 全是纯值与纯函数，vitest（node 环境，无 localStorage / jsdom）可以直接单测。
 *
 * store 会把这些**原样再导出**，所以消费方继续从 store 导入即可。
 */

export type DisplayMode = 'all' | 'lyric-only' | 'cover-only'
export type ColorScheme = 'dark' | 'light' | 'auto'
export type AccentColorVariant = 'off' | 'primary' | 'secondary' | 'tertiary'
export type CoverHAlign = 'left' | 'center'
export type CoverVAlign = 'bottom' | 'middle'
export type SongInfoAlign = 'left' | 'center'
export type BackgroundType = 'fluid' | 'blur' | 'gradient' | 'solid' | 'none' | 'geometric'
export type KaraokeAnimation = 'float' | 'slide'
export type LyricAlignmentPct = 30 | 50
export type LyricTiming = 'smooth' | 'sharp' | 'lazy' | 'easeout'
export type ContributorDisplay = 'show' | 'hover' | 'hide'
/**
 * 底部副字幕的内容档位：两个都给 / 只译文 / 只罗马音 / 隐藏。
 *
 * ⚠️ 类型定义在**这里**而不是 `skins/shared/subtitle-tracks.ts`：它同时是
 * 「一条设置」与「副字幕解析层的入参」，而设置是更上游的概念 —— 定义放下游会让
 * 数据层反过来 import 皮肤层（model 是纯叶子，不能依赖任何东西，见文件头）。
 * 副字幕层改为从这里 import 并原样再导出，老引用不用改。
 */
export type SubtitleContentMode = 'both' | 'translation' | 'romanization' | 'none'
/** remain = 显示剩余; total = 显示已播(点击切换) */
export type TimeIndicator = 'remain' | 'total'

/** 流体帧率上限档位 → 实际 fps。0=∞ */
export const FLUID_FPS_MAP: Record<number, number> = { 0: 5, 1: 10, 2: 30, 3: 60, 4: Infinity }
/** 流体模糊档位 → 实际 px */
export const FLUID_BLUR_MAP: Record<number, number> = { 5: 32, 6: 64, 7: 128 }

/** 四种动画曲线 → CSS timing-function。对齐参考项目 main.js bindSelectGroupToClass('lyric-animation-timing') */
export const LYRIC_TIMING_MAP: Record<LyricTiming, string> = {
  smooth: 'cubic-bezier(0.18, 0.77, 0.58, 0.99)',
  sharp: 'cubic-bezier(0.54, 0, 0.16, 1)',
  lazy: 'cubic-bezier(0.32, 0.72, 0, 1)',
  easeout: 'cubic-bezier(0, 0.55, 0.45, 1)'
}

/** 持久化用的 localStorage 键（历史各版本都用同一个键，迁移要按它读老数据）。 */
export const PERSIST_KEY = 'immersive-settings'

/**
 * 全部沉浸式播放页设置（**不含 `skin`** —— 当前面板是全局项，只在 store 里）。
 * 键名 / 写入目标对齐参考项目，默认值按本项目自定义 refined-now-playing-netease
 * 的 settings-menu.html 与 main.js 绑定函数。
 *
 * 命名约定：保持参考项目原始 kebab-case 设置键，便于与参考实现逐项对照；
 * 仅在外层包裹 TypeScript 字面量联合类型约束取值范围。
 *
 * 「倾诉」不读其中与面板外观有关的部分（显示模式 / 封面 / 背景 / 歌词排版 / 字体），
 * 那些字段仍然完整保留在这里 —— 它们是经典的设置，不因为倾诉不读而少一行。
 */
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
  // 倾诉不读本项：它用内置字重常量（tilt-adapter 的 FONT_WEIGHT_PLAIN/TILT），
  // 且因内置字体只有 400 字面，两者实际渲染相同（见该常量的注释）
  lyricFontWeight: number // 100–900, default 500
  lyricFontSize: number // 16–64 px, default 32
  lyricRomajiSizeEm: number // 0.3–1.5 em, default 0.6
  lyricTranslationSizeEm: number // 0.3–1.5 em, default 1
  /**
   * 底部副字幕显示哪几档。**沉浸页通用项**（不是「经典」面板的外观项）：
   * 它是「这一页的副字幕要不要显示罗马音 / 译文」，与正在放哪个面板无关，
   * 所以「倾诉」「流光」「浮名」都读它（与明暗主题、底栏四项同一类）。
   *
   * 默认 `'both'`（罗马音在前、译文在后）—— 与上游 `classic` / `fume` 的既有表现一致；
   * 上游的默认档是 `'translation'`，本项目刻意取 `'both'`（2026-10-15 用户定）。
   */
  subtitleContentMode: SubtitleContentMode
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
  lyricOffset: number // -10000–10000 ms, default 0（倾诉也读这一项：它是节拍对齐，不是排版）
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

/** 新建一份默认设置（默认值对齐参考项目 main.js bind 函数的第二参数）。 */
export function createDefaultSettings(): ImmersiveSettings {
  return {
    // 外观
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
    // 罗马音 + 译文两行（用户 2026-10-15 定：保留两行，但要能通过设置关掉）
    subtitleContentMode: 'both',
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
  }
}
