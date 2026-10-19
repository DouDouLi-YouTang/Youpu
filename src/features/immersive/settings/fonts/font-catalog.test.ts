import { describe, expect, it } from 'vitest'

import {
  COMMON_FONTS,
  FONT_PRESETS,
  commonFontOptions,
  hasPresetFont,
  type FontPreset
} from './font-catalog'

describe('commonFontOptions', () => {
  it('只返回常用字体白名单与已安装字体的交集，并保持白名单顺序', () => {
    const installed = ['Arial', 'NotInWhitelist', 'SimSun', 'Microsoft YaHei UI']

    expect(commonFontOptions(installed)).toEqual([
      { label: 'Microsoft YaHei UI', value: 'Microsoft YaHei UI' },
      { label: 'SimSun', value: 'SimSun' },
      { label: 'Arial', value: 'Arial' }
    ])
  })

  it('没有已安装字体时返回空列表', () => {
    expect(commonFontOptions([])).toEqual([])
    expect(commonFontOptions(['Unknown Font'])).toEqual([])
  })

  it('白名单本身不重复', () => {
    expect(new Set(COMMON_FONTS).size).toBe(COMMON_FONTS.length)
  })
})

describe('hasPresetFont', () => {
  const preset: FontPreset = {
    name: 'Test Preset',
    fonts: ['Test Font A', 'Test Font B'],
    url: ''
  }

  it('预设中任意一个字体已安装即返回 true', () => {
    expect(hasPresetFont(preset, ['Test Font B'])).toBe(true)
  })

  it('预设字体都未安装时返回 false', () => {
    expect(hasPresetFont(preset, ['Another Font'])).toBe(false)
  })
})

describe('FONT_PRESETS', () => {
  it('预设名称唯一，且每个预设至少包含一个字体族', () => {
    expect(new Set(FONT_PRESETS.map((preset) => preset.name)).size).toBe(FONT_PRESETS.length)
    for (const preset of FONT_PRESETS) {
      expect(preset.fonts.length).toBeGreaterThan(0)
    }
  })
})
