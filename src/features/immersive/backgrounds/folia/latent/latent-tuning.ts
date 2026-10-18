import type { FoliaTheme } from '../types'
import { normalizeAudio } from '../shared/audio-bands'

/**
 * latent 模式的 tuning 与全部纯函数 —— 逐字对齐规格 §3.3 / §3.4 / §3.5。
 *
 * 为什么连「当前设置页只暴露一部分 tuning」也要把整套钳制函数搬过来：
 * 这些钳制是**持久化层的历史约定**（0–2 / 0.5–8 / 0–1 各有来头），
 * 将来接设置面板时只要接上 UI，渲染层一行都不用改；现在漏掉哪个区间，
 * 以后就会以「读档读到越界值 → shader 画面爆掉」的形式补作业。
 */

export type LatentBackgroundDisplayMode = 'dithering' | 'mesh' | 'both'
export type LatentBackgroundColorSource = 'cover-theme' | 'cover-only'

export interface LatentBackgroundTuning {
  displayMode: LatentBackgroundDisplayMode
  colorSource: LatentBackgroundColorSource
  dynamicOnlyInPlayer: boolean
  enhancedBeatResponse: boolean
  /** 抖动层 shader 速度（0–2，1 = 实时） */
  ditheringSpeed: number
  /** 抖动层被音频拉向的速度（0–2） */
  ditheringAudioSpeed: number
  /** 抖动像素边长（0.5–8） */
  ditheringSize: number
  /** 抖动层不透明度（0–1），只在与 mesh 叠加时有意义 */
  ditheringOpacity: number
  meshSpeed: number
  meshAudioSpeed: number
  meshDistortion: number
  meshSwirl: number
  overlayEnabled: boolean
  overlayOpacity: number
}

/** 逐字抄 `DEFAULT_LATENT_BACKGROUND_TUNING`（Folia `src/types.ts:1049-1064`）。 */
export const DEFAULT_LATENT_BACKGROUND_TUNING: LatentBackgroundTuning = {
  displayMode: 'both',
  colorSource: 'cover-theme',
  dynamicOnlyInPlayer: true,
  enhancedBeatResponse: true,
  ditheringSpeed: 0.1,
  ditheringAudioSpeed: 1.2,
  ditheringSize: 2.5,
  ditheringOpacity: 0.55,
  meshSpeed: 0.3,
  meshAudioSpeed: 2,
  meshDistortion: 0.8,
  meshSwirl: 0.1,
  overlayEnabled: true,
  overlayOpacity: 0.35
}

/** 两个 shader 共用的物理像素上限（1280×720，§3.6）。 */
export const MAX_SHADER_PIXELS = 1280 * 720
/** 暂停时速度降到基准的 12%（不是 0）—— Folia 的「暂停」是慢放，不是停帧。 */
export const PAUSED_SPEED_SCALE = 0.12

export function clampLatentNumber(value: unknown, fallback: number, min = 0, max = 1): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

function clampLatentBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function resolveDisplayMode(value: unknown): LatentBackgroundDisplayMode {
  return value === 'dithering' || value === 'mesh' || value === 'both'
    ? value
    : DEFAULT_LATENT_BACKGROUND_TUNING.displayMode
}

function resolveColorSource(value: unknown): LatentBackgroundColorSource {
  // 只有 'cover-only' 被特别识别（对齐 Folia `visualizerSettingsPersistence.ts:874-876`）
  return value === 'cover-only' ? 'cover-only' : 'cover-theme'
}

/**
 * partial tuning → 完整 tuning。非法值回默认、越界夹区间、布尔只认布尔，
 * 与持久化层 `readStoredLatentBackgroundTuning` 的判定顺序一致。
 */
export function resolveLatentTuning(
  tuning?: Partial<LatentBackgroundTuning>
): LatentBackgroundTuning {
  const source = tuning ?? {}
  const fallback = DEFAULT_LATENT_BACKGROUND_TUNING
  return {
    displayMode: resolveDisplayMode(source.displayMode),
    colorSource: resolveColorSource(source.colorSource),
    dynamicOnlyInPlayer: clampLatentBoolean(
      source.dynamicOnlyInPlayer,
      fallback.dynamicOnlyInPlayer
    ),
    enhancedBeatResponse: clampLatentBoolean(
      source.enhancedBeatResponse,
      fallback.enhancedBeatResponse
    ),
    ditheringSpeed: clampLatentNumber(source.ditheringSpeed, fallback.ditheringSpeed, 0, 2),
    ditheringAudioSpeed: clampLatentNumber(
      source.ditheringAudioSpeed,
      fallback.ditheringAudioSpeed,
      0,
      2
    ),
    ditheringSize: clampLatentNumber(source.ditheringSize, fallback.ditheringSize, 0.5, 8),
    ditheringOpacity: clampLatentNumber(source.ditheringOpacity, fallback.ditheringOpacity, 0, 1),
    meshSpeed: clampLatentNumber(source.meshSpeed, fallback.meshSpeed, 0, 2),
    meshAudioSpeed: clampLatentNumber(source.meshAudioSpeed, fallback.meshAudioSpeed, 0, 2),
    meshDistortion: clampLatentNumber(source.meshDistortion, fallback.meshDistortion, 0, 2),
    meshSwirl: clampLatentNumber(source.meshSwirl, fallback.meshSwirl, 0, 1),
    overlayEnabled: clampLatentBoolean(source.overlayEnabled, fallback.overlayEnabled),
    overlayOpacity: clampLatentNumber(source.overlayOpacity, fallback.overlayOpacity, 0, 1)
  }
}

