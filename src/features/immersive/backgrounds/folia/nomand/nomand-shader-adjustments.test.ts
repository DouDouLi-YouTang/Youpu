import { describe, expect, it } from 'vitest'

import {
  NOMAND_LENS_SHAPE,
  NOMAND_OVERSCAN_LIMITS,
  NOMAND_PAPER_TEXTURE_SHAPE,
  getLensDistortionOverscan,
  getPaperTextureOverscan,
  resolveDaylightInversion,
  resolveHalftoneInversion
} from './nomand-shader-adjustments'

describe('明暗自适应反色', () => {
  it('浅色主题 + 非原色模式才翻一次', () => {
    expect(resolveDaylightInversion(false, false, true)).toBe(true)
    expect(resolveDaylightInversion(true, false, true)).toBe(false)
    // 原色模式不翻（画面主体靠原图颜色，翻亮度只会糊）
    expect(resolveDaylightInversion(false, true, true)).toBe(false)
    // 深色主题原样
    expect(resolveDaylightInversion(false, false, false)).toBe(false)
    expect(resolveDaylightInversion(true, false, false)).toBe(true)
    expect(resolveDaylightInversion(false, false, undefined)).toBe(false)
  })

  it('网点比像素画多翻一次基准（深色主题下「关闭反色」也要正常观感）', () => {
    // 深色主题：网点基准先翻一次
    expect(resolveHalftoneInversion(false, false, false)).toBe(true)
    expect(resolveHalftoneInversion(true, false, false)).toBe(false)
    // 浅色主题：在翻转后的基准上再叠明暗自适应 → 回到「不翻」
    expect(resolveHalftoneInversion(false, false, true)).toBe(false)
    expect(resolveHalftoneInversion(true, false, true)).toBe(true)
  })
})

describe('paper-texture 预放大', () => {
  it('位移量级对齐 0.0.80（约 3e-2），落在合理区间', () => {
    const overscan = getPaperTextureOverscan(0.42, 0.3)
    // 位移上界 ≈ 4.4e-2 → overscan ≈ 1.10，绝不该退化成 1（= 图像完全不位移）
    expect(overscan).toBeGreaterThan(1.05)
    expect(overscan).toBeLessThan(1.3)
  })

  it('某个入参为 0 时仍然放大（位移主要来自固定形状参数，不是用户参数）', () => {
    const overscan = getPaperTextureOverscan(0, 0)
    expect(overscan).toBeGreaterThan(1.05)
  })

  it('roughness / fiber 变大只会让预放大更大（单调，不翻转）', () => {
    const low = getPaperTextureOverscan(0, 0)
    const high = getPaperTextureOverscan(1, 1)
    expect(high).toBeGreaterThanOrEqual(low)
  })

  it('越界输入被夹住，不会算出 Infinity / NaN', () => {
    for (const overscan of [
      getPaperTextureOverscan(-5, 9),
      getPaperTextureOverscan(Number.NaN, Number.NaN),
      getPaperTextureOverscan(100, -100)
    ]) {
      expect(Number.isFinite(overscan)).toBe(true)
      expect(overscan).toBeGreaterThanOrEqual(1)
      expect(overscan).toBeLessThanOrEqual(NOMAND_OVERSCAN_LIMITS.maxOverscan)
    }
  })

  it('0.0.81 的形状参数表里没有 0.0.80 已删除的键（编译期已保证，这里防手滑加回来）', () => {
    expect(Object.keys(NOMAND_PAPER_TEXTURE_SHAPE).sort()).toEqual([
      'crumpleCount',
      'crumples',
      'distortion',
      'drops',
      'fiberSize',
      'foldOffsetX',
      'foldOffsetY',
      'foldSizeX',
      'foldSizeY',
      'folds',
      'roughnessRows',
      'roughnessSize',
      'seed',
      'wrinkleSize',
      'wrinkles'
    ])
    // crumpleCount 必须落在 0.0.81 声明的 2–15 内（paperTextureMeta.maxCrumpleCount = 15）
    expect(NOMAND_PAPER_TEXTURE_SHAPE.crumpleCount).toBeGreaterThanOrEqual(2)
    expect(NOMAND_PAPER_TEXTURE_SHAPE.crumpleCount).toBeLessThanOrEqual(15)
    // foldSize 的取值域是 0.5–3，这里刻意取 0（= 最多折痕），不能「修正」成 0.5
    expect(NOMAND_PAPER_TEXTURE_SHAPE.foldSizeX).toBe(0)
  })
})

describe('lens-distortion 预放大', () => {
  it('bulge <= 0（向内收缩）只留色散余量，不放大到夸张', () => {
    const overscan = getLensDistortionOverscan(0, 0.45)
    expect(overscan).toBeGreaterThanOrEqual(1)
    expect(overscan).toBeLessThan(1.25)
  })

  it('bulge 越大预放大越大（单调递增）', () => {
    const values = [-0.5, 0, 0.3, 0.6, 1].map((bulge) => getLensDistortionOverscan(bulge, 0.45))
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThanOrEqual(values[index - 1])
    }
    expect(values.at(-1)).toBeGreaterThan(values[0])
  })

  it('极端参数被上限挡住（不会算出 Infinity，tan 也不会饱和到爆）', () => {
    for (const value of [
      getLensDistortionOverscan(1, 1),
      getLensDistortionOverscan(5, 5),
      getLensDistortionOverscan(Number.NaN, Number.NaN),
      getLensDistortionOverscan(-1, -1)
    ]) {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(1)
      expect(value).toBeLessThanOrEqual(NOMAND_OVERSCAN_LIMITS.maxOverscan)
    }
  })

  it('默认 tuning 下预放大接近 1.1（既遮住位移又不把封面裁没）', () => {
    const overscan = getLensDistortionOverscan(0.3, 0.45)
    expect(overscan).toBeGreaterThan(1.0)
    expect(overscan).toBeLessThan(1.35)
  })

  it('镜头固定形状参数与 Folia 一致（overscan 依赖 focusEdges）', () => {
    expect(NOMAND_LENS_SHAPE).toEqual({
      perspective: 0.4,
      count: 20,
      focusCenter: 0.55,
      focusEdges: 0.8,
      swirl: 0.08,
      lensCircle: 0.1
    })
  })
})
