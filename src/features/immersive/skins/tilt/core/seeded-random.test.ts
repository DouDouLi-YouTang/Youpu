import { describe, expect, it } from 'vitest'
import { seededRandom } from './seeded-random'

describe('seededRandom', () => {
  it('同一 (seed, index) 永远得到同一个值', () => {
    const cases: [number, number][] = [
      [0, 0],
      [1, 1],
      [123456, 200],
      [-7, 100],
      [1234.5, 3]
    ]
    for (const [seed, index] of cases) {
      expect(seededRandom(seed, index)).toBe(seededRandom(seed, index))
    }
  })

  it('输出恒在 [0, 1)', () => {
    for (let seed = -20; seed <= 20; seed++) {
      for (let index = 0; index < 30; index++) {
        const value = seededRandom(seed * 1234.5, index)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThan(1)
      }
    }
    expect(seededRandom(Number.NaN, 1)).toBeGreaterThanOrEqual(0)
    expect(seededRandom(Number.POSITIVE_INFINITY, 1)).toBeLessThan(1)
  })

  it('固定 seed 时，不同 index 必得不同结果（0..99 两两不同）', () => {
    const values = new Set<number>()
    for (let index = 0; index < 100; index++) values.add(seededRandom(987654321, index))
    expect(values.size).toBe(100)
  })

  it('不同 seed 在同一 index 上给出不同结果', () => {
    const values = new Set<number>()
    for (let seed = 1000; seed < 1010; seed++) values.add(seededRandom(seed, 200))
    expect(values.size).toBe(10)
  })

  it('分布大致均匀（10000 个样本，均值与十个分桶都在容差内）', () => {
    const samples = 10000
    const buckets = Array.from({ length: 10 }, () => 0)
    let sum = 0
    for (let index = 0; index < samples; index++) {
      const value = seededRandom(12345, index)
      sum += value
      buckets[Math.floor(value * 10)]++
    }
    expect(sum / samples).toBeCloseTo(0.5, 1)
    for (const count of buckets) {
      expect(Math.abs(count / samples - 0.1)).toBeLessThan(0.03)
    }
  })
})
