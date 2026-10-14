import { describe, expect, it } from 'vitest'

import {
  MICRO_LINE_DURATION_THRESHOLD_MS,
  MICRO_LINE_RENDER_FLOOR_MS,
  SHORT_LINE_DURATION_THRESHOLD_MS,
  WORD_LOOKAHEAD_FAST_MS,
  WORD_LOOKAHEAD_INSTANT_MS,
  WORD_LOOKAHEAD_NORMAL_MS,
  buildLineRenderEndTimeMs,
  buildLineRenderHints,
  getLineRenderEndTimeMs,
  getLineRenderHints,
  getLineTransitionTimingMs,
  resolveLineTimingClass,
  resolveLineTransitionMode,
  resolveWordLookaheadMs,
  resolveWordRevealMode,
  type LineRenderHints,
  type RenderHintLineLike
} from './render-hints'

/** 造一行：只填时间字段，`words` / `renderHints` 按需 */
function makeLine(params: {
  startTimeMs: number
  endTimeMs: number
  wordEnds?: number[]
  renderHints?: LineRenderHints
}): RenderHintLineLike {
  return {
    startTimeMs: params.startTimeMs,
    endTimeMs: params.endTimeMs,
    words: params.wordEnds?.map((endTimeMs) => ({ endTimeMs })),
    renderHints: params.renderHints
  }
}

describe('档位阈值（规格书 §4.9 的表格）', () => {
  it('严格小于 100ms 是 micro，100ms 起是 short', () => {
    expect(resolveLineTimingClass(0)).toBe('micro')
    expect(resolveLineTimingClass(MICRO_LINE_DURATION_THRESHOLD_MS - 0.001)).toBe('micro')
    // 边界值本身落进下一档（上游是 `<`，不是 `<=`）
    expect(resolveLineTimingClass(MICRO_LINE_DURATION_THRESHOLD_MS)).toBe('short')
  })

  it('严格小于 180ms 是 short，180ms 起是 normal', () => {
    expect(resolveLineTimingClass(SHORT_LINE_DURATION_THRESHOLD_MS - 0.001)).toBe('short')
    expect(resolveLineTimingClass(SHORT_LINE_DURATION_THRESHOLD_MS)).toBe('normal')
    expect(resolveLineTimingClass(60_000)).toBe('normal')
  })

  it('三档分别映射到 过场档 / 揭示档', () => {
    expect([
      resolveLineTransitionMode('micro'),
      resolveLineTransitionMode('short'),
      resolveLineTransitionMode('normal')
    ]).toEqual(['none', 'fast', 'normal'])
    expect([
      resolveWordRevealMode('micro'),
      resolveWordRevealMode('short'),
      resolveWordRevealMode('normal')
    ]).toEqual(['instant', 'fast', 'normal'])
  })

  it('逐词提前量按揭示档取值（流光用它判 waiting → active）', () => {
    expect(resolveWordLookaheadMs('instant')).toBe(WORD_LOOKAHEAD_INSTANT_MS)
    expect(resolveWordLookaheadMs('fast')).toBe(WORD_LOOKAHEAD_FAST_MS)
    expect(resolveWordLookaheadMs('normal')).toBe(WORD_LOOKAHEAD_NORMAL_MS)
    // 三档必须互不相等，否则「提前亮」的观感会在某一档消失
    expect(
      new Set([WORD_LOOKAHEAD_INSTANT_MS, WORD_LOOKAHEAD_FAST_MS, WORD_LOOKAHEAD_NORMAL_MS]).size
    ).toBe(3)
  })
})

