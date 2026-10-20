import { describe, expect, it } from 'vitest'

import type { FoliaTheme } from '../types'
import {
  DEFAULT_LATENT_BACKGROUND_TUNING,
  PAUSED_SPEED_SCALE,
  clampAudioAmount,
  clampShaderSpeed,
  easeTowards,
  resolveLatentAudioSpeedTarget,
  resolveLatentBroadbandEnergy,
  resolveLatentOnsetPulse,
  resolveLatentShaderColors,
  resolveLatentShaderSpeed,
  resolveLatentTuning,
  shaderColorsEqual
} from './latent-tuning'

const theme: FoliaTheme = {
  backgroundColor: '#101010',
  primaryColor: '#ffffff',
  accentColor: '#ff8800',
  secondaryColor: '#00aaff'
}

describe('latent tuning 默认值与钳制', () => {
  it('默认值逐字对齐 DEFAULT_LATENT_BACKGROUND_TUNING', () => {
    expect(resolveLatentTuning()).toEqual(DEFAULT_LATENT_BACKGROUND_TUNING)
    expect(DEFAULT_LATENT_BACKGROUND_TUNING).toMatchObject({
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
    })
  })

  it('越界值按各自区间夹住，非法值回默认', () => {
    const tuned = resolveLatentTuning({
      ditheringSpeed: 9,
      ditheringAudioSpeed: -3,
      ditheringSize: 0.1,
      ditheringOpacity: 5,
      meshSpeed: Number.NaN,
      meshDistortion: 4,
      meshSwirl: 0.7,
      overlayOpacity: -1
    })
    expect(tuned.ditheringSpeed).toBe(2)
    expect(tuned.ditheringAudioSpeed).toBe(0)
    expect(tuned.ditheringSize).toBe(0.5)
    expect(tuned.ditheringOpacity).toBe(1)
    expect(tuned.meshSpeed).toBe(DEFAULT_LATENT_BACKGROUND_TUNING.meshSpeed)
    expect(tuned.meshDistortion).toBe(2)
    expect(tuned.meshSwirl).toBe(0.7)
    expect(tuned.overlayOpacity).toBe(0)
  })

  it('枚举与布尔只接受合法值', () => {
    expect(resolveLatentTuning({ displayMode: 'mesh' }).displayMode).toBe('mesh')
    expect(resolveLatentTuning({ displayMode: 'nope' as never }).displayMode).toBe(
      DEFAULT_LATENT_BACKGROUND_TUNING.displayMode
    )
    expect(resolveLatentTuning({ colorSource: 'cover-only' }).colorSource).toBe('cover-only')
    expect(resolveLatentTuning({ colorSource: 'x' as never }).colorSource).toBe('cover-theme')
    expect(resolveLatentTuning({ overlayEnabled: false }).overlayEnabled).toBe(false)
    expect(resolveLatentTuning({ overlayEnabled: 1 as never }).overlayEnabled).toBe(true)
  })
})

