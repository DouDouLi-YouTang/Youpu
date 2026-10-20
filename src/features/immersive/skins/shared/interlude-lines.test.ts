import { describe, expect, it } from 'vitest'

import {
  INTERLUDE_DOT_COUNT,
  INTERLUDE_FULL_TEXT,
  INTERLUDE_MIN_GAP_MS,
  attachInterludeLines,
  isInterludeLine
} from './interlude-lines'
import type { LyricLine } from '@/domain/lyric'

/**
 * 造一行普通歌词。
 *
 * `endTimeMs` 是**音源自带的真实行时长**（YRC / TTML 才有）—— 行间空隙只能靠它判断，
 * 见 `interlude-lines` 的文件头。老 LRC 的行没有这个字段（传 `undefined`）。
 */
function line(timeMs: number, text = `L${timeMs}`, endTimeMs?: number): LyricLine {
  return endTimeMs === undefined ? { timeMs, text } : { timeMs, text, endTimeMs }
}

/** 播放时长：测试里给一个足够大的值，避免末行兜底路径干扰 */
const DURATION_MS = 600000

describe('isInterludeLine', () => {
  it('只有恰好六个半角句点才算插曲行', () => {
    expect(isInterludeLine({ text: INTERLUDE_FULL_TEXT })).toBe(true)
    // 五个 / 七个点都不算：上游是逐字比较，不是"点数差不多"
    expect(isInterludeLine({ text: '.....' })).toBe(false)
    expect(isInterludeLine({ text: '.......' })).toBe(false)
    // 中文省略号也不是
    expect(isInterludeLine({ text: '……' })).toBe(false)
  })
})

describe('attachInterludeLines', () => {
  it('空数组原样返回空数组（不造插曲）', () => {
    expect(attachInterludeLines([], DURATION_MS)).toEqual([])
  })

  it('首行晚于 3 秒时，在它前面补一行插曲（两端各留 500ms）', () => {
    const result = attachInterludeLines([line(10000)], DURATION_MS)

    expect(result).toHaveLength(2)
    expect(result[0].text).toBe(INTERLUDE_FULL_TEXT)
    expect(result[0].timeMs).toBe(500)
    // 插曲的结束 = 首行起始 - 500ms；它由六个点的最后一个词的结束时间体现
    const lastDot = result[0].words?.at(-1)
    expect(lastDot && lastDot.timeMs + lastDot.durationMs).toBe(9500)
    expect(result[1].timeMs).toBe(10000)
  })

  it('首行不晚于 3 秒时不补前导插曲（阈值是严格大于）', () => {
    // 正好 3000ms 不补
    expect(attachInterludeLines([line(3000)], DURATION_MS)).toHaveLength(1)
    expect(attachInterludeLines([line(2999)], DURATION_MS)).toHaveLength(1)
    expect(attachInterludeLines([line(3001)], DURATION_MS)).toHaveLength(2)
  })

  it('行间空隙大于 3 秒时补插曲（两端各留 50ms）', () => {
    // 前一行 1000ms 起、真实结束 2000ms；下一行 10000ms 起 → 空隙 8000ms
    const result = attachInterludeLines([line(1000, 'a', 2000), line(10000, 'b')], DURATION_MS)

    expect(result).toHaveLength(3)
    expect(result[0].timeMs).toBe(1000)
    expect(result[1].text).toBe(INTERLUDE_FULL_TEXT)
    expect(result[1].timeMs).toBe(2050)
    const lastDot = result[1].words?.at(-1)
    expect(lastDot && lastDot.timeMs + lastDot.durationMs).toBe(9950)
    expect(result[2].timeMs).toBe(10000)
  })

  it('空隙正好 3 秒不补插曲（阈值是严格大于）', () => {
    // 真实结束 1001ms；下一行起始 4001ms → 空隙正好 3000ms（不补）
    expect(
      attachInterludeLines([line(1000, 'a', 1001), line(4001, 'b')], DURATION_MS)
    ).toHaveLength(2)
    // 再多 1ms → 空隙 3001ms（补）
    expect(
      attachInterludeLines([line(1000, 'a', 1001), line(4002, 'b')], DURATION_MS)
    ).toHaveLength(3)
  })

  it('零长度行（结束 = 起始）会退化成"下一行起始"，不补插曲', () => {
    // 这类数据是异常输入：真实时长不可信，只能退回下一行起始当结束
    expect(
      attachInterludeLines([line(1000, 'a', 1000), line(4001, 'b')], DURATION_MS)
    ).toHaveLength(2)
  })

  it('老 LRC 行（没有真实行时长）不补行间插曲 —— 与上游一致', () => {
    // 两行的"结束时间"退化成下一行起始，空隙恒为 0
    expect(attachInterludeLines([line(1000, 'a'), line(10000, 'b')], DURATION_MS)).toHaveLength(2)
  })

  it('尾奏之后不补插曲（上游只在首行前与行间补）', () => {
    const result = attachInterludeLines([line(1000, 'a', 2000)], DURATION_MS)
    expect(result).toHaveLength(1)
  })

  it('插曲行由六个等分的点组成（不是按字数平均）', () => {
    const result = attachInterludeLines([line(1000, 'a', 2000), line(10000, 'b')], DURATION_MS)
    const interlude = result[1]

    expect(interlude.words).toHaveLength(INTERLUDE_DOT_COUNT)
    expect(interlude.words?.every((word) => word.word === '.')).toBe(true)

    // 六等分：每份时长一致，且首尾拼起来正好是插曲区间
    const durations = interlude.words?.map((word) => word.durationMs) ?? []
    expect(new Set(durations).size).toBe(1)
    const first = interlude.words?.[0]
    const last = interlude.words?.at(-1)
    expect(first?.timeMs).toBe(2050)
    expect(last && last.timeMs + last.durationMs).toBe(9950)
  })

  it('原行顺序与内容保持不变（插曲只做插入）', () => {
    const input = [line(1000, 'a', 2000), line(10000, 'b', 11000), line(20000, 'c', 21000)]
    const result = attachInterludeLines(input, DURATION_MS)

    const realLines = result.filter((item) => !isInterludeLine(item))
    expect(realLines).toEqual(input)
    // 顺序：a、插曲、b、插曲、c
    expect(result.map((item) => item.text)).toEqual([
      'a',
      INTERLUDE_FULL_TEXT,
      'b',
      INTERLUDE_FULL_TEXT,
      'c'
    ])
  })

  it('已有插曲行时不会重复补（幂等性：按行内容判定，不按标记）', () => {
    const once = attachInterludeLines([line(1000, 'a', 2000), line(10000, 'b')], DURATION_MS)
    // 再跑一遍：插曲行没有真实时长，与相邻行的空隙都小于阈值
    const twice = attachInterludeLines(once, DURATION_MS)
    expect(twice).toHaveLength(once.length)
  })

  it('阈值常量与上游一致（3000ms）', () => {
    expect(INTERLUDE_MIN_GAP_MS).toBe(3000)
  })
})
