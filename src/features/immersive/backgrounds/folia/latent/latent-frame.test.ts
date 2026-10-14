import { describe, expect, it } from 'vitest'

import type { FoliaAudioBands } from '../types'
import {
  LATENT_FRAME_STATE_INITIAL,
  LATENT_SMOOTHING,
  latentFrameMath,
  resolveLatentFrameSpeeds,
  resolveLatentStaticLayerStyles,
  stepLatentFrame,
  type LatentFrameState
} from './latent-frame'
import { DEFAULT_LATENT_BACKGROUND_TUNING, PAUSED_SPEED_SCALE } from './latent-tuning'

const tuning = DEFAULT_LATENT_BACKGROUND_TUNING

const silent: FoliaAudioBands = { bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 }

function run(
  bands: FoliaAudioBands,
  power: number,
  state: LatentFrameState = LATENT_FRAME_STATE_INITIAL,
  paused = false,
  showMesh = true
) {
  return stepLatentFrame(state, bands, power, tuning, paused, showMesh)
}

describe('latent 逐帧状态机', () => {
  it('静音首帧：音频项全 0，层样式回到基准值', () => {
    const { state, output } = run(silent, 0)
    expect(state).toMatchObject({
      smoothedPower: 0,
      smoothedBass: 0,
      smoothedMid: 0,
      smoothedBeatSpeed: 0,
      previousBeatEnergy: 0,
      onsetPulse: 0
    })
    expect(output.meshDistortion).toBeCloseTo(tuning.meshDistortion, 6)
    expect(output.meshSwirl).toBeCloseTo(tuning.meshSwirl, 6)
    expect(output.ditheringPxSize).toBeCloseTo(tuning.ditheringSize, 6)
    expect(output.meshFilter).toBe('saturate(1.04) brightness(0.94)')
    expect(output.meshTransform).toBe('scale(1.025)')
    expect(output.ditheringTransform).toBe('scale(1.015)')
    // both 档下 dithering 层初始不透明度就是 tuning.ditheringOpacity
    expect(output.ditheringLayerOpacity).toBeCloseTo(tuning.ditheringOpacity, 6)
  })

  it('平滑系数逐字对齐 Folia（0.12 / 0.16 / 0.13，起拍 0.42 / 回落 0.14）', () => {
    expect(LATENT_SMOOTHING).toEqual({
      power: 0.12,
      bass: 0.16,
      mid: 0.13,
      beatRise: 0.42,
      beatFall: 0.14
    })
  })

  it('每帧只走一部分（不是瞬时贴到目标）', () => {
    const { state } = run({ ...silent, bass: 255 }, 255)
    // 目标 1，先走一阶的一步：0 + (1 - 0) * 系数
    expect(state.smoothedPower).toBeCloseTo(0.12, 6)
    expect(state.smoothedBass).toBeCloseTo(0.16, 6)
  })

  it('onset 差分用**上一帧**的能量：持续同能量不会一直触发脉冲', () => {
    const loud = { bass: 255, lowMid: 255, mid: 255, vocal: 255, treble: 255 }
    const first = run(loud, 255)
    expect(first.state.onsetPulse).toBeGreaterThan(0)
    // 第二帧能量与第一帧相同 → 差分为 0，脉冲只剩 0.84 的衰减
    const second = run(loud, 255, first.state)
    expect(second.state.onsetPulse).toBeCloseTo(first.state.onsetPulse * 0.84, 6)
  })

  it('enhancedBeatResponse = false 时脉冲恒 0，速度只跟宽带能量', () => {
    const off = { ...tuning, enhancedBeatResponse: false }
    const loud = { bass: 255, lowMid: 255, mid: 255, vocal: 255, treble: 255 }
    const result = stepLatentFrame(LATENT_FRAME_STATE_INITIAL, loud, 255, off, false, true)
    expect(result.state.onsetPulse).toBe(0)
    // 全 255 → 宽带能量 1 → 速度目标 = clampAudioAmount(1) = 1，一步走到 0.42
    expect(result.state.smoothedBeatSpeed).toBeCloseTo(LATENT_SMOOTHING.beatRise, 6)
  })

  it('起拍快、回落慢（非对称缓动）', () => {
    // 从静止到全能量：走 0.42
    const rising = run({ bass: 255, lowMid: 255, mid: 255, vocal: 255, treble: 255 }, 255)
    expect(rising.state.smoothedBeatSpeed).toBeCloseTo(LATENT_SMOOTHING.beatRise, 6)

    // 关掉强拍响应后脉冲恒 0，速度目标就等于宽带能量，才能干净地验证回落步长
    const noPulse = { ...tuning, enhancedBeatResponse: false }
    const falling = stepLatentFrame({ ...rising.state }, silent, 0, noPulse, false, true)
    expect(falling.state.smoothedBeatSpeed).toBeCloseTo(
      rising.state.smoothedBeatSpeed * (1 - LATENT_SMOOTHING.beatFall),
      6
    )
  })

  it('能量骤停时 onset 脉冲仍会把速度往上推一两帧（Folia 的既有行为）', () => {
    // 这是「起拍快、回落慢」的另一面：0.84 的脉冲衰减 + 0.85 的速度权重，
    // 让一次强拍的能量消失后速度还会继续冲到目标之上 —— 不是 bug，是听感来源。
    const loud = { bass: 255, lowMid: 255, mid: 255, vocal: 255, treble: 255 }
    const rising = run(loud, 255)
    const afterDrop = run(silent, 0, { ...rising.state })
    expect(afterDrop.state.smoothedBeatSpeed).toBeGreaterThan(rising.state.smoothedBeatSpeed)
    // 脉冲按 0.84 衰减，所以这一帧的速度目标是 pulse*0.85
    const expectedTarget = rising.state.onsetPulse * 0.84 * 0.85
    expect(afterDrop.state.smoothedBeatSpeed).toBeCloseTo(
      rising.state.smoothedBeatSpeed +
        (expectedTarget - rising.state.smoothedBeatSpeed) * LATENT_SMOOTHING.beatRise,
      6
    )
  })

  it('暂停：所有目标归零（而不是冻结在上一帧的值）', () => {
    const loud = { bass: 255, lowMid: 255, mid: 255, vocal: 255, treble: 255 }
    const hot = run(loud, 255)
    const paused = run(loud, 255, hot.state, true)
    expect(paused.state.previousBeatEnergy).toBe(0)
    expect(paused.state.smoothedPower).toBeLessThan(hot.state.smoothedPower)
    expect(paused.state.smoothedBass).toBeLessThan(hot.state.smoothedBass)
  })

  it('displayMode = dithering（无 mesh）时抖动层不透明度恒为 1', () => {
    const { output } = run({ ...silent, bass: 255 }, 255, LATENT_FRAME_STATE_INITIAL, false, false)
    expect(output.ditheringLayerOpacity).toBe(1)
  })

  it('bass 把 u_pxSize 往下拉但守住 0.5 下界', () => {
    const { output } = run({ ...silent, bass: 255 }, 0)
    expect(output.ditheringPxSize).toBeCloseTo(tuning.ditheringSize * (1 - 0.16 * 0.34), 6)
    // 人为把 bass 平滑值拉到最大，验证 Math.max(0.5, ...) 的下界
    const saturated = stepLatentFrame(
      { ...LATENT_FRAME_STATE_INITIAL, smoothedBass: 1 },
      silent,
      0,
      { ...tuning, ditheringSize: 0.5 },
      false,
      true
    )
    expect(saturated.output.ditheringPxSize).toBe(0.5)
  })

  it('power 与 mid/vocal 各自驱动对应 uniform，互不串档', () => {
    const { output } = run({ ...silent, mid: 255 }, 255)
    // u_distortion 只跟 power、u_swirl / filter 只跟 mid
    expect(output.meshDistortion).toBeCloseTo(tuning.meshDistortion + 0.12 * 0.62, 6)
    expect(output.meshSwirl).toBeCloseTo(tuning.meshSwirl + 0.13 * 0.38, 6)
    expect(output.meshFilter).toContain(`saturate(${1.04 + 0.13 * 0.34})`)
  })

  it('mid = max(mid, vocal)：lowMid 与 treble 不影响 mesh 的 swirl', () => {
    const vocalOnly = run({ ...silent, vocal: 255 }, 0)
    const bassOnly = run({ ...silent, bass: 255, treble: 255 }, 0)
    expect(vocalOnly.state.smoothedMid).toBeCloseTo(LATENT_SMOOTHING.mid, 6)
    expect(bassOnly.state.smoothedMid).toBe(0)
  })
})

