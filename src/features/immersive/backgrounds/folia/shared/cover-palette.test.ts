import { describe, expect, it } from 'vitest'

import { extractRepresentativeColorsFromPixels } from './cover-palette'

/** 造一段 RGBA 扁平像素：count 个像素全部是同一颜色 */
function fill(count: number, r: number, g: number, b: number, a = 255): number[] {
  const out: number[] = []
  for (let index = 0; index < count; index += 1) out.push(r, g, b, a)
  return out
}

describe('extractRepresentativeColorsFromPixels', () => {
  it('权重高的色块排在前面', () => {
    const pixels = [...fill(300, 10, 20, 30), ...fill(20, 240, 10, 10)]
    expect(extractRepresentativeColorsFromPixels(pixels, 2)).toEqual(['#0a141e', '#f00a0a'])
  })

  it('透明像素（alpha < 128）被跳过', () => {
    const pixels = [...fill(10, 0, 0, 0, 0), ...fill(10, 255, 255, 255)]
    expect(extractRepresentativeColorsFromPixels(pixels, 3)).toEqual(['#ffffff'])
  })

  it('全透明 / 空输入返回空数组', () => {
    expect(extractRepresentativeColorsFromPixels([], 4)).toEqual([])
    expect(extractRepresentativeColorsFromPixels(fill(4, 1, 2, 3, 0), 4)).toEqual([])
    expect(extractRepresentativeColorsFromPixels(fill(4, 1, 2, 3), 0)).toEqual([])
  })

  it('请求数超过实际颜色数时只返回实际颜色', () => {
    const pixels = fill(50, 100, 150, 200)
    expect(extractRepresentativeColorsFromPixels(pixels, 6)).toEqual(['#6496c8'])
  })

  it('4-bit 量化：同一格内的细微差异先合并再加权平均', () => {
    // 0x0a/0x0b 落在同一量化格（>>4 都是 0），应合并成一个平均色
    const pixels = [...fill(1, 10, 10, 10), ...fill(1, 11, 11, 11)]
    expect(extractRepresentativeColorsFromPixels(pixels, 2)).toHaveLength(1)
  })

  it('能切出对比明显的多色（中位切分按权重切）', () => {
    const pixels = [
      ...fill(100, 250, 250, 250),
      ...fill(100, 5, 5, 5),
      ...fill(100, 250, 5, 5),
      ...fill(100, 5, 5, 250)
    ]
    const colors = extractRepresentativeColorsFromPixels(pixels, 4)
    expect(colors).toHaveLength(4)
    expect(new Set(colors).size).toBe(4)
  })
})
