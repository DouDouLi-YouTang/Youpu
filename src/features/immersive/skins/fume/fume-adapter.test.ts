import { describe, expect, it } from 'vitest'

import type { LyricLine } from '@/domain/lyric'
import {
  FUME_FALLBACK_LINE_DURATION_MS,
  resolveFumeEmptyFontSize,
  resolveFumeLineEndMs,
  resolveFumeSubtitleFontSize,
  resolveFumeUpcomingFontSize,
  toFumeLines,
  toFumeWords
} from './fume-adapter'

/**
 * 浮名适配层：数据形状与单位换算的**唯一**入口（§15.2）。
 *
 * 这一层错了不会报错，只会静默地改变视觉节奏，所以三类东西必须单独钉住：
 *  1. 行结束时间的三条分支（它决定拖尾、`renderEndTime`、相机的行过场）；
 *  2. 逐词数据的**自洽性拦截**（拼不出整行时必须退回整行摊分，否则字素错位）；
 *  3. `renderHints` 是否真的随行一起烘出来（漏了会让 §5.3 的截止时间退化成行尾）。
 */

function makeLine(overrides: Partial<LyricLine> = {}): LyricLine {
  return { timeMs: 1000, text: '一二三', ...overrides }
}

describe('行结束时间推算（§15.2）', () => {
  it('兜底时长与「倾诉」「流光」同为 5 秒', () => {
    expect(FUME_FALLBACK_LINE_DURATION_MS).toBe(5000)
  })

  it('有下一行就用下一行起点', () => {
    expect(resolveFumeLineEndMs(makeLine(), { timeMs: 4000 }, 60_000)).toBe(4000)
  })

  it('末行用播放时长', () => {
    expect(resolveFumeLineEndMs(makeLine({ timeMs: 50_000 }), null, 60_000)).toBe(60_000)
  })

  it('时长未知或乱序时退回固定 5 秒', () => {
    expect(resolveFumeLineEndMs(makeLine({ timeMs: 50_000 }), null, 0)).toBe(55_000)
    expect(resolveFumeLineEndMs(makeLine({ timeMs: 50_000 }), null, 40_000)).toBe(55_000)
    expect(resolveFumeLineEndMs(makeLine({ timeMs: 5000 }), { timeMs: 1000 }, 0)).toBe(10_000)
  })

  it('下一行时间戳不比当前行晚时视为无效（乱序数据不产生负时长行）', () => {
    expect(resolveFumeLineEndMs(makeLine({ timeMs: 5000 }), { timeMs: 5000 }, 60_000)).toBe(60_000)
  })
})

describe('逐词数据适配（§15.2）', () => {
  it('自洽的逐词数据原样映射，时间保持毫秒', () => {
    expect(
      toFumeWords(
        [
          { word: '你', timeMs: 100, durationMs: 200 },
          { word: '好', timeMs: 300, durationMs: 150 }
        ],
        '你好'
      )
    ).toEqual([
      { text: '你', startTimeMs: 100, endTimeMs: 300 },
      { text: '好', startTimeMs: 300, endTimeMs: 450 }
    ])
  })

  it('没有 words（老歌只有行级 LRC）返回空数组', () => {
    expect(toFumeWords(undefined, '你好')).toEqual([])
    expect(toFumeWords([], '你好')).toEqual([])
  })

  it('拼不出整行时返回空数组（宁可整行摊分，也不要字素错位）', () => {
    expect(toFumeWords([{ word: '你', timeMs: 0, durationMs: 100 }], '你好')).toEqual([])
    expect(
      toFumeWords(
        [
          { word: '你', timeMs: 0, durationMs: 100 },
          { word: '好', timeMs: 0, durationMs: 100 }
        ],
        '你 好'
      )
    ).toEqual([])
  })

  it('乱序时间戳被单调化（起点不早于上一个词的起点）', () => {
    const words = toFumeWords(
      [
        { word: '甲', timeMs: 500, durationMs: 100 },
        { word: '乙', timeMs: 200, durationMs: 100 }
      ],
      '甲乙'
    )
    expect(words[1]?.startTimeMs).toBe(500)
    expect(words[1]?.endTimeMs).toBe(600)
  })

  it('非有限时间戳退回上一个词的起点（不产生 NaN）', () => {
    const words = toFumeWords(
      [
        { word: '甲', timeMs: 500, durationMs: 100 },
        { word: '乙', timeMs: Number.NaN, durationMs: 100 }
      ],
      '甲乙'
    )
    expect(words[1]).toEqual({ text: '乙', startTimeMs: 500, endTimeMs: 600 })
  })

  it('负时长 / 非有限时长按 0 处理（不退化成负区间）', () => {
    const words = toFumeWords(
      [
        { word: '甲', timeMs: 100, durationMs: -50 },
        { word: '乙', timeMs: 300, durationMs: Number.POSITIVE_INFINITY }
      ],
      '甲乙'
    )
    expect(words[0]).toEqual({ text: '甲', startTimeMs: 100, endTimeMs: 100 })
    expect(words[1]).toEqual({ text: '乙', startTimeMs: 300, endTimeMs: 300 })
  })
})

