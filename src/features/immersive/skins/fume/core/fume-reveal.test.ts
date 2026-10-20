import { describe, expect, it } from 'vitest'
import {
  MIN_LINE_SPREAD_DURATION_MS,
  MIN_VISUAL_PROGRESS_DURATION_MS,
  MIN_WORD_REVEAL_DURATION_MS,
  buildEvenGraphemeTimings,
  buildWordGraphemeTimings,
  buildWordRangesFromWords,
  resolveLinePassCutoffTime,
  resolvePrintedGraphemeCount,
  resolvePrintedGraphemeProgress,
  resolvePrintedGlyphsInRange,
  resolveVisualProgressWithCutoff,
  resolveWordRevealProgress
} from './fume-reveal'
import type { FumeWord, FumeWordRange } from './fume-types'

/** 造一个词区间（只填测试关心的字段） */
function makeRange(params: {
  word: FumeWord
  start: number
  end: number
  graphemeTimings?: FumeWordRange['graphemeTimings']
}): FumeWordRange {
  return {
    wordIndex: 0,
    word: params.word,
    start: params.start,
    end: params.end,
    colorStart: params.start,
    colorEnd: params.end,
    graphemeTimings: params.graphemeTimings ?? []
  }
}

describe('buildEvenGraphemeTimings（规格书 §5.2 的均分，单位毫秒）', () => {
  it('把区间均分给每个字素，时长总和精确等于区间长度', () => {
    const timings = buildEvenGraphemeTimings('abcd', 0, 1000)
    expect(timings.map((t) => t.char)).toEqual(['a', 'b', 'c', 'd'])
    expect(timings.map((t) => t.startTimeMs)).toEqual([0, 250, 500, 750])
    expect(timings.map((t) => t.endTimeMs)).toEqual([250, 500, 750, 1000])
    const total = timings.reduce((sum, t) => sum + (t.endTimeMs - t.startTimeMs), 0)
    expect(total).toBe(1000)
  })

  it('最后一个字素的结束时间直接取 endTimeMs（浮点余数不泄漏到尾部）', () => {
    const timings = buildEvenGraphemeTimings('abc', 0, 100)
    expect(timings[timings.length - 1].endTimeMs).toBe(100)
  })

  it('空文本返回空数组', () => {
    expect(buildEvenGraphemeTimings('', 0, 1000)).toEqual([])
  })

  it('按字素切分：emoji / 组合字符不被切碎', () => {
    const timings = buildEvenGraphemeTimings('a👍🏽b', 0, 900)
    expect(timings.map((t) => t.char)).toEqual(['a', '👍🏽', 'b'])
    expect(timings.map((t) => t.startTimeMs)).toEqual([0, 300, 600])
  })

  it('反向区间按 0 长度处理：全部落在 startTimeMs，不产生负时长', () => {
    const timings = buildEvenGraphemeTimings('ab', 500, 100)
    expect(timings.map((t) => t.startTimeMs)).toEqual([500, 500])
    expect(timings.map((t) => t.endTimeMs)).toEqual([500, 100])
    // 最后一个字素的 endTimeMs 原样取入参（上游也这样），但时长为负这件事不影响揭示：
    // 揭示只用 startTimeMs。这里只断言不出现 NaN。
    for (const timing of timings) {
      expect(Number.isNaN(timing.startTimeMs)).toBe(false)
    }
  })

  it('零长区间：每个字素都落在同一时刻', () => {
    const timings = buildEvenGraphemeTimings('ab', 700, 700)
    expect(timings.map((t) => t.startTimeMs)).toEqual([700, 700])
  })
})

