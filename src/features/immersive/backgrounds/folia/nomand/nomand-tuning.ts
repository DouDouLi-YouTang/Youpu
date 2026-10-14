/**
 * nomand 模式的 tuning —— 逐字对齐规格 §5.5（Folia `src/types.ts:1023-1047`
 * + `stores/visualizerSettingsPersistence.ts:755-838`）。
 *
 * 一个模式顶五种 Paper 图像 shader，靠 `effect` 切换。本仓库不带设置面板，
 * 运行时取默认 `effect = 'dithering'`，但**五种 effect 的渲染实现必须齐全**
 * （默认值一旦被改成别的 effect 就立刻走到）。
 */

export type NomandBackgroundEffect =
  | 'dithering'
  | 'fluted-glass'
  | 'paper-texture'
  | 'halftone-dots'
  | 'lens-distortion'

export type NomandBackgroundImageSource = 'cover-derived' | 'uploaded-global'
export type NomandDitheringType = '2x2' | '4x4' | '8x8'

export interface NomandBackgroundTuning {
  imageSource: NomandBackgroundImageSource
  effect: NomandBackgroundEffect
  ditheringType: NomandDitheringType
  size: number
  colorSteps: number
  originalColors: boolean
  inverted: boolean
  flutedGlassSize: number
  flutedGlassDistortion: number
  flutedGlassBlur: number
  paperTextureContrast: number
  paperTextureRoughness: number
  paperTextureFiber: number
  halftoneDotsSize: number
  halftoneDotsRadius: number
  halftoneDotsContrast: number
  halftoneDotsOriginalColors: boolean
  halftoneDotsInverted: boolean
  lensDistortionSpread: number
  lensDistortionBulge: number
  lensDistortionDispersion: number
  overlayEnabled: boolean
  overlayOpacity: number
}

/** 逐字抄 `DEFAULT_NOMAND_BACKGROUND_TUNING`。 */
export const DEFAULT_NOMAND_BACKGROUND_TUNING: NomandBackgroundTuning = {
  imageSource: 'cover-derived',
  effect: 'dithering',
  ditheringType: '8x8',
  size: 3,
  colorSteps: 4,
  originalColors: false,
  inverted: false,
  flutedGlassSize: 0.5,
  flutedGlassDistortion: 0.5,
  flutedGlassBlur: 0.08,
  paperTextureContrast: 0.32,
  paperTextureRoughness: 0.42,
  paperTextureFiber: 0.3,
  halftoneDotsSize: 0.5,
  halftoneDotsRadius: 1.25,
  halftoneDotsContrast: 0.4,
  halftoneDotsOriginalColors: false,
  halftoneDotsInverted: false,
  lensDistortionSpread: 0.45,
  lensDistortionBulge: 0.3,
  lensDistortionDispersion: 0.65,
  overlayEnabled: true,
  overlayOpacity: 0.35
}

/** Folia `clampNomandEffectValue`：数值钳到区间，非数值回默认。 */
export function clampNomandEffectValue(value: unknown, fallback: number, min = 0, max = 1): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

const NOMAND_EFFECTS: readonly NomandBackgroundEffect[] = [
  'dithering',
  'fluted-glass',
  'paper-texture',
  'halftone-dots',
  'lens-distortion'
]

function resolveEffect(value: unknown): NomandBackgroundEffect {
  return NOMAND_EFFECTS.includes(value as NomandBackgroundEffect)
    ? (value as NomandBackgroundEffect)
    : DEFAULT_NOMAND_BACKGROUND_TUNING.effect
}

function resolveImageSource(value: unknown): NomandBackgroundImageSource {
  return value === 'uploaded-global' ? 'uploaded-global' : 'cover-derived'
}

function resolveDitheringType(value: unknown): NomandDitheringType {
  return value === '2x2' || value === '4x4' || value === '8x8'
    ? value
    : DEFAULT_NOMAND_BACKGROUND_TUNING.ditheringType
}

function resolveBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** partial → 完整 tuning。各字段的区间互不相同，逐字段用对应的钳制。 */
export function resolveNomandTuning(
  tuning?: Partial<NomandBackgroundTuning>
): NomandBackgroundTuning {
  const source = tuning ?? {}
  const fallback = DEFAULT_NOMAND_BACKGROUND_TUNING
  return {
    imageSource: resolveImageSource(source.imageSource),
    effect: resolveEffect(source.effect),
    ditheringType: resolveDitheringType(source.ditheringType),
    size: clampNomandEffectValue(source.size, fallback.size, 0.5, 20),
    // colorSteps 是整数（1–7），Folia 会 Math.round
    colorSteps: Math.round(clampNomandEffectValue(source.colorSteps, fallback.colorSteps, 1, 7)),
    originalColors: resolveBoolean(source.originalColors, fallback.originalColors),
    inverted: resolveBoolean(source.inverted, fallback.inverted),
    flutedGlassSize: clampNomandEffectValue(
      source.flutedGlassSize,
      fallback.flutedGlassSize,
      0.1,
      1
    ),
    flutedGlassDistortion: clampNomandEffectValue(
      source.flutedGlassDistortion,
      fallback.flutedGlassDistortion,
      0,
      1
    ),
    flutedGlassBlur: clampNomandEffectValue(source.flutedGlassBlur, fallback.flutedGlassBlur, 0, 1),
    paperTextureContrast: clampNomandEffectValue(
      source.paperTextureContrast,
      fallback.paperTextureContrast,
      0,
      1
    ),
    paperTextureRoughness: clampNomandEffectValue(
      source.paperTextureRoughness,
      fallback.paperTextureRoughness,
      0,
      1
    ),
    paperTextureFiber: clampNomandEffectValue(
      source.paperTextureFiber,
      fallback.paperTextureFiber,
      0,
      1
    ),
    halftoneDotsSize: clampNomandEffectValue(
      source.halftoneDotsSize,
      fallback.halftoneDotsSize,
      0.1,
      1
    ),
    halftoneDotsRadius: clampNomandEffectValue(
      source.halftoneDotsRadius,
      fallback.halftoneDotsRadius,
      0.1,
      2
    ),
    halftoneDotsContrast: clampNomandEffectValue(
      source.halftoneDotsContrast,
      fallback.halftoneDotsContrast,
      0,
      1
    ),
    halftoneDotsOriginalColors: resolveBoolean(
      source.halftoneDotsOriginalColors,
      fallback.halftoneDotsOriginalColors
    ),
    halftoneDotsInverted: resolveBoolean(
      source.halftoneDotsInverted,
      fallback.halftoneDotsInverted
    ),
    lensDistortionSpread: clampNomandEffectValue(
      source.lensDistortionSpread,
      fallback.lensDistortionSpread,
      0,
      1
    ),
    lensDistortionBulge: clampNomandEffectValue(
      source.lensDistortionBulge,
      fallback.lensDistortionBulge,
      -1,
      1
    ),
    lensDistortionDispersion: clampNomandEffectValue(
      source.lensDistortionDispersion,
      fallback.lensDistortionDispersion,
      0,
      1
    ),
    overlayEnabled: resolveBoolean(source.overlayEnabled, fallback.overlayEnabled),
    overlayOpacity: clampNomandEffectValue(source.overlayOpacity, fallback.overlayOpacity, 0, 1)
  }
}

/** 图源选择（与 monet 同一套语义，uploaded-global 优先）。 */
export function resolveNomandSourceUrl(
  coverUrl: string | null | undefined,
  uploadedUrl: string | null | undefined,
  source: NomandBackgroundImageSource
): string | null {
  return source === 'uploaded-global'
    ? (uploadedUrl ?? coverUrl ?? null)
    : (coverUrl ?? uploadedUrl ?? null)
}
