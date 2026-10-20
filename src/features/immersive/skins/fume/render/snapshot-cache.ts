/**
 * 静态区块快照的缓存（移植规格书 §11.1）。
 *
 * ## 为什么不复用 `skins/shared/bounded-cache.ts`
 *
 * 两者的淘汰依据**不是同一件事**：
 *
 * | | `rememberBounded` | 本模块 |
 * | --- | --- | --- |
 * | 淘汰依据 | Map 的**插入序**（"最老的先走"） | `lastUsed`（**最久没被用过**的先走） |
 * | 淘汰前的动作 | 无 | **先把 `canvas.width/height` 归零** |
 *
 * 第二条是分水岭：把 canvas 归零才是真正把 backing store 立刻还给浏览器，而
 * `rememberBounded` 只操作它收到的 Map，**不可能知道**被丢掉的值里有一张画布 ——
 * 复用它会让每一张被淘汰的快照在 GC 之前都白占着显存。
 *
 * 第一条则关系到**正确性而不只是性能**：快照的访问模式是「长时播放 + 总览镜头把
 * 整页区块一次性拉进视野」——插入序淘汰在这种情况下淘汰的正是**当前可见**的那一批
 * （它们在总览开始前才刚被创建），于是每帧都要重建快照，CPU 与显存一起爆。
 * 按 `lastUsed` 淘汰至少保证「这一帧刚画过的」不会被优先丢掉。
 *
 * ## 与上游的差异（本项目加固，用户明确要求）
 *
 * 上游是一张**永不设上限**的 Map，只靠 15 秒空闲回收。本项目额外加容量封顶：
 * 键空间是 `区块 × 状态/样式 × snapshotScale`，歌词长度与 DPR 档位都不受控，
 * 只靠时间回收意味着「一首超长歌 + 频繁跨 DPR 拖窗」可以让 Map 无界增长。
 * 上限取 {@link FUME_SNAPSHOT_CACHE_LIMIT}，定得**远高于**真实工作集，
 * 因此正常播放中不会触发；触发时按 `lastUsed` 淘汰，是「宁可重画也不 OOM」的兜底。
 *
 * ## 分层
 *
 * 本文件只碰「Map + canvas 尺寸」这两件事，不创建快照（创建在 `canvas-text.ts`，
 * 由调用方以回调注入），因此可以在 node 里用假对象把回收顺序、边界逐条钉住。
 */

import type { FumeStaticBlockSnapshot } from '../core/fume-types'

/** 超过这段时间没被用过的快照会被释放；快照重画很便宜，不值得为它长期占显存（§11.1） */
export const SNAPSHOT_IDLE_MS = 15_000

/**
 * 缓存容量上限（本项目加固，上游无上限）。
 *
 * 1024 这个数是按**最坏的真实工作集**倒推的：一个键 = 「一个区块 × 一种状态/样式」，
 * `passed` 在 `dimmed` 分支下最多同时存在 standard + dimmed 两张，等待态一张，
 * 因此一首 300 行的歌在总览镜头里最多约 `300 × 3 = 900` 个键 —— 全部装得下。
 * 再小就会在超长歌词的总览里把**可见**的快照淘汰掉，反而比不封顶更费 CPU。
 */
export const FUME_SNAPSHOT_CACHE_LIMIT = 1024

/** 缓存里的一条记录：快照本体 + 最近一次使用时刻（毫秒，与 `performance.now()` 同源） */
export interface FumeSnapshotCacheEntry {
  snapshot: FumeStaticBlockSnapshot
  lastUsed: number
}

/** 键 = `${blockId}:${state}:${style}:${snapshotScale}`（由 §8.4 的 `resolveFumeStaticLayers` 产出） */
export type FumeSnapshotCache = Map<string, FumeSnapshotCacheEntry>

/** 建一张空缓存；调用方（stage 的 ref）持有它跨帧存活 */
export function createFumeSnapshotCache(): FumeSnapshotCache {
  return new Map()
}

/**
 * 把画布的后备存储立刻还回去。
 *
 * 只 `delete` 是**不够**的：被删除的 canvas 仍持有每个像素 4 字节的 backing store，
 * 要等 GC 回收对象才释放。长时播放里每秒都会淘汰几张，等待 GC 意味着显存水位
 * 一直贴着峰值 —— 而归零尺寸会让浏览器**同步**释放这块内存。
 */