describe('getLineTransitionTimingMs（过场时长三件套）', () => {
  it('none 档全部为 0（极短行不该有任何过场）', () => {
    expect(getLineTransitionTimingMs(50, 'none', 'instant')).toEqual({
      enterDurationMs: 0,
      exitDurationMs: 0,
      linePassHoldMs: 0
    })
    // 即使传 normal 揭示，none 也仍然是全 0（先判过场档）
    expect(getLineTransitionTimingMs(50, 'none', 'normal')).toEqual({
      enterDurationMs: 0,
      exitDurationMs: 0,
      linePassHoldMs: 0
    })
  })

  it('fast 档有 45..60ms 进场地板与 30..40ms 出场地板', () => {
    const tiny = getLineTransitionTimingMs(0, 'fast', 'fast')
    expect(tiny.enterDurationMs).toBe(45)
    expect(tiny.exitDurationMs).toBe(30)
    expect(tiny.linePassHoldMs).toBe(30)

    // 150ms：0.45*150=67.5 → 被 60 上限截断；0.22*150=33 → 落在区间内
    const mid = getLineTransitionTimingMs(150, 'fast', 'fast')
    expect(mid.enterDurationMs).toBe(60)
    expect(mid.exitDurationMs).toBe(33)
  })

  it('fast 档在 instant 揭示时 linePassHold 为 0（字瞬间全亮，没有「最后一个字」可等）', () => {
    const timing = getLineTransitionTimingMs(150, 'fast', 'instant')
    expect(timing.linePassHoldMs).toBe(0)
    // 其余两项与 fast 揭示时一致
    expect(timing.enterDurationMs).toBe(60)
    expect(timing.exitDurationMs).toBe(33)
  })

  it('normal 档的进场 = max(220, max(raw,120)*0.34)，上限 420', () => {
    // 极短（但被判成 normal 的）时长：仍按 120ms 参与缩放 → 40.8 → 地板 220
    expect(getLineTransitionTimingMs(0, 'normal', 'normal').enterDurationMs).toBe(220)
    // 500ms → 170 → 地板 220
    expect(getLineTransitionTimingMs(500, 'normal', 'normal').enterDurationMs).toBe(220)
    // 1000ms → 340
    expect(getLineTransitionTimingMs(1000, 'normal', 'normal').enterDurationMs).toBe(340)
    // 2000ms → 680 → 被 420 上限截断
    expect(getLineTransitionTimingMs(2000, 'normal', 'normal').enterDurationMs).toBe(420)
  })

  it('normal 档的出场 = max(180, max(raw,120)*0.18)，上限 320', () => {
    expect(getLineTransitionTimingMs(500, 'normal', 'normal').exitDurationMs).toBe(180)
    expect(getLineTransitionTimingMs(1000, 'normal', 'normal').exitDurationMs).toBe(180)
    // 1500ms → 270
    expect(getLineTransitionTimingMs(1500, 'normal', 'normal').exitDurationMs).toBe(270)
    // 3000ms → 540 → 被 320 上限截断
    expect(getLineTransitionTimingMs(3000, 'normal', 'normal').exitDurationMs).toBe(320)
  })

  it('normal 档的 linePassHold 是 60ms；instant 揭示时为 0', () => {
    expect(getLineTransitionTimingMs(1000, 'normal', 'normal').linePassHoldMs).toBe(60)
    expect(getLineTransitionTimingMs(1000, 'normal', 'instant').linePassHoldMs).toBe(0)
  })
})