describe('latent 音频反应', () => {
  it('宽带能量：全 0 为 0，全 255 为 1，随 vocal 权重变化', () => {
    expect(resolveLatentBroadbandEnergy(0, 0, 0, 0, 0)).toBe(0)
    expect(resolveLatentBroadbandEnergy(255, 255, 255, 255, 255)).toBeCloseTo(1, 5)
    const vocalHeavy = resolveLatentBroadbandEnergy(0, 0, 0, 255, 0)
    const trebleHeavy = resolveLatentBroadbandEnergy(0, 0, 0, 0, 255)
    expect(vocalHeavy).toBeGreaterThan(trebleHeavy)
  })

  it('onset 脉冲只认上升沿，并按 0.84 衰减', () => {
    expect(resolveLatentOnsetPulse(0.5, 0.4, 0)).toBeCloseTo(clampAudioAmount(0.1 * 7), 6)
    // 下降沿不产生新脉冲，但保留上帧的衰减值
    expect(resolveLatentOnsetPulse(0.2, 0.5, 0.9)).toBeCloseTo(0.9 * 0.84, 6)
    expect(resolveLatentOnsetPulse(0.2, 0.5, 0)).toBe(0)
    // 大跳变被夹到 1
    expect(resolveLatentOnsetPulse(1, 0, 0)).toBe(1)
  })

  it('enhancedBeatResponse 只影响速度目标', () => {
    const energy = 0.5
    const pulse = 0.4
    expect(resolveLatentAudioSpeedTarget(energy, pulse, true)).toBeCloseTo(
      clampAudioAmount(energy * 0.42 + pulse * 0.85),
      6
    )
    expect(resolveLatentAudioSpeedTarget(energy, pulse, false)).toBeCloseTo(
      clampAudioAmount(energy),
      6
    )
  })

  it('速度：暂停用 12% 倍率，播放按音频量插值并夹到 0–2', () => {
    expect(resolveLatentShaderSpeed(1.2, 2, 0.5, true)).toBeCloseTo(1.2 * PAUSED_SPEED_SCALE, 6)
    expect(resolveLatentShaderSpeed(0.2, 1.2, 0, false)).toBeCloseTo(0.2, 6)
    expect(resolveLatentShaderSpeed(0.2, 1.2, 1, false)).toBeCloseTo(1.2, 6)
    expect(resolveLatentShaderSpeed(1.8, 2, 1, false)).toBe(2)
  })

  it('easeTowards / clamp 是标准一阶与区间运算', () => {
    expect(easeTowards(0, 1, 0.25)).toBe(0.25)
    expect(clampAudioAmount(1.4)).toBe(1)
    expect(clampShaderSpeed(-2)).toBe(0)
    expect(clampShaderSpeed(3)).toBe(2)
  })
})

describe('latent 取色', () => {
  it('cover-theme：六色槽位含主题底色与强调色', () => {
    const colors = resolveLatentShaderColors(
      ['#111111', '#222222', '#333333'],
      theme,
      'cover-theme'
    )
    expect(colors.mesh).toEqual(['#111111', '#222222', '#333333', '#222222', '#101010', '#ff8800'])
    expect(colors.ditheringBack).toBe('#101010')
    expect(colors.ditheringFront).toBe('#111111')
  })

  it('cover-only：每个槽位各有各的兜底对象（不是一条 ?? 链）', () => {
    const colors = resolveLatentShaderColors(['#111111'], theme, 'cover-only')
    // primary = cover[0]；secondary..senary 依次回退 primary → secondary → tertiary
    expect(colors.mesh).toEqual(['#111111', '#111111', '#111111', '#111111', '#111111', '#111111'])
    const two = resolveLatentShaderColors(['#111111', '#222222'], theme, 'cover-only')
    expect(two.mesh).toEqual(['#111111', '#222222', '#222222', '#111111', '#222222', '#222222'])
    expect(two.ditheringBack).toBe('#222222')
  })

  it('无封面时回退主题色', () => {
    const colors = resolveLatentShaderColors([], theme, 'cover-theme')
    expect(colors.mesh[0]).toBe(theme.secondaryColor)
    expect(colors.mesh[1]).toBe(theme.primaryColor)
    expect(colors.mesh[4]).toBe(theme.backgroundColor)
    expect(colors.mesh[5]).toBe(theme.accentColor)
  })

  it('shaderColorsEqual 比较颜色内容而不是引用', () => {
    const a = resolveLatentShaderColors(['#111111'], theme, 'cover-theme')
    const b = resolveLatentShaderColors(['#111111'], theme, 'cover-theme')
    const c = resolveLatentShaderColors(['#222222'], theme, 'cover-theme')
    expect(shaderColorsEqual(a, b)).toBe(true)
    expect(shaderColorsEqual(a, c)).toBe(false)
  })
})