describe('latent 帧速度', () => {
  it('播放时按音频量在两个基准速度之间插值', () => {
    const speeds = resolveLatentFrameSpeeds(tuning, 0, false)
    expect(speeds.mesh).toBeCloseTo(tuning.meshSpeed, 6)
    expect(speeds.dithering).toBeCloseTo(tuning.ditheringSpeed, 6)

    const hot = resolveLatentFrameSpeeds(tuning, 1, false)
    expect(hot.mesh).toBeCloseTo(tuning.meshAudioSpeed, 6)
    expect(hot.dithering).toBeCloseTo(tuning.ditheringAudioSpeed, 6)
  })

  it('暂停时落到基准速度 × 12%（不是 0 —— 暂停是慢放不是停帧）', () => {
    const speeds = resolveLatentFrameSpeeds(tuning, 1, true)
    expect(speeds.mesh).toBeCloseTo(tuning.meshSpeed * PAUSED_SPEED_SCALE, 6)
    expect(speeds.dithering).toBeCloseTo(tuning.ditheringSpeed * PAUSED_SPEED_SCALE, 6)
    expect(speeds.mesh).toBeGreaterThan(0)
  })
})

describe('latent 静态档层样式', () => {
  it('both 档：抖动层用 tuning 不透明度，mesh 层 filter 归位', () => {
    expect(resolveLatentStaticLayerStyles(tuning, true)).toEqual({
      ditheringOpacity: '0.55',
      ditheringTransform: 'scale(1.015)',
      meshFilter: 'none',
      meshTransform: 'scale(1.025)'
    })
  })

  it('dithering 档（无 mesh）：不透明度恒 1', () => {
    expect(resolveLatentStaticLayerStyles(tuning, false).ditheringOpacity).toBe('1')
  })
})

describe('latent 数学工具集合', () => {
  it('easeTowards / clampAudioAmount 是标准一阶与区间运算', () => {
    expect(latentFrameMath.easeTowards(0, 1, 0.5)).toBe(0.5)
    expect(latentFrameMath.clampAudioAmount(1.2)).toBe(1)
    expect(latentFrameMath.clampAudioAmount(-1)).toBe(0)
  })
})
