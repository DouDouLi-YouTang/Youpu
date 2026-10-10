import { describe, expect, it } from 'vitest'
import type { CharTiming } from './char-timing'
import { buildCharTimings, buildCharTimingsFromWords } from './char-timing'
import { segmentGraphemes } from './graphemes'

const THUMB = '👍🏽'
const COMBINING = 'é'

/** 所有时间片时长之和（退化输入下也应等于区间长度或 0） */
function totalDuration(timings: readonly CharTiming[]): number {
  return timings.reduce((total, timing) => total + (timing.endTime - timing.startTime), 0)
}

describe('buildCharTimings 基本均分（笔记 §5）', () => {
  it('把区间均分给每个非空白字素，时长总和等于区间长度', () => {
    const timings = buildCharTimings('你好世界', 0, 4000)
    expect(timings.map((t) => t.startTime)).toEqual([0, 1000, 2000, 3000])
    expect(timings.map((t) => t.endTime)).toEqual([1000, 2000, 3000, 4000])
    expect(totalDuration(timings)).toBeCloseTo(4000, 10)
  })

  it('空白字素不占时间（时长为 0），且锚在下一个非空白字素的起点', () => {
    const timings = buildCharTimings('你 好', 0, 2000)
    expect(timings.map((t) => t.char)).toEqual(['你', ' ', '好'])
    expect(timings[1]).toMatchObject({ startTime: 1000, endTime: 1000, isWhitespace: true })
    expect(totalDuration(timings)).toBeCloseTo(2000, 10)
  })

  it('尾随空白锚在区间末尾', () => {
    const timings = buildCharTimings('你好 ', 0, 2000)
    expect(timings[2]).toMatchObject({ startTime: 2000, endTime: 2000, isWhitespace: true })
    expect(totalDuration(timings)).toBeCloseTo(2000, 10)
  })

  it('每个非空白字素时长相等（浮点容差内）', () => {
    const timings = buildCharTimings('abcde', 100, 1100).filter((t) => !t.isWhitespace)
    const durations = timings.map((t) => t.endTime - t.startTime)
    for (const duration of durations) expect(duration).toBeCloseTo(200, 10)
  })

  it('单位无关：秒与毫秒同构（只做比例运算）', () => {
    const seconds = buildCharTimings('你好世界', 0, 3.5)
    const milliseconds = buildCharTimings('你好世界', 0, 3500)
    for (let index = 0; index < seconds.length; index++) {
      expect(seconds[index].startTime * 1000).toBeCloseTo(milliseconds[index].startTime, 8)
      expect(seconds[index].endTime * 1000).toBeCloseTo(milliseconds[index].endTime, 8)
    }
  })
})

describe('buildCharTimings 字素安全', () => {
  it('按 Intl.Segmenter 的字素切分，emoji / 组合字符不被切碎', () => {
    const text = `a${THUMB}b${COMBINING}`
    const timings = buildCharTimings(text, 0, 900)
    expect(timings.map((t) => t.char)).toEqual(segmentGraphemes(text).map((g) => g.text))
    expect(timings.map((t) => t.char).join('')).toBe(text)
    expect(timings).toHaveLength(4) // 不是 8（码元数）
  })

  it('index 是原文偏移，可用 slice 取回该字素；顺序与原文一致', () => {
    const text = `你${THUMB}好`
    const timings = buildCharTimings(text, 0, 300)
    let previousIndex = -1
    for (const timing of timings) {
      expect(text.slice(timing.index, timing.index + timing.char.length)).toBe(timing.char)
      expect(timing.index).toBeGreaterThan(previousIndex)
      previousIndex = timing.index
    }
  })

  it('所有时间片 startTime <= endTime（不产生负时长）', () => {
    for (const text of ['hello world', '你好 世界', `a${THUMB} b`]) {
      for (const timing of buildCharTimings(text, 0, 1000)) {
        expect(timing.startTime).toBeLessThanOrEqual(timing.endTime)
      }
    }
  })
})

