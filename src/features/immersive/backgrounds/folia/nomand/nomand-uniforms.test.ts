import { describe, expect, it } from 'vitest'
import {
  GlassDistortionShapes,
  GlassGridShapes,
  HalftoneDotsGrids,
  HalftoneDotsTypes
} from '@paper-design/shaders'

import type { FoliaTheme } from '../types'
import { DEFAULT_NOMAND_BACKGROUND_TUNING, resolveNomandTuning } from './nomand-tuning'
import { NOMAND_MAX_PIXEL_COUNT, resolveNomandShaderPlan } from './nomand-uniforms'

const theme: FoliaTheme = {
  backgroundColor: '#101010',
  primaryColor: '#ffffff',
  accentColor: '#ff8800',
  secondaryColor: '#00aaff'
}

function plan(overrides: Partial<typeof DEFAULT_NOMAND_BACKGROUND_TUNING> = {}, daylight = false) {
  return resolveNomandShaderPlan(resolveNomandTuning(overrides), theme, daylight)
}

describe('nomand 挂载计划 —— 公共部分', () => {
  it('像素上限是 1920×1080', () => {
    expect(NOMAND_MAX_PIXEL_COUNT).toBe(1920 * 1080)
  })

  it('五种 effect 都产出 fragmentShader，且 u_fit = cover', () => {
    const effects = [
      'dithering',
      'fluted-glass',
      'paper-texture',
      'halftone-dots',
      'lens-distortion'
    ] as const
    const shaders = new Set<string>()
    for (const effect of effects) {
      const result = plan({ effect })
      expect(typeof result.fragmentShader).toBe('string')
      expect(result.fragmentShader.length).toBeGreaterThan(100)
      expect(result.effect).toBe(effect)
      // cover = 2：忘了给会退回 contain，图像四周多一圈底色
      expect(result.uniforms.u_fit).toBe(2)
      expect(result.uniforms.u_scale).toBeGreaterThan(0)
      shaders.add(result.fragmentShader)
    }
    // 五个 effect 必须是五段不同的 shader
    expect(shaders.size).toBe(5)
  })

  it('mipmaps：折射类三个传 u_image，屏幕空间图案两个不传', () => {
    expect(plan({ effect: 'fluted-glass' }).mipmaps).toEqual(['u_image'])
    expect(plan({ effect: 'paper-texture' }).mipmaps).toEqual(['u_image'])
    expect(plan({ effect: 'lens-distortion' }).mipmaps).toEqual(['u_image'])
    expect(plan({ effect: 'dithering' }).mipmaps).toEqual([])
    expect(plan({ effect: 'halftone-dots' }).mipmaps).toEqual([])
  })

  it('不产出 u_image / u_noiseTexture（由渲染层补，纯函数不能 new Image）', () => {
    for (const effect of [
      'dithering',
      'fluted-glass',
      'paper-texture',
      'halftone-dots',
      'lens-distortion'
    ] as const) {
      const { uniforms } = plan({ effect })
      expect(uniforms).not.toHaveProperty('u_image')
      expect(uniforms).not.toHaveProperty('u_noiseTexture')
    }
  })
})

