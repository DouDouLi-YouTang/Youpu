import { describe, expect, it } from 'vitest'
import {
  AFTERGLOW_FLOOR,
  clampPulseDuration,
  getCharPulseIntensity,
  getCharPulseScale
} from './core/char-pulse'
import {
  AFTERGLOW_RAMP_FACTOR,
  CHAR_FADE_DELAY_MS,
  CHAR_FADE_DURATION_MS,
  FALLBACK_LINE_DURATION_MS,
  LINE_HEIGHT_PLAIN,
  LINE_HEIGHT_TILT,
  PLAIN_PULSE_SCALE,
  PLAIN_SCALE_FLOOR,
  PULSE_MAX_DURATION_MS,
  PULSE_MIN_DURATION_MS,
  PULSE_TOTAL_FACTOR,
  resolveAvailableWidth,
  resolveBaseFontPx,
  resolveHeightScale,
  resolveLineEndMs,
  resolveOverflowScale,
  resolvePulseAnimationMs,
  resolveSegmentGapPx,
  resolveSegmentGapTotalPx,
  resolveTextHeightPx,
  SEEK_JUMP_MS,
  SEGMENT_GAP_MAX_PX,
  SEGMENT_GAP_MIN_PX,
  SEGMENT_LEAD_MS,
  SHORT_LAST_SEGMENT_SCALE,
  shouldResplit,
  TILT_CHAR_FADE_DELAY_MS,
  TILT_FONT_SCALE,
  TILT_PULSE_SCALE,
  toWordSpans
} from './tilt-adapter'

describe('秒 → 毫秒换算只发生在适配层（笔记 §5–§7 的阈值）', () => {
  it('常量就是笔记里的秒值乘 1000', () => {
    expect(SEGMENT_LEAD_MS).toBe(250)
    expect(CHAR_FADE_DELAY_MS).toBe(40)
    expect(TILT_CHAR_FADE_DELAY_MS).toBe(50)
    expect(PULSE_MIN_DURATION_MS).toBe(200)
    expect(PULSE_MAX_DURATION_MS).toBe(900)
    expect(FALLBACK_LINE_DURATION_MS).toBe(5000)
    // 淡入动画时长是笔记没给的取值（0.4s），锁住它：改这里就要同步改 keyframes 的默认值
    expect(CHAR_FADE_DURATION_MS).toBe(400)
  })

  it('脉冲总时长系数与 core 的余晖升起系数一致（1 + 1.2）', () => {
    expect(PULSE_TOTAL_FACTOR).toBe(1 + AFTERGLOW_RAMP_FACTOR)
    // core 的余晖升起段正好在 progress = PULSE_TOTAL_FACTOR 处走完并落到地板
    expect(getCharPulseIntensity(PULSE_TOTAL_FACTOR)).toBe(AFTERGLOW_FLOOR)
    expect(getCharPulseIntensity(PULSE_TOTAL_FACTOR - 1e-6)).toBeLessThan(AFTERGLOW_FLOOR)
    expect(getCharPulseIntensity(PULSE_TOTAL_FACTOR + 1e-6)).toBe(AFTERGLOW_FLOOR)
  })

  it('峰值系数与 core 的 getCharPulseScale 一致（倾斜 0.18 / 非倾斜 0.15）', () => {
    expect(getCharPulseScale(1, true)).toBeCloseTo(1 + TILT_PULSE_SCALE, 10)
    expect(getCharPulseScale(1, false)).toBeCloseTo(1 + PLAIN_PULSE_SCALE, 10)
  })

  it('seek 判定阈值要远大于正常播放的观测步长（4Hz × 最高 1.5 倍速 ≈ 375ms）', () => {
    expect(SEEK_JUMP_MS).toBeGreaterThan(375 * 2)
  })
})

describe('resolveLineEndMs 行结束时间推算（笔记 §8.1.1）', () => {
  it('有下一行 → 用下一行起点', () => {
    expect(resolveLineEndMs({ timeMs: 1000 }, { timeMs: 3500 }, 200000)).toBe(3500)
  })

  it('最后一行 → 用播放时长兜底', () => {
    expect(resolveLineEndMs({ timeMs: 1000 }, null, 180000)).toBe(180000)
    expect(resolveLineEndMs({ timeMs: 1000 }, undefined, 180000)).toBe(180000)
  })

  it('最后一行但时长未知（0 / NaN）→ 固定 5 秒', () => {
    expect(resolveLineEndMs({ timeMs: 1000 }, null, 0)).toBe(6000)
    expect(resolveLineEndMs({ timeMs: 1000 }, null, Number.NaN)).toBe(6000)
  })

  it('下一行时间戳乱序（早于本行）→ 不产生负长度，退到兜底', () => {
    expect(resolveLineEndMs({ timeMs: 5000 }, { timeMs: 4000 }, 9000)).toBe(9000)
    expect(resolveLineEndMs({ timeMs: 5000 }, { timeMs: 5000 }, 0)).toBe(10000)
  })

  it('播放时长刚好等于行起点也算不可用（否则行时长为 0）', () => {
    expect(resolveLineEndMs({ timeMs: 5000 }, null, 5000)).toBe(10000)
  })
})