describe('buildCharTimings 退化输入', () => {
  it('空串 → 空数组', () => {
    expect(buildCharTimings('', 0, 1000)).toEqual([])
  })

  it('单字素独占整个区间', () => {
    expect(buildCharTimings('字', 10, 16)).toEqual([
      { char: '字', index: 0, startTime: 10, endTime: 16, isWhitespace: false }
    ])
  })

  it('零长度区间 → 全部零时长，落在 startTime', () => {
    const timings = buildCharTimings('你好', 500, 500)
    expect(totalDuration(timings)).toBe(0)
    for (const timing of timings) {
      expect(timing.startTime).toBe(500)
      expect(timing.endTime).toBe(500)
    }
  })

  it('endTime < startTime（负长度）→ 按 0 长度处理，不产生负值与倒序时间', () => {
    const timings = buildCharTimings('你好', 900, 100)
    expect(totalDuration(timings)).toBe(0)
    for (const timing of timings) {
      expect(timing.startTime).toBe(900)
      expect(timing.endTime).toBe(900)
    }
  })

  it('NaN / ±Infinity 时间不产生 NaN，且仍是有限值', () => {
    for (const [startTime, endTime] of [
      [Number.NaN, 1000],
      [0, Number.NaN],
      [Number.NaN, Number.NaN],
      [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
      [0, Number.POSITIVE_INFINITY]
    ]) {
      for (const timing of buildCharTimings('你好', startTime, endTime)) {
        expect(Number.isFinite(timing.startTime)).toBe(true)
        expect(Number.isFinite(timing.endTime)).toBe(true)
        expect(timing.startTime).toBeLessThanOrEqual(timing.endTime)
      }
    }
  })

  it('全空白文本 → 全部零时长，锚在区间末尾', () => {
    const timings = buildCharTimings('   ', 0, 900)
    expect(timings).toHaveLength(3)
    expect(totalDuration(timings)).toBe(0)
    for (const timing of timings) expect(timing.endTime).toBe(900)
  })

  it('起点为负（前奏时间戳）也照常均分', () => {
    const timings = buildCharTimings('你好', -4000, 0)
    expect(totalDuration(timings)).toBeCloseTo(4000, 10)
    expect(timings[0].startTime).toBe(-4000)
    expect(timings[0].endTime).toBe(-2000)
  })
})

describe('buildCharTimingsFromWords（笔记 §5 词级路径）', () => {
  it('逐词均分，index 相对拼接文本，并带 wordIndex', () => {
    const timings = buildCharTimingsFromWords([
      { text: '你好', startTime: 0, endTime: 1000 },
      { text: ' 世界', startTime: 1200, endTime: 2200 }
    ])
    expect(timings.map((t) => t.char).join('')).toBe('你好 世界')
    expect(timings.map((t) => t.wordIndex)).toEqual([0, 0, 1, 1, 1])
    expect(timings.map((t) => t.index)).toEqual([0, 1, 2, 3, 4])
    // 每个词内部时长总和 = 该词的区间长度
    const wordDurations = [0, 0]
    for (const timing of timings) {
      wordDurations[timing.wordIndex] += timing.endTime - timing.startTime
    }
    expect(wordDurations[0]).toBeCloseTo(1000, 10)
    expect(wordDurations[1]).toBeCloseTo(1000, 10)
  })

  it('词与词时间不连续（时间戳缺失留下的空隙）不做全局归一化', () => {
    const timings = buildCharTimingsFromWords([
      { text: '你', startTime: 0, endTime: 100 },
      { text: '好', startTime: 5000, endTime: 5100 }
    ])
    expect(timings[0]).toMatchObject({ startTime: 0, endTime: 100 })
    expect(timings[1]).toMatchObject({ startTime: 5000, endTime: 5100 })
  })

  it('空词列表 → 空数组；空词不产生时间片', () => {
    expect(buildCharTimingsFromWords([])).toEqual([])
    expect(buildCharTimingsFromWords([{ text: '', startTime: 0, endTime: 100 }])).toEqual([])
  })
})
