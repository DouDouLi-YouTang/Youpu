import { afterEach, describe, expect, it } from 'vitest'

import {
  DROP_SHADOW_INNER_ALPHA,
  DROP_SHADOW_RADIUS_SCALE,
  clearCanvasTextGlow,
  fillGlowText,
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

/**
 * `fillGlowText` 的假 context：记录调用序列，并让 `measureText` 返回一组**好算**的
 * 包围盒（left 10 / right 90 / ascent 30 / descent 10），这样 pad 与裁剪矩形都能手算。
 *
 * `clip` 只记录调用时的矩形，不复刻 canvas 的裁剪语义 —— 我们要钉的是"传给 canvas 的
 * 数字对不对"，真裁剪行为是浏览器的责任（node 里也没有）。
 */
function glowContext(filter = '') {
  const calls: string[] = []
  const rects: number[][] = []
  const metrics = {
    width: 100,
    actualBoundingBoxLeft: 10,
    actualBoundingBoxRight: 90,
    actualBoundingBoxAscent: 30,
    actualBoundingBoxDescent: 10
  }
  const context = {
    filter,
    fillStyle: '',
    shadowBlur: 0,
    shadowColor: '',
    calls,
    rects,
    fillText(text: string, x: number, y: number) {
      calls.push(`fillText:${text}:${x}:${y}`)
    },
    measureText() {
      calls.push('measureText')
      return metrics
    },
    save() {
      calls.push('save')
    },
    restore() {
      calls.push('restore')
    },
    beginPath() {
      calls.push('beginPath')
    },
    rect(x: number, y: number, width: number, height: number) {
      calls.push('rect')
      rects.push([x, y, width, height])
    },
    clip() {
      calls.push('clip')
    }
  }
  return context as unknown as CanvasRenderingContext2D & {
    calls: string[]
    rects: number[][]
  }
}

describe('fillGlowText（浮名 §10.4b 的整行辉光）', () => {
  it('没有 filter 时直接 fillText（普通模式下 shadowBlur 自己会扩缓冲，不需要裁剪）', () => {
    setGlowBlurQuantized(false)
    const context = glowContext('')

    fillGlowText(context, '你好', 100, 200)

    expect(context.calls).toEqual(['fillText:你好:100:200'])
    expect(context.rects).toEqual([])
  })

  it('有 filter 时按包围盒 + 4σ pad 裁剪一次，再画一次', () => {
    setGlowBlurQuantized(true)
    const context = glowContext()
    setCanvasTextGlow(context, 24, '#ffffff')

    fillGlowText(context, '你好', 100, 200)

    // sigma = 12 → pad = 12 × 4 + 4 = 52
    expect(context.calls).toEqual([
      'measureText',
      'save',
      'beginPath',
      'rect',
      'clip',
      'fillText:你好:100:200',
      'restore'
    ])
    expect(context.rects).toEqual([[100 - 10 - 52, 200 - 30 - 52, 10 + 90 + 104, 30 + 10 + 104]])
  })

  it('裁剪后必须 restore（裁剪是 context 状态，不复原会把后面所有绘制一起裁掉）', () => {
    setGlowBlurQuantized(true)
    const context = glowContext('drop-shadow(0 0 8px #fff)')

    fillGlowText(context, 'a', 0, 0)

    expect(context.calls[0]).toBe('measureText')
    expect(context.calls[context.calls.length - 1]).toBe('restore')
  })

  it('filter 是别的形状（主题自定义）时按无光晕处理，不会误读出半径', () => {
    const context = glowContext('blur(6px)')

    fillGlowText(context, 'a', 0, 0)

    expect(context.calls).toEqual(['fillText:a:0:0'])
  })

  it('drop-shadow 的 sigma 为 0 时也走直接绘制（0 半径没有要裁的东西）', () => {
    const context = glowContext('drop-shadow(0 0 0px #fff)')

    fillGlowText(context, 'a', 0, 0)

    expect(context.calls).toEqual(['fillText:a:0:0'])
  })
})
