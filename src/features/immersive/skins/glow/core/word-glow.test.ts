import { afterEach, describe, expect, it } from 'vitest'

import { setGlowBlurQuantized } from '../../shared/glow-blur-quantize'
import {
  GLOW_RADII,
  SWEEP_DURATION_FACTOR,
  buildGlowKeyframes,
  buildGlowKeyframesQuantized,
  dropShadowAt,
  textShadowAt,
  type WithAlpha
} from './word-glow'

/**
 * 「流光」的辉光参数层。这里全是**字符串拼接**，但拼错一位数字的表现是
 * "光晕大小不对 / 颜色全白"，而且只在逐字素扫描时才看得出来 —— 所以逐条钉死。
 *
 * 两个形态（text-shadow / drop-shadow）必须给出**等价的观感**：
 * 这是本文件最重要的一组断言，见「两种形态的等价性」。
 */

afterEach(() => {
  // 模块级开关是全局状态，任何一条测试改过它都必须复位，否则会污染后面展开的用例
  setGlowBlurQuantized(false)
})

/**
 * 测试用的 alpha 工具：处理 3 位 / 6 位 hex，其它原样返回
 * （与真实实现 `colorWithAlpha` 的契约一致 —— 非 hex/rgb 的颜色透传，不变成白色）。
 */
