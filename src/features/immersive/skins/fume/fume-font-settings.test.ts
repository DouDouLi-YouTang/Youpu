import { describe, expect, it } from 'vitest'

import type { FoliaFontSettings } from '../../folia-font-settings'
import { buildLayoutCacheKey } from './core/layout-key'
import type { FumeLine } from './core/fume-types'
import { buildFumeFontKey, resolveFumeFontSelection } from './fume-font-settings'

function makeLine(): FumeLine {
  return {
    words: [],
    startTimeMs: 0,
    endTimeMs: 1000,
    fullText: '测试'
  }
}

function makeSettings(overrides: Partial<FoliaFontSettings> = {}): FoliaFontSettings {
  return {
    custom: true,
    families: ['Source Han Serif'],
    weight: 600,
    ...overrides
  }
}

describe('resolveFumeFontSelection', () => {
  it('关闭自定义字体时仍保留独立字重，但忽略自定义字体族', () => {
    expect(
      resolveFumeFontSelection(
        makeSettings({
          custom: false,
          families: ['Source Han Serif'],
          weight: 900
        })
      )
    ).toEqual({ fontFamilyStack: undefined, fontWeight: 900 })
  })

  it('关闭自定义字体且字重为 null 时完全跟随主题', () => {
    expect(
      resolveFumeFontSelection(
        makeSettings({
          custom: false,
          families: ['Source Han Serif'],
          weight: null
        })
      )
    ).toEqual({ fontFamilyStack: undefined, fontWeight: undefined })
  })

  it('自定义时清洗字体链并保留自定义字重', () => {
    expect(
      resolveFumeFontSelection(
        makeSettings({
          families: [
            '  Source Han Serif ',
            42,
            '',
            'Source Han Serif',
            'Noto Serif CJK SC'
          ] as unknown as string[],
          weight: 700
        })
      )
    ).toEqual({
      fontFamilyStack: ['Source Han Serif', 'Noto Serif CJK SC'],
      fontWeight: 700
    })
  })

  it('weight = null 时仍使用自定义字体链，但字重跟随主题', () => {
    expect(resolveFumeFontSelection(makeSettings({ weight: null }))).toEqual({
      fontFamilyStack: ['Source Han Serif'],
      fontWeight: undefined
    })
  })

  it('非法字重回退主题字重，空字体链回退内置字体', () => {
    expect(resolveFumeFontSelection(makeSettings({ families: [], weight: 550 }))).toEqual({
      fontFamilyStack: undefined,
      fontWeight: undefined
    })
  })

  it('设置缺省时安全回退主题默认值', () => {
    expect(resolveFumeFontSelection(undefined)).toEqual({
      fontFamilyStack: undefined,
      fontWeight: undefined
    })
    expect(resolveFumeFontSelection(null)).toEqual({
      fontFamilyStack: undefined,
      fontWeight: undefined
    })
  })
})

describe('buildFumeFontKey', () => {
  it('字体文件状态、字体链和字重任一变化都会换键', () => {
    const base = buildFumeFontKey('ready', resolveFumeFontSelection(makeSettings()))

    expect(buildFumeFontKey('pending', resolveFumeFontSelection(makeSettings()))).not.toBe(base)
    expect(
      buildFumeFontKey(
        'ready',
        resolveFumeFontSelection(makeSettings({ families: ['Another Serif'] }))
      )
    ).not.toBe(base)
    expect(
      buildFumeFontKey('ready', resolveFumeFontSelection(makeSettings({ weight: 500 })))
    ).not.toBe(base)
  })

  it('字体链顺序参与键，完全相同的输入稳定命中', () => {
    const first = buildFumeFontKey(
      'ready',
      resolveFumeFontSelection(makeSettings({ families: ['A', 'B'] }))
    )
    const reversed = buildFumeFontKey(
      'ready',
      resolveFumeFontSelection(makeSettings({ families: ['B', 'A'] }))
    )
    const same = buildFumeFontKey(
      'ready',
      resolveFumeFontSelection(makeSettings({ families: ['A', 'B'] }))
    )

    expect(first).not.toBe(reversed)
    expect(same).toBe(first)
  })
})

describe('字体设置接入布局缓存键', () => {
  const viewport = { width: 1280, height: 720 }
  const baseTheme = { name: 'fume', fontStyle: 'serif' as const }

  function keyFor(selection: ReturnType<typeof resolveFumeFontSelection>): string {
    return buildLayoutCacheKey(
      [makeLine()],
      viewport,
      {
        ...baseTheme,
        fontFamilyStack: selection.fontFamilyStack,
        fontWeight: selection.fontWeight
      },
      1,
      { heroScale: 1 }
    )
  }

  it('字体链或字重变化时布局键失效', () => {
    const base = keyFor(resolveFumeFontSelection(makeSettings()))
    expect(
      keyFor(resolveFumeFontSelection(makeSettings({ families: ['Another Serif'] })))
    ).not.toBe(base)
    expect(keyFor(resolveFumeFontSelection(makeSettings({ weight: 500 })))).not.toBe(base)
  })

  it('关闭自定义字体但保留相同字重时仍命中对应布局键', () => {
    const inherited = keyFor(resolveFumeFontSelection(undefined))
    expect(keyFor(resolveFumeFontSelection(makeSettings({ custom: false, weight: null })))).toBe(
      inherited
    )
  })
})
