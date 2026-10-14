import { describe, expect, it } from 'vitest'

import { getContrastRatio, getHueDistance, hexToHsl } from './color-math'
import { ACCENT_MIN_CONTRAST, PRIMARY_MIN_CONTRAST, SECONDARY_MIN_CONTRAST } from './design-space'
import { generateSongThemeColors } from './generate'
import { createSeededRandom } from './seed'

/** 一组「像真封面」的色盘：主色 + 一个远离它的第二色相 + 一个近中性色 */
const WARM_COVER = ['#b45309', '#1e3a8a', '#f5f5f4', '#78350f', '#111827']
const COOL_COVER = ['#0ea5e9', '#f472b6', '#e2e8f0', '#0f172a', '#7dd3fc']

describe('generateSongThemeColors', () => {
  it('两档都给全四个颜色，且都是合法十六进制', () => {
    const theme = generateSongThemeColors({ coverColors: WARM_COVER })

    for (const mode of [theme.light, theme.dark]) {
      for (const color of [
        mode.backgroundColor,
        mode.primaryColor,
        mode.accentColor,
        mode.secondaryColor
      ]) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it('同一覆盖盘 + 同一种子 → 完全一致（可重现）', () => {
    const first = generateSongThemeColors({
      coverColors: WARM_COVER,
      random: createSeededRandom(42)
    })
    const second = generateSongThemeColors({
      coverColors: WARM_COVER,
      random: createSeededRandom(42)
    })

    expect(first).toEqual(second)
  })

  it('不同歌曲 id → 不同颜色（这正是「每首歌主题色都一样」的修复）', () => {
    const a = generateSongThemeColors({
      coverColors: WARM_COVER,
      random: createSeededRandom(1)
    })
    const b = generateSongThemeColors({
      coverColors: WARM_COVER,
      random: createSeededRandom(2)
    })

    // 同一张封面 + 同一个颜色骨架之下，至少底色或强调色应有差异
    expect(a.dark.backgroundColor).not.toBe(b.dark.backgroundColor)
  })

  it('不同封面 → 明显不同的色相（不是同一套颜色换了明暗）', () => {
    const warm = generateSongThemeColors({
      coverColors: WARM_COVER,
      random: createSeededRandom(7)
    })
    const cool = generateSongThemeColors({
      coverColors: COOL_COVER,
      random: createSeededRandom(7)
    })

    const warmHue = hexToHsl(warm.dark.backgroundColor)!.h
    const coolHue = hexToHsl(cool.dark.backgroundColor)!.h
    expect(getHueDistance(warmHue, coolHue)).toBeGreaterThan(60)
  })

  it('没有封面时也生成一套颜色（不同 id 互不相同）', () => {
    const a = generateSongThemeColors({ coverColors: [], random: createSeededRandom(11) })
    const b = generateSongThemeColors({ coverColors: [], random: createSeededRandom(12) })

    expect(a.dark.backgroundColor).toMatch(/^#[0-9a-f]{6}$/)
    expect(a.dark.backgroundColor).not.toBe(b.dark.backgroundColor)
  })

  it('底色永远是「深色档更暗、亮色档更亮」', () => {
    const theme = generateSongThemeColors({
      coverColors: WARM_COVER,
      random: createSeededRandom(3)
    })

    expect(hexToHsl(theme.dark.backgroundColor)!.l).toBeLessThan(0.2)
    expect(hexToHsl(theme.light.backgroundColor)!.l).toBeGreaterThan(0.85)
  })

  it('底色永远带一点饱和度（灰调封面也不会退化成纯中性）', () => {
    const theme = generateSongThemeColors({
      coverColors: ['#808080', '#909090', '#a0a0a0'],
      random: createSeededRandom(5)
    })

    expect(hexToHsl(theme.dark.backgroundColor)!.s).toBeGreaterThan(0)
    expect(hexToHsl(theme.light.backgroundColor)!.s).toBeGreaterThan(0)
  })

  it('正文 / 次级 / 强调色都达到各自的对比度地板', () => {
    for (const seed of [1, 17, 99, 2024, 31337]) {
      const theme = generateSongThemeColors({
        coverColors: WARM_COVER,
        random: createSeededRandom(seed)
      })

      for (const mode of [theme.light, theme.dark]) {
        expect(getContrastRatio(mode.primaryColor, mode.backgroundColor)).toBeGreaterThanOrEqual(
          PRIMARY_MIN_CONTRAST - 0.05
        )
        expect(getContrastRatio(mode.secondaryColor, mode.backgroundColor)).toBeGreaterThanOrEqual(
          SECONDARY_MIN_CONTRAST - 0.05
        )
        expect(getContrastRatio(mode.accentColor, mode.backgroundColor)).toBeGreaterThanOrEqual(
          ACCENT_MIN_CONTRAST - 0.05
        )
      }
    }
  })

  it('正文色不是纯黑纯白（保留封面色相）', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const theme = generateSongThemeColors({
        coverColors: COOL_COVER,
        random: createSeededRandom(seed)
      })

      expect(theme.dark.primaryColor).not.toBe('#ffffff')
      expect(theme.light.primaryColor).not.toBe('#000000')
      // 深色档的正文色应该带一点色相（饱和度 > 0）
      expect(hexToHsl(theme.dark.primaryColor)!.s).toBeGreaterThan(0)
    }
  })

  it('强调色与正文色分得开（逐词高亮不会看不见）', () => {
    for (const seed of [1, 6, 12, 24, 48, 96]) {
      const theme = generateSongThemeColors({
        coverColors: WARM_COVER,
        random: createSeededRandom(seed)
      })
      const { accentColor, primaryColor } = theme.dark

      const hueApart = getHueDistance(hexToHsl(accentColor)!.h, hexToHsl(primaryColor)!.h) >= 15
      const contrastApart = getContrastRatio(accentColor, primaryColor) >= 1.3
      expect(hueApart || contrastApart).toBe(true)
    }
  })

  it('明暗两档共用同一个颜色骨架：切换明暗不是换成另一首歌', () => {
    const theme = generateSongThemeColors({
      coverColors: WARM_COVER,
      random: createSeededRandom(8)
    })

    // 两档底色的色相应相近（同骨架），只是明度分道扬镳
    const darkHue = hexToHsl(theme.dark.backgroundColor)!.h
    const lightHue = hexToHsl(theme.light.backgroundColor)!.h
    expect(getHueDistance(darkHue, lightHue)).toBeLessThan(30)
  })

  it('色盘里混入坏值时跳过它们，不影响出图', () => {
    const theme = generateSongThemeColors({
      coverColors: ['not-a-color', '#b45309', '', '#1e3a8a'],
      random: createSeededRandom(4)
    })

    expect(theme.dark.backgroundColor).toMatch(/^#[0-9a-f]{6}$/)
  })
})
