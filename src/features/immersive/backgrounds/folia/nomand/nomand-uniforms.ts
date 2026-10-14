import {
  DitheringTypes,
  GlassDistortionShapes,
  GlassGridShapes,
  HalftoneDotsGrids,
  HalftoneDotsTypes,
  ShaderFitOptions,
  imageDitheringFragmentShader,
  flutedGlassFragmentShader,
  halftoneDotsFragmentShader,
  lensDistortionFragmentShader,
  paperTextureFragmentShader,
  type ShaderMountUniforms
} from '@paper-design/shaders'

import type { FoliaTheme } from '../types'
import { getShaderColorFromString } from '@paper-design/shaders'
import { objectSizingUniforms } from '../shared/paper-shader-mount'
import {
  NOMAND_LENS_SHAPE,
  NOMAND_PAPER_TEXTURE_SHAPE,
  getLensDistortionOverscan,
  getPaperTextureOverscan,
  resolveDaylightInversion,
  resolveHalftoneInversion
} from './nomand-shader-adjustments'
import type { NomandBackgroundTuning } from './nomand-tuning'

/**
 * nomand 的五个 effect → `ShaderMount` 入参（纯函数，可单测）。
 *
 * 为什么要把这份映射抽出来（而不是在 `NomandBackground.vue` 里写五个 `if`）：
 *  1. 每种 effect 的 uniform **名字与取值域都不一样**，写错一个键在浏览器里只会
 *     `console.warn('Uniform location for ... not found')`，画面上完全不报错、只是某个特性
 *     静默失效（`shader-mount.js` 的 `setUniformValues` 就是这么处置的）。这类错误必须靠断言兜。
 *  2. 公共 sizing（`objectSizingUniforms()`）与 `u_fit: cover` 是五个 effect 的统一前提；
 *     `fit` 忘了给就会退回 `contain`，图像四周多出一圈底色。
 *  3. 单测能在 node 环境直接对比 uniform 表，不需要 WebGL。
 *
 * 五个 effect 共用的部分（Folia `nomand/entry.tsx:53-61`）：
 * `width/height = 100%`、`image`、`fit: 'cover'`、`minPixelRatio: 1`、
 * `maxPixelCount: 1920 * 1080`。
 */

/** nomand 每个 shader 的像素上限（Folia `commonProps`）：1920×1080。 */
export const NOMAND_MAX_PIXEL_COUNT = 1920 * 1080

export interface NomandShaderPlan {
  /** 用于 `createPaperShaderMount({ fragmentShader })` */
  fragmentShader: string
  /** 除 `u_image` 之外的初始 uniform（`u_image` 由挂载器按 URL 载图后补上） */
  uniforms: ShaderMountUniforms
  /** `ShaderMount` 的 `mipmaps` 参数 */
  mipmaps: string[]
  /** 日志/调试用（`key` 的组成部分） */
  effect: NomandBackgroundTuning['effect']
}

/** `fit: cover` + sizing 那批（0.0.81 的默认值来自 `defaultObjectSizing`）。 */
function coverSizing(): ShaderMountUniforms {
  return { ...objectSizingUniforms(), u_fit: ShaderFitOptions.cover }
}

/**
 * 组装某个 effect 的挂载计划。
 *
 * @param effectShaderMode `mode` 传给 paper 挂载器（WebGL 不可用时的 warn 去重键），恒为 `'nomand'`
 */