const withAlpha: WithAlpha = (color, alpha) => {
  const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color)?.[1]
  if (!hex) return color
  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => char + char)
          .join('')
      : hex
  const r = Number.parseInt(expanded.slice(0, 2), 16)
  const g = Number.parseInt(expanded.slice(2, 4), 16)
  const b = Number.parseInt(expanded.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

describe('半径档位', () => {
  it('持续辉光与扫描辉光同半径（20 / 40）—— 同一句话里两种词不该有两种光晕大小', () => {
    expect(GLOW_RADII.sustained).toEqual({ inner: 20, outer: 40 })
    expect(GLOW_RADII.sweep).toEqual(GLOW_RADII.sustained)
  })

  it('instant 档半径最小（14 / 24），fast 居中（18 / 32）', () => {
    expect(GLOW_RADII.instant).toEqual({ inner: 14, outer: 24 })
    expect(GLOW_RADII.fast).toEqual({ inner: 18, outer: 32 })
  })

  it('持续 / 扫描档的内外层是 2 倍关系，短行两档不是（原样，别统一）', () => {
    // sustained / sweep：20 / 40（正好两倍）
    expect(GLOW_RADII.sustained.outer).toBe(GLOW_RADII.sustained.inner * 2)
    expect(GLOW_RADII.sweep.outer).toBe(GLOW_RADII.sweep.inner * 2)
    // instant 14 / 24、fast 18 / 32 —— 观感上更"紧"，不遵循两倍，这是上游原样
    expect(GLOW_RADII.instant.outer).not.toBe(GLOW_RADII.instant.inner * 2)
    expect(GLOW_RADII.fast.outer).not.toBe(GLOW_RADII.fast.inner * 2)
  })

  it('外层半径随档位"从紧到松"单调：instant < fast < sustained', () => {
    expect(GLOW_RADII.instant.outer).toBeLessThan(GLOW_RADII.fast.outer)
    expect(GLOW_RADII.fast.outer).toBeLessThan(GLOW_RADII.sustained.outer)
  })
})

describe('text-shadow 形态', () => {
  it('双层阴影，内层在前、外层在后', () => {
    expect(textShadowAt('#fff', 20, 40)).toBe('0 0 20px #fff, 0 0 40px #fff')
  })

  it('关键帧里字色恒为透明（辉光层只出影子不出字）', () => {
    expect(buildGlowKeyframes('#fff', 20, 40, [0, 1, 0]).color).toBe('transparent')
  })

  it('强度为 0 的关键帧给 none（不是 0px 阴影）', () => {
    expect(buildGlowKeyframes('#fff', 20, 40, [0, 1, 0]).textShadow).toEqual([
      'none',
      '0 0 20px #fff, 0 0 40px #fff',
      'none'
    ])
  })

  it('关键帧数量与 peaks 一致', () => {
    for (const peaks of [
      [0, 1, 0],
      [0, 1, 1],
      [0, 1]
    ]) {
      expect(buildGlowKeyframes('#fff', 20, 40, peaks).textShadow).toHaveLength(peaks.length)
    }
  })

  it('非 0 强度一律给满半径（text-shadow 版本不做半径插值，靠 opacity/关键帧）', () => {
    // ⚠️ 原样：`peak > 0` 就是满强度，不乘 peak。半径随强度缩放是 drop-shadow 版本的行为。
    const frames = buildGlowKeyframes('#fff', 20, 40, [0.1, 0.5, 1]).textShadow
    expect(frames[0]).toBe(frames[1])
    expect(frames[1]).toBe(frames[2])
  })
})

describe('drop-shadow 形态', () => {
  it('半径按 0.4 缩放、内层 alpha 为 0.7', () => {
    const result = dropShadowAt('#ff0000', 20, 40, withAlpha)
    expect(result).toBe('drop-shadow(0 0 8px rgba(255, 0, 0, 0.7)) drop-shadow(0 0 16px #ff0000)')
  })

  it('字色是实色（透明字投不出影子）', () => {
    expect(buildGlowKeyframesQuantized('#ff0000', 20, 40, [0, 1], withAlpha).color).toBe('#ff0000')
  })

  it('半径随强度一起缩放（光晕"长大"的过程）', () => {
    const frames = buildGlowKeyframesQuantized('#fff', 20, 40, [0, 0.5, 1], withAlpha).filter
    expect(frames[0]).toBe(
      'drop-shadow(0 0 0px rgba(255, 255, 255, 0.7)) drop-shadow(0 0 0px #fff)'
    )
    expect(frames[1]).toBe(
      'drop-shadow(0 0 4px rgba(255, 255, 255, 0.7)) drop-shadow(0 0 8px #fff)'
    )
    expect(frames[2]).toBe(
      'drop-shadow(0 0 8px rgba(255, 255, 255, 0.7)) drop-shadow(0 0 16px #fff)'
    )
  })

  it('opacity 直接吃 peaks（承载旧版 text-shadow 的 alpha 斜坡）', () => {
    expect(buildGlowKeyframesQuantized('#fff', 20, 40, [0, 0.3, 1], withAlpha).opacity).toEqual([
      0, 0.3, 1
    ])
  })

  it('非 hex/rgb 颜色透传（withAlpha 交给调用方决定），不变成白色', () => {
    const passthrough: WithAlpha = (color) => color
    const result = dropShadowAt('hsl(0 100% 50%)', 20, 40, passthrough)
    expect(result).toContain('hsl(0 100% 50%)')
    expect(result).not.toContain('255')
  })

  it('opacity 数组是副本：改它不会改到入参 peaks', () => {
    const peaks = [0, 1]
    const result = buildGlowKeyframesQuantized('#fff', 20, 40, peaks, withAlpha)
    result.opacity[0] = 99
    expect(peaks[0]).toBe(0)
  })
})

describe('两种形态的等价性（降级不能改变观感）', () => {
  it('同一组峰值下两者的帧数一致，且都以"无光晕"起止', () => {
    const peaks = [0, 1, 0]
    const plain = buildGlowKeyframes('#fff', 20, 40, peaks)
    const quantized = buildGlowKeyframesQuantized('#fff', 20, 40, peaks, withAlpha)

    expect(quantized.filter).toHaveLength(plain.textShadow.length)
    expect(plain.textShadow[0]).toBe('none')
    expect(plain.textShadow[2]).toBe('none')
    expect(quantized.opacity[0]).toBe(0)
    expect(quantized.opacity[2]).toBe(0)
  })
})

describe('扫描时长系数', () => {
  it('为 6：把一个字的淡出拉过后面几个字，才有"扫过去"的感觉', () => {
    expect(SWEEP_DURATION_FACTOR).toBe(6)
  })
})
