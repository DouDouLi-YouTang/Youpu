import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TILT_STYLE_PROBABILITY,
  SHORT_LAST_SEGMENT_SCALE,
  isShortLastSegment,
  measureSegmentLength,
  pickTiltSegment
} from './tilt-pick'

const SEGMENTS = ['我爱你，', '可是你爱他', '你爱她']

describe('pickTiltSegment（笔记 §2.3）', () => {
  it('倾斜下标要么为 null，要么是合法下标（最多一段倾斜）', () => {
    for (let seed = 0; seed < 500; seed++) {
      const { tiltIndex } = pickTiltSegment(SEGMENTS, seed * 313)
      expect(
        tiltIndex === null ||
          (Number.isInteger(tiltIndex) && tiltIndex >= 0 && tiltIndex < SEGMENTS.length)
      ).toBe(true)
    }
  })

  it('概率为 0 时没有候选 → 整行都不倾斜', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(pickTiltSegment(SEGMENTS, seed, 0).tiltIndex).toBeNull()
    }
  })

  it('概率为 1 时必有倾斜段，且只选一个', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(pickTiltSegment(SEGMENTS, seed, 1).tiltIndex).not.toBeNull()
    }
  })

  it('概率为 1 时，多个 seed 能把各段都选到（选择确实用了种子）', () => {
    const chosen = new Set<number>()
    for (let seed = 0; seed < 200; seed++) {
      const { tiltIndex } = pickTiltSegment(SEGMENTS, seed, 1)
      if (tiltIndex !== null) chosen.add(tiltIndex)
    }
    expect(chosen.size).toBe(SEGMENTS.length)
  })

  it('默认概率就是 0.35，且与显式传 0.35 等价', () => {
    expect(DEFAULT_TILT_STYLE_PROBABILITY).toBe(0.35)
    for (let seed = 0; seed < 50; seed++) {
      expect(pickTiltSegment(SEGMENTS, seed)).toEqual(pickTiltSegment(SEGMENTS, seed, 0.35))
    }
  })

  it('同一 (segments, seed, 概率) 结果完全一致（可复现）', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(pickTiltSegment(SEGMENTS, seed)).toEqual(pickTiltSegment(SEGMENTS, seed))
    }
  })

  it('空段列表 / 越界概率不抛异常', () => {
    expect(pickTiltSegment([], 1).tiltIndex).toBeNull()
    expect(pickTiltSegment(SEGMENTS, 1, Number.NaN)).toEqual(pickTiltSegment(SEGMENTS, 1))
    expect(pickTiltSegment(SEGMENTS, 1, -1).tiltIndex).toBeNull()
    expect(pickTiltSegment(SEGMENTS, 1, 99).tiltIndex).not.toBeNull()
  })
})

describe('measureSegmentLength', () => {
  it('数的是非空白字素（emoji 算一个字，空格不算）', () => {
    expect(measureSegmentLength('你好')).toBe(2)
    expect(measureSegmentLength('你好 ')).toBe(2)
    expect(measureSegmentLength(' ')).toBe(0)
    expect(measureSegmentLength('a👍🏽')).toBe(2)
    expect(measureSegmentLength('')).toBe(0)
  })
})

describe('isShortLastSegment（笔记 §2.4）', () => {
  it('末段非倾斜、字数 ≤ 2、且 字数×2 ≤ 前一段 → true', () => {
    expect(isShortLastSegment([9, 1], false)).toBe(true)
    expect(isShortLastSegment([4, 2], false)).toBe(true)
    expect(isShortLastSegment([9, 5, 2], false)).toBe(true)
  })

  it('末段是倾斜段 → false（即使很短）', () => {
    expect(isShortLastSegment([9, 1], true)).toBe(false)
  })

  it('末段字数 > 2 → false', () => {
    expect(isShortLastSegment([20, 3], false)).toBe(false)
  })

  it('末段相对前一段不够短（字数×2 > 前一段）→ false', () => {
    expect(isShortLastSegment([1, 1], false)).toBe(false)
    expect(isShortLastSegment([3, 2], false)).toBe(false)
  })

  it('退化输入：段数 < 2、空数组、字数为 0 或非有限值 → false', () => {
    expect(isShortLastSegment([], false)).toBe(false)
    expect(isShortLastSegment([1], false)).toBe(false)
    expect(isShortLastSegment([9, 0], false)).toBe(false)
    expect(isShortLastSegment([9, Number.NaN], false)).toBe(false)
    expect(isShortLastSegment([Number.NaN, 1], false)).toBe(false)
  })

  it('放大倍率常量与笔记一致（1.18 倍）', () => {
    expect(SHORT_LAST_SEGMENT_SCALE).toBe(1.18)
  })

  it('集成：末段短且未被选中倾斜时标记为 true，被选中时标记为 false', () => {
    const segments = ['这是一句很长的歌词', '啊']
    let sawShort = false
    let sawTilted = false
    for (let seed = 0; seed < 40; seed++) {
      const { tiltIndex, shortLastSegment } = pickTiltSegment(segments, seed, 1)
      expect(shortLastSegment).toBe(tiltIndex !== 1)
      if (tiltIndex === 1) sawTilted = true
      else sawShort = true
    }
    expect(sawShort).toBe(true)
    expect(sawTilted).toBe(true)
  })
})
