import type { FoliaAudioBands } from '../types'
import { normalizeAudio } from '../shared/audio-bands'
import {
  clampAudioAmount,
  easeTowards,
  resolveLatentAudioSpeedTarget,
  resolveLatentBroadbandEnergy,
  resolveLatentOnsetPulse,
  resolveLatentShaderSpeed,
  type LatentBackgroundTuning
} from './latent-tuning'

/**
 * latent 的**逐帧状态机**（纯函数 + 不可变状态，可单测）。
 *
 * 为什么从 `use-latent-render.ts` 里拆出来：
 *  1. 平滑系数（0.12 / 0.16 / 0.13 与起拍 0.42 / 回落 0.14）是**按 60fps 每帧一次**
 *     设计的，改错不会有任何报错，只会让「音频反应」看起来像没有或像过冲。
 *     这类数值必须有断言，而 rAF / WebGL / DOM 里没法断言。
 *  2. 顺序敏感：onset 脉冲必须在更新 `previousBeatEnergy` **之前**用上一帧的能量算；
 *     反了的话差分恒为 0，`enhancedBeatResponse` 会静默失效。
 *  3. 暂停语义（目标归零但 rAF 继续、速度落到 12%）与 staticMode（setSpeed(0) 且不跑）
 *     是两件事，必须能在不挂 WebGL 的情况下验证。
 *
 * ⚠️ 输入是 **0–255** 的 Folia 量纲（`normalizeAudio` 就是 `/255`），
 * 由 `shared/audio-bands.ts` 统一换算，这一层不做量纲判断。
 */

/** 平滑器系数（Folia `LatentBackground.tsx:209-215` 与 `:229-233`）。 */
export const LATENT_SMOOTHING = Object.freeze({
  power: 0.12,
  bass: 0.16,
  mid: 0.13,
  beatRise: 0.42,
  beatFall: 0.14
})

export interface LatentFrameState {
  smoothedPower: number
  smoothedBass: number
  smoothedMid: number
  smoothedBeatSpeed: number
  /** 上一帧的宽带能量（onset 差分的基准） */
  previousBeatEnergy: number
  onsetPulse: number
}

export const LATENT_FRAME_STATE_INITIAL: LatentFrameState = Object.freeze({
  smoothedPower: 0,
  smoothedBass: 0,
  smoothedMid: 0,
  smoothedBeatSpeed: 0,
  previousBeatEnergy: 0,
  onsetPulse: 0
})

/** 这一帧要写进 shader / 层样式的东西（只含**随音频变化**的部分）。 */
export interface LatentFrameOutput {
  /** dithering 的 `u_pxSize` */
  ditheringPxSize: number
  /** mesh 的 `u_distortion`（已知会越界到 2.62，见 §3.2） */
  meshDistortion: number
  /** mesh 的 `u_swirl` */
  meshSwirl: number
  /** dithering 层不透明度（未与 mesh 叠加时恒为 1） */
  ditheringLayerOpacity: number
  /** dithering 层 transform */
  ditheringTransform: string
  /** mesh 层 filter */
  meshFilter: string
  /** mesh 层 transform */
  meshTransform: string
}

/**
 * 推进一帧音频状态机。
 *
 * @param paused 暂停时**所有音频目标归零**（不是冻结：rAF 继续跑，只是不再有能量输入；
 *               速度由 `resolveLatentFrameSpeeds` 落到基准的 12%）
 */
