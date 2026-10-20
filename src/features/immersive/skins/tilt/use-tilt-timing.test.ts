import { describe, expect, it } from 'vitest'
import type { LyricWord } from '@/domain/lyric'
import { getCharPulseIntensity, getCharPulseScale } from './core/char-pulse'
import { determineLineCount } from './core/line-count'
import { splitIntoSentences } from './core/segmentation'
import { pickTiltSegment } from './core/tilt-pick'
import { PULSE_TOTAL_FACTOR, TILT_WAVE_DIVISOR, type TiltLineSource } from './tilt-adapter'
import { buildTiltLineModel, type TiltCharModel } from './use-tilt-timing'
import type { TiltSegmentLayout } from './use-tilt-layout'

/** 按 core 的切分结果生成布局段（偏移 = 逐段累加 UTF-16 长度，与 core 的保证一致） */
function toLayoutSegments(text: string, count: number, seed: number): TiltSegmentLayout[] {
  const texts = splitIntoSentences(text, count, seed)
  const { tiltIndex, shortLastSegment } = pickTiltSegment(texts, seed)
  let offset = 0
  return texts.map((segmentText, index) => {
    const layout: TiltSegmentLayout = {
      text: segmentText,
      offset,
      isTilt: index === tiltIndex,
      isShortLast: index === texts.length - 1 && shortLastSegment
    }
    offset += segmentText.length
    return layout
  })
}

const FONT_PX = 60

describe('buildTiltLineModel 逐字模型（词级时间戳路径）', () => {
  const TEXT = '我爱你，可是你爱他'
  const WORDS: LyricWord[] = [
    { word: '我', timeMs: 1000, durationMs: 200 },
    { word: '爱', timeMs: 1200, durationMs: 200 },
    { word: '你', timeMs: 1400, durationMs: 200 },
    { word: '，', timeMs: 1600, durationMs: 100 },
    { word: '可', timeMs: 1700, durationMs: 100 },
    { word: '是', timeMs: 1800, durationMs: 100 },
    { word: '你', timeMs: 1900, durationMs: 100 },
    { word: '爱', timeMs: 2000, durationMs: 100 },
    { word: '他', timeMs: 2100, durationMs: 1000 }
  ]
  const source: TiltLineSource = { text: TEXT, timeMs: 1000, endMs: 3100, words: WORDS }
  const segments: TiltSegmentLayout[] = [
    { text: '我爱你，', offset: 0, isTilt: false, isShortLast: false },
    { text: '可是你爱他', offset: 4, isTilt: true, isShortLast: false }
  ]
  const model = buildTiltLineModel({ source, segments, fontPx: FONT_PX, clockMs: 1000 })

  it('段结构原样保留，字素一个不少（拼接 === 原文）', () => {
    expect(model.text).toBe(TEXT)
    expect(model.segments).toHaveLength(2)
    const all = model.segments.flatMap((segment) => segment.chars.map((char) => char.char))
    expect(all.join('')).toBe(TEXT)
    expect(model.segments[0].chars).toHaveLength(4)
    expect(model.segments[1].chars).toHaveLength(5)
    expect(model.segments[1].isTilt).toBe(true)
  })

  it('逐字淡入延迟 = 段可见起点（首字 − 0.25s） + 非空白序号 × 0.04s（倾斜段 0.05s）', () => {
    const plain = model.segments[0].chars
    // 段内首字 1000ms，提前 250ms，时钟零点 1000ms → 基准 −250ms
    expect(plain.map((char) => char.fadeDelayMs)).toEqual([-250, -210, -170, -130])
    const tilt = model.segments[1].chars
    // 倾斜段首字 1700 → 基准 450ms，步长 50ms
    expect(tilt.map((char) => char.fadeDelayMs)).toEqual([450, 500, 550, 600, 650])
  })

  it('脉冲延迟 = 字素起点 − 时钟零点（可为负），时长 = 钳制后 × 2.2', () => {
    const chars = model.segments.flatMap((segment) => segment.chars)
    expect(chars.map((char) => char.pulseDelayMs)).toEqual([
      0, 200, 400, 600, 700, 800, 900, 1000, 1100
    ])
    // 200ms → 440；100ms 被抬到下限 200 → 440；1000ms 被压到上限 900 → 1980
    expect(chars.map((char) => char.pulseDurationMs)).toEqual([
      440, 440, 440, 440, 440, 440, 440, 440, 1980
    ])
  })

  it('倾斜段按奇偶上下交错 ±字号/6，非倾斜段不动', () => {
    expect(model.segments[0].chars.map((char) => char.wavePx)).toEqual([0, 0, 0, 0])
    const wave = FONT_PX / TILT_WAVE_DIVISOR
    expect(model.segments[1].chars.map((char) => char.wavePx)).toEqual([
      -wave,
      wave,
      -wave,
      wave,
      -wave
    ])
  })

  it('峰值系数按段给（倾斜 0.18 / 非倾斜 0.15），与 core 的放大倍率同源', () => {
    expect(model.segments[0].chars.every((char) => char.peak === 0.15)).toBe(true)
    expect(model.segments[1].chars.every((char) => char.peak === 0.18)).toBe(true)
    const peak = model.segments[1].chars[0].peak
    expect(1 + peak).toBeCloseTo(getCharPulseScale(1, true), 10)
  })

  it('延迟 + 动画时长把钟形峰值与余晖末点放在正确时刻（与 core 的曲线同相位）', () => {
    const char = model.segments[0].chars[0] // 1000–1200ms，时钟零点 1000ms
    // 钟形中点 = 动画总时长的 0.5 / 2.2（tilt-line.scss 的 22.7273% 关键帧）
    const peakAt = char.pulseDelayMs + char.pulseDurationMs * (0.5 / PULSE_TOTAL_FACTOR)
    expect(peakAt).toBeCloseTo(100, 6) // 字的中点 1100 − 时钟 1000
    // 余晖升段结束于字结束之后 1.2 × 时长（此处 200 × 1.2 = 240ms）
    expect(char.pulseDelayMs + char.pulseDurationMs).toBeCloseTo(char.endTime - 1000 + 240, 6)
    expect(getCharPulseIntensity(0.5)).toBe(1)
  })

  it('同样的输入 → 同样的输出（可复现）；且不修改入参', () => {
    const segmentsCopy = JSON.parse(JSON.stringify(segments)) as TiltSegmentLayout[]
    const again = buildTiltLineModel({ source, segments, fontPx: FONT_PX, clockMs: 1000 })
    expect(again).toEqual(model)
    expect(segments).toEqual(segmentsCopy)
  })
})