function releaseBackingStore(snapshot: FumeStaticBlockSnapshot): void {
  snapshot.canvas.width = 0
  snapshot.canvas.height = 0
}

/**
 * 容量口径与 `shared/bounded-cache.ts` 保持一致：**写入后最多保留 `max(1, floor(limit))` 条**。
 *
 * 即「一条都不留」不是一种容量，`0` / 负数 / 非有限值一律按 1 处理 —— 这样拼错常量时的
 * 表现是「缓存小一点」，而不是「每次都重算」这种静默的性能陷阱。
 */
function resolveCapacity(limit: number): number {
  return Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1
}

/**
 * 淘汰最久没用过的一条（`lastUsed` 最小）。
 *
 * 平局取先遇到的：Map 的遍历序是插入序，所以「同样久没用过」时淘汰更早插入的那张，
 * 与直觉一致。
 */
function evictLeastRecentlyUsed(cache: FumeSnapshotCache): void {
  let oldestKey: string | null = null
  let oldestLastUsed = Number.POSITIVE_INFINITY

  for (const [key, entry] of cache) {
    if (entry.lastUsed < oldestLastUsed) {
      oldestLastUsed = entry.lastUsed
      oldestKey = key
    }
  }

  if (oldestKey === null) return

  const entry = cache.get(oldestKey)
  if (entry) releaseBackingStore(entry.snapshot)
  cache.delete(oldestKey)
}

/**
 * 取一张快照：命中就直接返回，未命中就用 `createSnapshot` 现做一张并存入。
 *
 * 三条语义别改：
 * 1. **命中也要刷新 `lastUsed`** —— 只在新插入时记时间的话，"最近用过"就退化成
 *    "最近创建过"，总览里被反复复用的老快照会被优先淘汰，正好淘汰错人；
 * 2. **创建失败不写缓存** —— 失败（拿不到 2d context）往往与当时的资源压力有关，
 *    把失败也缓存下来会让这一块在整个播放期都拿不到快照；返回 `undefined` 让调用方
 *    这一帧回落到实时绘制，下一帧再试；
 * 3. **淘汰发生在写入之前** —— 于是缓存里**永远不会同时持有** `capacity + 1` 张画布。
 *
 * 参数一律走位置参数而不是对象：本函数在每帧的绘制循环里被每个在屏区块调用一次，
 * 每帧新建一个入参对象就是 §16.2 说的那种 GC 抖动来源。
 */
export function acquireFumeSnapshot(
  cache: FumeSnapshotCache,
  key: string,
  now: number,
  createSnapshot: () => FumeStaticBlockSnapshot | null,
  limit: number = FUME_SNAPSHOT_CACHE_LIMIT
): FumeStaticBlockSnapshot | undefined {
  const cached = cache.get(key)
  if (cached) {
    cached.lastUsed = now
    return cached.snapshot
  }

  const snapshot = createSnapshot()
  if (!snapshot) return undefined

  const capacity = resolveCapacity(limit)
  if (cache.size >= capacity) {
    evictLeastRecentlyUsed(cache)
  }
  cache.set(key, { snapshot, lastUsed: now })

  return snapshot
}

/**
 * 回收空闲超过 {@link SNAPSHOT_IDLE_MS} 的快照（§11.1）—— stage 每帧调一次。
 *
 * 三种 `now` 的语义：
 * - **正常时刻**：`now - lastUsed <= SNAPSHOT_IDLE_MS` 的一律跳过，与上游的 `<=` 一致
 *   （也就是恰好卡在 15 秒的那一条这一帧还留着）；
 * - **`+Infinity`**：全清。文章 / 主题变化与组件卸载都走这条，所以只暴露一个函数
 *   就够，不需要再写一个 `clear()`；
 * - **`NaN`**：**一律不动**。时钟拿不到时把缓存全清是最糟的选择 —— 下一帧所有区块
 *   都要重建快照（本来只是读不到时间）。这条是本项目的加固，上游没有这道闸。
 */
export function releaseFumeSnapshots(cache: FumeSnapshotCache, now: number): void {
  if (Number.isNaN(now)) return

  for (const [key, entry] of cache) {
    if (now - entry.lastUsed <= SNAPSHOT_IDLE_MS) continue
    releaseBackingStore(entry.snapshot)
    cache.delete(key)
  }
}
