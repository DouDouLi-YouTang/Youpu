/**
 * 「浮名」顶层排版的**分片驱动**（性能修复，2026-10-14）。
 *
 * ## 它解决什么
 *
 * `article-layout.ts` 的顶层搜索是「列数 × 8 次二分 + 1 次全量」共 33 次完整排版。
 * 实测（1600×900、真实字体与 pretext）：50 行约 1.0s、120 行约 3.1s，**全程同步**，
 * 期间主线程一帧都出不来 —— 拖窗口、切歌时画面就是冻住的。把它挪到 rAF /
 * setTimeout 之后只解决了「什么时候开始」，没有解决「开始之后占住多久」。
 *
 * 所以这里把搜索当成**可中断的任务**来驱动：搜索本身是生成器
 * （{@link createArticleLayoutSearch}），每跑一小段就问一次「预算用完了吗」，
 * 用完就 `await` 一次让出主线程，回来接着跑。
 *
 * ## 为什么让出点是「块之间」而不是「更细」
 *
 * 生成器只在**一次完整排版尝试的块之间**、以及两次尝试之间让出。这是刻意的：
 * 一次 `prepareSingleLine`（pretext 换行 + 字号二分）内部若被打断，前后两半就可能
 * 读到不同的测量缓存；而块之间让出时，已经算完的块是**自洽**的 —— 位置、字号、
 * 行切分都不会因为让出而改变。于是：**输出与同步版逐字相同**，变的只有时机。
 *
 * ## 预算为什么按时间而不是按块数
 *
 * 块与块的代价差一个数量级（一行 3 个字 vs 一行 40 个字），按块数切会在长行上
 * 攒出几十毫秒的阻塞。按时间切则无论行多长，每片的阻塞都封顶在
 * {@link FUME_LAYOUT_SLICE_BUDGET_MS} 加上「一块」的溢出。
 *
 * ## 中止
 *
 * `shouldAbort` 在每个让出点被问一次（**不**在块之间问 —— 那是每片内部，问了也来不及
 * 做任何事）。返回 `true` 时本函数返回 `null`，语义是「这次结果作废，调用方不得写回」。
 * 切歌 / 再次 resize 都走这条路径：旧任务最多再跑完当前这一片就停，
 * 而这一片的长度已经被预算封住了。
 */

import {
  createArticleLayoutSearch,
  type FumeArticleLayoutInput,
  type FumeArticleLayoutResult
} from './article-layout'

/**
 * 每片的主线程预算（毫秒）。
 *
 * 8ms 是按「60fps 的一帧有 16.7ms」倒推的：留一半给这一帧的绘制与其它任务，
 * 用户看到的才是「画面照常动、排版在后台一点点做完」，而不是「偶尔卡一下」。
 * 调小会让让出次数变多（每次让出都要跨一次宏任务），总时长反而上升；
 * 调大则开始能感觉到顿。
 */
export const FUME_LAYOUT_SLICE_BUDGET_MS = 8

export interface FumeChunkedLayoutOptions {
  /**
   * 让出主线程。返回的 Promise 在「可以继续跑下一片」时 resolve。
   *
   * 由调用方注入（生产是 `use-fume-layout` 的 MessageChannel 宏任务），
   * 这样本模块**不碰任何浏览器 API**，可以在 node 里用「立即 resolve」跑等价性测试。
   */
  yieldToMainThread: () => Promise<void>
  /** 时间源；默认 `performance.now` */
  now?: () => number
  /** 每片预算（毫秒）；默认 {@link FUME_LAYOUT_SLICE_BUDGET_MS} */
  sliceBudgetMs?: number
  /** 每个让出点问一次：`true` = 立刻放弃本次搜索 */
  shouldAbort?: () => boolean
}

/**
 * 分片跑完一次顶层搜索。
 *
 * 返回值：
 * - `null` = **被 `shouldAbort` 中止**（结果作废，调用方不得写回）；
 * - 否则与 `buildArticleLayout` 的返回值逐字相同（含 `article` 为 `null` 的「排不出」）。
 */
export async function buildArticleLayoutChunked(
  input: FumeArticleLayoutInput,
  options: FumeChunkedLayoutOptions
): Promise<FumeArticleLayoutResult | null> {
  const search = createArticleLayoutSearch(input)
  const now = options.now ?? (() => performance.now())
  const budgetMs = options.sliceBudgetMs ?? FUME_LAYOUT_SLICE_BUDGET_MS
  const shouldAbort = options.shouldAbort ?? (() => false)

  let sliceStartedAt = now()

  for (;;) {
    if (shouldAbort()) return null

    const step = search.next()
    if (step.done) return step.value

    if (now() - sliceStartedAt < budgetMs) continue

    await options.yieldToMainThread()
    sliceStartedAt = now()
  }
}
