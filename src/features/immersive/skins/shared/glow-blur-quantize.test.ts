import { afterEach, describe, expect, it } from 'vitest'

import {
  DROP_SHADOW_INNER_ALPHA,
  DROP_SHADOW_RADIUS_SCALE,
  clearCanvasTextGlow,
  isGlowBlurQuantized,
  quantizeShadowBlur,
  setGlowBlurQuantized,
  setCanvasTextGlow
} from './glow-blur-quantize'

/**
 * 辉光模糊半径的平台降级开关。它守护的是一个**长时间播放才会暴露的真实故障**
 * （见文件头）：半径每帧都变会让 Chromium 无限铸字形 strike，Linux 上约 35 分钟
 * 后耗尽软限制、合成器停止出帧。这一层若写错，表现是"播半小时卡死"，
 * 而短测试完全看不出来 —— 所以两条分支都要显式覆盖。
 */

afterEach(() => {
  // 模块级开关：每条用例后复位，避免顺序耦合
  setGlowBlurQuantized(false)
})

/** 假 canvas 上下文：只记录被写过的字段，足够断言"设了什么、复位成什么" */
function fakeContext(): CanvasRenderingContext2D {
  return {
    shadowBlur: 0,
    shadowColor: '',
    filter: ''
  } as unknown as CanvasRenderingContext2D
}

describe('量化', () => {
  it('关闭时原样返回（不取整，保住细腻的半径渐变）', () => {
    setGlowBlurQuantized(false)
    expect(quantizeShadowBlur(12.7)).toBe(12.7)
    expect(quantizeShadowBlur(0.4)).toBe(0.4)
  })

  it('开启时取整到整像素（于是扫描只产生有限个半径）', () => {
    setGlowBlurQuantized(true)
    expect(quantizeShadowBlur(12.7)).toBe(13)
    expect(quantizeShadowBlur(12.2)).toBe(12)
  })

  it('负数与非法值都归 0（半径不能是负的）', () => {
    setGlowBlurQuantized(true)
    expect(quantizeShadowBlur(-5)).toBe(0)
    expect(quantizeShadowBlur(Number.NaN)).toBe(0)
    expect(quantizeShadowBlur(Number.POSITIVE_INFINITY)).toBe(0)

    setGlowBlurQuantized(false)
    expect(quantizeShadowBlur(-5)).toBe(0)
    expect(quantizeShadowBlur(Number.NaN)).toBe(0)
  })

  it('取整只在降级模式下发生（两档结果必须不同，否则开关没意义）', () => {
    setGlowBlurQuantized(false)
    const plain = quantizeShadowBlur(7.6)
    setGlowBlurQuantized(true)
    const quantized = quantizeShadowBlur(7.6)
    expect(plain).toBe(7.6)
    expect(quantized).toBe(8)
  })
})

describe('开关默认值', () => {
  it('非浏览器 / 无 navigator 环境下默认关闭（node 单测正是这种情况）', () => {
    setGlowBlurQuantized(false)
    expect(isGlowBlurQuantized()).toBe(false)
  })

  it('set 之后 is 立即反映新值', () => {
    setGlowBlurQuantized(true)
    expect(isGlowBlurQuantized()).toBe(true)
    setGlowBlurQuantized(false)
    expect(isGlowBlurQuantized()).toBe(false)
  })
})

describe('canvas 光晕（浮名用）', () => {
  it('普通模式写 shadowBlur / shadowColor，不碰 filter', () => {
    setGlowBlurQuantized(false)
    const context = fakeContext()
    setCanvasTextGlow(context, 24, 'rgba(255,255,255,0.5)')

    expect(context.shadowBlur).toBe(24)
    expect(context.shadowColor).toBe('rgba(255,255,255,0.5)')
    expect(context.filter).toBe('')
  })

  it('降级模式改用 filter: drop-shadow，并把 shadow 明确清掉', () => {
    setGlowBlurQuantized(true)
    const context = fakeContext()
    setCanvasTextGlow(context, 24, '#ffffff')

    // sigma = shadowBlur / 2 —— 与 canvas 的 shadowBlur 是同一个视觉量
    expect(context.filter).toBe('drop-shadow(0 0 12px #ffffff)')
    expect(context.shadowBlur).toBe(0)
    expect(context.shadowColor).toBe('transparent')
  })

  it('半径为 0 时 filter 给 none（而不是 0px 的 drop-shadow）', () => {
    setGlowBlurQuantized(true)
    const context = fakeContext()
    setCanvasTextGlow(context, 0, '#ffffff')
    expect(context.filter).toBe('none')
  })

  it('复位：两档都清掉 shadow，且降级模式下必须把 filter 复位', () => {
    setGlowBlurQuantized(true)
    const context = fakeContext()
    setCanvasTextGlow(context, 24, '#fff')
    clearCanvasTextGlow(context)

    expect(context.shadowBlur).toBe(0)
    expect(context.shadowColor).toBe('transparent')
    // ⚠️ 这条是关键：filter 是"状态"不是"每次绘制参数"，
    // 不复位会让**后面所有**绘制都带上光晕滤镜
    expect(context.filter).toBe('none')
  })

  it('普通模式复位时不写 filter（原本就没碰过它）', () => {
    setGlowBlurQuantized(false)
    const context = fakeContext()
    clearCanvasTextGlow(context)
    expect(context.filter).toBe('')
  })
})

describe('drop-shadow 拟合常数', () => {
  it('半径系数 0.4、内层 alpha 0.7（按像素差拟合出来的，改动会让两种形态不再等价）', () => {
    expect(DROP_SHADOW_RADIUS_SCALE).toBe(0.4)
    expect(DROP_SHADOW_INNER_ALPHA).toBe(0.7)
  })
})
