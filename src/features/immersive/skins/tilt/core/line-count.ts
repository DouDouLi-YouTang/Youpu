/**
 * 分行决策：一行歌词切几段（移植笔记 §2.1）。
 *
 * 思路：字数与「视觉上该分几行」不是线性关系 —— 10 字和 20 字的差别远大于
 * 30 字和 40 字，所以先做 log 归一化，再乘一个由种子决定的抖动，最后乘用户可调的
 * `splitProbability`，按固定阈值落到 1–4 段。
 *
 * 时间无关、单位无关（本文件不碰时间）。纯函数，可在 node 环境单测。
 */

import { seededRandom } from './seeded-random'

/** 用户可调的「分段概率」默认值（移植笔记 §2.1） */
export const DEFAULT_SPLIT_PROBABILITY = 0.75

/** 最小/最大段数（移植笔记 §2.1：1–4 段） */
export const MIN_LINE_COUNT = 1
export const MAX_LINE_COUNT = 4

/** 归一化常数：约 20 字的行得分接近 1.0（拟合常数，非物理量） */
const LENGTH_OFFSET = 4
const NORMALIZE_BASE = 24

/** 抖动区间 [0.7, 1.3]：jitter = random * 0.6 + 0.7 */
const JITTER_MIN = 0.7
const JITTER_SPAN = 0.6

/** 抖动取值用的种子索引（移植笔记 §2.1 固定为 1） */
const JITTER_SEED_INDEX = 1

/** 段数阈值：score < 0.45 → 1 段；< 1.05 → 2 段；< 1.7 → 3 段；否则 4 段 */
const THRESHOLDS = [0.45, 1.05, 1.7] as const

/** 把概率钳制到 [0, 1]；非有限值回退到默认概率 */
function normalizeProbability(probability: number): number {
  if (!Number.isFinite(probability)) return DEFAULT_SPLIT_PROBABILITY
  return Math.min(Math.max(probability, 0), 1)
}

/**
 * 决定这一行切成几段。
 *
 * @param charCount        行文本去掉空格后的字数（调用方给出；本函数不自己数，
 *                         因为「字数」的口径由调用方统一：建议用 countGraphemes(text, { ignoreWhitespace: true })）
 * @param seed             种子，约定用行起始时间（本项目的 LyricLine.timeMs）
 * @param splitProbability 用户可调的分段倾向，默认 0.75
 * @returns 段数，恒定落在 [MIN_LINE_COUNT, MAX_LINE_COUNT] = [1, 4]
 *
 * 退化输入：charCount 为 0/负数/NaN 一律按 0 处理（charCount = 0 时恒为 1 段，
 * 因为 log(0 + 4) / log(24) * 1.3 * 1 = 0.4253 < 0.45）；splitProbability 会被钳到 [0, 1]。
 * 性质：固定 seed 与 splitProbability 时，段数对 charCount 单调不减（score 单调增）。
 */
export function determineLineCount(
  charCount: number,
  seed: number,
  splitProbability: number = DEFAULT_SPLIT_PROBABILITY
): number {
  const length = Number.isFinite(charCount) && charCount > 0 ? charCount : 0
  const probability = normalizeProbability(splitProbability)

  const normalized = Math.log(length + LENGTH_OFFSET) / Math.log(NORMALIZE_BASE)
  const jitter = seededRandom(seed, JITTER_SEED_INDEX) * JITTER_SPAN + JITTER_MIN
  const score = normalized * jitter * probability

  let count = MIN_LINE_COUNT
  for (const threshold of THRESHOLDS) {
    if (score >= threshold) count++
  }
  return Math.min(count, MAX_LINE_COUNT)
}
