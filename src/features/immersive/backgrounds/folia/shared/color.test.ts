import { describe, expect, it } from 'vitest'

import {
  channelsToHex,
  clearColorCacheForTests,
  colorWithAlpha,
  luminanceOf,
  mixChannels,
  parseColorChannels,
  resolveThemeChannels
} from './color'

describe('color', () => {
  it('把 3/6 位 hex 与 rgb()/rgba() 解析成通道', () => {
    expect(parseColorChannels('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseColorChannels('#1a2b3c')).toEqual({ r: 26, g: 43, b: 60 })
    expect(parseColorChannels('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 })
    expect(parseColorChannels('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30 })
  })

  it('命名色 / hsl 视为透传，不解析成通道', () => {
    expect(parseColorChannels('red')).toBeNull()
    expect(parseColorChannels('hsl(200 50% 50%)')).toBeNull()
  })

  it('colorWithAlpha：可解析色拼 rgba，不可解析色原样返回', () => {
    expect(colorWithAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)')
    // 解析失败（空串 / 坏 hex）回退白色 —— 对齐 Folia 的 FALLBACK_RGB
    expect(colorWithAlpha('', 1)).toBe('rgba(255, 255, 255, 1)')
    expect(colorWithAlpha('#12345', 1)).toBe('rgba(255, 255, 255, 1)')
    // 命名色 / hsl 原样返回，交给 CSS 处理
    expect(colorWithAlpha('hsl(200 50% 50%)', 0.3)).toBe('hsl(200 50% 50%)')
  })

  it('alpha 与通道都夹到合法区间', () => {
    expect(colorWithAlpha('rgb(300, -20, 12)', 5)).toBe('rgba(255, 0, 12, 1)')
    expect(colorWithAlpha('#ffffff', -1)).toBe('rgba(255, 255, 255, 0)')
  })

  it('resolveThemeChannels 解析失败时用调用方的 fallback', () => {
    const fallback = { r: 10, g: 10, b: 12 }
    expect(resolveThemeChannels('nope', fallback)).toEqual(fallback)
    expect(resolveThemeChannels('rgb(1,2,3)', fallback)).toEqual({ r: 1, g: 2, b: 3 })
  })

  it('mixChannels / channelsToHex / luminanceOf 是逐通道线性运算', () => {
    expect(mixChannels({ r: 0, g: 0, b: 0 }, { r: 100, g: 200, b: 40 }, 0.5)).toEqual({
      r: 50,
      g: 100,
      b: 20
    })
    expect(mixChannels({ r: 0, g: 0, b: 0 }, { r: 100, g: 200, b: 40 }, 9)).toEqual({
      r: 100,
      g: 200,
      b: 40
    })
    expect(channelsToHex({ r: 8, g: 16, b: 255 })).toBe('#0810ff')
    expect(luminanceOf({ r: 255, g: 255, b: 255 })).toBeCloseTo(255, 5)
    expect(luminanceOf({ r: 0, g: 0, b: 0 })).toBe(0)
  })

  it('解析缓存容量到上限会清空，不会无限增长', () => {
    clearColorCacheForTests()
    for (let index = 0; index < 600; index += 1) parseColorChannels(`#${index.toString(16)}`)
    // 缓存清过之后仍能正确解析（清空只是丢缓存，不影响语义）
    expect(parseColorChannels('#010203')).toEqual({ r: 1, g: 2, b: 3 })
  })
})