describe('buildTiltLineModel 退化路径（没有 words / 空白段）', () => {
  it('没有 words → 整行时长均匀分配，段仍按各自首字先后浮现', () => {
    const source: TiltLineSource = { text: 'ab cd', timeMs: 0, endMs: 2000 }
    const segments: TiltSegmentLayout[] = [
      { text: 'ab ', offset: 0, isTilt: false, isShortLast: false },
      { text: 'cd', offset: 3, isTilt: false, isShortLast: false }
    ]
    const model = buildTiltLineModel({ source, segments, fontPx: FONT_PX, clockMs: 0 })
    const [first, second] = model.segments
    // 4 个非空白字素均分 2000ms → 每个 500ms
    expect(first.chars.map((char) => char.pulseDelayMs)).toEqual([0, 500, 1000])
    expect(second.chars.map((char) => char.pulseDelayMs)).toEqual([1000, 1500])
    // 'ab ' 的第三个字素是空格：时长恒为 0 → 被抬到脉冲下限（200 × 2.2 = 440）
    expect(first.chars.map((char) => char.pulseDurationMs)).toEqual([1100, 1100, 440])
    expect(second.chars.map((char) => char.pulseDurationMs)).toEqual([1100, 1100])
    // 段 2 首字 1000ms → 基准 = 1000 − 250 = 750ms
    expect(second.chars.map((char) => char.fadeDelayMs)).toEqual([750, 790])
  })

  it('空白字素：不占淡入序号、不交错位移，跟着前一个实字出现', () => {
    const source: TiltLineSource = { text: 'ab cd', timeMs: 0, endMs: 2000 }
    const segments: TiltSegmentLayout[] = [
      { text: 'ab ', offset: 0, isTilt: false, isShortLast: false },
      { text: 'cd', offset: 3, isTilt: false, isShortLast: false }
    ]
    const model = buildTiltLineModel({ source, segments, fontPx: FONT_PX, clockMs: 0 })
    const space = model.segments[0].chars[2]
    expect(space).toMatchObject({ char: ' ', isWhitespace: true, wavePx: 0 })
    // 跟前一个实字 'b'（−210）一起出现，而不是用段基准（−250）
    expect(space.fadeDelayMs).toBe(model.segments[0].chars[1].fadeDelayMs)
    expect(model.segments[0].chars.map((char) => char.seq)).toEqual([0, 1, 2])
  })

  it('段内全是空白（core 会合并掉，属防御分支）→ 退化用整行起点，不崩', () => {
    const source: TiltLineSource = { text: '   abc', timeMs: 4000, endMs: 6000 }
    const segments: TiltSegmentLayout[] = [
      { text: '   ', offset: 0, isTilt: true, isShortLast: false },
      { text: 'abc', offset: 3, isTilt: false, isShortLast: false }
    ]
    const model = buildTiltLineModel({ source, segments, fontPx: FONT_PX, clockMs: 4000 })
    expect(model.segments[0].chars.every((char) => char.isWhitespace)).toBe(true)
    // 全空白段：基准 = 整行起点 4000 − 250 − 4000 = −250（而不是 NaN / Infinity）
    for (const char of model.segments[0].chars) expect(char.fadeDelayMs).toBe(-250)
    expect(model.segments[1].chars.map((char) => char.fadeDelayMs)).toEqual([-250, -210, -170])
  })
})

