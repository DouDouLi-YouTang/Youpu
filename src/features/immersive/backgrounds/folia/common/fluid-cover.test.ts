import { describe, expect, it } from 'vitest'

import {
  COVER_BLUR_SOURCE_MAX,
  FLUID_NO_COVER_OPACITY,
  appendFluidCoverLayer,
  dropFluidCoverLayer,
  resolveFluidBlendOverlayOpacity,
  resolveFluidCoverOpacity,
  settleFluidCoverLayers,
  type FluidCoverLayer
} from './fluid-cover'

const layer = (key: number, sourceCover = `cover-${key}`): FluidCoverLayer => ({
  key,
  sourceCover,
  url: `blob:${key}`
})

describe('common 常量', () => {
  it('降采样上限是 384（决定会不会出现网格状闪烁，不是性能参数）', () => {
    expect(COVER_BLUR_SOURCE_MAX).toBe(384)
  })

  it('无封面时的主题底色不透明度是 0.8', () => {
    expect(FLUID_NO_COVER_OPACITY).toBe(0.8)
  })

  it('顶层混合渐变：非 iOS 0.4 / overlay，iOS 0.2 / normal', () => {
    expect(resolveFluidBlendOverlayOpacity(false)).toBe(0.4)
    expect(resolveFluidBlendOverlayOpacity(true)).toBe(0.2)
  })
})

describe('交叉淡入的层管理', () => {
  it('第一层直接加入', () => {
    expect(appendFluidCoverLayer([], 'blob:1', 'cover-A', 1)).toEqual([
      { key: 1, sourceCover: 'cover-A', url: 'blob:1' }
    ])
  })

  it('第二层压到两层：保留旧顶 + 新来的（旧顶在新层下面淡出）', () => {
    const first = appendFluidCoverLayer([], 'blob:1', 'cover-A', 1)
    const second = appendFluidCoverLayer(first, 'blob:2', 'cover-B', 2)
    expect(second).toHaveLength(2)
    expect(second.map((item) => item.key)).toEqual([1, 2])
  })

  it('第三层仍然只有两层（层数不随切歌次数增长）', () => {
    let layers = appendFluidCoverLayer([], 'blob:1', 'cover-A', 1)
    layers = appendFluidCoverLayer(layers, 'blob:2', 'cover-B', 2)
    layers = appendFluidCoverLayer(layers, 'blob:3', 'cover-C', 3)
    expect(layers.map((item) => item.key)).toEqual([2, 3])
  })

  it('同一张封面重复推送返回原数组（不触发第二轮淡入）', () => {
    const first = appendFluidCoverLayer([], 'blob:1', 'cover-A', 1)
    const again = appendFluidCoverLayer(first, 'blob:1b', 'cover-A', 2)
    expect(again).toBe(first)
  })

  it('淡入结束后只留顶层，并把 readyKeys 收缩成一把', () => {
    const layers = [layer(1), layer(2)]
    const settled = settleFluidCoverLayers(layers, 2)
    expect(settled.layers.map((item) => item.key)).toEqual([2])
    expect([...settled.readyKeys]).toEqual([2])
  })

  it('加载失败剔除该层，但最后一层永不移除', () => {
    expect(dropFluidCoverLayer([layer(1), layer(2)], 1).map((item) => item.key)).toEqual([2])
    const single = [layer(1)]
    expect(dropFluidCoverLayer(single, 1)).toBe(single)
  })
})

describe('某层的目标不透明度', () => {
  it('顶层在 decode 完成前是 0，完成后是 1', () => {
    expect(resolveFluidCoverOpacity(true, false)).toBe(0)
    expect(resolveFluidCoverOpacity(true, true)).toBe(1)
  })

  it('非顶层恒为 1（正在淡出的是外层 wrapper 的 opacity）', () => {
    expect(resolveFluidCoverOpacity(false, false)).toBe(1)
    expect(resolveFluidCoverOpacity(false, true)).toBe(1)
  })
})