describe('buildWordGraphemeTimings（规格书 §5.2 的词 → 字素）', () => {
  it('无音节：整词均分（含空白字素）', () => {
    const word: FumeWord = { text: '你 好', startTimeMs: 0, endTimeMs: 300 }
    const timings = buildWordGraphemeTimings(word)
    expect(timings.map((t) => t.char)).toEqual(['你', ' ', '好'])
    expect(timings.map((t) => t.startTimeMs)).toEqual([0, 100, 200])
  })

  it('有音节：每个音节各自均分自己的区间，按顺序拼接', () => {
    const word: FumeWord = {
      text: 'abcd',
      startTimeMs: 0,
      endTimeMs: 1000,
      syllables: [
        { text: 'ab', startTimeMs: 0, endTimeMs: 200 },
        { text: 'cd', startTimeMs: 800, endTimeMs: 1000 }
      ]
    }
    const timings = buildWordGraphemeTimings(word)
    expect(timings.map((t) => t.char)).toEqual(['a', 'b', 'c', 'd'])
    // 音节之间的空档（200-800）是「延音」：字素世界里不存在时间片，自然跳过
    expect(timings.map((t) => t.startTimeMs)).toEqual([0, 100, 800, 900])
    expect(timings.map((t) => t.endTimeMs)).toEqual([100, 200, 900, 1000])
  })

  it('音节为空数组时退回整词均分（不要走 flatMap 的空结果）', () => {
    const word: FumeWord = { text: 'ab', startTimeMs: 0, endTimeMs: 100, syllables: [] }
    expect(buildWordGraphemeTimings(word).map((t) => t.char)).toEqual(['a', 'b'])
  })
})

describe('buildWordRangesFromWords（规格书 §5.1）', () => {
  it('词或字素为空时返回空数组', () => {
    expect(buildWordRangesFromWords([], ['a'])).toEqual([])
    expect(buildWordRangesFromWords([{ text: 'a', startTimeMs: 0, endTimeMs: 1 }], [])).toEqual([])
  })

  it('过滤掉字素为空的词', () => {
    const ranges = buildWordRangesFromWords(
      [
        { text: '', startTimeMs: 0, endTimeMs: 100 },
        { text: 'a', startTimeMs: 100, endTimeMs: 200 }
      ],
      ['a']
    )
    expect(ranges).toHaveLength(1)
    expect(ranges[0].wordIndex).toBe(0)
    expect(ranges[0].word.text).toBe('a')
  })

  it('只有空白的词**不会**被过滤（过滤判据是字素数 > 0，空格也算一个字素）', () => {
    // 上游的过滤条件是 `splitGraphemes(word.text).length > 0`，空白词因此留在列表里。
    // 这条容易被误判成「空白词应当被丢掉」——显式钉住上游行为。
    const ranges = buildWordRangesFromWords([{ text: ' ', startTimeMs: 0, endTimeMs: 100 }], [' '])
    expect(ranges).toHaveLength(1)
    expect(ranges[0].word.text).toBe(' ')
  })

  it('整个词列表都没有字素（如全是空串）时返回空数组', () => {
    const ranges = buildWordRangesFromWords(
      [
        { text: '', startTimeMs: 0, endTimeMs: 100 },
        { text: '', startTimeMs: 100, endTimeMs: 200 }
      ],
      ['a']
    )
    expect(ranges).toEqual([])
  })

  it('吞掉紧随其后的空白字素，使各词区间首尾相接（视觉流不左移）', () => {
    const words: FumeWord[] = [
      { text: 'hello', startTimeMs: 0, endTimeMs: 500 },
      { text: 'world', startTimeMs: 500, endTimeMs: 1000 }
    ]
    // fullText = 'hello world'（词文本不含空格，空格只在字素数组里）
    const graphemes = ['h', 'e', 'l', 'l', 'o', ' ', 'w', 'o', 'r', 'l', 'd']
    const ranges = buildWordRangesFromWords(words, graphemes)
    expect(ranges.map((r) => [r.start, r.end])).toEqual([
      [0, 6],
      [6, 11]
    ])
  })

  it('连续多个空白全部吞掉', () => {
    const words: FumeWord[] = [
      { text: 'a', startTimeMs: 0, endTimeMs: 1 },
      { text: 'b', startTimeMs: 1, endTimeMs: 2 }
    ]
    const ranges = buildWordRangesFromWords(words, ['a', ' ', ' ', 'b'])
    expect(ranges.map((r) => [r.start, r.end])).toEqual([
      [0, 3],
      [3, 4]
    ])
  })

  it('字素数少于词数时，多出来的词退化成零宽区间（不越界、不抛异常）', () => {
    const words: FumeWord[] = [
      { text: 'a', startTimeMs: 0, endTimeMs: 1 },
      { text: 'b', startTimeMs: 1, endTimeMs: 2 },
      { text: 'c', startTimeMs: 2, endTimeMs: 3 }
    ]
    const ranges = buildWordRangesFromWords(words, ['a'])
    expect(ranges.map((r) => [r.start, r.end])).toEqual([
      [0, 1],
      [1, 1],
      [1, 1]
    ])
  })

  it('colorStart / colorEnd 与 start / end 一致（当前实现）', () => {
    const ranges = buildWordRangesFromWords(
      [{ text: 'ab', startTimeMs: 0, endTimeMs: 10 }],
      ['a', 'b']
    )
    expect(ranges[0].colorStart).toBe(ranges[0].start)
    expect(ranges[0].colorEnd).toBe(ranges[0].end)
  })

  it('每个词都带上自己的字素时间片', () => {
    const ranges = buildWordRangesFromWords(
      [{ text: 'ab', startTimeMs: 0, endTimeMs: 200 }],
      ['a', 'b']
    )
    expect(ranges[0].graphemeTimings.map((t) => t.char)).toEqual(['a', 'b'])
  })
})