describe('buildLineRenderEndTimeMs（§5.3 与 §17.3 第 7 条的分界）', () => {
  it('micro 行有 67ms 的停留地板', () => {
    // 起止只差 50ms：渲染结束时间被抬到 start + 67
    const shortMicro = makeLine({ startTimeMs: 1000, endTimeMs: 1050 })
    expect(buildLineRenderEndTimeMs(shortMicro, 50, 'none', 'instant')).toBe(
      1000 + MICRO_LINE_RENDER_FLOOR_MS
    )
    // 已经超过地板的 micro 行保持原样（取 max，不把时间往回拉）
    const longMicro = makeLine({ startTimeMs: 1000, endTimeMs: 1090 })
    expect(buildLineRenderEndTimeMs(longMicro, 90, 'none', 'instant')).toBe(1090)
  })

  it('fast 行的出场起点取「进场刚结束 / 拖尾结束 / 行尾之前的出场」三者最大', () => {
    // 150ms 行：enter=60, exit=33, hold=30（fast 揭示）
    const line = makeLine({ startTimeMs: 1000, endTimeMs: 1150 })
    // 拖尾起点 max(1150,1000)+30 = 1180 > 进场刚结束 1070、行尾前出场 1117
    expect(buildLineRenderEndTimeMs(line, 150, 'fast', 'fast')).toBe(1213)
  })

  it('fast + instant 揭示时 hold 为 0，出场起点回落到行尾之前', () => {
    const line = makeLine({ startTimeMs: 1000, endTimeMs: 1150 })
    // 拖尾起点 = 1150，行尾前出场 = 1117，进场刚结束 = 1070 → 取 1150
    expect(buildLineRenderEndTimeMs(line, 150, 'fast', 'instant')).toBe(1150 + 33)
  })

  it('normal 行按 rawDuration 缩放（1000ms → enter 340 / exit 180 / hold 60）', () => {
    const line = makeLine({ startTimeMs: 1000, endTimeMs: 2000 })
    // 拖尾起点 = 2000+60 = 2060；行尾前出场 = 1820 → 2060 + 180
    expect(buildLineRenderEndTimeMs(line, 1000, 'normal', 'normal')).toBe(2240)
  })

  it('最后一个词的结束时间晚于行结束时，拖尾从词尾算起', () => {
    const line = makeLine({ startTimeMs: 1000, endTimeMs: 2000, wordEnds: [1800, 2100] })
    // 拖尾起点 = 2100+60 = 2160 → 2160 + 180
    expect(buildLineRenderEndTimeMs(line, 1000, 'normal', 'normal')).toBe(2340)
  })

  it('短 normal 行（190ms）也会被撑到 430ms 的可见窗口', () => {
    const line = makeLine({ startTimeMs: 0, endTimeMs: 190 })
    // enter=220（地板）、exit=180（地板）、hold=60 → 190+60+180
    expect(buildLineRenderEndTimeMs(line, 190, 'normal', 'normal')).toBe(430)
  })

  it('渲染结束时间永远不早于行结束时间', () => {
    // 行结束早于「行尾前出场」时，靠最后的 max 兜住
    const line = makeLine({ startTimeMs: 0, endTimeMs: 100 })
    expect(buildLineRenderEndTimeMs(line, 100, 'normal', 'normal')).toBeGreaterThanOrEqual(100)
    expect(buildLineRenderEndTimeMs(line, 100, 'none', 'instant')).toBeGreaterThanOrEqual(100)
  })
})

describe('buildLineRenderHints / getLineRenderHints / getLineRenderEndTimeMs', () => {
  it('一次性算出的四个派生量彼此自洽', () => {
    const hints = buildLineRenderHints(makeLine({ startTimeMs: 1000, endTimeMs: 1150 }))
    expect(hints.rawDurationMs).toBe(150)
    expect(hints.timingClass).toBe('short')
    expect(hints.lineTransitionMode).toBe('fast')
    expect(hints.wordRevealMode).toBe('fast')
    expect(hints.renderEndTimeMs).toBe(1213)
  })

  it('反向区间（end < start）的 rawDuration 按 0 处理', () => {
    const hints = buildLineRenderHints(makeLine({ startTimeMs: 5000, endTimeMs: 4000 }))
    expect(hints.rawDurationMs).toBe(0)
    expect(hints.timingClass).toBe('micro')
    // micro 的停留地板仍然生效
    expect(hints.renderEndTimeMs).toBe(5000 + MICRO_LINE_RENDER_FLOOR_MS)
  })

  it('已经烘好的 renderHints 优先，不被现算覆盖', () => {
    const baked: LineRenderHints = {
      rawDurationMs: 123,
      timingClass: 'short',
      renderEndTimeMs: 999_999,
      lineTransitionMode: 'fast',
      wordRevealMode: 'fast'
    }
    const line = makeLine({ startTimeMs: 0, endTimeMs: 4000, renderHints: baked })
    expect(getLineRenderHints(line)).toBe(baked)
    expect(getLineRenderEndTimeMs(line)).toBe(999_999)
  })

  it('没有烘好的提示时现算（与 buildLineRenderHints 同值）', () => {
    const line = makeLine({ startTimeMs: 0, endTimeMs: 2000 })
    expect(getLineRenderEndTimeMs(line)).toBe(buildLineRenderHints(line).renderEndTimeMs)
  })

  it('空行：hints 为 null，结束时间为 -Infinity（0 会让「最后一块」判定在开头就成立）', () => {
    expect(getLineRenderHints(null)).toBeNull()
    expect(getLineRenderHints(undefined)).toBeNull()
    expect(getLineRenderEndTimeMs(null)).toBe(Number.NEGATIVE_INFINITY)
    expect(getLineRenderEndTimeMs(undefined)).toBe(Number.NEGATIVE_INFINITY)
  })
})