/** shader speed 钳到 0–2（Folia `clampShaderSpeed`）。 */
export function clampShaderSpeed(value: number): number {
  return Math.min(2, Math.max(0, value))
}

/** 音频量钳到 0–1（Folia `clampAudioAmount`）。 */
export function clampAudioAmount(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** 一阶缓动：`cur + (target - cur) * amount`（Folia `easeTowards`）。 */
export function easeTowards(current: number, target: number, amount: number): number {
  return current + (target - current) * amount
}

/**
 * 宽带能量 —— 五个频带按 0.22/0.18/0.22/0.28/0.10 加权后开 0.55 次方。
 *
 * 为什么有权重：vocal（1000–3500Hz）是「人声/主旋律」所在，最能让背景跟着句子起伏；
 * treble 只给 0.1，因为高频能量在人声片段里恒高、区分度差。
 * 为什么要 0.55 次方：能量分布极度不均，直接线性映射会让速度长期趴在低档。
 */
export function resolveLatentBroadbandEnergy(
  bass: number,
  lowMid: number,
  mid: number,
  vocal: number,
  treble: number
): number {
  const broadbandEnergy =
    normalizeAudio(bass) * 0.22 +
    normalizeAudio(lowMid) * 0.18 +
    normalizeAudio(mid) * 0.22 +
    normalizeAudio(vocal) * 0.28 +
    normalizeAudio(treble) * 0.1
  return Math.pow(broadbandEnergy, 0.55)
}

/**
 * onset 脉冲：只在能量**上升**时响应，并按 0.84 每帧衰减。
 *
 * 为什么是差分：鼓点与弦乐的能量峰值高度接近，靠「绝对能量」区分不出节拍；
 * 帧间上升沿才是「刚刚发生了什么」。系数 7 是 0–255 量纲下的增益，
 * 换成 0–1 域必须一起改（所以量纲换算统一在 shared/audio-bands.ts）。
 */
export function resolveLatentOnsetPulse(
  currentEnergy: number,
  previousEnergy: number,
  previousPulse: number
): number {
  return Math.max(previousPulse * 0.84, clampAudioAmount((currentEnergy - previousEnergy) * 7))
}

/** 强拍速度目标：宽带能量占 0.42、onset 占 0.85（两者之和会超过 1，最后统一夹住）。 */
export function resolveLatentBeatSpeedTarget(broadbandEnergy: number, onsetPulse: number): number {
  return clampAudioAmount(broadbandEnergy * 0.42 + onsetPulse * 0.85)
}

/**
 * `enhancedBeatResponse` 只改**速度目标**，不改任何 uniform 幅度：
 * 关掉它，速度就只跟宽带能量走（更平滑、少抖动）。
 */
export function resolveLatentAudioSpeedTarget(
  broadbandEnergy: number,
  onsetPulse: number,
  enhancedBeatResponse: boolean
): number {
  return enhancedBeatResponse
    ? resolveLatentBeatSpeedTarget(broadbandEnergy, onsetPulse)
    : clampAudioAmount(broadbandEnergy)
}

/** 由基准速度 + 音频量插值出真实速度；暂停时直接落到 base × 0.12。 */
export function resolveLatentShaderSpeed(
  baseSpeed: number,
  audioSpeed: number,
  audioAmount: number,
  paused: boolean
): number {
  return clampShaderSpeed(
    paused ? baseSpeed * PAUSED_SPEED_SCALE : easeTowards(baseSpeed, audioSpeed, audioAmount)
  )
}

export interface LatentShaderColors {
  /** 抖动层底色 */
  ditheringBack: string
  /** 抖动层前景 */
  ditheringFront: string
  /** mesh 的六色（顺序即槽位，不能重排） */
  mesh: string[]
}

/**
 * 取色盘 + 主题 → shader 六色。
 *
 * ⚠️ **六个槽位各有各的兜底对象**，写成一条 `??` 链就会走样：
 * `cover-only` 的 quaternary→primary、quinary→secondary、senary→tertiary；
 * `cover-theme` 的 tertiary→primary。取到几色都要按这个表落位。
 */
export function resolveLatentShaderColors(
  coverColors: string[],
  theme: FoliaTheme,
  colorSource: LatentBackgroundColorSource
): LatentShaderColors {
  const primary = coverColors[0] ?? theme.secondaryColor

  if (colorSource === 'cover-only') {
    const secondary = coverColors[1] ?? primary
    const tertiary = coverColors[2] ?? secondary
    const quaternary = coverColors[3] ?? primary
    const quinary = coverColors[4] ?? secondary
    const senary = coverColors[5] ?? tertiary
    return {
      ditheringBack: tertiary,
      ditheringFront: primary,
      mesh: [primary, secondary, tertiary, quaternary, quinary, senary]
    }
  }

  const secondary = coverColors[1] ?? theme.primaryColor
  const tertiary = coverColors[2] ?? primary
  const quaternary = coverColors[3] ?? secondary
  return {
    ditheringBack: theme.backgroundColor,
    ditheringFront: primary,
    mesh: [primary, secondary, tertiary, quaternary, theme.backgroundColor, theme.accentColor]
  }
}

/** 稳定的颜色数组比较：颜色没变时不要重建 shader（重建 = 一次 context 申请 + 首帧闪烁）。 */
export function shaderColorsEqual(a: LatentShaderColors, b: LatentShaderColors): boolean {
  if (a.ditheringBack !== b.ditheringBack || a.ditheringFront !== b.ditheringFront) return false
  if (a.mesh.length !== b.mesh.length) return false
  return a.mesh.every((color, index) => color === b.mesh[index])
}
