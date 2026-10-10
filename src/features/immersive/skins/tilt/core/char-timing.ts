/**
 * 逐字时间（移植笔记 §5）：把词级时间戳均摊到字素（grapheme）。
 *
 * 为什么要到字素级：emoji、组合字符、韩文音节等多码点字符，按 length 切会切碎。
 *
 * **单位由调用方决定，本层只做比例运算**：传秒就用秒、传毫秒就用毫秒，
 * 本层不做 ms↔s 换算（那是 C3b 适配层的职责）。
 * 本项目的 words 是 `{ word, timeMs, durationMs }`（毫秒），调用方自己组装成
 * `{ text, startTime, endTime }` 再进来。
 *
 * 纯函数，可在 node 环境单测。
 */

import { isWhitespaceOnly, segmentGraphemes } from './graphemes'

/** 一个字素的时间片（单位与入参一致） */
export interface CharTiming {
  /** 字素文本（可能由多个码点组成，别再按 length 切） */
  char: string
  /** 该字素在**输入文本**中的 UTF-16 起始偏移 */
  index: number
  /** 该字素开始时间 */
  startTime: number
  /** 该字素结束时间（空白字素恒等于 startTime，见下） */
  endTime: number
  /** 是否纯空白字素：渲染时不做放大/脉冲，淡入序号也不算它 */
  isWhitespace: boolean
}

/** 带起止时间的文本片段（一个词）。时间单位由调用方决定。 */
export interface TimedSpan {
  text: string
  startTime: number
  endTime: number
}

/** 逐字时间 + 它属于第几个词（buildCharTimingsFromWords 专用） */
export interface WordCharTiming extends CharTiming {
  /** 所属词的下标（对应传入的 spans 顺序） */
  wordIndex: number
}

/** 非有限时间值回退到 fallback（NaN/±Infinity 都会毁掉整条时间轴，宁可退化成 0 长度） */
function sanitizeTime(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

/**
 * 把一个区间 [startTime, endTime] 均分到一个文本的每个字素上（移植笔记 §5）。
 *
 * 规则：
 * - 只有**非空白**字素参与时间均分（§5：「均分给它的非空格字素」）
 * - 空白字素时长恒为 0，锚在「下一个非空白字素的起点」；没有下一个则锚在区间末尾
 * - 最后一片非空白字素吸收浮点余数，使时长总和**精确**等于区间长度
 * - 输出包含全部字素（含空白），所以 chars.join('') === 原文
 *
 * 退化输入：
 * - 空串 → []
 * - endTime < startTime（含负长度）→ 一律按 0 长度处理，全部落在 startTime，不产生负值
 * - endTime === startTime → 0 长度
 * - 单字素 → 独占整个区间
 * - startTime/endTime 为 NaN/±Infinity → 非有限的一方退化为 0
 * - 全空白文本 → 所有字素 0 长度，锚在区间末尾
 *
 * @returns 每个字素一片，顺序与原文一致；无 NaN、无负时长
 */
export function buildCharTimings(text: string, startTime: number, endTime: number): CharTiming[] {
  const graphemes = segmentGraphemes(text)
  if (graphemes.length === 0) return []

  const from = sanitizeTime(startTime, 0)
  const to = sanitizeTime(endTime, from)
  // 反向区间（endTime < startTime）统一按 0 长度处理：钳到 from，绝不产生负时长
  const span = to > from ? to - from : 0
  const clampedTo = from + span

  const animatedCount = graphemes.reduce(
    (count, grapheme) => (isWhitespaceOnly(grapheme.text) ? count : count + 1),
    0
  )
  const step = animatedCount > 0 ? span / animatedCount : 0

  const timings: CharTiming[] = []
  let slot = 0
  for (const grapheme of graphemes) {
    if (isWhitespaceOnly(grapheme.text)) {
      // 下一个非空白字素的起点；尾随空白 / 全空白文本锚在区间末尾
      const anchor = slot < animatedCount ? from + slot * step : clampedTo
      timings.push({
        char: grapheme.text,
        index: grapheme.index,
        startTime: anchor,
        endTime: anchor,
        isWhitespace: true
      })
      continue
    }
    const start = from + slot * step
    const isLast = slot === animatedCount - 1
    timings.push({
      char: grapheme.text,
      index: grapheme.index,
      startTime: start,
      endTime: isLast ? clampedTo : start + step,
      isWhitespace: false
    })
    slot++
  }
  return timings
}

/**
 * 词级时间戳路径（移植笔记 §5 第 3、4 点）：逐词把 [startTime, endTime] 均分到
 * 该词的非空白字素，再拼成整段的结果。
 *
 * 词与词的时间可以不连续（有的词没有时间戳），本层**不做全局归一化** ——
 * 各词独立均分，与移植笔记一致；调用方若要「整段均匀分配」，直接对整段调用
 * buildCharTimings 即可（§8.1 的降级路径）。
 *
 * @param spans 词列表，时间单位由调用方决定
 * @returns 每个字素一片；`index` 相对**所有词文本拼接后**的字符串，
 *          另带 `wordIndex` 便于按词分组
 */
export function buildCharTimingsFromWords(spans: readonly TimedSpan[]): WordCharTiming[] {
  const result: WordCharTiming[] = []
  let offset = 0
  for (let wordIndex = 0; wordIndex < spans.length; wordIndex++) {
    const span = spans[wordIndex]
    for (const timing of buildCharTimings(span.text, span.startTime, span.endTime)) {
      result.push({ ...timing, index: timing.index + offset, wordIndex })
    }
    offset += span.text.length
  }
  return result
}
