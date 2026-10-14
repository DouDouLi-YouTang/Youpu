/**
 * 文本测量层的 DOM / pretext 接线单测（规格书 §4.7 / §4.8 / §4.10）。
 *
 * `text-measure-pure.ts` 已经把无 DOM 的换算全部测掉了，这里只需要钉住两件事：
 *
 * 1. **canvas 逐前缀测量**：无 DOM 时退化成「长度正确、内容全 0」，有 DOM 时
 *    逐前缀量宽 + 走有界缓存（同一键第二次必须是同一个数组引用，否则缓存白建）；
 * 2. **字号二分**：pretext 被换成一个「每字素 1em 宽」的假实现 —— 于是
 *    「这一行还塞不塞得进」变成一个可以手算的判据，二分收敛点也能精确写出来
 *    （全放得下 → 逼近上界；一个都放不下 → 退到最小字号 × 三个倍率）。
 *
 * 假 pretext 必须**记下**它收到的 font string 与 lineHeight，否则「行高取整」
 * 这类只差几像素的细节在单测里根本看不见。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 假 pretext 的状态：每次调用的入参都留档，供断言反查 */
const spy = vi.hoisted(() => ({
  fonts: [] as string[],
  lineHeights: [] as number[]
}))

/**
 * 假 pretext：宽度 = 字素数 × 字号（每个字素占 1em），行数按宽度取整。
 *
 * 用「字素数」而不是 `text.length`：CJK 与 emoji 都是单字素多码元，
 * 用 UTF-16 长度会让测试里的期望值跟真实测量口径对不上。
 */
vi.mock('@chenglou/pretext', () => ({
  prepareWithSegments: (text: string, font: string) => {
    spy.fonts.push(font)
    const match = /(\d+(?:\.\d+)?)px/.exec(font)
    const fontPx = match ? Number(match[1]) : 0
    const graphemeCount = [...text].length
    return {
      segments: [text],
      widths: [graphemeCount * fontPx],
      breakableFitAdvances: [new Array<number>(graphemeCount).fill(fontPx)]
    }
  },
  layoutWithLines: (prepared: { widths: number[] }, maxWidth: number, lineHeight: number) => {
    spy.lineHeights.push(lineHeight)
    const width = prepared.widths[0] ?? 0
    const lineCount = Math.max(Math.ceil(width / maxWidth), 1)
    return {
      lineCount,
      height: lineCount * lineHeight,
      lines: [
        {
          text: '',
          width: Math.min(width, maxWidth),
          start: { segmentIndex: 0, graphemeIndex: 0 },
          end: { segmentIndex: 0, graphemeIndex: 0 }
        }
      ]
    }
  }
}))

import {
  FUME_BODY_FONT_PX_RANGE,
  FUME_BODY_FONT_WEIGHT,
  FUME_HERO_FONT_PX_RANGE,
  FUME_HERO_FONT_WEIGHT,
  buildFontSpec,
  buildPreparedSingleLine,
  clearSegmentMeasureCache,
  measureSegmentGlyphOffsets,
  normalizeFontWeight,
  resolveThemeFontWeight
} from './text-measure'

/** 假 canvas 上下文：只实现被用到的 `font` 与 `measureText`（每字符 10px） */
function makeCanvasStub(): {
  canvas: { getContext: (kind: string) => unknown }
  context: { font: string; measureText: (text: string) => { width: number } }
} {
  const context = {
    font: '',
    measureText: (text: string): { width: number } => ({ width: text.length * 10 })
  }
  return {
    canvas: { getContext: (kind: string) => (kind === '2d' ? context : null) },
    context
  }
}