describe('整首歌转换（toFumeLines）', () => {
  const LINES: LyricLine[] = [
    { timeMs: 0, text: '第一行' },
    { timeMs: 2000, text: '第二行', translation: '第二个', romaji: 'dai ni' },
    { timeMs: 5000, text: '第三行' }
  ]

  it('逐行补齐 endTimeMs，末行用播放时长', () => {
    const result = toFumeLines(LINES, 9000)
    expect(result.map((line) => [line.startTimeMs, line.endTimeMs])).toEqual([
      [0, 2000],
      [2000, 5000],
      [5000, 9000]
    ])
  })

  it('字段逐个映射：fullText / translation / romanization', () => {
    const result = toFumeLines(LINES, 9000)
    expect(result[1]).toMatchObject({
      fullText: '第二行',
      translation: '第二个',
      romanization: 'dai ni'
    })
    expect(result[0]?.translation).toBeUndefined()
    expect(result[0]?.romanization).toBeUndefined()
  })

  it('isChorus 透传数据层的副歌标记；没有标记的行回退成 false（§7.11）', () => {
    // 数据层（`lyric.mapper.applyChorusRanges`）按 `/song/chorus` 的区间打标，
    // 没打标的行必须是 false 而不是 undefined —— 下游 `article-blocks` 直接读它做加权。
    expect(toFumeLines(LINES, 9000).every((line) => line.isChorus === false)).toBe(true)

    const withChorus = LINES.map((line, index) =>
      index === 1 ? { ...line, isChorus: true } : line
    )
    expect(toFumeLines(withChorus, 9000).map((line) => line.isChorus)).toEqual([false, true, false])
  })

  it('renderHints 随行一起烘出（否则 §5.3 的截止时间会退化成行尾）', () => {
    const [first] = toFumeLines(LINES, 9000)
    expect(first?.renderHints).toBeDefined()
    const hints = first!.renderHints!
    // 行时长 2000ms = normal → 进场 420ms、出场 320ms、渲染结束 = max(2000, 2000-320+320) = 2000
    expect(hints.rawDurationMs).toBe(2000)
    expect(hints.timingClass).toBe('normal')
    expect(hints.lineTransitionMode).toBe('normal')
    expect(hints.wordRevealMode).toBe('normal')
    expect(hints.renderEndTimeMs).toBeGreaterThanOrEqual(first!.endTimeMs)
  })

  it('没有 words 时 words 为空数组（走 §5.5 的整行摊分路径）', () => {
    expect(toFumeLines(LINES, 9000)[0]?.words).toEqual([])
  })

  it('空行也保留在数组里（§7.7 的过滤在排版层做，适配层不丢下标）', () => {
    const result = toFumeLines(
      [
        { timeMs: 0, text: '  ' },
        { timeMs: 1000, text: '词' }
      ],
      3000
    )
    expect(result).toHaveLength(2)
    expect(result[0]?.fullText).toBe('  ')
  })
})

describe('副字幕与空态字号（§14.2）', () => {
  it('副字幕 = clamp(1.05rem, 2.2vw, 1.2rem)', () => {
    expect(resolveFumeSubtitleFontSize()).toBe('clamp(1.050rem, 2.200vw, 1.200rem)')
  })

  it('下一句预览 = clamp(0.875rem, 1.8vw, 1rem)', () => {
    expect(resolveFumeUpcomingFontSize()).toBe('clamp(0.875rem, 1.800vw, 1.000rem)')
  })

  it('副字幕档与「流光」不同（上游两个面板各拼各的，不要"统一"它们）', () => {
    // 流光是 clamp(1.125rem, 2.6vw, 1.25rem)，数值刻意不同
    expect(resolveFumeSubtitleFontSize()).not.toBe('clamp(1.125rem, 2.600vw, 1.250rem)')
  })

  it('空态字号与「流光」同值（上游的空态是外壳提供的通用层）', () => {
    expect(resolveFumeEmptyFontSize()).toBe('clamp(1.500rem, 3.500vw, 2.250rem)')
  })
})