describe('resolveWordRevealProgress（规格书 §5.2）', () => {
  it('线性进度：起点 0、中点 0.5、终点 1', () => {
    const range = makeRange({
      word: { text: 'a', startTimeMs: 1000, endTimeMs: 2000 },
      start: 0,
      end: 1
    })
    expect(resolveWordRevealProgress(range, 1000)).toBe(0)
    expect(resolveWordRevealProgress(range, 1500)).toBe(0.5)
    expect(resolveWordRevealProgress(range, 2000)).toBe(1)
  })

  it('零长 / 反向词：不用除法，直接看是否越过终点', () => {
    const zero = makeRange({
      word: { text: 'a', startTimeMs: 500, endTimeMs: 500 },
      start: 0,
      end: 1
    })
    expect(resolveWordRevealProgress(zero, 499)).toBe(0)
    expect(resolveWordRevealProgress(zero, 500)).toBe(1)

    const reversed = makeRange({
      word: { text: 'a', startTimeMs: 900, endTimeMs: 100 },
      start: 0,
      end: 1
    })
    expect(resolveWordRevealProgress(reversed, 50)).toBe(0)
    expect(resolveWordRevealProgress(reversed, 100)).toBe(1)
  })

  it('时长地板 80ms：极短词的进度按 80ms 摊', () => {
    const range = makeRange({
      word: { text: 'a', startTimeMs: 0, endTimeMs: 20 },
      start: 0,
      end: 1
    })
    // 20ms 的区间被抬到 80ms：t = 40 时进度是 0.5 而不是 1
    expect(resolveWordRevealProgress(range, 40)).toBeCloseTo(0.5, 12)
    expect(MIN_WORD_REVEAL_DURATION_MS).toBe(80)
  })

  it('起点之前恒为 0，终点之后恒为 1（钳制）', () => {
    const range = makeRange({
      word: { text: 'a', startTimeMs: 100, endTimeMs: 200 },
      start: 0,
      end: 1
    })
    expect(resolveWordRevealProgress(range, 0)).toBe(0)
    expect(resolveWordRevealProgress(range, 99999)).toBe(1)
  })
})

