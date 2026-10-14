import { describe, expect, it } from 'vitest'

import { MONET_DRIFT_CONSTANTS, buildMonetDriftTrack } from './monet-background-drift'

interface ParsedKeyframe {
  x: number
  y: number
  scale: number
}

/** 把 `translate3d(x%, y%, 0) scale(s)` 解析回数值，便于断言（而不是比字符串）。 */
function parseTrack(strength: number): ParsedKeyframe[] {
  return buildMonetDriftTrack(strength).keyframes.map((keyframe) => {
    const match = /^translate3d\(([-\d.]+)%, ([-\d.]+)%, 0\) scale\(([\d.]+)\)$/.exec(
      String(keyframe.transform)
    )
    if (!match) throw new Error(`无法解析关键帧：${String(keyframe.transform)}`)
    return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) }
  })
}

describe('monet 漂移轨道常量', () => {
  it('逐字对齐规格 §4.4', () => {
    expect(MONET_DRIFT_CONSTANTS).toEqual({
      loopSeconds: 240,
      latticePoints: 76,
      sampleCount: 156,
      maxTravelPercent: 3.4,
      breathAmplitude: 0.035,
      overscanMargin: 0.01
    })
  })
})

describe('buildMonetDriftTrack', () => {
  it('关键帧数是 sampleCount + 1（0..156），时长 240 秒', () => {
    const track = buildMonetDriftTrack(0.5)
    expect(track.keyframes).toHaveLength(157)
    expect(track.durationMs).toBe(240_000)
  })

  it('首尾关键帧完全一致（噪声按格点取模 → 无缝循环）', () => {
    const frames = parseTrack(0.5)
    const first = frames[0]
    const last = frames.at(-1) as ParsedKeyframe
    expect(last.x).toBeCloseTo(first.x, 4)
    expect(last.y).toBeCloseTo(first.y, 4)
    expect(last.scale).toBeCloseTo(first.scale, 5)
  })

  it('每个通道都归一化到 ±1：位移上界精确等于 maxTravelPercent', () => {
    const track = buildMonetDriftTrack(1)
    const frames = parseTrack(1)
    const maxAbs = frames.reduce(
      (acc, frame) => Math.max(acc, Math.abs(frame.x), Math.abs(frame.y)),
      0
    )
    // travel = 3.4%，归一化后极值必须正好打到它（容差留给 toFixed(4)）
    expect(maxAbs).toBeCloseTo(3.4, 3)
    expect(track.maxTravelPercent).toBe(3.4)
  })

  it('缩放永远大于 1 + 2 * travel（否则平移会把图边拖进视口）', () => {
    for (const strength of [0, 0.25, 0.5, 1]) {
      const track = buildMonetDriftTrack(strength)
      const lowerBound = 1 + (track.maxTravelPercent / 100) * 2
      // 上界 = minScale（几何下限 + 舍入余量）+ 该强度下的整个呼吸幅度
      const upperBound = track.minScale + 0.035 * strength + 0.0001
      for (const frame of parseTrack(strength)) {
        expect(frame.scale).toBeGreaterThan(lowerBound)
        expect(frame.scale).toBeLessThanOrEqual(upperBound)
      }
      expect(track.minScale).toBeCloseTo(1 + (track.maxTravelPercent / 100) * 2 + 0.01, 6)
    }
  })

  it('strength = 0：位移为 0、缩放恒等于下限（既不漂也不呼吸）', () => {
    const track = buildMonetDriftTrack(0)
    expect(track.maxTravelPercent).toBe(0)
    expect(track.minScale).toBeCloseTo(1.01, 6)
    for (const frame of parseTrack(0)) {
      expect(frame.x).toBe(0)
      expect(frame.y).toBe(0)
      expect(frame.scale).toBeCloseTo(1.01, 5)
    }
  })

  it('强度越大位移越大（单调，且与 strength 线性）', () => {
    const half = parseTrack(0.5)
    const full = parseTrack(1)
    expect(half).toHaveLength(full.length)
    for (let index = 0; index < full.length; index += 1) {
      expect(half[index].x).toBeCloseTo(full[index].x / 2, 3)
      expect(half[index].y).toBeCloseTo(full[index].y / 2, 3)
    }
  })

  it('三个通道不同步（x / y / scale 的采样序列互不相同）', () => {
    const frames = parseTrack(1)
    const sameXy = frames.filter((frame) => Math.abs(frame.x - frame.y) < 1e-9).length
    // 允许极少数巧合，但绝不该「基本都相等」
    expect(sameXy).toBeLessThan(frames.length * 0.1)
  })

  it('越界 / NaN 输入被夹住，不会产出 NaN 的 transform', () => {
    for (const strength of [-5, 9, Number.NaN, Number.POSITIVE_INFINITY]) {
      const track = buildMonetDriftTrack(strength)
      expect(track.keyframes).toHaveLength(157)
      for (const frame of track.keyframes) {
        expect(String(frame.transform)).not.toContain('NaN')
      }
    }
    expect(buildMonetDriftTrack(9).maxTravelPercent).toBe(3.4)
    expect(buildMonetDriftTrack(-5).maxTravelPercent).toBe(0)
  })
})
