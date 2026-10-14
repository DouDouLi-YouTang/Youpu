/**
 * 字素（grapheme）切分工具 —— **全部皮肤共享**的纯算法层地基。
 *
 * 住在 `skins/shared/` 而不是某个皮肤目录里：「倾诉」与「浮名」都要切字素
 * （逐字脉冲 / 逐字揭示），而两个平级皮肤**不该互相依赖**（删掉一个不能弄坏另一个）。
 * 曾经它长在 `tilt/core/` 下、被 `fume/core/` 直接 import，那是一条跨皮肤依赖，
 * 已按 Folia 移植笔记 §15.6 / §17.3 的建议提到这一层。
 *
 * 为什么必须用 Intl.Segmenter：emoji、组合字符（e + ́ ）、韩文音节、ZWJ 序列
 * （👨‍👩‍👧）在 UTF-16 里都是多码点，用 `split('')` / `length` 切会切碎，
 * 渲染出来就是「半个 emoji」。本文件是纯算法层里**唯一**接触 Intl.Segmenter
 * 的地方，其余模块一律复用它，避免各写一份切分口径。
 *
 * 本层不做任何时间/单位换算（时间单位由调用方决定，见各函数注释）：以毫秒为单位
 * 的皮肤（本项目全部皮肤）直接用毫秒，不需要在这里乘除 1000。
 * 纯函数、无副作用，可在 vitest 的 node 环境直接单测。
 */

/** 一个字素及其在原文本中的 UTF-16 起始偏移 */
export interface Grapheme {
  /** 字素文本（可能由多个码点组成，如 👍🏽 / é） */
  text: string
  /** 在原字符串中的 UTF-16 起始下标 */
  index: number
}

/** 仅匹配「全是空白字符」的串：半角空格、全角空格、换行、制表符等（\s 覆盖） */
const WHITESPACE_ONLY_RE = /^\s+$/

// 字素切分规则与语言基本无关，故沿用移植笔记 §5 的 `undefined` locale。
// 放在模块级：Intl.Segmenter 是标准内建对象（非 DOM），实例无状态、可复用。
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** 按字素切分文本，保留每个字素在原文本中的偏移。空串返回空数组。 */
export function segmentGraphemes(text: string): Grapheme[] {
  if (!text) return []
  const result: Grapheme[] = []
  for (const part of SEGMENTER.segment(text)) {
    result.push({ text: part.segment, index: part.index })
  }
  return result
}

/**
 * 所有字素边界偏移（升序，含 0 与 text.length）。
 * 用途：把任意 UTF-16 下标「对齐」到字素边界，保证切分不会切进一个字素内部。
 * 空串返回 [0]。
 */
export function graphemeOffsets(text: string): number[] {
  const offsets = [0]
  for (const part of SEGMENTER.segment(text)) {
    if (part.index > 0) offsets.push(part.index)
  }
  const end = offsets[offsets.length - 1]
  if (end !== text.length) offsets.push(text.length)
  return offsets
}

/**
 * 把任意偏移量吸附到「不超过它的最大字素边界」。
 * `offsets` 应为 graphemeOffsets 的结果（升序）；越界会被钳制到首/末边界。
 */
export function snapToGraphemeBoundary(offsets: readonly number[], offset: number): number {
  if (offsets.length === 0) return 0
  const first = offsets[0]
  const last = offsets[offsets.length - 1]
  if (!Number.isFinite(offset) || offset <= first) return first
  if (offset >= last) return last
  // 二分：找最后一个 <= offset 的边界
  let low = 0
  let high = offsets.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (offsets[mid] <= offset) low = mid
    else high = mid - 1
  }
  return offsets[low]
}

/** 字素数量。`ignoreWhitespace` 为 true 时跳过纯空白字素（如逐字序号、视觉长度）。 */
export function countGraphemes(text: string, options: { ignoreWhitespace?: boolean } = {}): number {
  const ignoreWhitespace = options.ignoreWhitespace === true
  let count = 0
  for (const part of SEGMENTER.segment(text)) {
    if (ignoreWhitespace && isWhitespaceOnly(part.segment)) continue
    count++
  }
  return count
}

/** 该字符串是否「全是空白字符」。空串返回 false（空串不是空白段，是空段）。 */
export function isWhitespaceOnly(text: string): boolean {
  return WHITESPACE_ONLY_RE.test(text)
}