describe('resolvePrintedGlyphsInRange（规格书 §5.2 的 +0.2 偏置）', () => {
  const range = makeRange({
    word: { text: 'abcd', startTimeMs: 0, endTimeMs: 1000 },
    start: 0,
    end: 4
  })

  it('起点前 0 个；起点后立刻吐第一个字（+0.2 偏置 + 下限 1）', () => {
    expect(resolvePrintedGlyphsInRange(range, -1)).toBe(0)
    expect(resolvePrintedGlyphsInRange(range, 0)).toBe(0)
    expect(resolvePrintedGlyphsInRange(range, 1)).toBe(1)
  })

  it('按 floor(progress * length + 0.2) 逐级推进', () => {
    // 进度 0.5 → floor(2.2) = 2；进度 0.8 → floor(3.4) = 3
    expect(resolvePrintedGlyphsInRange(range, 500)).toBe(2)
    expect(resolvePrintedGlyphsInRange(range, 800)).toBe(3)
  })

  it('进度到 1 直接返回全长（不走 floor）', () => {
    expect(resolvePrintedGlyphsInRange(range, 1000)).toBe(4)
    expect(resolvePrintedGlyphsInRange(range, 5000)).toBe(4)
  })

  it('零宽区间返回 0', () => {
    const empty = makeRange({
      word: { text: 'a', startTimeMs: 0, endTimeMs: 1000 },
      start: 3,
      end: 3
    })
    expect(resolvePrintedGlyphsInRange(empty, 500)).toBe(0)
  })

  it('有音节时按音节时间片判定，并受 length 上限约束', () => {
    const timed = makeRange({
      word: {
        text: 'abc',
        startTimeMs: 0,
        endTimeMs: 1000,
        syllables: [
          { text: 'a', startTimeMs: 0, endTimeMs: 300 },
          { text: 'bc', startTimeMs: 300, endTimeMs: 1000 }
        ]
      },
      start: 0,
      end: 3,
      graphemeTimings: [
        { char: 'a', startTimeMs: 0, endTimeMs: 300 },
        { char: 'b', startTimeMs: 300, endTimeMs: 650 },
        { char: 'c', startTimeMs: 650, endTimeMs: 1000 }
      ]
    })
    expect(resolvePrintedGlyphsInRange(timed, 299)).toBe(1)
    expect(resolvePrintedGlyphsInRange(timed, 300)).toBe(2)
    expect(resolvePrintedGlyphsInRange(timed, 650)).toBe(3)
    // t >= endTimeMs 时直接给满（即使时间片还没走完）
    expect(resolvePrintedGlyphsInRange(timed, 1000)).toBe(3)
  })
})

describe('resolveLinePassCutoffTime（规格书 §5.3 / §17.1 第 6 条）', () => {
  // 一行 1000→4000ms 的 normal 行（3000ms）：
  // enter = min(420, max(220, 1020)) = 420；exit = min(320, max(180, 540)) = 320；hold = 60
  // 拖尾起点 = 4000 + 60 = 4060 → renderEndTime = 4060 + 320 = 4380
  const line = { startTimeMs: 1000, endTimeMs: 4000 }

  it('内部用 getLineRenderEndTimeMs，再与下一行起始时间取 min', () => {
    expect(resolveLinePassCutoffTime(line, 5000)).toBe(4380) // 下一行更晚 → 用渲染结束时间
    expect(resolveLinePassCutoffTime(line, 4300)).toBe(4300) // 下一行更早 → 被截短
    expect(resolveLinePassCutoffTime(line, 4380)).toBe(4380) // 相等 → 保持
  })

  it('下一行时间非有限（含 null / undefined）时不钳制', () => {
    for (const next of [
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY
    ]) {
      expect(resolveLinePassCutoffTime(line, next)).toBe(4380)
    }
  })

  it('已经烘好 renderHints 的行直接复用，不再现算', () => {
    const baked = {
      ...line,
      renderHints: {
        rawDurationMs: 3000,
        timingClass: 'normal' as const,
        renderEndTimeMs: 5000,
        lineTransitionMode: 'normal' as const,
        wordRevealMode: 'normal' as const
      }
    }
    expect(resolveLinePassCutoffTime(baked, 10_000)).toBe(5000)
    expect(resolveLinePassCutoffTime(baked, 4500)).toBe(4500)
  })

  it('最后一个词的结束时间参与拖尾起点（词尾晚于行尾）', () => {
    const withWords = { ...line, words: [{ endTimeMs: 4200 }] }
    // 拖尾起点 = 4200 + 60 = 4260 → 4260 + 320 = 4580
    expect(resolveLinePassCutoffTime(withWords, Number.POSITIVE_INFINITY)).toBe(4580)
  })
})

