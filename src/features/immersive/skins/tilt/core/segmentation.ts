/**
 * 五级递进切分（移植笔记 §2.2）：把一行文本切成 targetCount 段。
 *
 * 从粗到细逐级尝试，每级只对「还不够多」的段再切：
 *   1 标点 → 2 括号引号 → 3 西文词 → 4 CJK 空格 → 5 特殊字符
 * 五级跑完后仍未达目标，用「二次切分」（在字素边界对半切最长的段）补足；
 * 超过目标则合并相邻段。
 *
 * 硬性不变量（有单测守着）：
 * - 段按顺序拼回去 === 原文（切分绝不丢字、造字，只选切点）
 * - 每个切点都落在字素边界上（emoji/组合字符不会被切碎）
 * - 每段非空；五级切分产生的「纯空白段」会并进相邻段，
 *   二次切分也优先避开纯空白切点（只有为凑够段数才可能留下纯空白段）
 * - 段数 === min(targetCount, 字素数)，除非文本里再无处可切
 * - 同一 (text, targetCount, seed) → 完全相同的结果（seed 只用于平局打破）
 *
 * 本文件不碰时间。纯函数，可在 node 环境单测。
 */

import {
  countGraphemes,
  graphemeOffsets,
  isWhitespaceOnly,
  segmentGraphemes,
  snapToGraphemeBoundary
} from '../../shared/graphemes'
import { seededRandom } from './seeded-random'

/** 级别 1：标点（移植笔记 §2.2 表格） */
const PUNCTUATION_RE = /[，。；！？、…·.,;!?]/

/** 级别 2：成对符号（括号/引号）—— 在成对符号**外侧**切 */
const BRACKET_PAIRS: readonly (readonly [string, string])[] = [
  ['（', '）'],
  ['(', ')'],
  ['【', '】'],
  ['[', ']'],
  ['《', '》'],
  ['〈', '〉'],
  ['「', '」'],
  ['『', '』'],
  ['｛', '｝'],
  ['{', '}'],
  ['“', '”'],
  ['‘', '’']
]

/** 同形引号（直引号）用开关式配对；不成对时忽略（不切） */
const SYMMETRIC_QUOTE = '"'

/** 级别 3：西文词（移植笔记 §2.2 给出的词形） */
const LATIN_WORD_RE_SOURCE = '[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*'

/** 级别 5：特殊字符兜底 —— 任意 Unicode 标点(P)或符号(S) */
const SYMBOL_RE = /[\p{P}\p{S}]/u

/** 间隔里的空白（级别 3 需要「词与词之间有空白」才算词边界） */
const SPACE_RE = /\s/

/** 二次切分 / 合并时打破平局用的种子索引区段（避开移植笔记 §2 占用的 1、100+i、200） */
const SPLIT_SEED_BASE = 300
const MERGE_SEED_BASE = 400

/** 每级切分：给一段文本，返回切点（UTF-16 下标，切点归右段） */
type LevelSplitter = (segment: string) => number[]

/** 所有切点必须是字素边界、且落在 (0, length) 内，升序去重 */
function normalizeBoundaries(text: string, raw: readonly number[]): number[] {
  if (raw.length === 0) return []
  const offsets = graphemeOffsets(text)
  const valid = raw
    .map((boundary) => snapToGraphemeBoundary(offsets, boundary))
    .filter((boundary) => boundary > 0 && boundary < text.length)
  return [...new Set(valid)].sort((a, b) => a - b)
}

/** 按切点把一段切碎，过滤空段（空段拼回去不影响原文） */
function applyBoundaries(text: string, boundaries: readonly number[]): string[] {
  const parts: string[] = []
  let start = 0
  for (const boundary of boundaries) {
    parts.push(text.slice(start, boundary))
    start = boundary
  }
  parts.push(text.slice(start))
  return parts.filter((part) => part.length > 0)
}

/** 级别 1：标点之后切（标点归属前段，后随空格归属后段）。连续标点视为一个单位。 */
function punctuationBoundaries(text: string): number[] {
  const boundaries: number[] = []
  let index = 0
  while (index < text.length) {
    if (!PUNCTUATION_RE.test(text[index])) {
      index++
      continue
    }
    let end = index
    while (end < text.length && PUNCTUATION_RE.test(text[end])) end++
    boundaries.push(end)
    index = end
  }
  return boundaries
}

