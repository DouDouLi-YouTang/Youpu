import { describe, expect, it } from 'vitest'

import {
  clampFoliaAudio,
  isFoliaBandShape,
  normalizeAudioBandsInput,
  normalizeAudio,
  normalizeAudioPowerInput,
  readFoliaBands,
  readFoliaPower,
  silentFoliaBands,
  toFoliaBands,
  toFoliaBandsFromInput,
  toFoliaScale
} from './audio-bands'

describe('audio-bands', () => {
  it('0–1 → 0–255 且越界被夹住', () => {
    expect(toFoliaScale(0)).toBe(0)
    expect(toFoliaScale(1)).toBe(255)
    expect(toFoliaScale(0.5)).toBeCloseTo(127.5, 4)
    expect(toFoliaScale(2)).toBe(255)
    expect(toFoliaScale(-1)).toBe(0)
    expect(toFoliaScale(Number.NaN)).toBe(0)
  })

  it('四频带 → 六频带：同区间共用 + 相邻区间加权', () => {
    const bands = toFoliaBands({ low: 1, mid: 0.5, high: 0.25, power: 1 })
    expect(bands.bass).toBe(255)
    expect(bands.mid).toBeCloseTo(0.5 * 255, 4)
    expect(bands.treble).toBeCloseTo(0.25 * 255, 4)
    // lowMid = low*0.6 + mid*0.4 = 0.8
    expect(bands.lowMid).toBeCloseTo(0.8 * 255, 4)
    // vocal = mid*0.65 + high*0.35 = 0.4125
    expect(bands.vocal).toBeCloseTo(0.4125 * 255, 4)
  })

  it('六频带彼此不同涨同落（近似映射也要保住相对差异）', () => {
    const quiet = toFoliaBands({ low: 0.1, mid: 0.2, high: 0.3, power: 0.2 })
    const loud = toFoliaBands({ low: 0.9, mid: 0.4, high: 0.05, power: 0.7 })
    // 逐频带比较「同一频带在两段音频里的方向」—— 这才是「保住相对差异」的含义。
    // （跨频带比较没有意义：lowMid 与 vocal 的加权基准不同，量级本就不在一个尺度上。）
    expect(loud.bass).toBeGreaterThan(quiet.bass)
    expect(loud.treble).toBeLessThan(quiet.treble)
    expect(loud.lowMid).toBeGreaterThan(quiet.lowMid)
    expect(loud.vocal).toBeGreaterThan(quiet.vocal)
    // 同一段音频内部也要有区分度：不能退化成六个相等的值
    expect(new Set(Object.values(loud)).size).toBeGreaterThan(3)
  })

  it('normalizeAudio 是 /255 再夹到 0–1', () => {
    expect(normalizeAudio(255)).toBe(1)
    expect(normalizeAudio(0)).toBe(0)
    expect(normalizeAudio(127.5)).toBeCloseTo(0.5, 4)
    expect(normalizeAudio(9999)).toBe(1)
    expect(normalizeAudio(-5)).toBe(0)
    expect(normalizeAudio(Number.NaN)).toBe(0)
  })

  it('clampFoliaAudio 杀 NaN、夹区间', () => {
    expect(clampFoliaAudio(Number.NaN)).toBe(0)
    expect(clampFoliaAudio(Number.POSITIVE_INFINITY)).toBe(0)
    expect(clampFoliaAudio(-3)).toBe(0)
    expect(clampFoliaAudio(300)).toBe(255)
  })

  it('回调缺失 / 返回空时给出静默值', () => {
    expect(readFoliaPower(undefined)).toBe(0)
    expect(readFoliaBands(undefined)).toEqual(silentFoliaBands())
    // 已经是 Folia 0–255 量纲时**必须显式声明 scale**：不声明就按 0–1 解释，
    // 200 会被算成 200×255 再夹到 255（量纲混用最典型的坑，所以这里刻意各测一遍）
    expect(
      readFoliaBands(() => ({ bass: 300, lowMid: -1, mid: 10, vocal: 20, treble: 30 }), '0-255')
    ).toEqual({ bass: 255, lowMid: 0, mid: 10, vocal: 20, treble: 30 })
    // 不声明 scale 时按 0–1 解释：`{ mid: 1 }` = 满值，lowMid/vocal 由加权公式派生
    expect(readFoliaBands(() => ({ mid: 1 }))).toEqual({
      bass: 0,
      lowMid: 0.4 * 255,
      mid: 255,
      vocal: 0.65 * 255,
      treble: 0
    })
    // 0–1 量纲下 128 是越界值 → 夹到满值 255；要原样拿到 128 必须声明 '0-255'
    expect(readFoliaPower(() => 128)).toBe(255)
    expect(readFoliaPower(() => 0.5)).toBeCloseTo(127.5, 4)
    expect(readFoliaPower(() => 128, '0-255')).toBe(128)
  })
})

describe('audio-bands 宿主输入（量纲 + 形状自动识别）', () => {
  it("scale='0-1' 时按 0–255 换算", () => {
    const bands = normalizeAudioBandsInput({ low: 1, mid: 0.5, high: 0.5, power: 0.5 })
    expect(bands.bass).toBe(255)
    expect(bands.mid).toBeCloseTo(127.5, 4)
    expect(normalizeAudioPowerInput(0.5)).toBeCloseTo(127.5, 4)
  })

  it("scale='0-255' 时原样夹区间，不再乘 255", () => {
    const bands = normalizeAudioBandsInput({ low: 255, mid: 128, high: 0, power: 200 }, '0-255')
    expect(bands.bass).toBe(255)
    expect(bands.mid).toBe(128)
    // lowMid = 255*0.6 + 128*0.4 = 204.2（0–255 域内的同一条加权公式）
    expect(bands.lowMid).toBeCloseTo(204.2, 4)
    expect(normalizeAudioPowerInput(300, '0-255')).toBe(255)
  })

  it('五频带直接透传，四频带只用来补缺键', () => {
    const pure = normalizeAudioBandsInput(
      { bass: 10, lowMid: 20, mid: 30, vocal: 40, treble: 50 },
      '0-255'
    )
    expect(pure).toEqual({ bass: 10, lowMid: 20, mid: 30, vocal: 40, treble: 50 })

    // 混合形状：五频带键优先；四频带里**没有给**的 mid/high 就是 0（不给 = 静音，
    // 不能让 bass 反推 mid，否则一条 `bass` 输入会凭空造出中频）
    const mixed = normalizeAudioBandsInput({ low: 128, bass: 200 }, '0-255')
    expect(mixed.bass).toBe(200)
    expect(mixed.mid).toBe(0)
    expect(mixed.lowMid).toBeCloseTo(128 * 0.6, 4)
    expect(mixed.vocal).toBe(0)
  })

  it('形状判定看键而不是看数值（静音也必须认得出来）', () => {
    expect(isFoliaBandShape({ low: 0, mid: 0, high: 0, power: 0 })).toBe(false)
    expect(isFoliaBandShape({ bass: 0 })).toBe(true)
    expect(normalizeAudioBandsInput(null)).toEqual(silentFoliaBands())
    expect(normalizeAudioBandsInput(undefined, '0-255')).toEqual(silentFoliaBands())
  })

  it('toFoliaBandsFromInput 与 toFoliaBands 在 0–1 域等价', () => {
    const source = { low: 0.31, mid: 0.62, high: 0.17, power: 0.44 }
    expect(toFoliaBandsFromInput(source)).toEqual(toFoliaBands(source))
  })
})