describe('toWordSpans 词级时间戳适配（笔记 §8.1）', () => {
  it('没有 words / 空数组 → null（调用方退化为整行均匀分配）', () => {
    expect(toWordSpans(undefined, 'abc')).toBeNull()
    expect(toWordSpans([], 'abc')).toBeNull()
  })

  it('词文本拼接与行文本不一致 → null（硬用会让字素与段对不上号）', () => {
    expect(toWordSpans([{ word: 'ab', timeMs: 0, durationMs: 100 }], 'ac')).toBeNull()
  })

  it('正常路径：毫秒原样透传，文本按词切好', () => {
    const spans = toWordSpans(
      [
        { word: '我', timeMs: 1000, durationMs: 200 },
        { word: '爱', timeMs: 1200, durationMs: 300 }
      ],
      '我爱'
    )
    expect(spans).toEqual([
      { text: '我', startTime: 1000, endTime: 1200 },
      { text: '爱', startTime: 1200, endTime: 1500 }
    ])
  })

  it('起点乱序 → 单调化；时长为负/非有限 → 记 0 长度', () => {
    const spans = toWordSpans(
      [
        { word: 'a', timeMs: 1000, durationMs: Number.NaN },
        { word: 'b', timeMs: 900, durationMs: 100 },
        { word: 'c', timeMs: 1300, durationMs: -50 }
      ],
      'abc'
    )
    expect(spans).toEqual([
      { text: 'a', startTime: 1000, endTime: 1000 },
      { text: 'b', startTime: 1000, endTime: 1100 },
      { text: 'c', startTime: 1300, endTime: 1300 }
    ])
  })
})

describe('resolvePulseAnimationMs 逐字脉冲动画时长（笔记 §6）', () => {
  it('时长钳到 [0.2s, 0.9s] 后再乘总系数（含余晖升起段）', () => {
    expect(resolvePulseAnimationMs(0, 300)).toBeCloseTo(300 * PULSE_TOTAL_FACTOR, 10)
    expect(resolvePulseAnimationMs(0, 100)).toBeCloseTo(
      PULSE_MIN_DURATION_MS * PULSE_TOTAL_FACTOR,
      10
    )
    expect(resolvePulseAnimationMs(0, 5000)).toBeCloseTo(
      PULSE_MAX_DURATION_MS * PULSE_TOTAL_FACTOR,
      10
    )
  })

  it('退化输入（倒序 / 零长 / NaN）→ 均按最小时长处理，绝不产生负动画时长', () => {
    const min = PULSE_MIN_DURATION_MS * PULSE_TOTAL_FACTOR
    expect(resolvePulseAnimationMs(900, 500)).toBeCloseTo(min, 10)
    expect(resolvePulseAnimationMs(500, 500)).toBeCloseTo(min, 10)
    expect(resolvePulseAnimationMs(Number.NaN, 900)).toBeCloseTo(min, 10)
    expect(clampPulseDuration(Number.NaN, PULSE_MIN_DURATION_MS, PULSE_MAX_DURATION_MS)).toBe(
      PULSE_MIN_DURATION_MS
    )
  })
})

describe('resolveBaseFontPx clamp(3.125rem, 6.875vw, 5.625rem)（笔记 §4）', () => {
  it('宽窗口取上界 5.625rem = 90px', () => {
    expect(resolveBaseFontPx(1920, 16)).toBeCloseTo(90, 10)
    expect(resolveBaseFontPx(1310, 16)).toBeCloseTo(90, 10)
  })

  it('中间区间按 6.875vw 走', () => {
    expect(resolveBaseFontPx(1280, 16)).toBeCloseTo(88, 10)
    expect(resolveBaseFontPx(1000, 16)).toBeCloseTo(68.75, 10)
  })

  it('窄窗口取下界 3.125rem = 50px', () => {
    expect(resolveBaseFontPx(700, 16)).toBeCloseTo(50, 10)
    expect(resolveBaseFontPx(300, 16)).toBeCloseTo(50, 10)
  })

  it('rem 非法（0 / NaN / 负数）→ 按 16px 兜底，绝不返回 NaN 或 0', () => {
    expect(resolveBaseFontPx(1280, 0)).toBeCloseTo(88, 10)
    expect(resolveBaseFontPx(1280, Number.NaN)).toBeCloseTo(88, 10)
    expect(resolveBaseFontPx(1280, -4)).toBeCloseTo(88, 10)
  })

  it('视口宽度非法 → 取下界（宁可小，不可消失）', () => {
    expect(resolveBaseFontPx(Number.NaN, 16)).toBeCloseTo(50, 10)
    expect(resolveBaseFontPx(0, 16)).toBeCloseTo(50, 10)
  })
})

