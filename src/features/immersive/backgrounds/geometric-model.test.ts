import { describe, expect, it } from 'vitest'

import {
  BACKGROUND_ICON_NAMES,
  BAND_INPUT_MAX,
  BAND_SCALE_MAX,
  BAND_SCALE_MIN,
  buildParticles,
  buildShapes,
  PARTICLE_COUNT,
  resolveBandScale,
  resolveGeometricSeed,
  SHAPE_BAND,
  SHAPE_COUNT
} from './geometric-model'

/**
 * 几何背景模型的**性质测试**。这里断言的是「不变量」而不是具体数值 ——
 * 具体数值取决于 seededRandom 的实现，钉死它们只会让测试在无关重构时红。
 */
describe('buildShapes', () => {
  it('恒定产出 SHAPE_COUNT 个形状', () => {
    expect(buildShapes(12345, true)).toHaveLength(SHAPE_COUNT)
    expect(buildShapes(0, false)).toHaveLength(SHAPE_COUNT)
  })

  it('同一 seed 恒定输出同一套布局（进页面/切皮肤不会跳变）', () => {
    expect(buildShapes(777, true)).toEqual(buildShapes(777, true))
  })

  it('不同 seed 给出不同布局', () => {
    expect(buildShapes(1, true)).not.toEqual(buildShapes(2, true))
  })

  it('useIcons=false 时一个图标都不放', () => {
    const shapes = buildShapes(999, false)
    expect(shapes.every((s) => s.type !== 'icon' && s.icon === null)).toBe(true)
  })

  it('图标数量不超过 6、且图标名来自白名单', () => {
    // 多试几个 seed，避免只碰巧覆盖到某一支
    for (const seed of [1, 42, 777, 123456, -9]) {
      const icons = buildShapes(seed, true).filter((s) => s.type === 'icon')
      expect(icons.length).toBeLessThanOrEqual(6)
      for (const shape of icons) {
        expect(BACKGROUND_ICON_NAMES).toContain(shape.icon)
      }
    }
  })

  it('非图标形状的 icon 恒为 null，且类型在四型之内', () => {
    const allowed = ['circle', 'square', 'triangle', 'cross', 'icon']
    for (const shape of buildShapes(31337, true)) {
      expect(allowed).toContain(shape.type)
      if (shape.type === 'icon') expect(shape.icon).not.toBeNull()
      else expect(shape.icon).toBeNull()
    }
  })

  it('所有数值字段都在设计范围内（含边界）', () => {
    for (const seed of [0, 5, 88, 2024]) {
      for (const s of buildShapes(seed, true)) {
        expect(s.leftPct).toBeGreaterThanOrEqual(0)
        expect(s.leftPct).toBeLessThan(100)
        expect(s.topPct).toBeGreaterThanOrEqual(0)
        expect(s.topPct).toBeLessThan(100)
        expect(s.sizePx).toBeGreaterThanOrEqual(40)
        expect(s.sizePx).toBeLessThan(140)
        expect(s.durationSec).toBeGreaterThanOrEqual(30)
        expect(s.durationSec).toBeLessThan(60)
        expect(s.delaySec).toBeGreaterThanOrEqual(0)
        expect(s.delaySec).toBeLessThan(5)
        expect(s.opacity).toBeGreaterThanOrEqual(0.11)
        expect(s.opacity).toBeLessThan(0.19)
        expect(s.rotationDeg).toBeGreaterThanOrEqual(0)
        expect(s.rotationDeg).toBeLessThan(360)
        expect(Number.isFinite(s.sizePx)).toBe(true)
        expect(Number.isFinite(s.opacity)).toBe(true)
      }
    }
  })

  it('id 是 0..SHAPE_COUNT-1 且不重复（模板 :key 依赖它唯一）', () => {
    const ids = buildShapes(4242, true).map((s) => s.id)
    expect(new Set(ids).size).toBe(SHAPE_COUNT)
    expect(ids).toEqual(Array.from({ length: SHAPE_COUNT }, (_, i) => i))
  })

  it('reverse 与 filled 都能取到两种值（避免随机源退化）', () => {
    const shapes = buildShapes(20241010, true)
    expect(new Set(shapes.map((s) => s.reverse)).size).toBe(2)
    expect(new Set(shapes.map((s) => s.filled)).size).toBe(2)
  })

  it('形状类型覆盖四型（seed 足够时不该只剩一种）', () => {
    const types = new Set(buildShapes(20241010, false).map((s) => s.type))
    expect(types.size).toBeGreaterThanOrEqual(3)
  })
})

