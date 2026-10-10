import { describe, expect, it } from 'vitest'
import {
  AFTERGLOW_FLOOR,
  clampPulseDuration,
  getCharPulseAtTime,
  getCharPulseIntensity,
  getCharPulseScale,
  resolveCharPulseProgress
} from './char-pulse'

describe('getCharPulseIntensity 曲线（笔记 §6）', () => {
  it('还没唱到（progress <= 0）→ 0', () => {
    for (const progress of [0, -0, -0.001, -1, -1e6]) {
      expect(getCharPulseIntensity(progress)).toBe(0)
    }
  })

  it('钟形：0 → 1 → 0，峰值在 progress = 0.5', () => {
    expect(getCharPulseIntensity(0)).toBeCloseTo(0, 10)
    expect(getCharPulseIntensity(0.5)).toBeCloseTo(1, 10)
    expect(getCharPulseIntensity(1)).toBeCloseTo(0, 10)
    expect(getCharPulseIntensity(0.25)).toBeCloseTo(Math.sqrt(0.5), 10)
    expect(getCharPulseIntensity(0.75)).toBeCloseTo(Math.sqrt(0.5), 10)
  })

  it('上升段（0 → 0.5）单调增，下降段（0.5 → 1）单调减', () => {
    let previous = getCharPulseIntensity(0)
    for (let progress = 0.01; progress <= 0.5; progress += 0.01) {
      const value = getCharPulseIntensity(progress)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
    previous = getCharPulseIntensity(0.5)
    for (let progress = 0.51; progress <= 1; progress += 0.01) {
      const value = getCharPulseIntensity(progress)
      expect(value).toBeLessThanOrEqual(previous)
      previous = value
    }
  })

  it('峰值位置唯一：扫描 [0, 1] 的最大值出现在 0.5', () => {
    let best = -1
    let bestProgress = -1
    for (let step = 0; step <= 200; step++) {
      const progress = step / 200
      const value = getCharPulseIntensity(progress)
      if (value > best) {
        best = value
        bestProgress = progress
      }
    }
    expect(bestProgress).toBe(0.5)
    expect(best).toBeCloseTo(1, 10)
  })

  it('余晖段（progress > 1）：在 1.2 倍时长内升到地板值 0.25 后恒定', () => {
    // 笔记 §6 原文：0.25 * (afterElapsed / ramp)，ramp = 1.2；>= ramp 则为地板 0.25
    expect(getCharPulseIntensity(1.6)).toBeCloseTo(AFTERGLOW_FLOOR * (0.6 / 1.2), 10)
    expect(getCharPulseIntensity(2.2)).toBe(AFTERGLOW_FLOOR)
    expect(getCharPulseIntensity(2.21)).toBe(AFTERGLOW_FLOOR)
    expect(getCharPulseIntensity(100)).toBe(AFTERGLOW_FLOOR)
  })

  it('余晖段单调不减，且始终不超过地板值', () => {
    let previous = getCharPulseIntensity(1)
    for (let progress = 1.01; progress <= 5; progress += 0.01) {
      const value = getCharPulseIntensity(progress)
      expect(value).toBeGreaterThanOrEqual(previous)
      expect(value).toBeLessThanOrEqual(AFTERGLOW_FLOOR)
      previous = value
    }
  })

  it('输出恒在 [0, 1]', () => {
    for (let progress = -1; progress <= 5; progress += 0.005) {
      const value = getCharPulseIntensity(progress)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('退化输入：NaN → 0；+Infinity 视为早已唱完（地板值）', () => {
    expect(getCharPulseIntensity(Number.NaN)).toBe(0)
    expect(getCharPulseIntensity(Number.POSITIVE_INFINITY)).toBe(AFTERGLOW_FLOOR)
    expect(getCharPulseIntensity(Number.NEGATIVE_INFINITY)).toBe(0)
  })
})

describe('clampPulseDuration（笔记 §6 的时长钳制）', () => {
  it('钳到 [min, max]（单位由调用方决定：秒 0.2/0.9，毫秒 200/900）', () => {
    expect(clampPulseDuration(0.05, 0.2, 0.9)).toBe(0.2)
    expect(clampPulseDuration(0.5, 0.2, 0.9)).toBe(0.5)
    expect(clampPulseDuration(5, 0.2, 0.9)).toBe(0.9)
    expect(clampPulseDuration(50, 200, 900)).toBe(200)
    expect(clampPulseDuration(2000, 200, 900)).toBe(900)
  })

  it('退化输入：NaN → 下限，±Infinity 照常钳制；非有限边界 → 0；min > max 不产生抖动区间', () => {
    expect(clampPulseDuration(Number.NaN, 0.2, 0.9)).toBe(0.2)
    expect(clampPulseDuration(Number.POSITIVE_INFINITY, 0.2, 0.9)).toBe(0.9)
    expect(clampPulseDuration(Number.NEGATIVE_INFINITY, 0.2, 0.9)).toBe(0.2)
    expect(clampPulseDuration(1, Number.NaN, Number.NaN)).toBe(0)
    expect(clampPulseDuration(0.5, 1, 0.2)).toBe(1)
  })
})

describe('resolveCharPulseProgress / getCharPulseAtTime', () => {
  it('progress = 已过时间 / 钳制后时长', () => {
    expect(resolveCharPulseProgress(500, 0, 400, 200, 900)).toBeCloseTo(1.25, 10)
    expect(resolveCharPulseProgress(500, 0, 100, 200, 900)).toBeCloseTo(2.5, 10) // 100ms 被钳到 200ms
    expect(resolveCharPulseProgress(0, 1000, 1400, 200, 900)).toBeCloseTo(-2.5, 10)
  })

  it('唱到一半 → 峰值；还没唱到 → 0；唱完很久 → 地板值', () => {
    expect(getCharPulseAtTime(200, 0, 400, 200, 900)).toBeCloseTo(1, 10)
    expect(getCharPulseAtTime(-1, 0, 400, 200, 900)).toBe(0)
    expect(getCharPulseAtTime(0, 0, 400, 200, 900)).toBe(0)
    expect(getCharPulseAtTime(4000, 0, 400, 200, 900)).toBe(AFTERGLOW_FLOOR)
  })

  it('极短音被钳到下限（20ms 的单词也有完整钟形）', () => {
    // 20ms 被钳到 200ms：唱到 100ms 时正好是钟形峰值
    expect(getCharPulseAtTime(100, 0, 20, 200, 900)).toBeCloseTo(1, 10)
    expect(getCharPulseAtTime(10, 0, 20, 200, 900)).toBeCloseTo(Math.sin(0.05 * Math.PI), 10)
  })

  it('单位无关：秒与毫秒同构', () => {
    for (const fraction of [0, 0.25, 0.5, 1, 2, 3]) {
      expect(getCharPulseAtTime(0.4 * fraction, 0, 0.4, 0.2, 0.9)).toBeCloseTo(
        getCharPulseAtTime(400 * fraction, 0, 400, 200, 900),
        10
      )
    }
  })

  it('非有限时间输入不抛异常且不产生 NaN', () => {
    for (const value of [
      getCharPulseAtTime(Number.NaN, 0, 400, 200, 900),
      getCharPulseAtTime(0, Number.NaN, 400, 200, 900),
      getCharPulseAtTime(0, 0, Number.NaN, 200, 900),
      getCharPulseAtTime(Number.POSITIVE_INFINITY, 0, 400, 200, 900)
    ]) {
      expect(Number.isNaN(value)).toBe(false)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
})

describe('getCharPulseScale（笔记 §6 的放大倍率）', () => {
  it('强度 0 → 1 倍；强度 1 → 倾斜 1.18 / 非倾斜 1.15', () => {
    expect(getCharPulseScale(0, true)).toBe(1)
    expect(getCharPulseScale(0, false)).toBe(1)
    expect(getCharPulseScale(1, true)).toBeCloseTo(1.18, 10)
    expect(getCharPulseScale(1, false)).toBeCloseTo(1.15, 10)
    expect(getCharPulseScale(0.5, false)).toBeCloseTo(1.075, 10)
  })

  it('退化输入：越界强度被钳制，NaN → 1 倍', () => {
    expect(getCharPulseScale(2, true)).toBeCloseTo(1.18, 10)
    expect(getCharPulseScale(-1, true)).toBe(1)
    expect(getCharPulseScale(Number.NaN, true)).toBe(1)
  })
})