describe('resolveVisualProgressWithCutoff（规格书 §5.4）', () => {
  it('无截止时就是线性进度', () => {
    expect(resolveVisualProgressWithCutoff(1000, 2000, 1000, 1e9)).toBe(0)
    expect(resolveVisualProgressWithCutoff(1000, 2000, 2000, 1e9)).toBe(0.5)
    expect(resolveVisualProgressWithCutoff(1000, 2000, 3000, 1e9)).toBe(1)
    expect(resolveVisualProgressWithCutoff(1000, 2000, 9000, 1e9)).toBe(1)
  })

  it('截止时间早于名义终点时，进度被压缩到截止点完成', () => {
    // 名义终点 3000，截止 2000 → 进度在 2000 处就到 1
    expect(resolveVisualProgressWithCutoff(1000, 2000, 1500, 2000)).toBe(0.5)
    expect(resolveVisualProgressWithCutoff(1000, 2000, 2000, 2000)).toBe(1)
  })

  it('截止时间早于起点时：从起点起 1ms 内完成（分母地板）', () => {
    expect(resolveVisualProgressWithCutoff(1000, 2000, 1000, 500)).toBe(0)
    expect(resolveVisualProgressWithCutoff(1000, 2000, 1001, 500)).toBe(1)
    expect(resolveVisualProgressWithCutoff(1000, 2000, 1000.5, 500)).toBeCloseTo(0.5, 12)
  })

  it('duration 非法（0 / 负数）时被 1ms 地板抬起，仍返回有限值', () => {
    for (const duration of [0, -5]) {
      const value = resolveVisualProgressWithCutoff(0, duration, 0.5, 1e9)
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeCloseTo(0.5, 12)
    }
    expect(MIN_VISUAL_PROGRESS_DURATION_MS).toBe(1)
  })

  it('恒不返回 NaN（哪怕时间全是非法值也保持有限）', () => {
    const value = resolveVisualProgressWithCutoff(0, 0, 0, 0)
    expect(Number.isNaN(value)).toBe(false)
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThanOrEqual(1)
  })
})

describe('resolvePrintedGraphemeCount 整数版（规格书 §5.5）', () => {
  const line = { startTimeMs: 0, endTimeMs: 1000 }

  it('字素数为 0 或者时间早于行起点时返回 0', () => {
    expect(resolvePrintedGraphemeCount(line, [], 0, 500)).toBe(0)
    expect(resolvePrintedGraphemeCount(line, [], 5, -1)).toBe(0)
  })

  it('用 line.endTimeMs 判定「已全部打印」（不是渲染结束时间，见 §17.3 第 7 条）', () => {
    expect(resolvePrintedGraphemeCount(line, [], 5, 100)).toBeLessThan(5)
    expect(resolvePrintedGraphemeCount(line, [], 5, 1000)).toBe(5)
    // 远超行尾也一样：颜色拖尾阶段不该再「往回退」
    expect(resolvePrintedGraphemeCount(line, [], 5, 5000)).toBe(5)
  })

  it('无词路径：整行摊分 + 起点后立刻补一个字', () => {
    // 进度 0.5 → floor(2.5 + 1) = 3
    expect(resolvePrintedGraphemeCount(line, [], 5, 500)).toBe(3)
    // 进度 0.001 → floor(0.005 + 1) = 1
    expect(resolvePrintedGraphemeCount(line, [], 5, 1)).toBe(1)
    // 起点处仍为 0（还没开始唱）
    expect(resolvePrintedGraphemeCount(line, [], 5, 0)).toBe(0)
  })

  it('无词路径的时长地板是 120ms（极短行不会被压缩成瞬跳）', () => {
    const shortLine = { startTimeMs: 0, endTimeMs: 60 }
    // 时长被抬到 120ms → 进度 0.25 → floor(1 + 1) = 2；
    // 若误用原始 60ms 时长，进度会是 0.5 → floor(2 + 1) = 3（多印一个字）
    expect(resolvePrintedGraphemeCount(shortLine, [], 4, 30)).toBe(2)
    // ⚠️ 但 `t >= endTimeMs` 的分支在摊分之前就已返回全长：
    // 「行已唱完」优先于「时长地板」，地板只影响唱的过程中
    expect(resolvePrintedGraphemeCount(shortLine, [], 4, 60)).toBe(4)
    expect(MIN_LINE_SPREAD_DURATION_MS).toBe(120)
  })

  it('有词路径：在第一个未打印完的词处停下并返回累计字数', () => {
    const words: FumeWord[] = [
      { text: 'ab', startTimeMs: 0, endTimeMs: 500 },
      { text: 'cd', startTimeMs: 500, endTimeMs: 1000 }
    ]
    const graphemes = ['a', 'b', ' ', 'c', 'd']
    const ranges = buildWordRangesFromWords(words, graphemes)
    // t = 250：第一个词进度 0.5，长度 3 → floor(1.5 + 0.2) = 1
    expect(resolvePrintedGraphemeCount(line, ranges, 5, 250)).toBe(1)
    // t = 1000 之前用 endTimeMs 判定，故 999 时走词路径
    // 第一个词满（3），第二个词进度 (999-500)/500 = 0.998 → floor(1.996+0.2)=2
    expect(resolvePrintedGraphemeCount(line, ranges, 5, 999)).toBe(5)
  })

  it('结果恒落在 [0, graphemeCount]', () => {
    for (const t of [-100, 0, 1, 250, 500, 999, 1000, 1e6]) {
      const value = resolvePrintedGraphemeCount(line, [], 7, t)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(7)
    }
  })
})

