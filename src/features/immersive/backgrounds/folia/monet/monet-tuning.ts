/**
 * monet 模式的 tuning —— 逐字对齐规格 §4.5（Folia `src/types.ts:1007-1021`
 * + `stores/visualizerSettingsPersistence.ts:597-649`）。
 *
 * 与 latent 同样：本仓库不带设置面板，但类型 / 取值域 / 钳制函数照搬，
 * 以后接面板不用改渲染层。localStorage key 在 Folia 是 `monet_background_tuning`，
 * 本项目不读写（没有面板就没有写入方），记录在此供将来迁移参考。
 */

export type MonetBackgroundSource = 'cover-derived' | 'uploaded-global'
export type MonetBackgroundLayout = 'full-overlay' | 'half-pane-gradient'
export type MonetBackgroundWashColorMode = 'theme' | 'custom'

export interface MonetBackgroundTuning {
  backgroundSource: MonetBackgroundSource
  backgroundLayout: MonetBackgroundLayout
  /** 烘焙时的画布模糊半径（0–60 px）；`ctx.filter` 不可用时退化为 CSS blur */
  backgroundBlurPx: number
  /** overlay 强度（0–1）：既进烘焙的渐变叠加，也参与半屏布局的图片不透明度 */
  backgroundOverlayOpacity: number
  backgroundGrayscale: number
  backgroundSaturation: number
  backgroundWash: number
  backgroundHalfPaneOffsetX: number
  backgroundWashColorMode: MonetBackgroundWashColorMode
  backgroundWashCustomColor: string
  backgroundDriftEnabled: boolean
  backgroundDriftStrength: number
  backgroundStreaksEnabled: boolean
}

/** 逐字抄 `DEFAULT_MONET_BACKGROUND_TUNING`。 */
export const DEFAULT_MONET_BACKGROUND_TUNING: MonetBackgroundTuning = {
  backgroundSource: 'cover-derived',
  backgroundLayout: 'full-overlay',
  backgroundBlurPx: 6,
  backgroundOverlayOpacity: 0.74,
  backgroundGrayscale: 0,
  backgroundSaturation: 1.05,
  backgroundWash: 0.34,
  backgroundHalfPaneOffsetX: 0,
  backgroundWashColorMode: 'theme',
  backgroundWashCustomColor: '#8fb7ff',
  backgroundDriftEnabled: true,
  backgroundDriftStrength: 0.5,
  backgroundStreaksEnabled: true
}

export function clampMonetBackgroundBlur(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(60, Math.max(0, value))
    : fallback
}

export function clampUnitInterval(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback
}

export function clampMonetBackgroundSaturation(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(2, Math.max(0, value))
    : fallback
}

export function clampMonetBackgroundOffsetX(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(40, Math.max(-40, value))
    : fallback
}

/** 只认 6 位 hex，并小写化（对齐 `normalizeHexColor`）。 */
export function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim().toLowerCase()
  return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : fallback
}

function resolveMonetBackgroundSource(value: unknown): MonetBackgroundSource {
  return value === 'uploaded-global' ? 'uploaded-global' : 'cover-derived'
}

function resolveMonetBackgroundLayout(value: unknown): MonetBackgroundLayout {
  return value === 'half-pane-gradient' ? 'half-pane-gradient' : 'full-overlay'
}

function resolveWashColorMode(value: unknown): MonetBackgroundWashColorMode {
  return value === 'custom' ? 'custom' : 'theme'
}

function resolveBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** partial → 完整 tuning：非法值回默认、越界按各自区间夹住。 */
export function resolveMonetTuning(tuning?: Partial<MonetBackgroundTuning>): MonetBackgroundTuning {
  const source = tuning ?? {}
  const fallback = DEFAULT_MONET_BACKGROUND_TUNING
  return {
    backgroundSource: resolveMonetBackgroundSource(source.backgroundSource),
    backgroundLayout: resolveMonetBackgroundLayout(source.backgroundLayout),
    backgroundBlurPx: clampMonetBackgroundBlur(source.backgroundBlurPx, fallback.backgroundBlurPx),
    backgroundOverlayOpacity: clampUnitInterval(
      source.backgroundOverlayOpacity,
      fallback.backgroundOverlayOpacity
    ),
    backgroundGrayscale: clampUnitInterval(
      source.backgroundGrayscale,
      fallback.backgroundGrayscale
    ),
    backgroundSaturation: clampMonetBackgroundSaturation(
      source.backgroundSaturation,
      fallback.backgroundSaturation
    ),
    backgroundWash: clampUnitInterval(source.backgroundWash, fallback.backgroundWash),
    backgroundHalfPaneOffsetX: clampMonetBackgroundOffsetX(
      source.backgroundHalfPaneOffsetX,
      fallback.backgroundHalfPaneOffsetX
    ),
    backgroundWashColorMode: resolveWashColorMode(source.backgroundWashColorMode),
    backgroundWashCustomColor: normalizeHexColor(
      source.backgroundWashCustomColor,
      fallback.backgroundWashCustomColor
    ),
    backgroundDriftEnabled: resolveBoolean(
      source.backgroundDriftEnabled,
      fallback.backgroundDriftEnabled
    ),
    backgroundDriftStrength: clampUnitInterval(
      source.backgroundDriftStrength,
      fallback.backgroundDriftStrength
    ),
    backgroundStreaksEnabled: resolveBoolean(
      source.backgroundStreaksEnabled,
      fallback.backgroundStreaksEnabled
    )
  }
}

/** 图源选择：`uploaded-global` 优先用户上传图，否则优先封面。 */
export function resolveMonetSourceUrl(
  coverUrl: string | null | undefined,
  uploadedUrl: string | null | undefined,
  source: MonetBackgroundSource
): string | null {
  return source === 'uploaded-global'
    ? (uploadedUrl ?? coverUrl ?? null)
    : (coverUrl ?? uploadedUrl ?? null)
}
