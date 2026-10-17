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
  prepareCalls: 0,
  measurePrepareCalls: 0,
  layoutCalls: 0,
  layoutWithLinesCalls: 0,
  fonts: [] as string[],
  layoutFonts: [] as string[],
  lineHeights: [] as number[]
}))

/**
 * 假 pretext：宽度 = 字素数 × 字号（每个字素占 1em），行数按宽度取整。
 *
 * 用「字素数」而不是 `text.length`：CJK 与 emoji 都是单字素多码元，
 * 用 UTF-16 长度会让测试里的期望值跟真实测量口径对不上。
 *
 * 四个导出各记一个计数器：`prepare` / `prepareWithSegments` 分开记，是为了钉住
 * 「测量路径用 `prepare`、渲染路径用 `prepareWithSegments`」这条接线；
 * `layout` / `layoutWithLines` 分开记，是为了钉住「宽度模型答得出来时一次真测量都不做」。
 */
vi.mock('@chenglou/pretext', () => {
  const createPrepared = (text: string, font: string, withSegments: boolean) => {
    const match = /(\d+(?:\.\d+)?)px/.exec(font)
    const fontPx = match ? Number(match[1]) : 0
    const graphemeCount = [...text].length
    const prepared: Record<string, unknown> = {
      font,
      widths: [graphemeCount * fontPx],
      kinds: ['text'],
      chunks: [{ startSegmentIndex: 0, endSegmentIndex: 1, consumedEndSegmentIndex: 1 }],
      simpleLineWalkFastPath: true,
      breakableFitAdvances: [new Array<number>(graphemeCount).fill(fontPx)]
    }
    if (withSegments) prepared.segments = [text]
    return prepared
  }

  const lineCountFor = (prepared: { widths: number[] }, maxWidth: number): number =>
    Math.max(Math.ceil((prepared.widths[0] ?? 0) / maxWidth), 1)

  return {
    prepare: (text: string, font: string) => {
      spy.measurePrepareCalls += 1
      spy.fonts.push(font)
      return createPrepared(text, font, false)
    },
    prepareWithSegments: (text: string, font: string) => {
      spy.prepareCalls += 1
      spy.fonts.push(font)
      return createPrepared(text, font, true)
    },
    layout: (prepared: { widths: number[] }, maxWidth: number, lineHeight: number) => {
      spy.layoutCalls += 1
      spy.layoutFonts.push(String((prepared as { font?: string }).font ?? ''))
      spy.lineHeights.push(lineHeight)
      const lineCount = lineCountFor(prepared, maxWidth)
      return { lineCount, height: lineCount * lineHeight }
    },
    layoutWithLines: (prepared: { widths: number[] }, maxWidth: number, lineHeight: number) => {
      spy.layoutWithLinesCalls += 1
      spy.layoutFonts.push(String((prepared as { font?: string }).font ?? ''))
      spy.lineHeights.push(lineHeight)
      const width = prepared.widths[0] ?? 0
      const lineCount = lineCountFor(prepared, maxWidth)
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
  }
})

import {
  FUME_BODY_FONT_PX_RANGE,
  FUME_BODY_FONT_WEIGHT,
  FUME_HERO_FONT_PX_RANGE,
  FUME_HERO_FONT_WEIGHT,
  buildFontSpec,
  buildMeasuredSingleLine,
  buildPreparedSingleLine,
  clearSegmentMeasureCache,
  measureSegmentGlyphOffsets,
  normalizeFontWeight,
  resolveFumeFontFamily,
  resolveThemeFontWeight
} from './text-measure'

/** 清空测量缓存与全部计数器：每条用例都从「冷启动」开始，计数才有可比性 */
function resetSpies(): void {
  clearSegmentMeasureCache()
  spy.prepareCalls = 0
  spy.measurePrepareCalls = 0
  spy.layoutCalls = 0
  spy.layoutWithLinesCalls = 0
  spy.fonts.length = 0
  spy.layoutFonts.length = 0
  spy.lineHeights.length = 0
}

/** 从字体串里取字号（`780 32px serif` → 32） */
function fontPxFromSpec(fontSpec: string): number {
  return Number(/(\d+(?:\.\d+)?)px/.exec(fontSpec)?.[1] ?? 0)
}

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

describe('resolveFumeFontFamily（§7.7 的 resolveThemeFontStack 位置）', () => {
  it('没有自定义族时是「内置衬线族 + 该档位的通用兜底族」', () => {
    expect(resolveFumeFontFamily({ name: 't', fontStyle: 'serif' })).toBe(
      '"Folia Noto Serif SC", serif'
    )
    expect(resolveFumeFontFamily({ name: 't', fontStyle: 'sans' })).toBe(
      '"Folia Noto Serif SC", system-ui, sans-serif'
    )
    expect(resolveFumeFontFamily({ name: 't', fontStyle: 'mono' })).toBe(
      '"Folia Noto Serif SC", ui-monospace, monospace'
    )
  })

  it('自定义族排在内置族之前（顺序就是优先级）', () => {
    expect(resolveFumeFontFamily({ name: 't', fontStyle: 'serif', fontFamily: 'My Font' })).toBe(
      '"My Font", "Folia Noto Serif SC", serif'
    )

    expect(
      resolveFumeFontFamily({
        name: 't',
        fontStyle: 'serif',
        fontFamilyStack: ['First', 'Second']
      })
    ).toBe('First, Second, "Folia Noto Serif SC", serif')
  })

  it('fontFamily 与 fontFamilyStack 合并后去重（同一个族不重复出现）', () => {
    const family = resolveFumeFontFamily({
      name: 't',
      fontStyle: 'serif',
      fontFamily: 'Dup',
      fontFamilyStack: ['Dup', 'Other']
    })

    expect(family.match(/Dup/g)).toHaveLength(1)
    expect(family).toBe('Dup, Other, "Folia Noto Serif SC", serif')
  })

  it('带空格的族名会被加引号（不加会被解析成多个族）', () => {
    expect(
      resolveFumeFontFamily({ name: 't', fontStyle: 'serif', fontFamily: 'Noto Serif SC' })
    ).toBe('"Noto Serif SC", "Folia Noto Serif SC", serif')
    // 通用族（serif 等）本来就有内置兜底，这里只验证「单个词不加引号」
    expect(resolveFumeFontFamily({ name: 't', fontStyle: 'serif', fontFamily: 'Georgia' })).toBe(
      'Georgia, "Folia Noto Serif SC", serif'
    )
  })

  it('空白自定义族被忽略（不会在栈里留下空项）', () => {
    expect(
      resolveFumeFontFamily({ name: 't', fontStyle: 'serif', fontFamilyStack: ['  ', ''] })
    ).toBe('"Folia Noto Serif SC", serif')
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
    resetSpies()
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
    const hero = buildPreparedSingleLine('ab', 'serif', 100, 'hero', 1, 1, 1, null)
    expect(spy.layoutWithLinesCalls).toBe(1)
    const heroLineHeight = Math.round(fontPxFromSpec(spy.layoutFonts[0]) * 1.02)
    expect(spy.lineHeights[0]).toBe(heroLineHeight)
    expect(hero.layout.height).toBe(heroLineHeight)

    resetSpies()

    const body = buildPreparedSingleLine('ab', 'serif', 100, 'body', 1, 1, 1, null)
    expect(spy.layoutWithLinesCalls).toBe(1)
    const bodyLineHeight = Math.round(fontPxFromSpec(spy.layoutFonts[0]) * 1.06)
    expect(spy.lineHeights[0]).toBe(bodyLineHeight)
    expect(body.layout.height).toBe(bodyLineHeight)
  })

  it('相同文本与字体串第二次命中 prepared 缓存，但布局仍按当前宽度重算', () => {
    const first = buildPreparedSingleLine('缓存命中', 'serif', 120, 'body', 1, 1, 1, null)
    const callsAfterFirst = { rich: spy.prepareCalls, measure: spy.measurePrepareCalls }

    const second = buildPreparedSingleLine('缓存命中', 'serif', 120, 'body', 1, 1, 1, null)

    // 两条缓存都要命中：宽度模型的参考测量，与渲染用的 prepareWithSegments
    expect(spy.prepareCalls).toBe(callsAfterFirst.rich)
    expect(spy.measurePrepareCalls).toBe(callsAfterFirst.measure)
    expect(second.fontPx).toBe(first.fontPx)
    expect(second.layout).not.toBe(first.layout)
  })
})

// ─────────── 候选判定走宽度模型（2026-10-17 性能修复） ───────────

describe('宽度模型快路径（§4.10 的候选判定）', () => {
  beforeEach(() => {
    resetSpies()
  })

  it('模型答得出来时一次真测量都不做', () => {
    buildMeasuredSingleLine('abcdefg', 'serif', 600, 'body', 1, 1, 1, null)

    expect(spy.layoutCalls).toBe(0)
    expect(spy.prepareCalls).toBe(0)
    // 宽度模型的参考测量只做一次（参考字号那一次）
    expect(spy.measurePrepareCalls).toBe(1)
  })

  it('与逐候选精确搜索选出同一个字号 / 行数（等价性）', () => {
    const fast = buildMeasuredSingleLine('abcdefg', 'serif', 600, 'body', 1, 1, 1, null)

    resetSpies()

    const exact = buildMeasuredSingleLine('abcdefg', 'serif', 600, 'body', 1, 1, 1, null, {
      exact: true
    })

    expect(spy.layoutCalls).toBe(8)
    expect(exact.fontPx).toBe(fast.fontPx)
    expect(exact.lineCount).toBe(fast.lineCount)
  })

  it('收敛点在安全带内（余量 0.2px）时退回真实测量复核', () => {
    // 单字素在模型口径下「宽度 = 字号」：hero 第一个候选 38px、块宽 38.2px → 余量 0.2px
    buildMeasuredSingleLine('a', 'serif', 38.2, 'hero', 1, 1, 1, null)

    expect(spy.layoutCalls).toBeGreaterThan(0)
  })

  it('兜底那一档必须精确：返回真实行数而不是占位值 2', () => {
    const result = buildMeasuredSingleLine('abcdefghij', 'serif', 10, 'body', 1, 1, 1, null)

    expect(result.fontPx).toBe(FUME_BODY_FONT_PX_RANGE.low)
    // 模型口径下这行宽 = 10 字素 × 10px = 100px，块宽 10px → 10 行
    expect(result.lineCount).toBe(10)
  })

  it('渲染路径只做一次 prepareWithSegments，测量路径只做 prepare', () => {
    buildPreparedSingleLine('abcd', 'serif', 400, 'body', 1, 1, 1, null)

    expect(spy.layoutWithLinesCalls).toBe(1)
    expect(spy.prepareCalls).toBe(1)
    expect(spy.measurePrepareCalls).toBe(1)
  })

  it('测量阶段与渲染阶段的行数一致：自愈分支不会被走到', () => {
    const measured = buildMeasuredSingleLine('abcd', 'serif', 400, 'body', 1, 1, 1, null)

    resetSpies()

    const prepared = buildPreparedSingleLine('abcd', 'serif', 400, 'body', 1, 1, 1, null)

    expect(prepared.fontPx).toBe(measured.fontPx)
    expect(prepared.layout.lineCount).toBe(measured.lineCount)
    // 自愈会额外跑 8 次精确二分（每次一个 prepare + 一个 layout），这里必须没有
    expect(spy.layoutCalls).toBe(0)
    expect(spy.measurePrepareCalls).toBe(1)
  })
})
