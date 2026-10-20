/**
 * 静态快照缓存的单测（移植规格书 §11.1 + 本项目的容量封顶）。
 *
 * 这一层的错误几乎全是**静默**的：回收晚一秒没人看得出来，淘汰顺序错了只是偶尔掉帧，
 * 忘了把 `canvas.width/height` 归零则表现为「播放半小时后显存才涨上去」。
 * 所以下面用假快照对象把「什么时候删、删的是哪一条、删之前做了什么」逐条钉死。
 *
 * 假快照只需要 `{ canvas: { width, height }, padding }` —— 真实类型是
 * `HTMLCanvasElement`，但本层只用得到这两个可变属性，用最小结构就能断言。
 */

import { describe, expect, it, vi } from 'vitest'

import {
  FUME_SNAPSHOT_CACHE_LIMIT,
  SNAPSHOT_IDLE_MS,
  acquireFumeSnapshot,
  createFumeSnapshotCache,
  releaseFumeSnapshots
} from './snapshot-cache'
import type { FumeStaticBlockSnapshot } from '../core/fume-types'

/** 造一张假快照：尺寸就取真实快照的像素口径，好断言「被归零了」 */
function makeSnapshot(width = 424, height = 64): FumeStaticBlockSnapshot {
  return {
    canvas: { width, height },
    padding: 11
  } as unknown as FumeStaticBlockSnapshot
}

/** 造一个永远成功的创建函数，并记录被调了几次 */
function makeFactory(snapshot: FumeStaticBlockSnapshot = makeSnapshot()) {
  const factory = vi.fn(() => snapshot)
  return { factory, snapshot }
}

