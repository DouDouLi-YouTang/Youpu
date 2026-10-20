/**
 * 颜色骨架 → **主题四色**（`backgroundColor` / `primaryColor` / `accentColor` / `secondaryColor`）。
 *
 * ## 这一步解决的是哪个问题
 *
 * 「浮名的文字颜色不跟随主题色」「每首歌主题色都一样」—— 这两句描述的是同一件事：
 * 原来四个颜色里只有强调色读封面，其余三个是写死的字面量。
 * 本模块把四个颜色的**色相全部接到封面**上，于是同一首歌在明暗两档下、
 * 在不同封面之间都是四色配套的一套，而不是「一个封面色 + 三个常量」。
 *
 * ## 每首歌都不一样，是怎么保证的
 *
 * 三个随机性来源叠加：
 *  1. 主色相本身来自封面色（`cover-analysis`）；
 *  2. 底色/文字色的明度与饱和度在区间内抖动（`design-space`）；
 *  3. 和声方案、抖动方向、气质档各自掷一次。
 *
 * ## 无封面时的兜底
 *
 * `coverColors` 为空不是错误路径：纯本地歌、取色失败、封面还没加载完都会走到这里。
 * 此时**仍然生成一套随机主题**（而不是回退到某个固定主题）——
 * 否则「没封面的歌」会共享同一套颜色，用户看到的还是「每首歌都一样」。
 * 调用方若要「取不到封面就用中性兜底」，请在**更上层**决定（`use-song-theme.ts`），
 * 本模块保持「永远给出一套颜色」这条简单契约。
 *
 * ## 纯函数
 *
 * 不碰 DOM、不读时间、不读全局状态；随机源由调用方注入。
 * 同一个 `(coverColors, random)` 必然得到同一套颜色 —— 这是可单测的前提。
 */

import {
  adjustLightnessForContrast,
  clamp01,
  getContrastRatio,
  getHueDistance,
  hslToHex,
  normalizeHue
} from './color-math'
import { analyzeCoverPalette, type CoverPalette, type HarmonyScheme } from './cover-analysis'
import {
  ACCENT_MIN_CONTRAST,
  ACCENT_RANGES,
  BACKGROUND_TONES,
  MIN_BACKGROUND_SATURATION,
  PRIMARY_MIN_CONTRAST,
  PRIMARY_RANGES,
  SECONDARY_MIN_CONTRAST,
  SECONDARY_RANGES,
  type Range,
  type ThemeMode
} from './design-space'
import type { FoliaColorScheme } from '../../../immersive-settings.model'

/** 一套主题的四个颜色 */
export interface SongThemeColors {
  backgroundColor: string
  primaryColor: string
  accentColor: string
  secondaryColor: string
}

/** 呼入参数：封面色盘 + 随机源（默认 `Math.random`，确定性场景请注入固定种子源） */
export interface GenerateSongThemeOptions {
  coverColors?: readonly string[]
  random?: () => number
}

/** 从区间里随机取一个值 */
function between(random: () => number, [min, max]: Range): number {
  return min + random() * (max - min)
}

/**
 * 沿**短弧**插值两个色相。
 *
 * 直接用 `from + (to - from) * amount` 会在跨 0° 时绕远路（350° → 10° 会走 340°），
 * 混色中途穿过完全不相干的色相。先把它折到 `[-180, 180)` 再插值就不会。
 */
function lerpHue(from: number, to: number, amount: number): number {
  const delta = ((to - from + 540) % 360) - 180
  return normalizeHue(from + delta * amount)
}

/**
 * 底色。
 *
 * `coverWeight` 让「封面本身很淡」的歌曲也拿到**偏中性**的底色：
 * 一张几乎无彩的封面配一块高饱和底色会很跳，权重把它压回来。
 * 下限 `MIN_BACKGROUND_SATURATION` 保住「每首歌底色都不完全一样」——
 * 它是 0.04 而不是 0，正是为了这个（见 `design-space` 的说明）。
 */
function buildBackgroundColor(
  mode: ThemeMode,
  palette: CoverPalette,
  random: () => number
): string {
  const tone = BACKGROUND_TONES[palette.tone]
  const lightnessRange = mode === 'dark' ? tone.darkLightness : tone.lightLightness
  const saturationRange = mode === 'dark' ? tone.darkSaturation : tone.lightSaturation
  const coverWeight = 0.55 + 0.45 * clamp01(palette.baseSaturation / 0.7)

  return hslToHex({
    h: palette.baseHue,
    s: Math.max(MIN_BACKGROUND_SATURATION, between(random, saturationRange) * coverWeight),
    l: between(random, lightnessRange)
  })
}

/**
 * 强调色。
 *
 * 算完之后要过一道**撞色检查**：同色系（角距 < 15°）且与正文色的对比度低于 1.3 时，
 * 正在唱的字与未唱的字看起来是同一个颜色，逐词高亮等于失效。
 * 这时把色相**再推开 40°** 而不是调亮度 —— 调亮度会掉进「强调色与正文色一样亮」
 * 的另一个坑（对比度上去了，但颜色仍然分不出来）。
 */