describe('normalizeFontWeight / resolveThemeFontWeight（§4.8）', () => {
  it('钳到 100..900 并四舍五入到 10 的倍数', () => {
    expect(normalizeFontWeight(500)).toBe(500)
    expect(normalizeFontWeight(765)).toBe(770)
    expect(normalizeFontWeight(50)).toBe(100)
    expect(normalizeFontWeight(1000)).toBe(900)
  })

  it('非数字 / NaN / Infinity 一律 null（交给档位默认值）', () => {
    expect(normalizeFontWeight('500')).toBeNull()
    expect(normalizeFontWeight(Number.NaN)).toBeNull()
    expect(normalizeFontWeight(Number.POSITIVE_INFINITY)).toBeNull()
    expect(normalizeFontWeight(undefined)).toBeNull()
  })

  it('主题没给字重时用传进来的档位默认值', () => {
    expect(resolveThemeFontWeight(null, FUME_HERO_FONT_WEIGHT)).toBe(FUME_HERO_FONT_WEIGHT)
    expect(resolveThemeFontWeight({}, FUME_BODY_FONT_WEIGHT)).toBe(FUME_BODY_FONT_WEIGHT)
    expect(resolveThemeFontWeight({ fontWeight: 830 }, FUME_BODY_FONT_WEIGHT)).toBe(830)
  })
})

describe('buildFontSpec（§4.8）', () => {
  it('hero / body 的默认字重分别是 780 / 640', () => {
    expect(buildFontSpec(32, 'hero', 'serif', null)).toBe('780 32px serif')
    expect(buildFontSpec(16, 'body', 'serif', null)).toBe('640 16px serif')
  })

  it('主题给字重时覆盖档位默认值', () => {
    expect(buildFontSpec(32, 'hero', '"Folia Noto Serif SC"', { fontWeight: 900 })).toBe(
      '900 32px "Folia Noto Serif SC"'
    )
  })
})

describe('measureSegmentGlyphOffsets（§4.7）', () => {
  beforeEach(() => {
    clearSegmentMeasureCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    clearSegmentMeasureCache()
  })

  it('无 DOM 时返回「长度 = 字素数 + 1」的全 0 数组（不是抛错）', () => {
    vi.stubGlobal('document', undefined)

    expect(measureSegmentGlyphOffsets('abc', '500 20px serif')).toEqual([0, 0, 0, 0])
    expect(measureSegmentGlyphOffsets('👨‍👩‍👧x', '500 20px serif')).toEqual([0, 0, 0])
  })

  it('有 DOM 时逐前缀量宽，并每次都设置 context.font', () => {
    const stub = makeCanvasStub()
    vi.stubGlobal('document', { createElement: () => stub.canvas })

    expect(measureSegmentGlyphOffsets('abc', '500 20px serif')).toEqual([0, 10, 20, 30])
    expect(stub.context.font).toBe('500 20px serif')
  })

  it('同一 (文本, 字体串) 第二次命中缓存，返回同一个数组引用', () => {
    const stub = makeCanvasStub()
    vi.stubGlobal('document', { createElement: () => stub.canvas })

    const first = measureSegmentGlyphOffsets('abc', '500 20px serif')
    const second = measureSegmentGlyphOffsets('abc', '500 20px serif')

    expect(second).toBe(first)
  })

  it('不同字体串是不同的缓存键（字号变了就要重新量）', () => {
    const stub = makeCanvasStub()
    vi.stubGlobal('document', { createElement: () => stub.canvas })

    const small = measureSegmentGlyphOffsets('abc', '500 20px serif')
    const large = measureSegmentGlyphOffsets('abc', '500 40px serif')

    expect(large).not.toBe(small)
  })

  it('清空缓存后重新测量（字体文件到位后必须走这条）', () => {
    const stub = makeCanvasStub()
    vi.stubGlobal('document', { createElement: () => stub.canvas })

    const before = measureSegmentGlyphOffsets('abc', '500 20px serif')
    clearSegmentMeasureCache()
    const after = measureSegmentGlyphOffsets('abc', '500 20px serif')

    expect(after).not.toBe(before)
    expect(after).toEqual(before)
  })

  it('拿不到 2d context 时同样退回全 0（长度仍然正确）', async () => {
    // 模块级 canvas 在这条用例之前已经被建出来了，必须重新加载模块才拿得到这条分支
    vi.resetModules()
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) })
    const fresh = await import('./text-measure')

    expect(fresh.measureSegmentGlyphOffsets('ab', '500 20px serif')).toEqual([0, 0, 0])
  })
})