describe('acquireFumeSnapshot（规格书 §11.1）', () => {
  it('未命中就现场创建并存进缓存', () => {
    const cache = createFumeSnapshotCache()
    const { factory, snapshot } = makeFactory()

    expect(acquireFumeSnapshot(cache, 'a:passed:standard:2', 1000, factory)).toBe(snapshot)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(cache.size).toBe(1)
    expect(cache.get('a:passed:standard:2')).toEqual({ snapshot, lastUsed: 1000 })
  })

  it('命中直接复用，不再调创建函数', () => {
    const cache = createFumeSnapshotCache()
    const { factory, snapshot } = makeFactory()

    acquireFumeSnapshot(cache, 'a:waiting:base:1', 1000, factory)
    factory.mockClear()

    expect(acquireFumeSnapshot(cache, 'a:waiting:base:1', 1200, factory)).toBe(snapshot)
    expect(factory).not.toHaveBeenCalled()
  })

  it('命中也要刷新 lastUsed（否则「最近用过」退化成「最近创建过」）', () => {
    const cache = createFumeSnapshotCache()
    const { factory } = makeFactory()

    acquireFumeSnapshot(cache, 'a', 1000, factory)
    acquireFumeSnapshot(cache, 'a', 5000, factory)

    expect(cache.get('a')?.lastUsed).toBe(5000)
  })

  it('创建失败返回 undefined 且不写缓存（失败往往是临时资源压力，下一帧还要再试）', () => {
    const cache = createFumeSnapshotCache()
    const factory = vi.fn(() => null)

    expect(acquireFumeSnapshot(cache, 'a', 1000, factory)).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('不同的键各存一张（状态 / 样式 / snapshotScale 都在键里）', () => {
    const cache = createFumeSnapshotCache()
    const { factory } = makeFactory()

    acquireFumeSnapshot(cache, 'a:waiting:base:1', 0, factory)
    acquireFumeSnapshot(cache, 'a:passed:standard:1', 0, factory)
    acquireFumeSnapshot(cache, 'a:passed:standard:2', 0, factory)

    expect(cache.size).toBe(3)
  })
})

describe('releaseFumeSnapshots（规格书 §11.1 的空闲回收）', () => {
  it('未超过 SNAPSHOT_IDLE_MS 的一条都不动', () => {
    const cache = createFumeSnapshotCache()
    const { factory, snapshot } = makeFactory()
    acquireFumeSnapshot(cache, 'a', 1000, factory)

    releaseFumeSnapshots(cache, 1000 + SNAPSHOT_IDLE_MS - 1)

    expect(cache.size).toBe(1)
    expect(snapshot.canvas.width).toBe(424)
    expect(snapshot.canvas.height).toBe(64)
  })

  it('恰好卡在 SNAPSHOT_IDLE_MS 上的这一帧仍然保留（与上游的 <= 一致）', () => {
    const cache = createFumeSnapshotCache()
    const { factory } = makeFactory()
    acquireFumeSnapshot(cache, 'a', 1000, factory)

    releaseFumeSnapshots(cache, 1000 + SNAPSHOT_IDLE_MS)

    expect(cache.size).toBe(1)
  })

  it('超时的那条被删除，并且删之前把画布尺寸归零（立刻还回后备存储）', () => {
    const cache = createFumeSnapshotCache()
    const { factory, snapshot } = makeFactory()
    acquireFumeSnapshot(cache, 'a', 1000, factory)

    releaseFumeSnapshots(cache, 1000 + SNAPSHOT_IDLE_MS + 1)

    expect(cache.size).toBe(0)
    expect(snapshot.canvas.width).toBe(0)
    expect(snapshot.canvas.height).toBe(0)
  })

  it('只删超时的那条，最近用过的原样留着', () => {
    const cache = createFumeSnapshotCache()
    const { factory } = makeFactory()
    acquireFumeSnapshot(cache, 'old', 0, factory)
    acquireFumeSnapshot(cache, 'fresh', 20_000, factory)

    releaseFumeSnapshots(cache, 20_000)

    expect([...cache.keys()]).toEqual(['fresh'])
  })

  it('now = +Infinity 全清（文章 / 主题变化与组件卸载都走这条）', () => {
    const cache = createFumeSnapshotCache()
    const a = makeSnapshot(100, 50)
    const b = makeSnapshot(200, 80)
    acquireFumeSnapshot(cache, 'a', 0, () => a)
    acquireFumeSnapshot(cache, 'b', 10, () => b)
    expect(cache.size).toBe(2)

    releaseFumeSnapshots(cache, Number.POSITIVE_INFINITY)

    expect(cache.size).toBe(0)
    expect([a.canvas.width, a.canvas.height, b.canvas.width, b.canvas.height]).toEqual([0, 0, 0, 0])
  })

  it('now = NaN 一律不动（时钟拿不到时全清比留着更糟）', () => {
    const cache = createFumeSnapshotCache()
    const { factory, snapshot } = makeFactory()
    acquireFumeSnapshot(cache, 'a', 0, factory)

    releaseFumeSnapshots(cache, Number.NaN)

    expect(cache.size).toBe(1)
    expect(snapshot.canvas.width).toBe(424)
  })
})

describe('容量封顶（本项目加固，上游是无上限 Map）', () => {
  it('默认上限远大于单首歌的工作集', () => {
    expect(FUME_SNAPSHOT_CACHE_LIMIT).toBeGreaterThanOrEqual(512)
  })

  it('满了先淘汰最久没用过的那条，并把它的画布归零', () => {
    const cache = createFumeSnapshotCache()
    const stale = makeSnapshot()
    const fresh = makeSnapshot()
    acquireFumeSnapshot(cache, 'stale', 1000, () => stale, 2)
    acquireFumeSnapshot(cache, 'fresh', 2000, () => fresh, 2)
    // 让 fresh 变成「最近用过」，stale 保持 1000
    acquireFumeSnapshot(cache, 'fresh', 3000, () => fresh, 2)

    acquireFumeSnapshot(cache, 'new', 4000, () => makeSnapshot(), 2)

    expect([...cache.keys()]).toEqual(['fresh', 'new'])
    expect(stale.canvas.width).toBe(0)
    expect(fresh.canvas.width).toBe(424)
  })

  it('淘汰依据是 lastUsed 而不是插入序（插入早但刚用过的不该被丢）', () => {
    const cache = createFumeSnapshotCache()
    acquireFumeSnapshot(cache, 'early-but-used', 0, () => makeSnapshot(), 2)
    acquireFumeSnapshot(cache, 'late-but-idle', 0, () => makeSnapshot(), 2)
    acquireFumeSnapshot(cache, 'early-but-used', 9_000, () => makeSnapshot(), 2)

    acquireFumeSnapshot(cache, 'new', 10_000, () => makeSnapshot(), 2)

    expect([...cache.keys()]).toEqual(['early-but-used', 'new'])
  })

  it('写入后最多保留 capacity 条（不出现 capacity + 1 张画布）', () => {
    const cache = createFumeSnapshotCache()

    for (let index = 0; index < 20; index += 1) {
      acquireFumeSnapshot(cache, `k${index}`, index, () => makeSnapshot(), 4)
    }

    expect(cache.size).toBe(4)
    expect([...cache.keys()]).toEqual(['k16', 'k17', 'k18', 'k19'])
  })

  it('容量口径与 shared/bounded-cache 一致：0 / 负数 / 非有限值都按 1 条处理', () => {
    for (const limit of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const cache = createFumeSnapshotCache()
      acquireFumeSnapshot(cache, 'a', 0, () => makeSnapshot(), limit)
      acquireFumeSnapshot(cache, 'b', 1, () => makeSnapshot(), limit)

      expect(cache.size).toBe(1)
      expect([...cache.keys()]).toEqual(['b'])
    }
  })

  it('小数容量向下取整（1.9 → 最多 1 条）', () => {
    const cache = createFumeSnapshotCache()

    acquireFumeSnapshot(cache, 'a', 0, () => makeSnapshot(), 1.9)
    acquireFumeSnapshot(cache, 'b', 1, () => makeSnapshot(), 1.9)

    expect([...cache.keys()]).toEqual(['b'])
  })

  it('同刻并列的几条里淘汰插入更早的那条（Map 遍历序即插入序）', () => {
    const cache = createFumeSnapshotCache()
    acquireFumeSnapshot(cache, 'first', 500, () => makeSnapshot(), 2)
    acquireFumeSnapshot(cache, 'second', 500, () => makeSnapshot(), 2)

    acquireFumeSnapshot(cache, 'new', 500, () => makeSnapshot(), 2)

    expect([...cache.keys()]).toEqual(['second', 'new'])
  })
})