describe('resolvePrintedGraphemeProgress 浮点版（规格书 §5.6）', () => {
  const line = { startTimeMs: 0, endTimeMs: 1000 }

  it('字素数为 0 或者时间早于行起点时返回 0', () => {
    expect(resolvePrintedGraphemeProgress(line, [], 0, 500)).toBe(0)
    expect(resolvePrintedGraphemeProgress(line, [], 5, -1)).toBe(0)
  })

  it('无词路径：progress * graphemeCount，不做取整', () => {
    expect(resolvePrintedGraphemeProgress(line, [], 5, 500)).toBe(2.5)
    expect(resolvePrintedGraphemeProgress(line, [], 5, 200)).toBeCloseTo(1, 12)
  })

  it('有词路径：在词内部连续推进（这是 smooth 相机的关键）', () => {
    const words: FumeWord[] = [
      { text: 'ab', startTimeMs: 0, endTimeMs: 500 },
      { text: 'cd', startTimeMs: 500, endTimeMs: 1000 }
    ]
    const ranges = buildWordRangesFromWords(words, ['a', 'b', ' ', 'c', 'd'])
    // 第一个词：进度 0.5 × 长度 3 = 1.5
    expect(resolvePrintedGraphemeProgress(line, ranges, 5, 250)).toBeCloseTo(1.5, 12)
    // 第一个词走完（3）后进入第二个词：进度 0.2 × 长度 2 = 0.4 → 3.4
    expect(resolvePrintedGraphemeProgress(line, ranges, 5, 600)).toBeCloseTo(3.4, 12)
  })

  it('遇到还没开始的词要提前返回（否则相机会向后跳到该词首）', () => {
    const words: FumeWord[] = [
      { text: 'ab', startTimeMs: 0, endTimeMs: 300 },
      { text: 'cd', startTimeMs: 800, endTimeMs: 1000 }
    ]
    const ranges = buildWordRangesFromWords(words, ['a', 'b', ' ', 'c', 'd'])
    // t = 500：第一个词已满（3），第二个词还没开始 → 停在 3，而不是跳回 3（词首）
    expect(resolvePrintedGraphemeProgress(line, ranges, 5, 500)).toBe(3)
    expect(resolvePrintedGraphemeProgress(line, ranges, 5, 700)).toBe(3)
  })

  it('用 line.endTimeMs 判定「已全部打印」', () => {
    expect(resolvePrintedGraphemeProgress(line, [], 5, 999)).toBeLessThan(5)
    expect(resolvePrintedGraphemeProgress(line, [], 5, 1000)).toBe(5)
  })

  it('结果恒落在 [0, graphemeCount] 且永不为 NaN', () => {
    const words: FumeWord[] = [{ text: 'abc', startTimeMs: 100, endTimeMs: 400 }]
    const ranges = buildWordRangesFromWords(words, ['a', 'b', 'c'])
    for (const t of [-100, 0, 100, 150, 250, 400, 1e6]) {
      const value = resolvePrintedGraphemeProgress(line, ranges, 3, t)
      expect(Number.isNaN(value)).toBe(false)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(3)
    }
  })
})