describe('buildPreparedSingleLine（§4.10 字号二分）', () => {
  beforeEach(() => {
    spy.fonts.length = 0
    spy.lineHeights.length = 0
  })

  it('宽度足够时二分逼近上界（8 次迭代后 low = 58 - 40 / 256）', () => {
    const result = buildPreparedSingleLine('ab', 'serif', 100000, 'hero', 1, 1, 1, null)

    expect(result.fontPx).toBeCloseTo(58 - 40 / 256, 10)
    expect(result.fontPx).toBeLessThan(FUME_HERO_FONT_PX_RANGE.high)
    expect(result.fontPx).toBeGreaterThan(FUME_HERO_FONT_PX_RANGE.low)
    expect(result.layout.lineCount).toBe(1)
  })

  it('一个都放不下时退到最小字号（再乘三个倍率）', () => {
    const result = buildPreparedSingleLine('abcdefghij', 'serif', 10, 'body', 1, 1, 1, null)

    expect(result.fontPx).toBe(FUME_BODY_FONT_PX_RANGE.low)
    expect(result.layout.lineCount).toBeGreaterThan(1)
  })

  it('收敛点是「区间内还塞得进的最大字号」：2 字素 / 40px 宽 → 精确落在 20', () => {
    // 宽度 = 2 × fontPx ≤ 40 → 边界 20 正好落在 [10,30] 内部；
    // 二分第一步就命中 20，之后全部偏高被拒，所以 best 停留在 20（不是 20 + ε）
    const result = buildPreparedSingleLine('ab', 'serif', 40, 'body', 1, 1, 1, null)

    expect(result.fontPx).toBe(20)
  })

  it('lyricsFontScale / densityScale / heroScale 只参与候选字号，不参与搜索区间', () => {
    const result = buildPreparedSingleLine('ab', 'serif', 100000, 'hero', 0.5, 2, 1.5, null)

    expect(result.fontPx).toBeCloseTo((58 - 40 / 256) * 0.5 * 2 * 1.5, 10)
  })

  it('body 的搜索区间是 10..30（与 hero 的 18..58 不同）', () => {
    const result = buildPreparedSingleLine('ab', 'serif', 100000, 'body', 1, 1, 1, null)

    expect(result.fontPx).toBeCloseTo(30 - (30 - 10) / 256, 10)
    expect(result.fontPx).toBeGreaterThan(FUME_BODY_FONT_PX_RANGE.low)
  })

  it('行高取整，且 hero / body 用不同系数（1.02 / 1.06）', () => {
    buildPreparedSingleLine('ab', 'serif', 100, 'hero', 1, 1, 1, null)
    const heroLineHeights = [...spy.lineHeights]
    const heroFonts = [...spy.fonts]

    spy.fonts.length = 0
    spy.lineHeights.length = 0

    buildPreparedSingleLine('ab', 'serif', 100, 'body', 1, 1, 1, null)
    const bodyLineHeights = [...spy.lineHeights]
    const bodyFonts = [...spy.fonts]

    expect(heroLineHeights).toHaveLength(8)
    expect(bodyLineHeights).toHaveLength(8)

    heroLineHeights.forEach((lineHeight, index) => {
      const fontPx = Number(/(\d+(?:\.\d+)?)px/.exec(heroFonts[index])?.[1] ?? 0)
      expect(lineHeight).toBe(Math.round(fontPx * 1.02))
    })
    bodyLineHeights.forEach((lineHeight, index) => {
      const fontPx = Number(/(\d+(?:\.\d+)?)px/.exec(bodyFonts[index])?.[1] ?? 0)
      expect(lineHeight).toBe(Math.round(fontPx * 1.06))
    })
  })
})
