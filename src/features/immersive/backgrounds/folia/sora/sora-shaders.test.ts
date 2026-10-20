import { describe, expect, it } from 'vitest'

import { resolveSoraParticleColor } from './use-sora-render'
import {
  SORA_ACCENT_COLOR_TYPE_THRESHOLD,
  SORA_FRAGMENT_SHADER,
  SORA_PARTICLE_COUNT,
  SORA_VERTEX_SHADER
} from './sora-shaders'

describe('sora shader 常量', () => {
  it('粒子数是 150（与 a_index 缓冲长度绑定）', () => {
    expect(SORA_PARTICLE_COUNT).toBe(150)
  })

  it('顶点着色器的关键公式逐项在（这些数字就是观感本身，改一个都算改行为）', () => {
    // 速度：每秒漂过屏宽的 0.8%–3.2%
    expect(SORA_VERTEX_SHADER).toContain('0.008 + speed_rand * 0.024')
    // 尺寸：3.8 次幂的长尾分布（不是均匀分布）
    expect(SORA_VERTEX_SHADER).toContain('0.0006 + 0.0032 * pow(size_rand, 3.8)')
    // 纵向铺满 NDC 的 90%
    expect(SORA_VERTEX_SHADER).toContain('-0.45 + y_rand * 0.9')
    // 横向循环
    expect(SORA_VERTEX_SHADER).toContain('fract(x_rand + u_time * speed)')
    // 漂浮与闪烁
    expect(SORA_VERTEX_SHADER).toContain('sin(u_time * 0.3 + y_rand * 6.283) * 0.005')
    expect(SORA_VERTEX_SHADER).toContain(
      '0.3 + 0.7 * sin(u_time * (1.0 + blink_rand * 2.5) + x_rand * 6.283)'
    )
    // 点尺寸按画布高度缩放，下限 2px
    expect(SORA_VERTEX_SHADER).toContain('max(2.0, size * u_resolution.y * 3.5)')
  })

  it('顶点着色器有 a_index 与两个 uniform，且六个随机通道各用一次', () => {
    expect(SORA_VERTEX_SHADER).toContain('attribute float a_index;')
    expect(SORA_VERTEX_SHADER).toContain('uniform vec2 u_resolution;')
    expect(SORA_VERTEX_SHADER).toContain('uniform float u_time;')
    for (const channel of ['1.1', '2.2', '3.3', '4.4', '5.5', '6.6']) {
      expect(SORA_VERTEX_SHADER).toContain(`, ${channel})`)
    }
  })

  it('片元着色器：反向 smoothstep + 低 alpha 丢弃 + 预乘 alpha', () => {
    // 参数反序是刻意的：写成 (0.1, 0.5) 会得到一圈甜甜圈而不是光点
    expect(SORA_FRAGMENT_SHADER).toContain('smoothstep(0.5, 0.1, dist)')
    expect(SORA_FRAGMENT_SHADER).toContain('if (alpha < 0.01) discard;')
    expect(SORA_FRAGMENT_SHADER).toContain('gl_FragColor = vec4(baseColor * alpha, alpha);')
    expect(SORA_FRAGMENT_SHADER).toContain(
      `v_color_type > ${SORA_ACCENT_COLOR_TYPE_THRESHOLD.toFixed(2)}`
    )
  })
})

describe('resolveSoraParticleColor', () => {
  const theme = { primaryColor: '#ffffff', accentColor: '#ff8800' }

  it('主题色按 /255 归一化（是 0–1 的 vec3，不是 0–255）', () => {
    const colors = resolveSoraParticleColor(theme, false)
    expect(colors.particle).toEqual([1, 1, 1])
    expect(colors.accent[0]).toBeCloseTo(1, 6)
    expect(colors.accent[1]).toBeCloseTo(0x88 / 255, 6)
    expect(colors.accent[2]).toBe(0)
  })

  it('底色跟随昼夜：深色纯黑、浅色纯白', () => {
    expect(resolveSoraParticleColor(theme, false).background).toEqual([0, 0, 0])
    expect(resolveSoraParticleColor(theme, true).background).toEqual([1, 1, 1])
  })

  it('主色解析失败时按明暗回退黑白（浅色主题回退黑点，否则白底白点看不见）', () => {
    const dark = resolveSoraParticleColor({ primaryColor: 'not-a-color', accentColor: '' }, false)
    expect(dark.particle).toEqual([1, 1, 1])
    const light = resolveSoraParticleColor({ primaryColor: 'not-a-color', accentColor: '' }, true)
    expect(light.particle).toEqual([0, 0, 0])
  })

  it('强调色解析失败退回主色，而不是回退黑白', () => {
    const colors = resolveSoraParticleColor(
      { primaryColor: 'rgb(10, 20, 30)', accentColor: 'hsl(200 50% 50%)' },
      false
    )
    expect(colors.particle).toEqual([10 / 255, 20 / 255, 30 / 255])
    expect(colors.accent).toEqual(colors.particle)
  })

  it('3 位 hex 与 rgba() 都能解析', () => {
    expect(
      resolveSoraParticleColor({ primaryColor: '#f80', accentColor: 'rgb(0,0,0)' }, false).particle
    ).toEqual([1, 0x88 / 255, 0])
    expect(
      resolveSoraParticleColor({ primaryColor: 'rgba(255, 0, 0, 0.5)', accentColor: '#000' }, false)
        .particle
    ).toEqual([1, 0, 0])
  })
})
