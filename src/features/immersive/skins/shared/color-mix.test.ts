import { describe, expect, it } from 'vitest'

import { colorWithAlpha, mixColors, parseColorChannels } from './color-mix'

describe('colorWithAlpha（上游 colorMix.ts 的三条怪癖）', () => {
  it('3 位 hex 展开成 6 位通道', () => {
    expect(colorWithAlpha('#abc', 1)).toBe('rgba(170, 187, 204, 1)')
    expect(colorWithAlpha('#f00', 0.5)).toBe('rgba(255, 0, 0, 0.5)')
  })

  it('6 位 hex 按通道解析', () => {
    expect(colorWithAlpha('#1c1917', 0.74)).toBe('rgba(28, 25, 23, 0.74)')
    expect(colorWithAlpha('#FFFFFF', 0)).toBe('rgba(255, 255, 255, 0)')
  })

  it('rgb() / rgba() 只取前三个通道（原有 alpha 被替换）', () => {
    expect(colorWithAlpha('rgb(10, 20, 30)', 0.5)).toBe('rgba(10, 20, 30, 0.5)')
    expect(colorWithAlpha('rgba(10, 20, 30, 0.9)', 0.25)).toBe('rgba(10, 20, 30, 0.25)')
    // 通道留白与小数都能解析
    expect(colorWithAlpha('rgb( 10.4 , 20.6 , 30 )', 1)).toBe('rgba(10, 21, 30, 1)')
  })

  it('解析失败回退白色（不是黑色 —— 深色纸面上黑字等于看不见）', () => {
    for (const broken of ['', '   ', '#12', '#12345', 'rgb(1,2)', 'rgb(a,b,c)']) {
      expect(colorWithAlpha(broken, 0.3)).toBe('rgba(255, 255, 255, 0.3)')
    }
  })

  it('命名色 / hsl() 原样返回，alpha 被忽略（上游行为，不要"修复"）', () => {
    expect(colorWithAlpha('transparent', 0.5)).toBe('transparent')
    expect(colorWithAlpha('red', 0)).toBe('red')
    expect(colorWithAlpha('hsl(200, 50%, 50%)', 0.2)).toBe('hsl(200, 50%, 50%)')
    // 前后空白会被归一化掉
    expect(colorWithAlpha('  transparent  ', 0.5)).toBe('transparent')
  })

  it('alpha 被钳到 [0, 1]，通道被钳到 [0, 255]', () => {
    expect(colorWithAlpha('#000000', -3)).toBe('rgba(0, 0, 0, 0)')
    expect(colorWithAlpha('#000000', 9)).toBe('rgba(0, 0, 0, 1)')
    // 越界通道来自 rgb() 输入（hex 不可能越界）
    expect(colorWithAlpha('rgb(300, -20, 128)', 1)).toBe('rgba(255, 0, 128, 1)')
  })

  it('非字符串输入按空串处理（回退白色）', () => {
    expect(colorWithAlpha(undefined as unknown as string, 0.5)).toBe('rgba(255, 255, 255, 0.5)')
  })
})

describe('parseColorChannels', () => {
  it('hex / rgb() 给出通道副本', () => {
    const channels = parseColorChannels('#010203')
    expect(channels).toEqual({ r: 1, g: 2, b: 3 })
    // 必须是副本：调用方改它不能污染缓存
    channels!.r = 200
    expect(parseColorChannels('#010203')).toEqual({ r: 1, g: 2, b: 3 })
  })

  it('命名色 / hsl() / 坏值一律 null', () => {
    for (const color of ['red', 'transparent', 'hsl(1,2%,3%)', '#12', 'rgb(1,2)', '']) {
      expect(parseColorChannels(color)).toBeNull()
    }
  })
})

describe('mixColors（浮名的字色拖尾与背景渐变都读它）', () => {
  it('端点精确等于 from / to，中点是通道线性插值', () => {
    expect(mixColors('#000000', '#ffffff', 0)).toBe('rgba(0, 0, 0, 1)')
    expect(mixColors('#000000', '#ffffff', 1)).toBe('rgba(255, 255, 255, 1)')
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('rgba(128, 128, 128, 1)')
  })

  it('amount 被钳到 [0, 1]（外插不外溢）', () => {
    expect(mixColors('#000000', '#ffffff', -5)).toBe('rgba(0, 0, 0, 1)')
    expect(mixColors('#000000', '#ffffff', 5)).toBe('rgba(255, 255, 255, 1)')
  })

  it('第四参数直接作为 alpha，被钳到 [0, 1]', () => {
    expect(mixColors('#000000', '#ffffff', 0.5, 0.3)).toBe('rgba(128, 128, 128, 0.3)')
    expect(mixColors('#000000', '#ffffff', 0.5, 9)).toBe('rgba(128, 128, 128, 1)')
  })

  it('任一端无法解析时退化成"按 0.5 二选一 + 加 alpha"', () => {
    expect(mixColors('red', '#ffffff', 0.2)).toBe('red')
    expect(mixColors('red', '#ffffff', 0.8)).toBe('rgba(255, 255, 255, 1)')
    // 端点解析失败（坏 hex）时二选一也走 colorWithAlpha，于是回退白色
    expect(mixColors('#zzzzzz', '#ffffff', 0.8)).toBe('rgba(255, 255, 255, 1)')
  })
})
