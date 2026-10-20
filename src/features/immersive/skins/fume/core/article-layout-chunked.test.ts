/**
 * 分片排版的等价性与中止语义（性能修复，2026-10-14）。
 *
 * 这一层唯一要证明的事情是：**让出主线程不改变排版结果**。所以核心用例是
 * 「同一份输入，同步版与分片版产出逐字段相同」，外加两条调度语义：
 * 预算用完之后真的让出、`shouldAbort` 之后真的停手（而不是白跑完剩下的几十次）。
 */

import { describe, expect, it } from 'vitest'

import { FUME_LAYOUT_SLICE_BUDGET_MS, buildArticleLayoutChunked } from './article-layout-chunked'
import { buildArticleLayout } from './article-layout'
import type { FumeArticleMeasure, FumePreparedSingleLineLike } from './article-layout-attempt'
import type { FumeLayoutThemeKey } from './layout-key'
import type { FumeLine } from './fume-types'

const GLYPH_PX = 10
const FAKE_FONT_PX = 20
const THEME: FumeLayoutThemeKey = { name: 'folia', fontStyle: 'serif' }
const VIEWPORT = { width: 1600, height: 900 }

/** 与 `article-layout.test.ts` 同口径的假测量（每个字素 GLYPH_PX 宽） */
function makeMeasure(): FumeArticleMeasure {
  return {
    resolveFontFamily: () => 'Fake Serif',
    buildFontSpec: (fontPx) => `500 ${fontPx}px Fake Serif`,
    prepareSingleLine: (text, _fontFamily, width): FumePreparedSingleLineLike => {
      const graphemeCount = [...text].length
      const perLine = Math.max(Math.floor(width / GLYPH_PX), 1)
      const lineCount = Math.max(Math.ceil(graphemeCount / perLine), 1)
      const lineHeight = Math.round(FAKE_FONT_PX * 1.06)

      const lines = Array.from({ length: lineCount }, (_, lineIndex) => {
        const startGrapheme = lineIndex * perLine
        const endGrapheme = Math.min(startGrapheme + perLine, graphemeCount)
        return {
          text: [...text].slice(startGrapheme, endGrapheme).join(''),
          width: (endGrapheme - startGrapheme) * GLYPH_PX,
          start: { segmentIndex: 0, graphemeIndex: startGrapheme },
          end: { segmentIndex: 0, graphemeIndex: endGrapheme }
        }
      })

      return {
        fontPx: FAKE_FONT_PX,
        prepared: {
          segments: [text],
          widths: [graphemeCount * GLYPH_PX],
          breakableFitAdvances: [new Array<number>(graphemeCount).fill(GLYPH_PX)]
        } as FumePreparedSingleLineLike['prepared'],
        layout: {
          lineCount,
          height: lineCount * lineHeight,
          lines
        } as FumePreparedSingleLineLike['layout']
      }
    },
    measureSegmentGlyphOffsets: (text) =>
      Array.from({ length: [...text].length + 1 }, (_, index) => index * GLYPH_PX)
  }
}

function makeLines(count: number, graphemeCount = 10): FumeLine[] {
  return Array.from({ length: count }, (_, index) => ({
    words: [],
    startTimeMs: 1000 + index * 1000,
    endTimeMs: 2000 + index * 1000,
    fullText: String.fromCharCode(0x4e00 + index).repeat(graphemeCount)
  }))
}

function makeInput(lines: FumeLine[]) {
  return {
    lines,
    viewport: VIEWPORT,
    layoutTheme: THEME,
    lyricsFontScale: 1,
    heroScale: 1,
    measure: makeMeasure(),
    now: () => 0
  }
}

/**
 * 假时钟：每次读都往前跳 `tickMs`，于是「一片用了多久」完全可控。
 *
 * 让出时把 `now` 再推一大步 —— 真实世界里让出本身也要花时间，
 * 这样每片开头都必然重新计时。
 */