/** 级别 2：成对符号外侧切（只切最外层配对；未配对的符号不切） */
function bracketBoundaries(text: string): number[] {
  const closeToOpen = new Map<string, string>()
  const openSet = new Set<string>()
  for (const [open, close] of BRACKET_PAIRS) {
    closeToOpen.set(close, open)
    openSet.add(open)
  }

  const boundaries: number[] = []
  const stack: { char: string; index: number }[] = []

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    const top = stack.length > 0 ? stack[stack.length - 1] : undefined
    const isSymmetricClose = char === SYMMETRIC_QUOTE && top?.char === SYMMETRIC_QUOTE
    const matchedOpen = closeToOpen.get(char)
    const isPairClose = matchedOpen !== undefined && top?.char === matchedOpen

    if (isSymmetricClose || isPairClose) {
      const open = stack.pop()
      if (open && stack.length === 0) {
        // 只在最外层配对的两侧切：开头之前、结尾之后
        boundaries.push(open.index, index + 1)
      }
      continue
    }
    if (char === SYMMETRIC_QUOTE || openSet.has(char)) stack.push({ char, index })
  }
  return boundaries
}

/** 级别 3：西文词边界（两个西文词之间隔了空白才切；空白归前段） */
function latinWordBoundaries(text: string): number[] {
  const boundaries: number[] = []
  let previousEnd = -1
  for (const match of text.matchAll(new RegExp(LATIN_WORD_RE_SOURCE, 'g'))) {
    const start = match.index
    if (previousEnd >= 0 && start > previousEnd && SPACE_RE.test(text.slice(previousEnd, start))) {
      boundaries.push(start)
    }
    previousEnd = start + match[0].length
  }
  return boundaries
}

/** 级别 4：空白处切（中文里的空格；空白归前段，切点落在空白串之后） */
function whitespaceBoundaries(text: string): number[] {
  const boundaries: number[] = []
  let index = 0
  while (index < text.length) {
    if (!SPACE_RE.test(text[index])) {
      index++
      continue
    }
    let end = index
    while (end < text.length && SPACE_RE.test(text[end])) end++
    if (end < text.length) boundaries.push(end)
    index = end
  }
  return boundaries
}

/** 级别 5：特殊字符兜底（按字素扫描，符号串之后切） */
function symbolBoundaries(text: string): number[] {
  const boundaries: number[] = []
  const graphemes = segmentGraphemes(text)
  let index = 0
  while (index < graphemes.length) {
    if (!SYMBOL_RE.test(graphemes[index].text)) {
      index++
      continue
    }
    let end = index
    while (end < graphemes.length && SYMBOL_RE.test(graphemes[end].text)) end++
    const last = graphemes[end - 1]
    boundaries.push(last.index + last.text.length)
    index = end
  }
  return boundaries
}

/** 五级递进顺序（移植笔记 §2.2：粗 → 细） */
const LEVELS: readonly LevelSplitter[] = [
  punctuationBoundaries,
  bracketBoundaries,
  latinWordBoundaries,
  whitespaceBoundaries,
  symbolBoundaries
]

/** 用某一级切分单段；切不动则原样返回 */
function splitSegment(segment: string, level: LevelSplitter): string[] {
  const boundaries = normalizeBoundaries(segment, level(segment))
  return boundaries.length === 0 ? [segment] : applyBoundaries(segment, boundaries)
}

/** 同一级作用到所有段上 */
function splitAllByLevel(segments: readonly string[], level: LevelSplitter): string[] {
  const result: string[] = []
  for (const segment of segments) result.push(...splitSegment(segment, level))
  return result
}

/** 纯空白段并进相邻段（优先并入前段；首段为纯空白则并入后段），保持拼接不变 */
function mergeWhitespaceOnly(segments: readonly string[]): string[] {
  const result: string[] = []
  let pending = ''
  for (const segment of segments) {
    if (segment.length === 0) continue
    if (isWhitespaceOnly(segment)) {
      if (result.length > 0) result[result.length - 1] += segment
      else pending += segment
      continue
    }
    result.push(pending + segment)
    pending = ''
  }
  if (pending.length > 0) {
    if (result.length > 0) result[result.length - 1] += pending
    else result.push(pending)
  }
  return result
}

