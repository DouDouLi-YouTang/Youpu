import { describe, expect, it } from 'vitest'

import type { LyricWord } from '@/domain/lyric'
import {
  FALLBACK_LINE_DURATION_MS,
  GLOW_EMPTY_FONT_CLAMP_REM_MAX,
  GLOW_EMPTY_FONT_CLAMP_REM_MIN,
  GLOW_EMPTY_FONT_CLAMP_VW,
  GLOW_FONT_CLAMP_REM_MAX,
  GLOW_FONT_CLAMP_REM_MIN,
  GLOW_FONT_CLAMP_VW,
  resolveClampFontSize,
  resolveDisplayWords,
  resolveGlowEmptyFontSize,
  resolveGlowFontSize,
  resolveLineEndMs,
  resolvePixelFontSize,
  toTimedWords
} from './glow-adapter'

/**
 * 「流光」适配层。它是**唯一**做毫秒↔秒换算与数据形状适配的地方，
 * 所以两件事必须钉死：
 *  1. clamp 字号三项都乘倍率（只乘中间项会让倍率在触界时失效）；
 *  2. 降级路径（无逐字数据 / 数据不自洽）必须**能看**，不是返回空。
 */

/** 模拟 YRC 逐字：每个词一个字，等时长 */
function perChar(text: string, startMs = 0, stepMs = 100): LyricWord[] {
  return Array.from(text).map((char, index) => ({
    word: char,
    timeMs: startMs + index * stepMs,
    durationMs: stepMs
  }))
}

describe('字号 clamp', () => {
  it('三项都乘倍率', () => {
    expect(resolveClampFontSize(2, 4, 6, 2)).toBe('clamp(4.000rem, 8.000vw, 12.000rem)')
  })

  it('倍率非法 / 非正退回 1（绝不生成 0rem 或 NaN）', () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveClampFontSize(2, 4, 6, bad)).toBe('clamp(2.000rem, 4.000vw, 6.000rem)')
    }
  })

  it('主行字号 = clamp(2.25rem, 6vw, 4.5rem)', () => {
    expect(resolveGlowFontSize()).toBe('clamp(2.250rem, 6.000vw, 4.500rem)')
  })

  it('空态字号 = clamp(1.5rem, 3.5vw, 2.25rem)', () => {
    expect(resolveGlowEmptyFontSize()).toBe('clamp(1.500rem, 3.500vw, 2.250rem)')
  })

  it('常量本身与 Folia 一致（改它们等于改视觉档位）', () => {
    expect([GLOW_FONT_CLAMP_REM_MIN, GLOW_FONT_CLAMP_VW, GLOW_FONT_CLAMP_REM_MAX]).toEqual([
      2.25, 6, 4.5
    ])
    expect([
      GLOW_EMPTY_FONT_CLAMP_REM_MIN,
      GLOW_EMPTY_FONT_CLAMP_VW,
      GLOW_EMPTY_FONT_CLAMP_REM_MAX
    ]).toEqual([1.5, 3.5, 2.25])
  })
})

describe('主行字号的像素值（量宽用）', () => {
  it('窄视口触下界：取 2.25rem', () => {
    // 视口 400px：6vw = 24px，而下界 2.25 × 16 = 36px —— 取下界
    expect(resolvePixelFontSize(400, 16)).toBe(36)
  })

  it('中间区间取 vw', () => {
    // 视口 1000px：6vw = 60px，上下界是 36 / 72 —— 取 60
    expect(resolvePixelFontSize(1000, 16)).toBe(60)
  })

  it('宽视口触上界：取 4.5rem', () => {
    // 视口 2000px：6vw = 120px，上界 4.5 × 16 = 72 —— 取上界
    expect(resolvePixelFontSize(2000, 16)).toBe(72)
  })

  it('读真实根字号，不写死 16（字号设置 / 高 DPI 下必须跟着变）', () => {
    expect(resolvePixelFontSize(400, 20)).toBe(45)
    expect(resolvePixelFontSize(400, 20)).not.toBe(resolvePixelFontSize(400, 16))
  })

  it('根字号非法时退回 16', () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(resolvePixelFontSize(400, bad)).toBe(36)
    }
  })

  it('视口宽度非法（未测量）时退化为下界，不产生 NaN', () => {
    for (const bad of [0, -1, Number.NaN]) {
      const value = resolvePixelFontSize(bad, 16)
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBe(36)
    }
  })

  it('单调不减：视口变宽字号不变小', () => {
    let previous = 0
    for (const width of [200, 600, 1000, 1500, 3000]) {
      const value = resolvePixelFontSize(width, 16)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })
})