export function stepLatentFrame(
  state: LatentFrameState,
  bands: FoliaAudioBands,
  audioPower: number,
  tuning: LatentBackgroundTuning,
  paused: boolean,
  showMesh: boolean
): { state: LatentFrameState; output: LatentFrameOutput } {
  const targetPower = paused ? 0 : normalizeAudio(audioPower)
  const targetBass = paused ? 0 : normalizeAudio(bands.bass)
  const targetBeatEnergy = paused
    ? 0
    : resolveLatentBroadbandEnergy(bands.bass, bands.lowMid, bands.mid, bands.vocal, bands.treble)
  // mid 与 vocal 取大：mesh 的 swirl/filter 要同时响应「主旋律」与「人声清晰度」两段
  const targetMid = paused ? 0 : normalizeAudio(Math.max(bands.mid, bands.vocal))

  const smoothedPower = easeTowards(state.smoothedPower, targetPower, LATENT_SMOOTHING.power)
  const smoothedBass = easeTowards(state.smoothedBass, targetBass, LATENT_SMOOTHING.bass)
  const smoothedMid = easeTowards(state.smoothedMid, targetMid, LATENT_SMOOTHING.mid)

  // 关掉 enhancedBeatResponse 时脉冲直接归零（公式只影响速度目标，不影响任何 uniform 幅度）
  const onsetPulse = tuning.enhancedBeatResponse
    ? resolveLatentOnsetPulse(targetBeatEnergy, state.previousBeatEnergy, state.onsetPulse)
    : 0

  const beatSpeedTarget = resolveLatentAudioSpeedTarget(
    targetBeatEnergy,
    onsetPulse,
    tuning.enhancedBeatResponse
  )
  // 非对称缓动：起拍快、回落慢，否则听感上「一下就没」
  const smoothedBeatSpeed = easeTowards(
    state.smoothedBeatSpeed,
    beatSpeedTarget,
    beatSpeedTarget > state.smoothedBeatSpeed
      ? LATENT_SMOOTHING.beatRise
      : LATENT_SMOOTHING.beatFall
  )

  return {
    state: {
      smoothedPower,
      smoothedBass,
      smoothedMid,
      smoothedBeatSpeed,
      previousBeatEnergy: targetBeatEnergy,
      onsetPulse
    },
    output: {
      ditheringPxSize: Math.max(
        0.5,
        tuning.ditheringSize - smoothedBass * tuning.ditheringSize * 0.34
      ),
      meshDistortion: tuning.meshDistortion + smoothedPower * 0.62,
      meshSwirl: tuning.meshSwirl + smoothedMid * 0.38,
      ditheringLayerOpacity: showMesh
        ? Math.min(1, tuning.ditheringOpacity + smoothedBass * 0.25)
        : 1,
      ditheringTransform: `scale(${1.015 + smoothedBass * 0.025})`,
      meshFilter: `saturate(${1.04 + smoothedMid * 0.34}) brightness(${0.94 + smoothedPower * 0.16})`,
      meshTransform: `scale(${1.025 + smoothedPower * 0.018})`
    }
  }
}

/** 这一帧两个 shader 该用的速度（`staticMode` 由调用方拦住，不进这里）。 */
export function resolveLatentFrameSpeeds(
  tuning: LatentBackgroundTuning,
  smoothedBeatSpeed: number,
  paused: boolean
): { mesh: number; dithering: number } {
  return {
    mesh: resolveLatentShaderSpeed(
      tuning.meshSpeed,
      tuning.meshAudioSpeed,
      smoothedBeatSpeed,
      paused
    ),
    dithering: resolveLatentShaderSpeed(
      tuning.ditheringSpeed,
      tuning.ditheringAudioSpeed,
      smoothedBeatSpeed,
      paused
    )
  }
}

/** 静态档（staticMode / 首帧）的层样式：即 Folia JSX 里的初始 style。 */
export function resolveLatentStaticLayerStyles(
  tuning: LatentBackgroundTuning,
  showMesh: boolean
): {
  ditheringOpacity: string
  ditheringTransform: string
  meshFilter: string
  meshTransform: string
} {
  return {
    ditheringOpacity: showMesh ? String(tuning.ditheringOpacity) : '1',
    ditheringTransform: 'scale(1.015)',
    meshFilter: 'none',
    meshTransform: 'scale(1.025)'
  }
}

/** 供测试断言用的集合（避免单测再从两个模块里各 import 一遍）。 */
export const latentFrameMath = {
  clampAudioAmount,
  easeTowards
}