/** 段数超过目标：反复合并「合并后最短」的相邻对（平局由种子决定） */
function mergeToTarget(segments: readonly string[], target: number, seed: number): string[] {
  const result = [...segments]
  let step = 0
  while (result.length > target) {
    let bestLength = Number.POSITIVE_INFINITY
    const candidates: number[] = []
    for (let index = 0; index < result.length - 1; index++) {
      const length = countGraphemes(result[index]) + countGraphemes(result[index + 1])
      if (length < bestLength) {
        bestLength = length
        candidates.length = 0
        candidates.push(index)
      } else if (length === bestLength) {
        candidates.push(index)
      }
    }
    if (candidates.length === 0) break
    const pick =
      candidates[Math.floor(seededRandom(seed, MERGE_SEED_BASE + step) * candidates.length)]
    result.splice(pick, 2, result[pick] + result[pick + 1])
    step++
  }
  return result
}

/** 二次切分的候选切点：优先中点，再向两侧就近扩展 */
function midpointCuts(graphemeCount: number): number[] {
  const middle = Math.ceil(graphemeCount / 2)
  const cuts: number[] = []
  for (let delta = 0; delta < graphemeCount; delta++) {
    const up = middle + delta
    const down = middle - delta
    if (up > 0 && up < graphemeCount) cuts.push(up)
    if (down > 0 && down < graphemeCount && down !== up) cuts.push(down)
  }
  return cuts
}

/** 二次切分：在字素边界上把一段对半切。优先选不产生纯空白段的切点，都没有就退回中点。 */
function splitSegmentAtMidpoint(segment: string): string[] {
  const offsets = graphemeOffsets(segment)
  const graphemeCount = offsets.length - 1
  if (graphemeCount < 2) return [segment]
  const cuts = midpointCuts(graphemeCount)
  const cut =
    cuts.find((candidate) => {
      const left = segment.slice(0, offsets[candidate])
      const right = segment.slice(offsets[candidate])
      return !isWhitespaceOnly(left) && !isWhitespaceOnly(right)
    }) ?? cuts[0]
  return [segment.slice(0, offsets[cut]), segment.slice(offsets[cut])]
}

/** 段数不足目标：二次切分（每次把最长的可切段对半切，平局由种子决定） */
function splitToTarget(segments: readonly string[], target: number, seed: number): string[] {
  const result = [...segments]
  let step = 0
  while (result.length < target) {
    let bestLength = 0
    const candidates: number[] = []
    for (let index = 0; index < result.length; index++) {
      const length = countGraphemes(result[index])
      if (length < 2) continue // 少于 2 个字素切不动
      if (length > bestLength) {
        bestLength = length
        candidates.length = 0
        candidates.push(index)
      } else if (length === bestLength) {
        candidates.push(index)
      }
    }
    if (candidates.length === 0) break // 无处可切（target > 字素数）：既定回退
    const pick =
      candidates[Math.floor(seededRandom(seed, SPLIT_SEED_BASE + step) * candidates.length)]
    result.splice(pick, 1, ...splitSegmentAtMidpoint(result[pick]))
    step++
  }
  return result
}

/** 目标段数归一化：非有限值或 < 1 一律按 1 处理 */
function normalizeTarget(targetCount: number): number {
  if (!Number.isFinite(targetCount)) return 1
  return Math.max(1, Math.floor(targetCount))
}

/**
 * 把一行文本切成 targetCount 段（移植笔记 §2.2 五级递进切分）。
 *
 * @param text        行文本。调用方应传已 trim 的文本；本函数**不修改**文本内容，
 *                    连首尾空白也原样保留在首/末段里（保证拼接可还原）。
 * @param targetCount 目标段数。由 determineLineCount 给出，或溢出重切时由调用方上调。
 * @param seed        种子，约定为行起始时间。只用于平局打破（合并/二次切分选谁），
 *                    因此它只影响「切在哪」，不影响字符是否齐全。
 * @returns 段数组，顺序即原文顺序
 *
 * 退化输入：空串 → []；targetCount ≤ 1 → [text]；targetCount 大于字素数时，
 * 返回「一段一个字素」的既定回退结果（段数 = 字素数）。
 */
export function splitIntoSentences(text: string, targetCount: number, seed: number): string[] {
  if (text.length === 0) return []
  const target = normalizeTarget(targetCount)
  if (target <= 1) return [text]

  let segments: string[] = [text]
  for (const level of LEVELS) {
    if (segments.length >= target) break
    segments = splitAllByLevel(segments, level)
  }

  segments = mergeWhitespaceOnly(segments)
  segments = mergeToTarget(segments, target, seed)
  segments = splitToTarget(segments, target, seed)
  return segments
}
