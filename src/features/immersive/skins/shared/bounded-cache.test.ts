/**
 * 有界缓存单测：它被颜色解析与文本测量共用，淘汰语义错一位的后果
 * 分别是「长会话内存增长」与「测量结果串味」，两者都不容易在肉眼上发现。
 */

import { describe, expect, it } from 'vitest'
import { rememberBounded } from './bounded-cache'

describe('rememberBounded', () => {
  it('写入后能读回，并返回写入的值（便于 return rememberBounded(...)）', () => {
    const cache = new Map<string, number>()
    const returned = rememberBounded(cache, 'a', 1, 8)

    expect(returned).toBe(1)
    expect(cache.get('a')).toBe(1)
  })

  it('未达上限不淘汰任何条目', () => {
    const cache = new Map<string, number>()
    for (let index = 0; index < 4; index += 1) {
      rememberBounded(cache, `k${index}`, index, 4)
    }

    expect(cache.size).toBe(4)
    expect([...cache.keys()]).toEqual(['k0', 'k1', 'k2', 'k3'])
  })

  it('超出上限时淘汰**最旧**的一条，保留最新 limit 条', () => {
    const cache = new Map<string, number>()
    for (let index = 0; index < 6; index += 1) {
      rememberBounded(cache, `k${index}`, index, 4)
    }

    expect([...cache.keys()]).toEqual(['k2', 'k3', 'k4', 'k5'])
  })

  it('重写已有键**不**淘汰其他条目，也不改变它的插入位置', () => {
    const cache = new Map<string, number>()
    for (let index = 0; index < 3; index += 1) {
      rememberBounded(cache, `k${index}`, index, 3)
    }

    rememberBounded(cache, 'k0', 99, 3)

    expect(cache.size).toBe(3)
    expect(cache.get('k0')).toBe(99)
    // 位置不变（不做真 LRU 提升）→ 下一次写入淘汰的仍是 k0
    expect([...cache.keys()]).toEqual(['k0', 'k1', 'k2'])
    rememberBounded(cache, 'k3', 3, 3)
    expect([...cache.keys()]).toEqual(['k1', 'k2', 'k3'])
  })

  it('limit 为 1 时退化成「只留最后一条」', () => {
    const cache = new Map<string, number>()
    rememberBounded(cache, 'a', 1, 1)
    rememberBounded(cache, 'b', 2, 1)

    expect([...cache.entries()]).toEqual([['b', 2]])
  })

  it('limit <= 0 / 非有限值一律按容量 1 处理（保留最新一条，不是无界、也不是不缓存）', () => {
    const cache = new Map<string, number>()
    rememberBounded(cache, 'a', 1, 0)
    rememberBounded(cache, 'b', 2, -5)

    // 每次写入都只保留最新的一条 —— 与上游「满了先删一条再写」的实际行为一致
    expect([...cache.entries()]).toEqual([['b', 2]])
  })

  it('limit 为小数时向下取整到整数容量', () => {
    const cache = new Map<string, number>()
    for (let index = 0; index < 4; index += 1) {
      rememberBounded(cache, `k${index}`, index, 2.9)
    }

    expect([...cache.keys()]).toEqual(['k2', 'k3'])
  })

  it('limit 为 NaN / Infinity 时按容量 1 处理（不会退化成无界）', () => {
    const nanCache = new Map<string, number>()
    rememberBounded(nanCache, 'a', 1, Number.NaN)
    rememberBounded(nanCache, 'b', 2, Number.NaN)
    expect([...nanCache.entries()]).toEqual([['b', 2]])

    const infiniteCache = new Map<string, number>()
    rememberBounded(infiniteCache, 'a', 1, Number.POSITIVE_INFINITY)
    rememberBounded(infiniteCache, 'b', 2, Number.POSITIVE_INFINITY)
    expect([...infiniteCache.entries()]).toEqual([['b', 2]])
  })

  it('键可以是非字符串（测量缓存用过长键做键）', () => {
    const cache = new Map<number, string>()
    rememberBounded(cache, 7, 'seven', 2)

    expect(cache.get(7)).toBe('seven')
  })

  it('缓存对象必须被原地修改（不能返回新 Map，否则调用处的旧引用会失效）', () => {
    const cache = new Map<string, number>()
    const sameReference = cache
    rememberBounded(cache, 'a', 1, 4)

    expect(sameReference.get('a')).toBe(1)
  })
})