describe('buildTiltLineModel 与 core 的组合（真实切分结果）', () => {
  const CASES: { text: string; timeMs: number }[] = [
    { text: '我爱你，可是你爱他，他却爱着她', timeMs: 12345 },
    { text: 'Hello world, how are you today my friend', timeMs: 60000 },
    { text: '他说「我们走吧」然后就走了', timeMs: 120000 },
    // 组合字素（ZWJ 家庭 emoji）：按 length 切会切碎，按字素切必须还原得一模一样
    { text: '天黑🌃了，回家吧👨‍👩‍👧‍👦宝贝', timeMs: 150000 }
  ]

  it('切分结果的偏移与字素索引严丝合缝：拼接 === 原文，且没有任何字素落在错段', () => {
    for (const { text, timeMs } of CASES) {
      const charCount = text.replace(/\s/g, '').length
      const segments = toLayoutSegments(text, determineLineCount(charCount, timeMs), timeMs)
      const model = buildTiltLineModel({
        source: { text, timeMs, endMs: timeMs + 4000 },
        segments,
        fontPx: FONT_PX,
        clockMs: timeMs
      })
      expect(model.segments.flatMap((s) => s.chars.map((c) => c.char)).join('')).toBe(text)
      // 每段自己的字素拼起来 === 该段文本（偏移错位会让这条先失败）
      for (const segment of model.segments) {
        expect(segment.chars.map((char) => char.char).join('')).toBe(segment.text)
      }
      // 时间轴单调不减，且都在行区间内
      const chars = model.segments.flatMap((segment) => segment.chars)
      let previous = Number.NEGATIVE_INFINITY
      for (const char of chars) {
        expect(char.startTime).toBeGreaterThanOrEqual(previous)
        expect(char.startTime).toBeGreaterThanOrEqual(timeMs)
        expect(char.endTime).toBeLessThanOrEqual(timeMs + 4000)
        previous = char.startTime
      }
    }
  })

  it('倾斜段最多只有一段，波浪位移只出现在它身上', () => {
    for (const { text, timeMs } of CASES) {
      const charCount = text.replace(/\s/g, '').length
      const segments = toLayoutSegments(text, determineLineCount(charCount, timeMs), timeMs)
      const model = buildTiltLineModel({
        source: { text, timeMs, endMs: timeMs + 4000 },
        segments,
        fontPx: FONT_PX,
        clockMs: timeMs
      })
      const tilted = model.segments.filter((segment) => segment.isTilt)
      expect(tilted.length).toBeLessThanOrEqual(1)
      for (const segment of model.segments) {
        const hasWave = segment.chars.some((char: TiltCharModel) => char.wavePx !== 0)
        expect(hasWave).toBe(segment.isTilt)
      }
    }
  })
})
