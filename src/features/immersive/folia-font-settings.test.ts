import { describe, expect, it } from 'vitest'

import {
  buildFoliaFontStack,
  createFoliaFontSettingsDefaults,
  escapeFontFamily,
  normalizeFoliaFontSettings,
  sanitizeFoliaFontFamilies,
  sanitizeFoliaFontWeight
} from './folia-font-settings'

describe('createFoliaFontSettingsDefaults', () => {
  it('每次返回全新的默认对象与字体数组', () => {
    const first = createFoliaFontSettingsDefaults()
    const second = createFoliaFontSettingsDefaults()

    expect(first).toEqual({ custom: false, families: [], weight: null })
    expect(first).not.toBe(second)
    expect(first.families).not.toBe(second.families)

    first.families.push('Arial')
    expect(second.families).toEqual([])
  })
})

describe('sanitizeFoliaFontFamilies', () => {
  it('只保留字符串，trim、去空并按首次出现顺序去重', () => {
    expect(
      sanitizeFoliaFontFamilies([
        '  Arial ',
        42,
        null,
        '',
        '   ',
        'Arial',
        'SimSun',
        'simsun',
        ' Microsoft YaHei '
      ])
    ).toEqual(['Arial', 'SimSun', 'Microsoft YaHei'])
  })

  it('非数组值安全回退为空数组', () => {
    for (const value of [null, undefined, 'Arial', 42, {}, new Set(['Arial'])]) {
      expect(sanitizeFoliaFontFamilies(value)).toEqual([])
    }
  })
})

describe('sanitizeFoliaFontWeight', () => {
  it('接受 null 与 100–900 的整百数', () => {
    expect(sanitizeFoliaFontWeight(null)).toBeNull()
    for (let weight = 100; weight <= 900; weight += 100) {
      expect(sanitizeFoliaFontWeight(weight)).toBe(weight)
    }
  })

  it('非法值统一回退 null', () => {
    for (const value of [
      undefined,
      0,
      99,
      101,
      150,
      950,
      1000,
      -100,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '500'
    ]) {
      expect(sanitizeFoliaFontWeight(value)).toBeNull()
    }
  })
})

describe('normalizeFoliaFontSettings', () => {
  it('清洗完整配置并丢弃未知字段', () => {
    expect(
      normalizeFoliaFontSettings({
        custom: true,
        families: [' Arial ', 'Arial', 'SimSun', 7],
        weight: 600,
        unknown: true
      })
    ).toEqual({
      custom: true,
      families: ['Arial', 'SimSun'],
      weight: 600
    })
  })

  it('非对象与非法字段回退默认值', () => {
    for (const value of [null, undefined, 'oops', [], 42]) {
      expect(normalizeFoliaFontSettings(value)).toEqual({
        custom: false,
        families: [],
        weight: null
      })
    }

    expect(
      normalizeFoliaFontSettings({
        custom: 'yes',
        families: 'Arial',
        weight: 550
      })
    ).toEqual({
      custom: false,
      families: [],
      weight: null
    })
  })
})

describe('escapeFontFamily', () => {
  it('输出带单引号的 CSS 字符串并转义引号、反斜杠和控制字符', () => {
    expect(escapeFontFamily("O'Reilly Sans")).toBe("'O\\'Reilly Sans'")
    expect(escapeFontFamily('A\\B')).toBe("'A\\\\B'")
    expect(escapeFontFamily('Line\nBreak')).toBe("'Line\\a Break'")
  })
})

describe('buildFoliaFontStack', () => {
  it('按自定义、内置回退、sans-serif 的顺序构造字体栈', () => {
    expect(buildFoliaFontStack(['My Font'], ['Folia Noto Serif SC'])).toBe(
      "'My Font', 'Folia Noto Serif SC', sans-serif"
    )
  })

  it('允许主题指定 serif 作为通用兜底，避免把流光默认字体改成无衬线', () => {
    expect(buildFoliaFontStack([], ['Folia Noto Serif SC'], 'serif')).toBe(
      "'Folia Noto Serif SC', serif"
    )
  })

  it('已有通用兜底族时不重复追加', () => {
    expect(buildFoliaFontStack(['Georgia'], ['Georgia'], 'serif')).toBe("'Georgia', serif")
  })

  it('跨来源去重，并且已经包含 sans-serif 时不重复追加', () => {
    expect(buildFoliaFontStack(['Arial', 'sans-serif'], ['Arial', 'SimSun'])).toBe(
      "'Arial', sans-serif, 'SimSun'"
    )
  })

  it('空配置仍提供通用兜底字体', () => {
    expect(buildFoliaFontStack([], [])).toBe('sans-serif')
    expect(buildFoliaFontStack(null, [])).toBe('sans-serif')
  })

  it('主题通用族保持不带引号，其他族名统一安全转义', () => {
    expect(buildFoliaFontStack(["Bad'Name\\Sans"], ['serif'])).toBe(
      "'Bad\\'Name\\\\Sans', serif, sans-serif"
    )
  })
})