function buildAccentColor(
  mode: ThemeMode,
  palette: CoverPalette,
  backgroundColor: string,
  primaryColor: string,
  random: () => number
): string {
  const ranges = ACCENT_RANGES[mode]
  const saturation = between(random, ranges.saturation)
  const lightness = between(random, ranges.lightness)

  const accent = adjustLightnessForContrast(
    hslToHex({ h: palette.accentHue, s: saturation, l: lightness }),
    backgroundColor,
    ACCENT_MIN_CONTRAST
  )

  const collidesWithPrimary =
    getHueDistance(palette.accentHue, palette.baseHue) < 15 &&
    getContrastRatio(accent, primaryColor) < 1.3

  if (!collidesWithPrimary) return accent

  return adjustLightnessForContrast(
    hslToHex({ h: normalizeHue(palette.accentHue + 40), s: saturation, l: lightness }),
    backgroundColor,
    ACCENT_MIN_CONTRAST
  )
}

/** 按一个明暗档算出一整套四色 */
function buildModeTheme(
  mode: ThemeMode,
  palette: CoverPalette,
  random: () => number
): SongThemeColors {
  const backgroundColor = buildBackgroundColor(mode, palette, random)

  const primaryRanges = PRIMARY_RANGES[mode]
  const primaryColor = adjustLightnessForContrast(
    hslToHex({
      h: palette.baseHue,
      s: between(random, primaryRanges.saturation),
      l: between(random, primaryRanges.lightness)
    }),
    backgroundColor,
    PRIMARY_MIN_CONTRAST
  )

  const accentColor = buildAccentColor(mode, palette, backgroundColor, primaryColor, random)

  const secondaryRanges = SECONDARY_RANGES[mode]
  const secondaryColor = adjustLightnessForContrast(
    hslToHex({
      // 次级色的色相落在主色与强调色之间 —— 三个色相因此是同一条弧上的三点，
      // 页面不会出现「第三种无关颜色」
      h: lerpHue(palette.baseHue, palette.accentHue, 0.2 + random() * 0.4),
      s: between(random, secondaryRanges.saturation),
      l: between(random, secondaryRanges.lightness)
    }),
    backgroundColor,
    SECONDARY_MIN_CONTRAST
  )

  return { backgroundColor, primaryColor, accentColor, secondaryColor }
}

/**
 * 生成一整套明暗主题。
 *
 * 明暗两档**共用同一个颜色骨架**（同一个 `CoverPalette`）—— 这样切换明暗时画面是
 * 「同一首歌换成白天/夜晚」，而不是换成另一首歌。两档只在明度与饱和度上分道扬镳。
 */
export function generateSongThemeColors({
  coverColors = [],
  random = Math.random
}: GenerateSongThemeOptions = {}): { light: SongThemeColors; dark: SongThemeColors } {
  const palette = analyzeCoverPalette(coverColors, random)

  return {
    light: buildModeTheme('light', palette, random),
    dark: buildModeTheme('dark', palette, random)
  }
}

/**
 * 固定配色方案 → 明暗两档四色。
 *
 * `daylight` / `midnight` / `mono` 是用户在 Folia 主题设置里明确选定的方案：
 * 它们不再跟随封面改变**整页**的色相，但仍保留同一套对比度地板，避免出现
 * “选了配色反而看不清歌词”的情况。默认的 `'song'` 不经过本函数。
 *
 * 三个方案的色相取冷灰蓝 / 暖棕 / 中性灰，刻意不复用 `DARK_THEME_COLORS`：
 * 那四个值是“封面还没解码完”的兜底，若拿它当用户方案，切换方案时会有
 * “和首帧一模一样”的错觉，也失去这个入口的意义。
 */
export function generateFixedFoliaTheme(colorMode: Exclude<FoliaColorScheme, 'song'>): {
  light: SongThemeColors
  dark: SongThemeColors
} {
  const build = (
    background: string,
    primary: string,
    accent: string,
    secondary: string
  ): SongThemeColors => ({
    backgroundColor: background,
    primaryColor: adjustLightnessForContrast(primary, background, PRIMARY_MIN_CONTRAST),
    accentColor: adjustLightnessForContrast(accent, background, ACCENT_MIN_CONTRAST),
    secondaryColor: adjustLightnessForContrast(secondary, background, SECONDARY_MIN_CONTRAST)
  })

  if (colorMode === 'mono') {
    return {
      light: build('#f4f4f5', '#18181b', '#52525b', '#3f3f46'),
      dark: build('#0c0c0f', '#f4f4f5', '#a1a1aa', '#d4d4d8')
    }
  }

  if (colorMode === 'daylight') {
    return {
      light: build('#f7f3eb', '#1c1917', '#c2410c', '#57534e'),
      dark: build('#17130e', '#fafaf9', '#fb923c', '#d6d3d1')
    }
  }

  return {
    light: build('#eef3f9', '#0f172a', '#0369a1', '#475569'),
    dark: build('#070b12', '#e2e8f0', '#38bdf8', '#94a3b8')
  }
}

/** 供调试 / 单测读取骨架（不参与生产链路） */
export function resolveCoverPalette(
  coverColors: readonly string[],
  random: () => number
): { palette: CoverPalette; scheme: HarmonyScheme } {
  const palette = analyzeCoverPalette(coverColors, random)
  return { palette, scheme: palette.scheme }
}
