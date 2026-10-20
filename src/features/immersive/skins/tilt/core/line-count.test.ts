import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SPLIT_PROBABILITY,
  MAX_LINE_COUNT,
  MIN_LINE_COUNT,
  determineLineCount
} from './line-count'

describe('determineLineCount', () => {
  it('段数恒在 1–4，且为整数', () => {
    for (let charCount = 0; charCount <= 120; charCount++) {
      for (let seed = 0; seed < 25; seed++) {
        const count = determineLineCount(charCount, seed * 7919)
        expect(Number.isInteger(count)).toBe(true)
        expect(count).toBeGreaterThanOrEqual(MIN_LINE_COUNT)
        expect(count).toBeLessThanOrEqual(MAX_LINE_COUNT)
      }
    }
  })

  it('同一 (charCount, seed) 恒定（可复现）', () => {
    expect(determineLineCount(18, 45678)).toBe(determineLineCount(18, 45678))
    expect(determineLineCount(37, 1, 0.5)).toBe(determineLineCount(37, 1, 0.5))
  })

  it('同一 seed 下，字数增大段数不减少（score 随字数单调增）', () => {
    for (let seed = 0; seed < 40; seed++) {
      let previous = determineLineCount(0, seed)
      for (let charCount = 1; charCount <= 120; charCount++) {
        const count = determineLineCount(charCount, seed)
        expect(count).toBeGreaterThanOrEqual(previous)
        previous = count
      }
    }
  })

  it('字数为 0（空行）恒为 1 段', () => {
    for (let seed = 0; seed < 200; seed++) expect(determineLineCount(0, seed)).toBe(1)
  })

  it('1 个字的退化行为只可能是 1–2 段', () => {
    for (let seed = 0; seed < 200; seed++)
      expect(determineLineCount(1, seed)).toBeLessThanOrEqual(2)
  })

  it('长行（>= 60 字）在默认概率下至少 2 段', () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(determineLineCount(60, seed)).toBeGreaterThanOrEqual(2)
    }
  })

  it('默认概率就是 0.75，且与显式传 0.75 等价', () => {
    expect(DEFAULT_SPLIT_PROBABILITY).toBe(0.75)
    for (let seed = 0; seed < 50; seed++) {
      expect(determineLineCount(12, seed)).toBe(determineLineCount(12, seed, 0.75))
    }
  })

  it('概率为 0 恒为 1 段；概率升高段数不减少', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(determineLineCount(40, seed, 0)).toBe(1)
      let previous = determineLineCount(40, seed, 0)
      for (let probability = 0.1; probability <= 1.0001; probability += 0.1) {
        const count = determineLineCount(40, seed, probability)
        expect(count).toBeGreaterThanOrEqual(previous)
        previous = count
      }
    }
  })

  it('平均段数随字数上升（趋势符合笔记 §2.1：不是线性，但单调）', () => {
    const mean = (charCount: number): number => {
      const seeds = 200
      let total = 0
      for (let seed = 0; seed < seeds; seed++) total += determineLineCount(charCount, seed)
      return total / seeds
    }
    expect(mean(4)).toBeLessThan(mean(12))
    expect(mean(12)).toBeLessThan(mean(30))
    expect(mean(30)).toBeLessThan(mean(80))
  })

  it('退化输入不抛异常：负数 / NaN / 越界概率', () => {
    expect(determineLineCount(-100, 1)).toBe(1)
    expect(determineLineCount(Number.NaN, 1)).toBe(1)
    expect(determineLineCount(Number.POSITIVE_INFINITY, 1)).toBe(1)
    expect(determineLineCount(10, 1, Number.NaN)).toBe(determineLineCount(10, 1))
    expect(determineLineCount(10, 1, 10)).toBe(determineLineCount(10, 1, 1))
    expect(determineLineCount(10, 1, -5)).toBe(1)
  })
})
