/**
 * 已作废快照缓存的**分批释放队列**（性能修复，2026-10-14）。
 *
 * ## 它解决什么
 *
 * 文章 / 主题一变，`use-fume-stage` 里那整张快照缓存就全部作废。原来的做法是在
 * **那一帧**把几百张快照一次清完 —— 实测 300 张 512×256 要 14.1ms，那一帧必定掉，
 * 而切歌本来就已经有排版要跑，两件事叠在一起就是用户看到的「切歌卡一下」。
 *
 * 这里改成：作废的缓存**整张进队列**，每帧只放一小批，把 14ms 摊到十几帧里
 * （每帧不到 1ms，60fps 的预算里放得下）。
 *
 * ## 为什么是「整张换掉」而不是「原地标记」
 *
 * 作废的语义是「这些快照一个都不能再用」，换引用是一步到位的 —— 不需要给每条记录
 * 加一个「作废」标志，也就不会出现「漏标一条」这种静默 bug。绘制层拿到的是新缓存，
 * 从下一帧开始就再也取不到旧快照。
 *
 * ## 为什么搬运时要重新编号
 *
 * 真正「把后备存储还给浏览器」的那段逻辑住在 `snapshot-cache.ts` 里，只通过
 * `releaseFumeSnapshots` 暴露（它按「空闲超过 15 秒」筛选，`+Infinity` 表示全清）。
 * 为了复用同一条释放路径，这一小批要被搬进一个临时缓存再传 `+Infinity` ——
 * 而**键会撞**：区块 id 只由行起始时间与行下标组成，两首歌很容易算出同一个键，
 * `Map.set` 会静默覆盖，被覆盖的那张画布就再也没人去把它的尺寸归零，
 * 等于把显存漏到 GC 之前。加一个单调序号让每个搬运条目必然唯一。
 *
 * ⚠️ 本模块**只碰 Map**，不创建也不绘制快照，所以能在 node 里用假对象把
 * 「每批几张、按什么顺序、卸载时是否真的清干净」逐条钉住。
 */

import {
  createFumeSnapshotCache,
  releaseFumeSnapshots,
  type FumeSnapshotCache
} from './snapshot-cache'

/**
 * 每帧释放的快照张数上限。
 *
 * 12 是按「300 张 → 25 帧」定的：单张释放约 0.047ms（实测 300 张 14.1ms），
 * 12 张约 0.56ms —— 60fps 的一帧预算里完全放得下，同时任何一帧都不会因为清缓存掉队。
 * 调大省帧数但单帧更贵，调小则总时长拉长；这个量级下两者都不敏感。
 */
export const RETIRED_SNAPSHOTS_PER_FRAME = 12

export interface FumeRetiredSnapshotQueue {
  /** 把一张作废的缓存交给队列；空缓存直接忽略（没什么可放的） */
  retire(cache: FumeSnapshotCache): void
  /** 放一小批（最多 `limit` 张）；返回本次真正释放的张数 */
  releaseBatch(limit?: number): number
  /** 立刻放完全部（**只在卸载时用**：那时不会再有下一帧，排队等于永久泄漏） */
  releaseAll(): void
  /** 还没释放的快照张数（调试 / 测试用） */
  pendingCount(): number
}

export function createFumeRetiredSnapshotQueue(): FumeRetiredSnapshotQueue {
  /** 已作废、等着分批释放的缓存；先进先出 */
  const pending: FumeSnapshotCache[] = []
  /** 搬运区：复用同一个 Map，不在帧循环里新建 */
  const staging: FumeSnapshotCache = createFumeSnapshotCache()
  /** 搬运条目的单调序号（见文件头「为什么搬运时要重新编号」） */
  let stagingSeq = 0

  function pendingCount(): number {
    let total = staging.size
    for (const cache of pending) total += cache.size
    return total
  }

  return {
    retire(cache) {
      if (cache.size === 0) return
      pending.push(cache)
    },

    releaseBatch(limit = RETIRED_SNAPSHOTS_PER_FRAME) {
      let budget = Math.max(0, Math.floor(limit))
      let released = 0

      // 从队列**头部**取：文章连续变化（快速切歌）时，最早作废的那张最不可能
      // 再被用上，先放它能把显存水位压得最低
      while (budget > 0 && pending.length > 0) {
        const cache = pending[0]
        for (const [key, entry] of cache) {
          stagingSeq += 1
          staging.set(`${stagingSeq}:${key}`, entry)
          cache.delete(key)
          budget -= 1
          released += 1
          if (budget <= 0) break
        }
        if (cache.size === 0) pending.shift()
      }

      if (released > 0) releaseFumeSnapshots(staging, Number.POSITIVE_INFINITY)
      return released
    },

    releaseAll() {
      for (const cache of pending) {
        releaseFumeSnapshots(cache, Number.POSITIVE_INFINITY)
      }
      pending.length = 0
      releaseFumeSnapshots(staging, Number.POSITIVE_INFINITY)
    },

    pendingCount
  }
}
