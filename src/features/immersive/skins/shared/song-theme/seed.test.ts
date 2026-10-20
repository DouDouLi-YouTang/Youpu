import { describe, expect, it } from 'vitest'

import { createSeededRandom, hashSeed } from './seed'

describe('hashSeed', () => {
  it('同一输入永远得到同一散列', () => {
    expect(hashSeed(12345)).toBe(hashSeed(12345))
    expect(hashSeed('abc')).toBe(hashSeed('abc'))
  })

  it('不同输入得到不同散列（常见 id 样本上无碰撞）', () => {
    const seen = new Set<number>()
    for (let id = 1; id <= 2000; id += 1) seen.add(hashSeed(id))
    // 允许极少量碰撞，但不该出现大面积重合
    expect(seen.size).toBeGreaterThan(1990)
  })

  it('落在 32 位无符号范围内', () => {
    for (const input of [0, 1, 2107173843, 4294967295, 'no-cover::no-song']) {
      const hash = hashSeed(input)
      expect(Number.isInteger(hash)).toBe(true)
      expect(hash).toBeGreaterThanOrEqual(0)
      expect(hash).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('createSeededRandom', () => {
  it('同一种子产生同一串数', () => {
    const a = createSeededRandom(99)
    const b = createSeededRandom(99)
    const first = Array.from({ length: 20 }, () => a())
    const second = Array.from({ length: 20 }, () => b())
    expect(first).toEqual(second)
  })

  it('不同种子产生不同的串', () => {
    const a = createSeededRandom(1)
    const b = createSeededRandom(2)
    expect(a()).not.toBe(b())
  })

  it('输出始终落在 [0, 1)', () => {
    const random = createSeededRandom(7)
    for (let index = 0; index < 5000; index += 1) {
      const value = random()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('相邻取值不相关（连续两次不会给出同一个数）', () => {
    const random = createSeededRandom(2024)
    let repeats = 0
    let previous = random()
    for (let index = 0; index < 5000; index += 1) {
      const value = random()
      if (value === previous) repeats += 1
      previous = value
    }
    expect(repeats).toBe(0)
  })

  it('分布大致均匀（十桶各自落在 8%–12%）', () => {
    const random = createSeededRandom('distribution')
    const buckets = new Array(10).fill(0)
    const total = 20000
    for (let index = 0; index < total; index += 1) {
      buckets[Math.floor(random() * 10)] += 1
    }
    for (const count of buckets) {
      expect(count / total).toBeGreaterThan(0.08)
      expect(count / total).toBeLessThan(0.12)
    }
  })
})
