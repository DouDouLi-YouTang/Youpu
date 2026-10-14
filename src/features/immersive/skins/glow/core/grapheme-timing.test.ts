import { describe, expect, it } from 'vitest'

import { buildWordGraphemeTimings } from './grapheme-timing'

/**
 * 「流光」逐字素时间戳。它决定辉光「从左扫到右」的节奏：
 * 分错了字素（emoji 被切成两半）或末字提前结束（浮点累加）都是肉眼可见的瑕疵，
 * 且只在慢速歌 / emoji 歌词上偶发，所以边界全部钉死。
 */

describe('均分规则', () => {
  it('把词的时长均分给每个字素，末字结束时刻取词的 endTime', () => {
    const result = buildWordGraphemeTimings({ text: 'abcd', startTime: 1000, endTime: 1400 })
    expect(result).toEqual([
      { char: 'a', startTimeMs: 1000, endTimeMs: 1100 },
      { char: 'b', startTimeMs: 1100, endTimeMs: 1200 },
      { char: 'c', startTimeMs: 1200, endTimeMs: 1300 },
      { char: 'd', startTimeMs: 1300, endTimeMs: 1400 }
    ])
  })

  it('末字结束时刻**精确等于**词的 endTime（不是浮点累加的结果）', () => {
    // 3 个字素分 1000ms：单位时长 333.333…，累加三次得 1999.9999999999998
    const result = buildWordGraphemeTimings({ text: 'abc', startTime: 1000, endTime: 2000 })
    expect(result[2].endTimeMs).toBe(2000)
    // 前两个字素仍是浮点值，只有末字被"归位"
    expect(result[0].endTimeMs).toBeCloseTo(1333.3333333333333, 9)
  })

  it('中文按字切（每个汉字一个字素）', () => {
    const result = buildWordGraphemeTimings({ text: '世界的尽头', startTime: 0, endTime: 500 })
    expect(result.map((timing) => timing.char)).toEqual(['世', '界', '的', '尽', '头'])
    expect(result).toHaveLength(5)
  })

  it('日文假名与汉字混排时逐个字素切，不切开促音 / 浊音', () => {
    const result = buildWordGraphemeTimings({ text: 'がっこう', startTime: 0, endTime: 400 })
    expect(result.map((timing) => timing.char)).toEqual(['が', 'っ', 'こ', 'う'])
  })
})

describe('字素边界的正确性（Intl.Segmenter 口径）', () => {
  it('emoji 是一个字素，不会被切成两半', () => {
    const result = buildWordGraphemeTimings({ text: '好👍', startTime: 0, endTime: 200 })
    expect(result.map((timing) => timing.char)).toEqual(['好', '👍'])
  })

  it('肤色修饰的 emoji 仍是一个字素（多码点不拆）', () => {
    const result = buildWordGraphemeTimings({ text: '👍🏽', startTime: 0, endTime: 100 })
    expect(result).toHaveLength(1)
    expect(result[0].char).toBe('👍🏽')
    expect(result[0].endTimeMs).toBe(100)
  })

  it('组合字符（e + 组合尖音）算一个字素', () => {
    const result = buildWordGraphemeTimings({ text: 'e\u0301x', startTime: 0, endTime: 200 })
    expect(result.map((timing) => timing.char)).toEqual(['e\u0301', 'x'])
  })
})

describe('退化输入', () => {
  it('空串返回空数组（调用方按整词一个 span 降级）', () => {
    expect(buildWordGraphemeTimings({ text: '', startTime: 0, endTime: 100 })).toEqual([])
  })

  it('空白也算字素（空格在时间轴上占位，不被跳过）', () => {
    // ⚠️ 与「倾诉」的字素处理相反：那边空白不参与脉冲计数，这边**参与**均分
    // —— 流光要的是"逐字扫过"的均匀节奏，跳过空格会让扫描在空格处突然加速。
    const result = buildWordGraphemeTimings({ text: 'a b', startTime: 0, endTime: 300 })
    expect(result.map((timing) => timing.char)).toEqual(['a', ' ', 'b'])
  })

  it('时长为负时钳成 0：所有字素落在同一时刻，不产生倒序时间轴', () => {
    const result = buildWordGraphemeTimings({ text: 'ab', startTime: 500, endTime: 300 })
    expect(result).toEqual([
      { char: 'a', startTimeMs: 500, endTimeMs: 500 },
      { char: 'b', startTimeMs: 500, endTimeMs: 300 }
    ])
  })

  it('零时长：全部字素起点等于词的起点，末字取 endTime', () => {
    const result = buildWordGraphemeTimings({ text: 'ab', startTime: 500, endTime: 500 })
    expect(result[0].startTimeMs).toBe(500)
    expect(result[0].endTimeMs).toBe(500)
    expect(result[1].endTimeMs).toBe(500)
  })

  it('单个字素：起止就是词的起止', () => {
    const result = buildWordGraphemeTimings({ text: 'x', startTime: 250, endTime: 400 })
    expect(result).toEqual([{ char: 'x', startTimeMs: 250, endTimeMs: 400 }])
  })
})

describe('wordIndex', () => {
  it('传了下标就带上（整行时间轴用）', () => {
    const result = buildWordGraphemeTimings({ text: 'ab', startTime: 0, endTime: 200 }, 3)
    expect(result.every((timing) => timing.wordIndex === 3)).toBe(true)
  })

  it('不传下标时字段不出现（避免 JSON 化 / 快照比较时多出 undefined 键）', () => {
    const result = buildWordGraphemeTimings({ text: 'ab', startTime: 0, endTime: 200 })
    expect(Object.hasOwn(result[0], 'wordIndex')).toBe(false)
  })

  it('下标 0 也算"传了"（不能用真值判断，否则会漏掉第一个词）', () => {
    const result = buildWordGraphemeTimings({ text: 'ab', startTime: 0, endTime: 200 }, 0)
    expect(result[0].wordIndex).toBe(0)
  })
})

describe('时间轴单调性', () => {
  it('字素起点严格递增、彼此不重叠，且覆盖整个词区间', () => {
    const result = buildWordGraphemeTimings({ text: '一二三四五六七', startTime: 0, endTime: 700 })
    for (let index = 1; index < result.length; index += 1) {
      expect(result[index].startTimeMs).toBeGreaterThanOrEqual(result[index - 1].startTimeMs)
      expect(result[index - 1].endTimeMs).toBeCloseTo(result[index].startTimeMs, 9)
    }
    expect(result[0].startTimeMs).toBe(0)
    expect(result[result.length - 1].endTimeMs).toBe(700)
  })
})
