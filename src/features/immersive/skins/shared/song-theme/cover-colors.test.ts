import { describe, expect, it } from 'vitest'

import { extractVibrantColorsFromPixels } from './cover-colors'

/** 把 `[r,g,b]` 展开成 RGBA 扁平数组（`ImageData.data` 的形状） */
function rgba(pixels: readonly (readonly [number, number, number])[], alpha = 255): number[] {
  return pixels.flatMap(([r, g, b]) => [r, g, b, alpha])
}

describe('extractVibrantColorsFromPixels', () => {
  it('一张纯色图返回那一个颜色', () => {
    const pixels = rgba(Array.from({ length: 64 }, () => [180, 60, 20] as const))
    const colors = extractVibrantColorsFromPixels(pixels, 5)

    expect(colors).toHaveLength(1)
    expect(colors[0]).toBe('#b43c14')
  })

  it('鲜艳色排在近中性色前面', () => {
    // 先铺一堆灰，再放一个饱和红：按面积灰占绝大多数，但饱和度排序应让红在前
    const pixels = rgba([
      ...Array.from({ length: 200 }, () => [128, 128, 128] as const),
      ...Array.from({ length: 4 }, () => [200, 30, 30] as const)
    ])
    const colors = extractVibrantColorsFromPixels(pixels, 2)

    expect(colors[0]).toBe('#c81e1e')
  })

  it('相近的颜色会被合并成一个（最小距离门槛）', () => {
    const pixels = rgba([
      ...Array.from({ length: 20 }, () => [200, 30, 30] as const),
      ...Array.from({ length: 20 }, () => [204, 34, 34] as const)
    ])
    const colors = extractVibrantColorsFromPixels(pixels, 5)

    expect(colors).toHaveLength(1)
  })

  it('距离够远的多个颜色都会被保留', () => {
    const pixels = rgba([
      ...Array.from({ length: 10 }, () => [200, 30, 30] as const),
      ...Array.from({ length: 10 }, () => [30, 90, 200] as const),
      ...Array.from({ length: 10 }, () => [40, 180, 60] as const)
    ])
    const colors = extractVibrantColorsFromPixels(pixels, 3)

    expect(colors).toHaveLength(3)
  })

  it('透明像素被跳过', () => {
    const pixels = [
      ...[0, 0, 0, 0],
      ...[255, 255, 255, 10],
      ...[200, 40, 40, 255],
      ...[200, 40, 40, 255]
    ]
    const colors = extractVibrantColorsFromPixels(pixels, 5)

    expect(colors).toEqual(['#c82828'])
  })

  it('全透明的图返回空数组（调用方走无封面路径）', () => {
    const pixels = rgba(
      Array.from({ length: 16 }, () => [10, 20, 30] as const),
      0
    )
    expect(extractVibrantColorsFromPixels(pixels, 5)).toEqual([])
  })

  it('count 为 0 时返回空数组', () => {
    const pixels = rgba(Array.from({ length: 16 }, () => [10, 20, 30] as const))
    expect(extractVibrantColorsFromPixels(pixels, 0)).toEqual([])
  })

  it('黑白封面走低饱和保底，仍然给出颜色（不会退化成「无封面」）', () => {
    const pixels = rgba([
      ...Array.from({ length: 50 }, () => [20, 20, 22] as const),
      ...Array.from({ length: 50 }, () => [230, 230, 232] as const)
    ])
    const colors = extractVibrantColorsFromPixels(pixels, 5)

    expect(colors.length).toBeGreaterThan(0)
  })

  it('隔点采样：像素数不足一个步长时仍能取到颜色', () => {
    // 采样步长为 2 个像素，只给 1 个像素时必须仍然命中下标 0
    expect(extractVibrantColorsFromPixels([200, 40, 40, 255], 5)).toEqual(['#c82828'])
  })

  it('输出是按饱和度降序的', () => {
    const pixels = rgba([
      ...Array.from({ length: 8 }, () => [170, 120, 120] as const), // 低饱和
      ...Array.from({ length: 8 }, () => [220, 20, 20] as const), // 高饱和
      ...Array.from({ length: 8 }, () => [120, 100, 160] as const) // 中饱和
    ])
    const colors = extractVibrantColorsFromPixels(pixels, 3)

    expect(colors[0]).toBe('#dc1414')
  })
})