function createFakeClock(tickMs: number): { now: () => number; advance: (ms: number) => void } {
  let current = 0
  return {
    now: () => {
      current += tickMs
      return current
    },
    advance: (ms) => {
      current += ms
    }
  }
}

describe('buildArticleLayoutChunked（性能修复的等价性）', () => {
  it('与同步版逐字段相同（含每个块的位置 / 字号 / 渲染行）', async () => {
    const input = makeInput(makeLines(24))

    const sync = buildArticleLayout(input)
    const chunked = await buildArticleLayoutChunked(input, {
      // 预算给到无限大 → 一次都不让出，等价于同步跑
      yieldToMainThread: () => Promise.resolve(),
      sliceBudgetMs: Number.POSITIVE_INFINITY
    })

    expect(chunked).not.toBeNull()
    expect(chunked!.timing).toEqual(sync.timing)
    expect(chunked!.article).toEqual(sync.article)
    expect(chunked!.article!.blocks).toEqual(sync.article!.blocks)
  })

  it('预算很小（每次都让出）时结果依然与同步版相同', async () => {
    const input = makeInput(makeLines(24))
    let yields = 0

    const sync = buildArticleLayout(input)
    const chunked = await buildArticleLayoutChunked(input, {
      yieldToMainThread: () => {
        yields += 1
        return Promise.resolve()
      },
      sliceBudgetMs: 0
    })

    expect(yields).toBeGreaterThan(30) // 每片只跑一步 → 至少 33 次让出
    expect(chunked!.timing).toEqual(sync.timing)
    expect(chunked!.article!.blocks).toEqual(sync.article!.blocks)
  })

  it('预算内不让出：一次尝试里的若干块挤在同一片里跑完', async () => {
    const input = makeInput(makeLines(24))
    let yields = 0

    await buildArticleLayoutChunked(input, {
      yieldToMainThread: () => {
        yields += 1
        return Promise.resolve()
      },
      // 假时钟每次读跳 1ms，预算 8ms → 每片约 8 个块
      now: createFakeClock(1).now,
      sliceBudgetMs: FUME_LAYOUT_SLICE_BUDGET_MS
    })

    // 24 行 × 33 次尝试 = 792 个块，每片 8 个 → 约 99 次让出（远小于块数）
    expect(yields).toBeGreaterThan(50)
    expect(yields).toBeLessThan(792)
  })

  it('空输入 / 非法视口：与同步版一样返回 article = null 的 timing', async () => {
    const chunked = await buildArticleLayoutChunked(makeInput([]), {
      yieldToMainThread: () => Promise.resolve()
    })

    expect(chunked!.article).toBeNull()
    expect(chunked!.timing.attempts).toBe(0)
  })

  it('shouldAbort 在第一个让出点就停手，返回 null（不写回语义）', async () => {
    const input = makeInput(makeLines(24))
    let yields = 0
    let attemptsSeen = 0

    const result = await buildArticleLayoutChunked(input, {
      yieldToMainThread: () => {
        yields += 1
        return Promise.resolve()
      },
      sliceBudgetMs: 0,
      // 让出 3 次之后喊停：剩下的几十次排版一次都不该再跑
      shouldAbort: () => {
        attemptsSeen = yields
        return yields >= 3
      }
    })

    expect(result).toBeNull()
    expect(attemptsSeen).toBe(3)
  })

  it('shouldAbort 一开始就为真：一次块都不排', async () => {
    const input = makeInput(makeLines(24))
    let prepares = 0
    const measure = makeMeasure()
    const countingMeasure: FumeArticleMeasure = {
      ...measure,
      prepareSingleLine: (...args) => {
        prepares += 1
        return measure.prepareSingleLine(...args)
      }
    }

    const result = await buildArticleLayoutChunked(
      { ...input, measure: countingMeasure },
      {
        yieldToMainThread: () => Promise.resolve(),
        shouldAbort: () => true
      }
    )

    expect(result).toBeNull()
    expect(prepares).toBe(0)
  })
})
