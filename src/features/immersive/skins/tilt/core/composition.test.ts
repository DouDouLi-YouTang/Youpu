import { describe, expect, it } from 'vitest'
import { buildCharTimings, buildCharTimingsFromWords } from './char-timing'
import { getCharPulseAtTime, getCharPulseScale } from './char-pulse'
import { determineLineCount } from './line-count'
import { splitIntoSentences } from './segmentation'
import { pickTiltSegment } from './tilt-pick'

/** 真实调用形态：由行起始时间（ms）做种子，行时长用下一行时间戳推算（§8.1.1） */
const LINES: { timeMs: number; text: string; lineEndMs: number }[] = [
  { timeMs: 12345, text: '我爱你，可是你爱他，他却爱着她', lineEndMs: 17145 },
  { timeMs: 60000, text: 'Hello world, how are you today my friend', lineEndMs: 65200 },
  { timeMs: 90000, text: '不想再想你了……真的', lineEndMs: 93000 },
  { timeMs: 120000, text: '他说「我们走吧」然后就走了', lineEndMs: 122600 },
  { timeMs: 150000, text: '啦啦啦 啦啦啦 啦啦啦啦啦', lineEndMs: 154000 }
]

describe('纯算法层组合（C3b 将按这个顺序调用）', () => {
  it('分行 → 切分 → 倾斜选择 → 逐字时间，全链路自洽', () => {
    for (const { timeMs, text, lineEndMs } of LINES) {
      const charCount = text.replace(/\s/g, '').length
      const count = determineLineCount(charCount, timeMs)
      expect(count).toBeGreaterThanOrEqual(1)
      expect(count).toBeLessThanOrEqual(4)

      const segments = splitIntoSentences(text, count, timeMs)
      expect(segments.join('')).toBe(text)
      expect(segments).toHaveLength(count)

      const { tiltIndex, shortLastSegment } = pickTiltSegment(segments, timeMs)
      expect(tiltIndex === null || (tiltIndex >= 0 && tiltIndex < segments.length)).toBe(true)
      expect(typeof shortLastSegment).toBe('boolean')

      const timings = buildCharTimings(text, timeMs, lineEndMs)
      expect(timings.map((t) => t.char).join('')).toBe(text)
      const total = timings.reduce((sum, t) => sum + (t.endTime - t.startTime), 0)
      expect(total).toBeCloseTo(lineEndMs - timeMs, 6)
      for (const timing of timings) {
        expect(Number.isFinite(timing.startTime)).toBe(true)
        expect(timing.startTime).toBeLessThanOrEqual(timing.endTime)
      }

      // 脉冲放大倍率始终在合理区间（倾斜 1.18 / 非倾斜 1.15 上限）
      const scale = getCharPulseScale(
        getCharPulseAtTime(timeMs, timeMs, lineEndMs, 200, 900),
        false
      )
      expect(scale).toBeGreaterThanOrEqual(1)
      expect(scale).toBeLessThanOrEqual(1.18)
    }
  })

  it('§8.1 降级路径：没有逐字数据时整行均匀分配（面板不会完全不动）', () => {
    const { timeMs, text, lineEndMs } = LINES[0]
    const timings = buildCharTimings(text, timeMs, lineEndMs).filter((t) => !t.isWhitespace)
    // 每个非空白字素都有时长，且覆盖整行区间
    expect(timings.every((t) => t.endTime > t.startTime)).toBe(true)
    expect(timings[timings.length - 1].endTime).toBeCloseTo(lineEndMs, 6)
  })

  it('§8.1 逐字路径：词级时间戳拼接后仍是整行文本（LyricWord.word 的 join 约定）', () => {
    const text = '我爱你，可是你爱他'
    // 模拟本项目 LyricWord[]（毫秒）：word 保持含空格，join('') 还原原文
    const words = [
      { text: '我爱你，', startTime: 1000, endTime: 2200 },
      { text: '可是你爱他', startTime: 2200, endTime: 4000 }
    ]
    expect(words.map((w) => w.text).join('')).toBe(text)

    const timings = buildCharTimingsFromWords(words)
    expect(timings.map((t) => t.char).join('')).toBe(text)
    expect(timings.map((t) => t.wordIndex)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1])
    for (const timing of timings) {
      expect(timing.startTime).toBeGreaterThanOrEqual(1000)
      expect(timing.endTime).toBeLessThanOrEqual(4000)
    }
  })
})