export function resolveNomandShaderPlan(
  tuning: NomandBackgroundTuning,
  theme: FoliaTheme,
  isDaylight: boolean
): NomandShaderPlan {
  const sizing = coverSizing()

  switch (tuning.effect) {
    case 'fluted-glass':
      return {
        effect: tuning.effect,
        fragmentShader: flutedGlassFragmentShader,
        // 玻璃折射会大幅缩放采样，没有 mipmap 会闪（Folia 显式传 ["u_image"]）
        mipmaps: ['u_image'],
        uniforms: {
          ...sizing,
          u_colorBack: getShaderColorFromString(theme.backgroundColor),
          u_colorShadow: getShaderColorFromString(theme.secondaryColor),
          u_colorHighlight: getShaderColorFromString(theme.primaryColor),
          u_shadows: 0.25,
          u_size: tuning.flutedGlassSize,
          u_angle: 0,
          u_distortion: tuning.flutedGlassDistortion,
          u_shift: 0,
          u_blur: tuning.flutedGlassBlur,
          u_edges: 0.25,
          u_stretch: 0,
          u_distortionShape: GlassDistortionShapes.prism,
          u_highlights: 0.1,
          u_shape: GlassGridShapes.lines,
          u_marginLeft: 0,
          u_marginRight: 0,
          u_marginTop: 0,
          u_marginBottom: 0,
          u_grainMixer: 0,
          u_grainOverlay: 0
        }
      }

    case 'paper-texture': {
      const shape = NOMAND_PAPER_TEXTURE_SHAPE
      return {
        effect: tuning.effect,
        fragmentShader: paperTextureFragmentShader,
        mipmaps: ['u_image'],
        uniforms: {
          ...sizing,
          // u_scale 承担 overscan（Folia 用 `scale={getPaperTextureOverscan(...)}`）
          u_scale: getPaperTextureOverscan(tuning.paperTextureRoughness, tuning.paperTextureFiber),
          // 0.0.80 的 colorFront → 0.0.81 的 colorShadow（都是「纸上的图案色」）。
          // colorPaper 与 colorBack 同值：Folia 的 colorBack 同时是「纸背后」与「图外露出的底色」
          u_colorBack: getShaderColorFromString(theme.backgroundColor),
          u_colorPaper: getShaderColorFromString(theme.backgroundColor),
          u_colorShadow: getShaderColorFromString(theme.accentColor),
          // 0.0.80 的 contrast → 0.0.81 的 blending（都是「图与纸的融合强度」）
          u_blending: tuning.paperTextureContrast,
          u_distortion: shape.distortion,
          // clip = false：让纸张填满整屏（与 Folia 的观感一致，不是裁到图像框内）
          u_clip: false,
          u_angle: 0,
          u_seed: shape.seed,
          u_roughness: tuning.paperTextureRoughness,
          u_roughnessSize: shape.roughnessSize,
          u_roughnessRows: shape.roughnessRows,
          u_fiber: tuning.paperTextureFiber,
          u_fiberSize: shape.fiberSize,
          u_folds: shape.folds,
          u_foldSizeX: shape.foldSizeX,
          u_foldSizeY: shape.foldSizeY,
          u_foldOffsetX: shape.foldOffsetX,
          u_foldOffsetY: shape.foldOffsetY,
          u_wrinkles: shape.wrinkles,
          u_wrinkleSize: shape.wrinkleSize,
          u_crumples: shape.crumples,
          u_crumpleCount: shape.crumpleCount,
          u_drops: shape.drops
        }
      }
    }

    case 'halftone-dots':
      return {
        effect: tuning.effect,
        fragmentShader: halftoneDotsFragmentShader,
        // 网点是屏幕空间图案，不需要纹理 mip（Folia 这个 shader 不传 mipmaps）
        mipmaps: [],
        uniforms: {
          ...sizing,
          u_colorBack: getShaderColorFromString(theme.backgroundColor),
          u_colorFront: getShaderColorFromString(theme.accentColor),
          u_size: tuning.halftoneDotsSize,
          u_radius: tuning.halftoneDotsRadius,
          u_contrast: tuning.halftoneDotsContrast,
          u_originalColors: tuning.halftoneDotsOriginalColors,
          // 比像素画多翻一次，见 resolveHalftoneInversion 的说明
          u_inverted: resolveHalftoneInversion(
            tuning.halftoneDotsInverted,
            tuning.halftoneDotsOriginalColors,
            isDaylight
          ),
          u_grid: HalftoneDotsGrids.hex,
          u_type: HalftoneDotsTypes.gooey,
          u_grainMixer: 0.12,
          u_grainOverlay: 0.06,
          u_grainSize: 0.5
        }
      }

    case 'lens-distortion':
      return {
        effect: tuning.effect,
        fragmentShader: lensDistortionFragmentShader,
        mipmaps: ['u_image'],
        uniforms: {
          ...sizing,
          u_scale: getLensDistortionOverscan(
            tuning.lensDistortionBulge,
            tuning.lensDistortionSpread
          ),
          u_spread: tuning.lensDistortionSpread,
          u_dispersion: tuning.lensDistortionDispersion,
          u_lensBulge: tuning.lensDistortionBulge,
          // 以下全是 NOMAND_LENS_SHAPE 的固定值与 preset 默认值（Folia 一律不传）
          u_perspective: NOMAND_LENS_SHAPE.perspective,
          u_count: NOMAND_LENS_SHAPE.count,
          u_focusCenter: NOMAND_LENS_SHAPE.focusCenter,
          u_focusEdges: NOMAND_LENS_SHAPE.focusEdges,
          u_swirl: NOMAND_LENS_SHAPE.swirl,
          u_lensCircle: NOMAND_LENS_SHAPE.lensCircle,
          u_bias: 1,
          u_angle: 0,
          u_dispersionShift: 0,
          u_dispersionColor: 0.6,
          u_noise: 0,
          u_noiseFrequency: 0.25,
          u_noiseOffset: 0,
          u_grainMixer: 0,
          u_grainOverlay: 0,
          u_imageX: 0,
          u_imageY: 0
        }
      }

    default:
      // dithering（也是 Folia `switch` 的 default 分支，缺省 effect）
      return {
        effect: tuning.effect,
        fragmentShader: imageDitheringFragmentShader,
        mipmaps: [],
        uniforms: {
          ...sizing,
          u_colorBack: getShaderColorFromString(theme.backgroundColor),
          u_colorFront: getShaderColorFromString(theme.accentColor),
          u_colorHighlight: getShaderColorFromString(theme.primaryColor),
          u_originalColors: tuning.originalColors,
          u_inverted: resolveDaylightInversion(tuning.inverted, tuning.originalColors, isDaylight),
          u_type: DitheringTypes[tuning.ditheringType],
          // image-dithering 的 uniform 名是 u_pxSize（不是 u_size）
          u_pxSize: tuning.size,
          u_colorSteps: tuning.colorSteps
        }
      }
  }
}
