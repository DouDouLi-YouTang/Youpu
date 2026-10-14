/**
 * 分批释放队列的单测（性能修复，2026-10-14）。
 *
 * 这一层的错误全是**静默**的：少放几张只是显存高一点，键撞了只是偶尔漏掉一次归零，
 * 卸载时没清干净则要等 GC。所以下面用假快照把「每批几张、按什么顺序、
 * 键撞了会不会丢、卸载时是否真清空」逐条钉死。
 */

import { describe, expect, it } from 'vitest'

import {
  RETIRED_SNAPSHOTS_PER_FRAME,
  createFumeRetiredSnapshotQueue
} from './retired-snapshot-queue'
import { createFumeSnapshotCache, type FumeSnapshotCache } from './snapshot-cache'
import type { FumeStaticBlockSnapshot } from '../core/fume-types'

/** 造一张假快照：只需要 `{ canvas: { width, height } }` 两个可变字段 */
function makeSnapshot(width = 512, height = 256): FumeStaticBlockSnapshot {
  return { canvas: { width, height }, padding: 8 } as unknown as FumeStaticBlockSnapshot
}

/** 造一张带 N 条的缓存，键为 `k0..kN-1` */
function makeCache(count: number): {
  cache: FumeSnapshotCache
  snapshots: FumeStaticBlockSnapshot[]
} {
  const cache = createFumeSnapshotCache()
  const snapshots: FumeStaticBlockSnapshot[] = []
  for (let index = 0; index < count; index += 1) {
    const snapshot = makeSnapshot()
    snapshots.push(snapshot)
    cache.set(`k${index}`, { snapshot, lastUsed: 0 })
  }
  return { cache, snapshots }
}

describe('createFumeRetiredSnapshotQueue（性能修复）', () => {
  it('每批默认只放 RETIRED_SNAPSHOTS_PER_FRAME 张', () => {
    const queue = createFumeRetiredSnapshotQueue()
    const { cache, snapshots } = makeCache(50)
    queue.retire(cache)

    expect(queue.releaseBatch()).toBe(RETIRED_SNAPSHOTS_PER_FRAME)
    // 被放掉的张数 = 画布尺寸归零的那几张
    const zeroed = snapshots.filter((s) => s.canvas.width === 0 && s.canvas.height === 0)
    expect(zeroed).toHaveLength(RETIRED_SNAPSHOTS_PER_FRAME)
    expect(queue.pendingCount()).toBe(50 - RETIRED_SNAPSHOTS_PER_FRAME)
  })

  it('反复调用直到放完，一张不漏', () => {
    const queue = createFumeRetiredSnapshotQueue()
    const { cache, snapshots } = makeCache(30)
    queue.retire(cache)

    let guard = 0
    while (queue.pendingCount() > 0 && guard < 100) {
      queue.releaseBatch()
      guard += 1
    }

    expect(queue.pendingCount()).toBe(0)
    for (const snapshot of snapshots) {
      expect(snapshot.canvas.width).toBe(0)
      expect(snapshot.canvas.height).toBe(0)
    }
  })

  it('空缓存进队列等于没进（`retire` 直接忽略）', () => {
    const queue = createFumeRetiredSnapshotQueue()
    queue.retire(createFumeSnapshotCache())

    expect(queue.pendingCount()).toBe(0)
    expect(queue.releaseBatch()).toBe(0)
  })

  it('多张缓存先进先出：先作废的那张先被放掉', () => {
    const queue = createFumeRetiredSnapshotQueue()
    const first = makeCache(4)
    const second = makeCache(4)
    queue.retire(first.cache)
    queue.retire(second.cache)

    queue.releaseBatch(4)

    // 第一批只够放完第一张缓存
    for (const snapshot of first.snapshots) expect(snapshot.canvas.width).toBe(0)
    for (const snapshot of second.snapshots) expect(snapshot.canvas.width).toBe(512)
  })

  it('两张缓存里的**同名键**都会被释放（搬运时重新编号，不能覆盖）', () => {
    const queue = createFumeRetiredSnapshotQueue()
    // 同一个键 `same` 出现在两张缓存里 —— 区块 id 只由行起始时间与行下标组成，
    // 两首歌很容易算出同一个键
    const firstCache = createFumeSnapshotCache()
    const firstSnapshot = makeSnapshot()
    firstCache.set('same', { snapshot: firstSnapshot, lastUsed: 0 })
    const secondCache = createFumeSnapshotCache()
    const secondSnapshot = makeSnapshot()
    secondCache.set('same', { snapshot: secondSnapshot, lastUsed: 0 })

    queue.retire(firstCache)
    queue.retire(secondCache)
    queue.releaseBatch(2)

    // 键撞了也必须两张都归零（只覆盖不释放的话第二张会留着 width=512）
    expect(firstSnapshot.canvas.width).toBe(0)
    expect(secondSnapshot.canvas.width).toBe(0)
  })

  it('releaseAll 立刻清空队列里的一切（卸载路径不能等下一帧）', () => {
    const queue = createFumeRetiredSnapshotQueue()
    const first = makeCache(10)
    const second = makeCache(10)
    queue.retire(first.cache)
    queue.retire(second.cache)
    queue.releaseBatch(3) // 先放掉一部分，剩下的在队列里

    queue.releaseAll()

    expect(queue.pendingCount()).toBe(0)
    for (const snapshot of [...first.snapshots, ...second.snapshots]) {
      expect(snapshot.canvas.width).toBe(0)
      expect(snapshot.canvas.height).toBe(0)
    }
  })

  it('limit 传 0 / 负数时一张都不放（不返回负数）', () => {
    const queue = createFumeRetiredSnapshotQueue()
    queue.retire(makeCache(5).cache)

    expect(queue.releaseBatch(0)).toBe(0)
    expect(queue.releaseBatch(-3)).toBe(0)
    expect(queue.pendingCount()).toBe(5)
  })
})
