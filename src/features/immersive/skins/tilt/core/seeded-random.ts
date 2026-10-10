/**
 * 确定性伪随机 —— 「倾诉」面板所有排版随机决策的唯一随机源。
 *
 * 选型：哈希式（stateless、可按索引随机访问），而不是 mulberry32 之类的流式 PRNG。
 * 理由：移植笔记 §2 的调用形态是 seededRandom(seed, 1) / (seed, 100 + i) / (seed, 200)，
 * 需要在任意索引处直接取值，且调用顺序可能随段数变化。流式 PRNG 必须从头推进 N 步
 * 才能取第 N 个值，索引一大就退化；哈希式是 O(1) 且与调用顺序无关。
 *
 * 混合函数用 murmur3 finalizer：在 32 位整数上是**双射**，雪崩性好。
 * 由此可以给出一个比「统计上大概不同」更强的保证：固定 seed 时，
 * 不同 index 必得不同结果（见单测）。
 *
 * 分布：输出 = 混淆后的 32 位无符号整数 / 2^32，落在 [0, 1)，均匀。
 * 绝不用 Math.random()：同一 seed + 同一输入必须给出完全一致的排版（可复现）。
 */

/** 2^32，用于把 32 位无符号整数映射到 [0, 1) */
const UINT32_RANGE = 4294967296

/** 32 位 avalanche 混淆（murmur3 finalizer 思路），输入输出均为有符号 32 位视图 */
function mix32(value: number): number {
  let h = value | 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

/** 把任意数值 seed 折叠成 32 位整数：行起始时间通常是整数毫秒，但也容得下小数秒。 */
function foldSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0
  const integer = Math.trunc(seed)
  const fraction = Math.round((seed - integer) * 0xffff) | 0
  return (integer ^ Math.imul(fraction, 0x27d4eb2d)) | 0
}

/**
 * 确定性伪随机：同一 (seed, index) 永远得到同一个值。
 *
 * @param seed  种子。约定用「行起始时间」（本项目的 LyricLine.timeMs）——同一首歌每次播放排版一致，
 *              不同行/不同歌排版不同。
 * @param index 决策位序号。约定见移植笔记 §2：1 = 长度抖动；100 + i = 第 i 段是否倾斜候选；
 *              200 = 从候选中选哪一段。其余内部用途各自占用空闲区段。
 * @returns [0, 1) 之间的数
 */
export function seededRandom(seed: number, index: number): number {
  const foldedSeed = foldSeed(seed)
  const foldedIndex = Math.trunc(Number.isFinite(index) ? index : 0) | 0
  const mixed = (foldedSeed ^ Math.imul(foldedIndex + 0x9e3779b9, 0x85ebca6b)) | 0
  return mix32(mixed) / UINT32_RANGE
}