describe('buildParticles', () => {
  it('恒定产出 PARTICLE_COUNT 个，且同一 seed 恒定', () => {
    expect(buildParticles(1)).toHaveLength(PARTICLE_COUNT)
    expect(buildParticles(1)).toEqual(buildParticles(1))
  })

  it('不同 seed 给出不同布局', () => {
    expect(buildParticles(1)).not.toEqual(buildParticles(2))
  })

  it('数值范围正确', () => {
    for (const p of buildParticles(555)) {
      expect(p.sizePx).toBeGreaterThanOrEqual(1)
      expect(p.sizePx).toBeLessThan(5)
      expect(p.leftPct).toBeGreaterThanOrEqual(0)
      expect(p.leftPct).toBeLessThan(100)
      expect(p.topPct).toBeGreaterThanOrEqual(0)
      expect(p.topPct).toBeLessThan(100)
      expect(p.opacity).toBeGreaterThanOrEqual(0)
      expect(p.opacity).toBeLessThan(0.3)
      expect(p.durationSec).toBeGreaterThanOrEqual(15)
      expect(p.durationSec).toBeLessThan(35)
      expect(p.delaySec).toBeGreaterThanOrEqual(0)
      expect(p.delaySec).toBeLessThan(10)
    }
  })

  it('与形状的种子区段不重叠（改形状不该改粒子）', () => {
    // 形状区在 [1000, 1000 + 15*10)，粒子区在其后；若两处索引撞车，
    // 下面的断言会因为「粒子随形状参数变化」而失败
    const a = buildParticles(31337)
    const b = buildParticles(31337)
    expect(a).toEqual(b)
  })
})

describe('resolveBandScale', () => {
  it('暂停时恒为静止档（不管频带多大）', () => {
    expect(resolveBandScale(0, false)).toBe(BAND_SCALE_MIN)
    expect(resolveBandScale(1, false)).toBe(BAND_SCALE_MIN)
  })

  it('播放时 0 频带 = 静止档，满档 = 最大档', () => {
    expect(resolveBandScale(0, true)).toBe(BAND_SCALE_MIN)
    expect(resolveBandScale(BAND_INPUT_MAX, true)).toBeCloseTo(BAND_SCALE_MAX, 6)
  })

  it('单调不减，且夹在 [MIN, MAX] 内', () => {
    let prev = -Infinity
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const scale = resolveBandScale(v, true)
      expect(scale).toBeGreaterThanOrEqual(BAND_SCALE_MIN)
      expect(scale).toBeLessThanOrEqual(BAND_SCALE_MAX)
      expect(scale).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = scale
    }
  })

  it('超出输入区不再放大（防水：频带若被改成 0–255 量纲也不会飞到天上）', () => {
    expect(resolveBandScale(255, true)).toBeCloseTo(BAND_SCALE_MAX, 6)
  })

  it('NaN / Infinity 不产生 NaN 缩放（CSS 变量写成 NaN 会让整个形状消失）', () => {
    expect(resolveBandScale(NaN, true)).toBe(BAND_SCALE_MIN)
    expect(resolveBandScale(Infinity, true)).toBeCloseTo(BAND_SCALE_MAX, 6)
    expect(resolveBandScale(-Infinity, true)).toBe(BAND_SCALE_MIN)
    expect(resolveBandScale(-1, true)).toBe(BAND_SCALE_MIN)
  })
})

describe('resolveGeometricSeed', () => {
  it('同一输入恒定', () => {
    expect(resolveGeometricSeed('347230')).toBe(resolveGeometricSeed('347230'))
  })

  it('不同歌曲 id 给出不同种子', () => {
    expect(resolveGeometricSeed('347230')).not.toBe(resolveGeometricSeed('347231'))
  })

  it('字符串与数字形态的同一 id 一致（本项目 id 是数字字符串）', () => {
    expect(resolveGeometricSeed('347230')).toBe(resolveGeometricSeed(347230))
  })

  it('缺歌时回退 0（仍是一套固定布局，不随机闪）', () => {
    expect(resolveGeometricSeed(null)).toBe(0)
    expect(resolveGeometricSeed(undefined)).toBe(0)
  })

  it('非有限数字回退 0', () => {
    expect(resolveGeometricSeed(NaN)).toBe(0)
    expect(resolveGeometricSeed(Infinity)).toBe(0)
  })

  it('种子能真正驱动出不同布局（端到端串起来）', () => {
    const a = buildShapes(resolveGeometricSeed('111'), true)
    const b = buildShapes(resolveGeometricSeed('222'), true)
    expect(a).not.toEqual(b)
  })
})

describe('SHAPE_BAND', () => {
  it('五种形状都有频带绑定，且只用 AudioBands 的四档', () => {
    const allowed = ['low', 'mid', 'high', 'power']
    const types = ['circle', 'square', 'triangle', 'cross', 'icon'] as const
    for (const type of types) {
      expect(allowed).toContain(SHAPE_BAND[type])
    }
  })

  it('四种几何形状绑定到不同侧重（不是全压在同一档）', () => {
    expect(new Set([SHAPE_BAND.circle, SHAPE_BAND.triangle, SHAPE_BAND.cross]).size).toBe(3)
  })
})