describe('nomand 挂载计划 —— 各 effect 的键与取值', () => {
  it('dithering（默认）：u_pxSize 而不是 u_size', () => {
    const { uniforms } = plan({ effect: 'dithering' })
    expect(uniforms).toHaveProperty('u_pxSize', DEFAULT_NOMAND_BACKGROUND_TUNING.size)
    expect(uniforms).not.toHaveProperty('u_size')
    // u_colorSteps 是**档数**（不是颜色数组），所以下面的「u_color* 都是 4 通道数组」必须跳过它
    expect(uniforms.u_colorSteps).toBe(4)
    expect(uniforms.u_originalColors).toBe(false)
    // 8x8 = 4
    expect(uniforms.u_type).toBe(4)
  })

  it('dithering 的明暗自适应走 resolveDaylightInversion', () => {
    // 深色主题不翻
    expect(plan({ effect: 'dithering' }, false).uniforms.u_inverted).toBe(false)
    // 浅色主题 + 非原色 → 翻转
    expect(plan({ effect: 'dithering' }, true).uniforms.u_inverted).toBe(true)
    // 原色模式不翻
    expect(plan({ effect: 'dithering', originalColors: true }, true).uniforms.u_inverted).toBe(
      false
    )
  })

  it('fluted-glass：prism + lines，且固定项逐字对齐 Folia', () => {
    const { uniforms } = plan({ effect: 'fluted-glass' })
    expect(uniforms.u_shape).toBe(GlassGridShapes.lines)
    expect(uniforms.u_distortionShape).toBe(GlassDistortionShapes.prism)
    expect(uniforms.u_shadows).toBe(0.25)
    expect(uniforms.u_highlights).toBe(0.1)
    expect(uniforms.u_edges).toBe(0.25)
    expect(uniforms.u_shift).toBe(0)
    expect(uniforms.u_stretch).toBe(0)
    expect(uniforms.u_size).toBe(DEFAULT_NOMAND_BACKGROUND_TUNING.flutedGlassSize)
    expect(uniforms.u_distortion).toBe(DEFAULT_NOMAND_BACKGROUND_TUNING.flutedGlassDistortion)
    expect(uniforms.u_blur).toBe(DEFAULT_NOMAND_BACKGROUND_TUNING.flutedGlassBlur)
  })

  it('halftone-dots：hex + gooey，且网点比像素画多翻一次', () => {
    const { uniforms } = plan({ effect: 'halftone-dots' })
    expect(uniforms.u_grid).toBe(HalftoneDotsGrids.hex)
    expect(uniforms.u_type).toBe(HalftoneDotsTypes.gooey)
    expect(uniforms.u_grainMixer).toBe(0.12)
    expect(uniforms.u_grainOverlay).toBe(0.06)
    expect(uniforms.u_grainSize).toBe(0.5)
    expect(uniforms.u_size).toBe(0.5)
    expect(uniforms.u_radius).toBe(1.25)
    // 深色主题：基准先翻一次
    expect(uniforms.u_inverted).toBe(true)
    expect(plan({ effect: 'halftone-dots' }, true).uniforms.u_inverted).toBe(false)
  })

  it('lens-distortion：固定镜头参数与 preset 默认值都要给齐', () => {
    const { uniforms } = plan({ effect: 'lens-distortion' })
    expect(uniforms.u_spread).toBe(0.45)
    expect(uniforms.u_dispersion).toBe(0.65)
    expect(uniforms.u_lensBulge).toBe(0.3)
    expect(uniforms.u_perspective).toBe(0.4)
    expect(uniforms.u_count).toBe(20)
    expect(uniforms.u_focusCenter).toBe(0.55)
    expect(uniforms.u_focusEdges).toBe(0.8)
    expect(uniforms.u_swirl).toBe(0.08)
    expect(uniforms.u_lensCircle).toBe(0.1)
    expect(uniforms.u_bias).toBe(1)
    expect(uniforms.u_imageX).toBe(0)
    expect(uniforms.u_imageY).toBe(0)
    // overscan 进 u_scale，必须 > 1
    expect(uniforms.u_scale).toBeGreaterThan(1)
  })

  it('paper-texture：0.0.81 的键全部给齐，0.0.80 的旧键一个都不能留', () => {
    const { uniforms } = plan({ effect: 'paper-texture' })
    // 0.0.81 独有
    for (const key of [
      'u_isImage',
      'u_colorPaper',
      'u_colorShadow',
      'u_blending',
      'u_distortion',
      'u_clip',
      'u_angle',
      'u_roughnessSize',
      'u_roughnessRows',
      'u_foldSizeX',
      'u_foldSizeY',
      'u_foldOffsetX',
      'u_foldOffsetY',
      'u_wrinkles',
      'u_wrinkleSize',
      'u_crumpleCount'
    ]) {
      // u_isImage 由 shader 内部按 u_image 决定，我们不设（0.0.81 的 uniforms 声明里它是 bool）
      if (key === 'u_isImage') continue
      expect(uniforms, `缺 uniform ${key}`).toHaveProperty(key)
    }
    // 0.0.80 已删除的键
    for (const key of ['u_colorFront', 'u_contrast', 'u_fade', 'u_crumpleSize', 'u_foldCount']) {
      expect(uniforms, `0.0.80 的旧键不该出现 ${key}`).not.toHaveProperty(key)
    }
    // u_distortion 必须非 0，否则整条「图像随纸面弯曲」消失
    expect(uniforms.u_distortion).not.toBe(0)
    expect(uniforms.u_clip).toBe(false)
    expect(uniforms.u_blending).toBe(DEFAULT_NOMAND_BACKGROUND_TUNING.paperTextureContrast)
    expect(uniforms.u_roughness).toBe(DEFAULT_NOMAND_BACKGROUND_TUNING.paperTextureRoughness)
    expect(uniforms.u_fiber).toBe(DEFAULT_NOMAND_BACKGROUND_TUNING.paperTextureFiber)
  })

  it('颜色类 uniform 都是 4 通道 0–1 数组（paper 的 setUniformValues 按长度 4 走 uniform4fv）', () => {
    for (const effect of ['dithering', 'fluted-glass', 'paper-texture', 'halftone-dots'] as const) {
      const { uniforms } = plan({ effect })
      for (const [key, value] of Object.entries(uniforms)) {
        if (!key.startsWith('u_color')) continue
        // u_colorSteps 是档数计数器，不是颜色
        if (key === 'u_colorSteps') continue
        expect(Array.isArray(value), `${key} 应该是数组`).toBe(true)
        expect((value as number[]).length, `${key} 应该是 4 通道`).toBe(4)
        for (const channel of value as number[]) {
          expect(channel).toBeGreaterThanOrEqual(0)
          expect(channel).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('主题色真的进了 uniform（不是写死的调色板）', () => {
    const { uniforms } = plan({ effect: 'fluted-glass' })
    // u_colorShadow 取 secondaryColor = #00aaff → r=0, g=0xaa/255, b=1
    expect((uniforms.u_colorShadow as number[])[2]).toBeCloseTo(1, 5)
    expect((uniforms.u_colorShadow as number[])[0]).toBeCloseTo(0, 5)
    expect((uniforms.u_colorShadow as number[])[1]).toBeCloseTo(0xaa / 255, 4)
  })
})