describe('行结束时间推算', () => {
  it('有下一行就用下一行起点', () => {
    expect(resolveLineEndMs({ timeMs: 1000 }, { timeMs: 4000 }, 60000)).toBe(4000)
  })

  it('末行用播放时长', () => {
    expect(resolveLineEndMs({ timeMs: 50000 }, null, 60000)).toBe(60000)
  })

  it('时长未知 / 乱序时用固定 5 秒兜底', () => {
    expect(resolveLineEndMs({ timeMs: 50000 }, null, 0)).toBe(50000 + FALLBACK_LINE_DURATION_MS)
    expect(resolveLineEndMs({ timeMs: 50000 }, null, 40000)).toBe(50000 + FALLBACK_LINE_DURATION_MS)
  })

  it('下一行时间戳不比当前行晚时视为无效（乱序数据不产生负时长行）', () => {
    expect(resolveLineEndMs({ timeMs: 5000 }, { timeMs: 5000 }, 60000)).toBe(60000)
    expect(resolveLineEndMs({ timeMs: 5000 }, { timeMs: 1000 }, 0)).toBe(
      5000 + FALLBACK_LINE_DURATION_MS
    )
  })
})

describe('逐字数据适配', () => {
  it('自洽的逐字数据原样映射（毫秒保持毫秒）', () => {
    const words = toTimedWords(
      [
        { word: '你', timeMs: 100, durationMs: 200 },
        { word: '好', timeMs: 300, durationMs: 150 }
      ],
      '你好'
    )
    expect(words).toEqual([
      { text: '你', startTime: 100, endTime: 300 },
      { text: '好', startTime: 300, endTime: 450 }
    ])
  })

  it('没有 words（老歌只有行级 LRC）返回空数组', () => {
    expect(toTimedWords(undefined, '你好')).toEqual([])
    expect(toTimedWords([], '你好')).toEqual([])
  })

  it('拼不出整行时返回空数组（不猜，避免字与时间戳错位）', () => {
    const words: LyricWord[] = [{ word: '你', timeMs: 0, durationMs: 100 }]
    expect(toTimedWords(words, '完全不同的文本')).toEqual([])
  })

  it('时长非正 / 非有限时当 0（不产生倒着走的时间轴）', () => {
    const words = toTimedWords(
      [
        { word: 'a', timeMs: 0, durationMs: 0 },
        { word: 'b', timeMs: 100, durationMs: -50 },
        { word: 'c', timeMs: 200, durationMs: Number.NaN }
      ],
      'abc'
    )
    expect(words.map((word) => word.endTime)).toEqual([0, 100, 200])
  })

  it('起点单调化：乱序的起点被拉齐到上一个词（动画不倒退）', () => {
    const words = toTimedWords(
      [
        { word: 'a', timeMs: 500, durationMs: 100 },
        { word: 'b', timeMs: 100, durationMs: 100 }
      ],
      'ab'
    )
    expect(words[1].startTime).toBe(500)
  })
})

describe('显示词（含降级路径）', () => {
  it('有逐字数据时走完整切分（CJK 逐字保留）', () => {
    const result = resolveDisplayWords('世界的尽头', perChar('世界的尽头'), 0, 500)
    expect(result.map((word) => word.text)).toEqual(['世', '界', '的', '尽', '头'])
  })

  it('没有逐字数据时退化成整行一个词（不是空数组 —— 空数组会让画面整个空掉）', () => {
    const result = resolveDisplayWords('你好世界', undefined, 1000, 3000)
    expect(result).toEqual([{ text: '你好世界', startTime: 1000, endTime: 3000 }])
  })

  it('数据不自洽时同样降级为整行一个词', () => {
    const broken: LyricWord[] = [{ word: '别的', timeMs: 0, durationMs: 100 }]
    expect(resolveDisplayWords('你好', broken, 1000, 2000)).toEqual([
      { text: '你好', startTime: 1000, endTime: 2000 }
    ])
  })

  it('整行文本为空时返回空数组（没有词可渲染）', () => {
    expect(resolveDisplayWords('', undefined, 0, 1000)).toEqual([])
  })

  it('用的是**行**的起止时间兜底，不是词的（降级只有一份时间来源）', () => {
    const result = resolveDisplayWords('abc', undefined, 700, 1900)
    expect(result[0].startTime).toBe(700)
    expect(result[0].endTime).toBe(1900)
  })
})
