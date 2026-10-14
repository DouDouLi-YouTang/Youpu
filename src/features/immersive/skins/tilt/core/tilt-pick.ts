/**
 * 选定哪一段倾斜（移植笔记 §2.3）+ 末段过短补偿（§2.4）。
 *
 * §2.3：每段按 seededRandom(seed, 100 + i) < tiltStyleProbability（默认 0.35）成为候选，
 *       再按 seededRandom(seed, 200) 从候选里选一个；候选为空则整行都不倾斜。
 *       用行起始时间做种子的意义：同一首歌每次播放排版一致（可复现），
 *       不同歌/不同行排版不同（有变化）。
 * §2.4：末段不是倾斜段、且字数 ≤ 2、且「字数 × 2 ≤ 前一段字数」→ 标记为短末段，
 *       渲染时字号放大 1.18 倍。
 *
 * 本文件不碰时间。纯函数，可在 node 环境单测。
 */

import { countGraphemes } from '../../shared/graphemes'
import { seededRandom } from './seeded-random'

/** 成段倾斜的概率默认值（移植笔记 §2.3） */
export const DEFAULT_TILT_STYLE_PROBABILITY = 0.35

/** 短末段的字号放大倍率（移植笔记 §2.4） */
export const SHORT_LAST_SEGMENT_SCALE = 1.18

/** 判定「过短末段」的字数上限（移植笔记 §2.4：≤ 2 字） */
const SHORT_LAST_SEGMENT_MAX_LENGTH = 2

/** 种子索引（移植笔记 §2.3 固定值）：100 + i = 第 i 段是否候选；200 = 选中哪一段 */
const CANDIDATE_SEED_BASE = 100
const PICK_SEED_INDEX = 200

/** 倾斜选择结果 */
export interface TiltPick {
  /** 倾斜段下标；null 表示整行都不倾斜（最多只有一段倾斜） */
  tiltIndex: number | null
  /** 是否命中「末段过短」补偿（渲染时末段字号 × SHORT_LAST_SEGMENT_SCALE） */
  shortLastSegment: boolean
}

/**
 * 段的「字数」：非空白字素数。
 * 用字素而非 length，emoji/组合字符才不会被算成多个字；
 * 空白不计入，因为 §2.4 的补偿是视觉尺寸问题（「啊 」和「啊」应当同样处理）。
 */
export function measureSegmentLength(segment: string): number {
  return countGraphemes(segment, { ignoreWhitespace: true })
}

/**
 * 末段过短补偿判定（移植笔记 §2.4）。
 *
 * @param segmentLengths    各段字数（可用 measureSegmentLength 得到），按顺序
 * @param lastSegmentIsTilted 最后一段是否被选为倾斜段
 * @returns 末段非倾斜、字数 ≤ 2、且 字数 × 2 ≤ 前一段字数 时为 true
 *
 * 退化输入：段数 < 2（没有「前一段」）→ false；末段字数为 0（理论上的空段）→ false。
 */
export function isShortLastSegment(
  segmentLengths: readonly number[],
  lastSegmentIsTilted: boolean
): boolean {
  if (lastSegmentIsTilted) return false
  if (segmentLengths.length < 2) return false
  const last = segmentLengths[segmentLengths.length - 1]
  const previous = segmentLengths[segmentLengths.length - 2]
  if (!Number.isFinite(last) || !Number.isFinite(previous)) return false
  if (last <= 0 || last > SHORT_LAST_SEGMENT_MAX_LENGTH) return false
  return last * 2 <= previous
}

/**
 * 选出这一段行里哪一段倾斜（移植笔记 §2.3），并顺带给出 §2.4 的短末段标记。
 *
 * @param segments              各段文本，按顺序（splitIntoSentences 的输出）
 * @param seed                  种子，约定为行起始时间
 * @param tiltStyleProbability  成段倾斜概率，默认 0.35；非有限值回退默认，其余钳到 [0, 1]
 * @returns { tiltIndex, shortLastSegment }
 *
 * 退化输入：segments 为空（或概率为 0、无候选）→ tiltIndex = null。
 * 性质：最多一段倾斜（结构上恒成立）；同一 (segments, seed, 概率) → 同一结果。
 */
export function pickTiltSegment(
  segments: readonly string[],
  seed: number,
  tiltStyleProbability: number = DEFAULT_TILT_STYLE_PROBABILITY
): TiltPick {
  const probability = Number.isFinite(tiltStyleProbability)
    ? Math.min(Math.max(tiltStyleProbability, 0), 1)
    : DEFAULT_TILT_STYLE_PROBABILITY

  const candidates: number[] = []
  for (let index = 0; index < segments.length; index++) {
    if (seededRandom(seed, CANDIDATE_SEED_BASE + index) < probability) candidates.push(index)
  }

  let tiltIndex: number | null = null
  if (candidates.length > 0) {
    const pick = Math.floor(seededRandom(seed, PICK_SEED_INDEX) * candidates.length)
    tiltIndex = candidates[Math.min(pick, candidates.length - 1)]
  }

  const lengths = segments.map(measureSegmentLength)
  const lastIndex = segments.length - 1
  const shortLastSegment = isShortLastSegment(
    lengths,
    tiltIndex !== null && tiltIndex === lastIndex
  )

  return { tiltIndex, shortLastSegment }
}