describe('TILT_FONT_SCALE 固定字号倍率', () => {
  it('恒为 1 —— 倾诉不读设置里的「字体大小」（2026-10-11 用户定：倾诉没有设置）', () => {
    expect(TILT_FONT_SCALE).toBe(1)
  })
})

describe('resolveAvailableWidth 可用宽度（笔记 §3）', () => {
  it('面板够宽 → 就是 0.85 × 视口', () => {
    expect(resolveAvailableWidth(1920, 0)).toBeCloseTo(1632, 10)
    expect(resolveAvailableWidth(1000, 2000)).toBeCloseTo(850, 10)
  })

  it('面板更窄（封面可见 / 歌词区留白）→ 收紧到面板宽度', () => {
    expect(resolveAvailableWidth(1920, 900)).toBe(900)
  })

  it('拿不到视口宽度 → 退化为面板宽度', () => {
    expect(resolveAvailableWidth(0, 800)).toBe(800)
    expect(resolveAvailableWidth(Number.NaN, 800)).toBe(800)
  })
})

describe('溢出决策（笔记 §3）', () => {
  it('溢出比 ≥ 1.6 才重切', () => {
    expect(shouldResplit(1.0)).toBe(false)
    expect(shouldResplit(1.599)).toBe(false)
    expect(shouldResplit(1.6)).toBe(true)
    expect(shouldResplit(3)).toBe(true)
    expect(shouldResplit(Number.NaN)).toBe(false)
  })

  it('未溢出不放大；溢出按比例缩小', () => {
    expect(resolveOverflowScale(0.5, false)).toBe(1)
    expect(resolveOverflowScale(1, false)).toBe(1)
    expect(resolveOverflowScale(1.25, false)).toBeCloseTo(0.8, 10)
  })

  it('缩放下限：倾斜段 0.5 / 非倾斜段 0.55', () => {
    expect(resolveOverflowScale(4, true)).toBe(0.5)
    expect(resolveOverflowScale(4, false)).toBe(0.55)
    expect(resolveOverflowScale(1.8, true)).toBeCloseTo(1 / 1.8, 10)
  })

  it('非法溢出比 → 不缩放', () => {
    expect(resolveOverflowScale(Number.NaN, true)).toBe(1)
    expect(resolveOverflowScale(Number.POSITIVE_INFINITY, false)).toBe(1)
  })
})

describe('resolveSegmentGapPx 段间距（与 tilt-line.scss 的 gap 同源）', () => {
  it('clamp(6px, 1.4vh, 20px)', () => {
    // 1.4vh：720 高 = 10.08，1440 高 = 20.16 → 撞上界 20
    expect(resolveSegmentGapPx(720)).toBeCloseTo(10.08, 10)
    expect(resolveSegmentGapPx(1440)).toBe(SEGMENT_GAP_MAX_PX)
    // 矮窗口撞下界 6
    expect(resolveSegmentGapPx(300)).toBe(SEGMENT_GAP_MIN_PX)
    expect(resolveSegmentGapPx(0)).toBe(SEGMENT_GAP_MIN_PX)
  })

  it('非法视口高度 → 取下界，绝不返回 NaN（NaN 写进 calc 会让整块歌词消失）', () => {
    expect(resolveSegmentGapPx(Number.NaN)).toBe(SEGMENT_GAP_MIN_PX)
    expect(resolveSegmentGapPx(-100)).toBe(SEGMENT_GAP_MIN_PX)
  })
})

