import { describe, expect, it } from 'vitest'

import {
  buildLayoutCacheKey,
  type FumeLayoutThemeKey,
  type FumeLayoutTuningKey
} from './layout-key'
import { hashString } from './fume-math'
import type { FumeLine } from './fume-types'

/** 造一行：只有参与键的字段有默认值 */
function makeLine(overrides: Partial<FumeLine> = {}): FumeLine {
  return {
    words: [],
    startTimeMs: 0,
    endTimeMs: 1000,
    fullText: '测试',
    ...overrides
  }
}

const VIEWPORT = { width: 1280.4, height: 720.6 }
const THEME: FumeLayoutThemeKey = { name: 'folia', fontStyle: 'serif' }
const TUNING: FumeLayoutTuningKey = { heroScale: 1 }

describe('buildLayoutCacheKey（规格书 §7.1）', () => {
  it('键的结构：视口 | 字体 | 倍率 | 行数 | 指纹', () => {
    const key = buildLayoutCacheKey([makeLine()], VIEWPORT, THEME, 1, TUNING)
    const parts = key.split('|')
    expect(parts).toHaveLength(11)
    expect(parts[0]).toBe('1280')
    expect(parts[1]).toBe('721')
    expect(parts[2]).toBe('serif')
    expect(parts[3]).toBe('') // fontFamily 缺省
    expect(parts[4]).toBe('') // fontFamilyStack 缺省
    expect(parts[5]).toBe('auto') // fontWeight 缺省
    expect(parts[6]).toBe('folia')
    expect(parts[7]).toBe('1.0000')
    expect(parts[8]).toBe('1.0000')
    expect(parts[9]).toBe('1')
    expect(parts[10]).toMatch(/^\d+$/)
  })

  it('视口尺寸取整：亚像素抖动不改变键', () => {
    // 取整后的值是 1280 / 721（720.6 会进位到 721）
    const base = buildLayoutCacheKey([makeLine()], { width: 1280, height: 721 }, THEME, 1, TUNING)
    expect(
      buildLayoutCacheKey([makeLine()], { width: 1280.4, height: 720.6 }, THEME, 1, TUNING)
    ).toBe(base)
    expect(
      buildLayoutCacheKey([makeLine()], { width: 1279.6, height: 720.6 }, THEME, 1, TUNING)
    ).toBe(base)
  })

  it('视口真正变化（跨过整像素）会换键', () => {
    const base = buildLayoutCacheKey([makeLine()], { width: 1280, height: 720 }, THEME, 1, TUNING)
    expect(
      buildLayoutCacheKey([makeLine()], { width: 1281, height: 720 }, THEME, 1, TUNING)
    ).not.toBe(base)
  })

  it('颜色 / 动画强度不参与键：主题对象多加字段也不改变结果', () => {
    const themeWithColors = {
      ...THEME,
      primaryColor: 'rgb(1, 2, 3)',
      accentColor: 'rgb(4, 5, 6)',
      animationIntensity: 'chaotic' as const
    }
    expect(buildLayoutCacheKey([makeLine()], VIEWPORT, themeWithColors, 1, TUNING)).toBe(
      buildLayoutCacheKey([makeLine()], VIEWPORT, THEME, 1, TUNING)
    )
  })

  it('字体的每一项都参与键', () => {
    const base = buildLayoutCacheKey([makeLine()], VIEWPORT, THEME, 1, TUNING)
    const variants: FumeLayoutThemeKey[] = [
      { ...THEME, name: 'other' },
      { ...THEME, fontStyle: 'sans' },
      { ...THEME, fontFamily: 'Custom' },
      { ...THEME, fontFamilyStack: ['A', 'B'] },
      { ...THEME, fontWeight: 500 }
    ]
    for (const variant of variants) {
      expect(buildLayoutCacheKey([makeLine()], VIEWPORT, variant, 1, TUNING)).not.toBe(base)
    }
  })

  it('fontFamilyStack 的顺序参与键（A,B 与 B,A 不同）', () => {
    const ab = buildLayoutCacheKey(
      [makeLine()],
      VIEWPORT,
      { ...THEME, fontFamilyStack: ['A', 'B'] },
      1,
      TUNING
    )
    const ba = buildLayoutCacheKey(
      [makeLine()],
      VIEWPORT,
      { ...THEME, fontFamilyStack: ['B', 'A'] },
      1,
      TUNING
    )
    expect(ab).not.toBe(ba)
  })

  it('lyricsFontScale / heroScale 参与键，且保留 4 位小数', () => {
    const base = buildLayoutCacheKey([makeLine()], VIEWPORT, THEME, 1, TUNING)
    expect(buildLayoutCacheKey([makeLine()], VIEWPORT, THEME, 1.1, TUNING)).not.toBe(base)
    expect(buildLayoutCacheKey([makeLine()], VIEWPORT, THEME, 1, { heroScale: 1.32 })).not.toBe(
      base
    )
    // 第 5 位小数被 toFixed(4) 抹掉（上游精度就是 4 位）
    expect(buildLayoutCacheKey([makeLine()], VIEWPORT, THEME, 1.00001, TUNING)).toBe(base)
  })

  it('行的时间 / 文本 / 词数 / isChorus 都参与键', () => {
    const base = buildLayoutCacheKey([makeLine()], VIEWPORT, THEME, 1, TUNING)
    const variants: FumeLine[] = [
      makeLine({ startTimeMs: 1 }),
      makeLine({ endTimeMs: 2000 }),
      makeLine({ fullText: '不同' }),
      makeLine({ words: [{ text: 'a', startTimeMs: 0, endTimeMs: 10 }] }),
      makeLine({ isChorus: true })
    ]
    for (const variant of variants) {
      expect(buildLayoutCacheKey([variant], VIEWPORT, THEME, 1, TUNING)).not.toBe(base)
    }
  })

  it('行的顺序参与键（同一个指纹序列反序不同）', () => {
    const a = makeLine({ fullText: 'A' })
    const b = makeLine({ fullText: 'B', startTimeMs: 2000, endTimeMs: 3000 })
    expect(buildLayoutCacheKey([a, b], VIEWPORT, THEME, 1, TUNING)).not.toBe(
      buildLayoutCacheKey([b, a], VIEWPORT, THEME, 1, TUNING)
    )
  })

  it('行数变化必然换键（即使指纹碰巧相同）', () => {
    const one = buildLayoutCacheKey([makeLine()], VIEWPORT, THEME, 1, TUNING)
    const two = buildLayoutCacheKey([makeLine(), makeLine()], VIEWPORT, THEME, 1, TUNING)
    expect(two).not.toBe(one)
  })

  it('空歌词也能建键（指纹是 FNV 的偏移基准）', () => {
    const key = buildLayoutCacheKey([], VIEWPORT, THEME, 1, TUNING)
    const parts = key.split('|')
    expect(parts[9]).toBe('0')
    expect(parts[10]).toBe(String(2166136261 >>> 0))
  })

  it('指纹与「逐行 hashString 后按 FNV 混合」的独立实现一致', () => {
    const lines = [
      makeLine({ fullText: 'A', startTimeMs: 0, endTimeMs: 1000 }),
      makeLine({ fullText: 'B', startTimeMs: 2000, endTimeMs: 3000, isChorus: true })
    ]
    let expected = 2166136261
    for (const line of lines) {
      const lineKey = `${line.startTimeMs}:${line.endTimeMs}:${line.fullText}:${line.words.length}:${
        line.isChorus ? 1 : 0
      }`
      expected ^= hashString(lineKey)
      expected = Math.imul(expected, 16777619)
    }
    expect(buildLayoutCacheKey(lines, VIEWPORT, THEME, 1, TUNING).split('|')[10]).toBe(
      String(expected >>> 0)
    )
  })

  it('同一个输入连调两次结果一致（纯函数、无隐藏状态）', () => {
    const lines = [makeLine({ fullText: '稳定' })]
    expect(buildLayoutCacheKey(lines, VIEWPORT, THEME, 1, TUNING)).toBe(
      buildLayoutCacheKey(lines, VIEWPORT, THEME, 1, TUNING)
    )
  })
})