describe('resolveTextHeightPx 各段文字高度之和', () => {
  it('单段按各自行高：普通段 1.35、倾斜段 1.25', () => {
    expect(
      resolveTextHeightPx({ segmentCount: 1, fontPx: 100, shortLast: false, tiltIndex: null })
    ).toBeCloseTo(LINE_HEIGHT_PLAIN * 100, 10)
    expect(
      resolveTextHeightPx({ segmentCount: 1, fontPx: 100, shortLast: false, tiltIndex: 0 })
    ).toBeCloseTo(LINE_HEIGHT_TILT * 100, 10)
  })

  it('多段相加，倾斜段只影响自己那一段', () => {
    const height = resolveTextHeightPx({
      segmentCount: 3,
      fontPx: 100,
      shortLast: false,
      tiltIndex: 1
    })
    expect(height).toBeCloseTo(
      LINE_HEIGHT_PLAIN * 100 + LINE_HEIGHT_TILT * 100 + LINE_HEIGHT_PLAIN * 100,
      10
    )
  })

  it('末段过短补偿让最后一段按 1.18 倍字号算高', () => {
    const normal = resolveTextHeightPx({
      segmentCount: 2,
      fontPx: 100,
      shortLast: false,
      tiltIndex: null
    })
    const short = resolveTextHeightPx({
      segmentCount: 2,
      fontPx: 100,
      shortLast: true,
      tiltIndex: null
    })
    expect(short - normal).toBeCloseTo(LINE_HEIGHT_PLAIN * 100 * (SHORT_LAST_SEGMENT_SCALE - 1), 10)
  })

  it('退化输入返回 0（调用方据此跳过缩放，而不是算出个负数）', () => {
    expect(
      resolveTextHeightPx({ segmentCount: 0, fontPx: 100, shortLast: false, tiltIndex: null })
    ).toBe(0)
    expect(
      resolveTextHeightPx({ segmentCount: 2, fontPx: 0, shortLast: false, tiltIndex: null })
    ).toBe(0)
    expect(
      resolveTextHeightPx({
        segmentCount: 2,
        fontPx: Number.NaN,
        shortLast: false,
        tiltIndex: null
      })
    ).toBe(0)
  })
})

describe('resolveSegmentGapTotalPx 段间距总和', () => {
  it('n 段有 n-1 个间距；0/1 段没有间距', () => {
    expect(resolveSegmentGapTotalPx(1, 720)).toBe(0)
    expect(resolveSegmentGapTotalPx(0, 720)).toBe(0)
    expect(resolveSegmentGapTotalPx(3, 720)).toBeCloseTo(2 * resolveSegmentGapPx(720), 10)
  })
})

describe('resolveHeightScale 纵向溢出缩放', () => {
  it('放得下 → 1（绝不放大）', () => {
    expect(resolveHeightScale(400, 0, 500, 0.5)).toBe(1)
    expect(resolveHeightScale(500, 0, 500, 0.5)).toBe(1)
  })

  it('放不下 → 按「可给文字的高度 / 文字高度」缩，而不是按总高比', () => {
    // 文字 600 + 间距 100 vs 可用 400：可用里扣掉间距只剩 300
    // 正确：300/600 = 0.5；错误写法（总高比）：400/700 ≈ 0.571
    expect(resolveHeightScale(600, 100, 400, 0.5)).toBeCloseTo(0.5, 10)
    // 刚好放得下（文字 300 + 间距 100 = 400）→ 不动
    expect(resolveHeightScale(300, 100, 400, 0.5)).toBe(1)
    expect(resolveHeightScale(700, 100, 400, 0.2)).toBeCloseTo(300 / 700, 10)
  })

  it('缩放下限生效（本项目传横向同款：倾斜 0.5 / 无倾斜 0.55）', () => {
    expect(resolveHeightScale(5000, 100, 400, 0.5)).toBe(0.5)
    expect(resolveHeightScale(5000, 100, 400, PLAIN_SCALE_FLOOR)).toBe(PLAIN_SCALE_FLOOR)
  })

  it('间距就把可用高度吃满 → 直接落到地板（不能再缩了）', () => {
    expect(resolveHeightScale(600, 500, 400, 0.5)).toBe(0.5)
    expect(resolveHeightScale(600, 400, 400, 0.55)).toBe(0.55)
  })

  it('非法输入 → 不缩放（宁可有点裁切，也不能让字号变 NaN）', () => {
    expect(resolveHeightScale(Number.NaN, 0, 400, 0.5)).toBe(1)
    expect(resolveHeightScale(600, 0, 0, 0.5)).toBe(1)
    expect(resolveHeightScale(600, 0, Number.NaN, 0.5)).toBe(1)
  })

  it('非法 / 越界 floor 退化为 1（不缩），避免系数放大字号', () => {
    expect(resolveHeightScale(5000, 0, 400, Number.NaN)).toBe(1)
    expect(resolveHeightScale(5000, 0, 400, 0)).toBe(1)
    expect(resolveHeightScale(5000, 0, 400, 2)).toBe(1)
    expect(resolveHeightScale(5000, 0, 400, -1)).toBe(1)
  })

  it('缩放结果恒在 (0, 1] 内（不会放大）', () => {
    for (const text of [100, 400, 900, 4000]) {
      for (const avail of [200, 500, 1200]) {
        const scale = resolveHeightScale(text, 12, avail, 0.5)
        expect(scale).toBeGreaterThan(0)
        expect(scale).toBeLessThanOrEqual(1)
      }
    }
  })
})
