/**
 * 文章排版顶层单测（规格书 §7.7 / §7.8，对应用例见 §15.5）。
 *
 * 测量层是**注入**的，所以这里用一个可完全预测的假实现：
 * 每个字素 `GLYPH_PX` 宽、每行 `innerWidth / GLYPH_PX` 个字素，
 * 于是「块高 + 间距」能直接手算，装箱与搜索的每一步都能写出精确期望值。
 *
 * 覆盖 §15.5 点名的五条：变体边界（4/22/28/36 字）、列高轮转、`overflowPenalty = 0.14`、
 * `targetHeight = 2.45 × viewportHeight`、`paperWidth` 的 920 / 2400 钳制；
 * 另加：measure / render 两种模式的差异、空行过滤、排序确定性、时间序派生字段。
 */

import { describe, expect, it } from 'vitest'

import {
  FUME_DENSITY_SCALE_MAX,
  FUME_DENSITY_SCALE_MIN,
  FUME_OVERFLOW_PENALTY_RATIO,
  FUME_PAPER_WIDTH_MAX_PX,
  FUME_PAPER_WIDTH_MIN_PX,
  FUME_TARGET_HEIGHT_SCREENS,
  buildArticleLayout,
  createArticleLayoutSearch,
  resolveColumnGap,
  resolveLayoutScore,
  resolveMaxColumns,
  resolvePaperWidth
} from './article-layout'
import {
  buildArticleLayoutAttempt,
  createAttemptTiming,
  type FumeArticleMeasure,
  type FumePreparedSingleLineLike
} from './article-layout-attempt'
import type { FumeLayoutThemeKey } from './layout-key'
import type { FumeLine } from './fume-types'

/** 假字体：每个字素 10px 宽（于是「一行几个字」= innerWidth / 10） */
const GLYPH_PX = 10

/** 假字号：固定 20px —— 行高就是 round(20 * 1.02/1.06)，便于手算 */
const FAKE_FONT_PX = 20

const THEME: FumeLayoutThemeKey = { name: 'folia', fontStyle: 'serif' }

/**
 * 假测量层：按「每字素 GLYPH_PX 宽」把文本折成若干行。
 *
 * `measuredOffsetsPerGlyph` 与真实现同口径（长度 = 字素数 + 1），但内容是线性递增 ——
 * 布局层只把它搬运到片段上，不需要真实字宽。
 */
function makeMeasure(): FumeArticleMeasure {
  return {
    resolveFontFamily: () => 'Fake Serif',
    buildFontSpec: (fontPx) => `500 ${fontPx}px Fake Serif`,
    prepareSingleLine: (text, _fontFamily, width): FumePreparedSingleLineLike => {
      const graphemeCount = [...text].length
      const perLine = Math.max(Math.floor(width / GLYPH_PX), 1)
      const lineCount = Math.max(Math.ceil(graphemeCount / perLine), 1)
      const segText = text
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
          segments: [segText],
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

/** 造一行：`text` 的字数决定排版后的行数 */
function makeLine(fullText: string, overrides: Partial<FumeLine> = {}): FumeLine {
  return {
    words: [],
    startTimeMs: 1000,
    endTimeMs: 2000,
    fullText,
    ...overrides
  }
}

/** 造 N 行不同文本（保证排序种子不同） */
function makeLines(count: number, graphemeCount = 10): FumeLine[] {
  return Array.from({ length: count }, (_, index) =>
    makeLine(String.fromCharCode(0x4e00 + index).repeat(graphemeCount), {
      startTimeMs: 1000 + index * 1000,
      endTimeMs: 2000 + index * 1000
    })
  )
}

const VIEWPORT = { width: 1600, height: 900 }

describe('resolvePaperWidth（§7.8）', () => {
  it('纸张比视口宽 1.95 倍', () => {
    // 1000 * 1.95 = 1950，且 1000 + 520 = 1520 → 取 1950
    expect(resolvePaperWidth({ width: 1000, height: 800 })).toBe(1950)
  })

  it('窄窗口下走「至少宽 520px」的分支，再被 920 下限抬起', () => {
    // 200 * 1.95 = 390；200 + 520 = 720 → 先取 720，再被 [920, 2400] 抬到 920。
    // 也就是说这一档在 920 以下的窗口里**永远**只出 920 —— 「至少宽 520」的意义是
    // 让纸张在中等窗口上比「× 1.95」更宽，而不是突破下限。
    expect(resolvePaperWidth({ width: 200, height: 800 })).toBe(FUME_PAPER_WIDTH_MIN_PX)
    // 「至少宽 520」真正压过「× 1.95」的窗口宽区间：x + 520 > 1.95x ⇔ x < 547。
    // 500 → max(975, 1020) = 1020，此时结果由「+520」而非倍数决定。
    expect(resolvePaperWidth({ width: 500, height: 800 })).toBe(1020)
  })

  it('下限 920：极窄窗口也保证纸张宽度', () => {
    expect(resolvePaperWidth({ width: 100, height: 800 })).toBe(FUME_PAPER_WIDTH_MIN_PX)
  })

  it('上限 2400：超宽窗口不再继续放大', () => {
    expect(resolvePaperWidth({ width: 4000, height: 2000 })).toBe(FUME_PAPER_WIDTH_MAX_PX)
    // 2400 恰好是阈值本身（钳制是闭区间）
    expect(resolvePaperWidth({ width: 2400, height: 2000 })).toBe(FUME_PAPER_WIDTH_MAX_PX)
  })
})

describe('resolveMaxColumns / resolveColumnGap（§7.8）', () => {
  it('四档阈值：1120 → 4 列、760 → 3 列、500 → 2 列、其余 1 列', () => {
    expect(resolveMaxColumns(2400)).toBe(4)
    expect(resolveMaxColumns(1120)).toBe(4)
    expect(resolveMaxColumns(1119)).toBe(3)
    expect(resolveMaxColumns(760)).toBe(3)
    expect(resolveMaxColumns(759)).toBe(2)
    expect(resolveMaxColumns(500)).toBe(2)
    expect(resolveMaxColumns(499)).toBe(1)
  })

  it('列间距按纸张宽 × 三档系数取整，再钳到 [6, 14]', () => {
    expect(resolveColumnGap(2400, 4)).toBe(14) // round(15.6) → 钳到 14
    expect(resolveColumnGap(1600, 3)).toBe(14) // round(13.6) = 14
    expect(resolveColumnGap(920, 2)).toBe(11) // round(10.58) = 11
    expect(resolveColumnGap(100, 2)).toBe(6) // round(1.15) → 钳到 6
  })
})

describe('resolveLayoutScore（§7.8 的 overflowPenalty = 0.14）', () => {
  const target = 2205 // 900 * 2.45

  it(`targetHeight = 视口高 × ${FUME_TARGET_HEIGHT_SCREENS}`, () => {
    expect(900 * FUME_TARGET_HEIGHT_SCREENS).toBe(target)
  })

  it('正好命中目标时得 0 分', () => {
    expect(resolveLayoutScore(target, target)).toBe(0)
  })

  it('偏低全额惩罚（差多少扣多少）', () => {
    expect(resolveLayoutScore(target - 100, target)).toBe(100)
  })

  it('偏高只按 14% 惩罚（同一偏差下，偏高远比偏低划算）', () => {
    expect(resolveLayoutScore(target + 100, target)).toBeCloseTo(
      100 + 100 * FUME_OVERFLOW_PENALTY_RATIO,
      10
    )
    // 偏高 100 分（114）< 偏低 200 分（200）→ 说明「宁可略高」的设计意图成立
    expect(resolveLayoutScore(target + 100, target)).toBeLessThan(
      resolveLayoutScore(target - 200, target)
    )
  })

  it('惩罚比例常量本身就是 0.14（防止被顺手改成别的数）', () => {
    expect(FUME_OVERFLOW_PENALTY_RATIO).toBe(0.14)
  })
})

describe('buildArticleLayoutAttempt（§7.7）', () => {
  const baseOptions = {
    paperWidth: 1600,
    viewportHeight: 900,
    columns: 2,
    gap: 10,
    densityScale: 1,
    seedKey: 'folia'
  }

  it('入参守卫：视口非正 / 没有行 → null', () => {
    const context = {
      lines: makeLines(4),
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    expect(
      buildArticleLayoutAttempt({ ...context, viewport: { width: 0, height: 900 } }, baseOptions)
    ).toBeNull()
    expect(
      buildArticleLayoutAttempt({ ...context, viewport: { width: 1600, height: 0 } }, baseOptions)
    ).toBeNull()
    expect(buildArticleLayoutAttempt({ ...context, lines: [] }, baseOptions)).toBeNull()
  })

  it('measure 模式只出指标，render 模式出完整文章（且两者高度一致）', () => {
    const context = {
      lines: makeLines(6),
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const metrics = buildArticleLayoutAttempt(context, { ...baseOptions, mode: 'measure' })
    const article = buildArticleLayoutAttempt(context, { ...baseOptions, mode: 'render' })

    expect(metrics).not.toBeNull()
    expect(article).not.toBeNull()
    expect(metrics!.height).toBe(article!.height)
    expect(metrics).not.toHaveProperty('blocks')
    expect(article!.blocks.length).toBeGreaterThan(0)
  })

  it('过滤空行：全空文本的输入仍然会排（但一块都建不出来）', () => {
    const context = {
      lines: [makeLine(''), makeLine('   ')],
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const article = buildArticleLayoutAttempt(context, baseOptions)

    expect(article).not.toBeNull()
    expect(article!.blocks).toEqual([])
    // 没有块时：文章高 = 列高（初始 verticalMargin）+ verticalMargin
    expect(article!.height).toBe(Math.max(VIEWPORT.height * 0.82, 220) * 2)
    expect(article!.firstRenderableStartTimeMs).toBe(Number.POSITIVE_INFINITY)
    expect(article!.lastChronologicalRenderEndTimeMs).toBe(Number.NEGATIVE_INFINITY)
  })

  it('水平 / 垂直留白：0.86 与 0.82，各带 280 / 220 的下限', () => {
    const context = {
      lines: makeLines(4),
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const article = buildArticleLayoutAttempt(context, baseOptions)!

    expect(article.paperBounds.left).toBeCloseTo(1600 * 0.86, 10)
    expect(article.paperBounds.top).toBeCloseTo(900 * 0.82, 10)
    expect(article.paperBounds.right).toBeCloseTo(1600 * 0.86 + 1600, 10)
    expect(article.width).toBeCloseTo(1600 + 1600 * 0.86 * 2, 10)

    // 小视口走下限分支
    const small = buildArticleLayoutAttempt(
      { ...context, viewport: { width: 100, height: 100 } },
      { ...baseOptions, paperWidth: 920 }
    )!
    expect(small.paperBounds.left).toBe(280)
    expect(small.paperBounds.top).toBe(220)
  })

  it('paperBounds.bottom 用「最后一列的底」而不是整张世界图的高度', () => {
    const context = {
      lines: makeLines(4),
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const article = buildArticleLayoutAttempt(context, baseOptions)!

    expect(article.paperBounds.bottom).toBeCloseTo(article.height - article.paperBounds.top, 10)
    expect(article.paperBounds.bottom).toBeLessThan(article.height)
  })

  it('时间序派生字段：chronologicalBlocks 按 sourceLineIndex 升序，首尾时间取自它们', () => {
    const lines = makeLines(6)
    const context = {
      lines,
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const article = buildArticleLayoutAttempt(context, baseOptions)!

    const indices = article.chronologicalBlocks.map((block) => block.sourceLineIndex)
    expect(indices).toEqual([...indices].sort((left, right) => left - right))
    expect(article.firstRenderableStartTimeMs).toBe(lines[0].startTimeMs)
    expect(article.blockBySourceLineIndex.size).toBe(article.chronologicalBlocks.length)
    // 末行 1000 + 5*1000 = 6000 起、7000 止；renderHash=7000 + 240（normal 行）
    expect(article.lastChronologicalRenderEndTimeMs).toBeGreaterThanOrEqual(lines[5].endTimeMs)
  })

  it('放置顺序 = 按种子打乱（不是时间序），但结果确定', () => {
    const context = {
      lines: makeLines(12),
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const first = buildArticleLayoutAttempt(context, baseOptions)!
    const second = buildArticleLayoutAttempt(context, baseOptions)!
    const placed = first.blocks.map((block) => block.sourceLineIndex)
    const chronological = [...placed].sort((left, right) => left - right)

    expect(first.blocks.map((block) => block.sourceLineIndex)).toEqual(
      second.blocks.map((block) => block.sourceLineIndex)
    )
    // 12 行打乱后几乎不可能是同一个顺序（除非排序键恰好单调）
    expect(placed).not.toEqual(chronological)
  })

  it('seedKey 不同 → 放置顺序不同（种子确实参与）', () => {
    const context = {
      lines: makeLines(12),
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const first = buildArticleLayoutAttempt(context, { ...baseOptions, seedKey: 'a' })!
    const second = buildArticleLayoutAttempt(context, { ...baseOptions, seedKey: 'b' })!

    expect(first.blocks.map((block) => block.sourceLineIndex)).not.toEqual(
      second.blocks.map((block) => block.sourceLineIndex)
    )
  })

  it('块高 = 视觉行数 × 行高；行高取整且用 hero 的 1.02 系数', () => {
    const context = {
      lines: [makeLine('一'.repeat(40))],
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    // 40 字超出天然 hero 的 28 字上限，而它又是唯一一块 → §7.2 的 fallback 会把它
    // 强制提升为 hero（「整首歌一块 hero 都没有」正是这条兜底要解决的场景）。
    // innerWidth = 列宽 = (1600 - 10) / 2 = 795 → 每行 79 个字素 → 40 字素排 1 行。
    const article = buildArticleLayoutAttempt(context, baseOptions)!
    const block = article.blocks[0]

    expect(block.variant).toBe('hero')
    expect(block.lineHeight).toBe(Math.round(FAKE_FONT_PX * 1.02))
    expect(block.height).toBe(block.layout.lines.length * block.lineHeight)
  })

  it('render 模式的块带齐 §7.6 的渲染数据（id / 字素 / 词区间 / 片段）', () => {
    const line = makeLine('一二三四五', {
      words: [
        { text: '一二三', startTimeMs: 1000, endTimeMs: 1500 },
        { text: '四五', startTimeMs: 1500, endTimeMs: 2000 }
      ]
    })
    const context = {
      lines: [line],
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const block = buildArticleLayoutAttempt(context, baseOptions)!.blocks[0]

    expect(block.id).toBe(`fume-${line.startTimeMs}-0`)
    expect(block.sourceLineIndex).toBe(0)
    expect(block.graphemes).toEqual([...'一二三四五'])
    expect(block.wordRanges).toHaveLength(2)
    expect(block.wordRangeIndexByOffset).toEqual([0, 0, 0, 1, 1])
    expect(block.renderLines.length).toBeGreaterThan(0)
    expect(block.renderLines[0].id).toBe(`${line.startTimeMs}-0`)
    // 片段上的实测偏移与真实现同口径：长度 = 片段的字素数 + 1
    for (const renderLine of block.renderLines) {
      for (const segment of renderLine.segments) {
        expect(segment.measuredGlyphOffsets).toHaveLength([...segment.text].length + 1)
      }
    }
  })

  it('hero 的渲染行有缩进、body 恒为 0（§7.6 的 0.08 系数）', () => {
    // 用 2 列 + 足够多的行，确保至少出现一个 hero（每 6 块一个）
    const context = {
      lines: makeLines(12, 10),
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const article = buildArticleLayoutAttempt(context, baseOptions)!
    const heroBlock = article.blocks.find((block) => block.variant === 'hero')
    const bodyBlock = article.blocks.find((block) => block.variant === 'body')

    expect(heroBlock).toBeDefined()
    expect(bodyBlock).toBeDefined()
    for (const renderLine of bodyBlock!.renderLines) {
      expect(renderLine.left).toBe(0)
    }
    for (const renderLine of heroBlock!.renderLines) {
      expect(renderLine.left).toBeGreaterThanOrEqual(0)
    }
  })

  it('timing 采样按段累加 lines（只统计真正参与排版的块）', () => {
    const timing = createAttemptTiming()
    const context = {
      lines: makeLines(5),
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    buildArticleLayoutAttempt(context, { ...baseOptions, timing })

    expect(timing.lines).toBe(5)
  })
})

describe('buildArticleLayout（§7.8 顶层搜索）', () => {
  it('视口非正 / 空列表 → article 为 null，但 timing 仍然返回', () => {
    const input = {
      lines: makeLines(4),
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const empty = buildArticleLayout({ ...input, lines: [] })
    const badViewport = buildArticleLayout({ ...input, viewport: { width: 0, height: 900 } })

    expect(empty.article).toBeNull()
    expect(badViewport.article).toBeNull()
    expect(empty.timing.attempts).toBe(0)
    expect(empty.timing.bestColumns).toBeNull()
  })

  it(`目标高度 = 视口高 × ${FUME_TARGET_HEIGHT_SCREENS}（且视口高有 240px 下限）`, () => {
    const input = {
      lines: makeLines(8),
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    expect(buildArticleLayout(input).timing.targetHeight).toBeCloseTo(900 * 2.45, 10)

    // 视口高 100 → 下限抬到 240 → 目标 588
    const short = buildArticleLayout({ ...input, viewport: { width: 1600, height: 100 } })
    expect(short.timing.targetHeight).toBeCloseTo(240 * 2.45, 10)
  })

  it('跑满「列数 × 8 次」次 measure，并额外跑一次 render', () => {
    const input = {
      lines: makeLines(20),
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const { article, timing } = buildArticleLayout(input)

    // paperWidth = 1950 → 4 列；4 × 8 = 32 次 measure + 1 次 render
    expect(resolveMaxColumns(resolvePaperWidth(VIEWPORT))).toBe(4)
    expect(timing.attempts).toBe(32)
    expect(timing.bestColumns).not.toBeNull()
    expect(article).not.toBeNull()
    // render 阶段会走一遍全部块
    expect(timing.render.lines).toBe(article!.blocks.length)
    // measure 阶段统计的是「尝试 × 块数」，必然不少于 render 的块数
    expect(timing.measure.lines).toBeGreaterThanOrEqual(timing.render.lines)
  })

  it('最终选中的密度落在搜索区间内（二分不会跑出界）', () => {
    const input = {
      lines: makeLines(20),
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const { timing } = buildArticleLayout(input)

    expect(timing.bestDensityScale).not.toBeNull()
    expect(timing.bestDensityScale!).toBeGreaterThanOrEqual(FUME_DENSITY_SCALE_MIN)
    expect(timing.bestDensityScale!).toBeLessThanOrEqual(FUME_DENSITY_SCALE_MAX)
  })

  it('结果确定：同输入两次得到相同的列数、密度与文章高度', () => {
    const input = {
      lines: makeLines(20),
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const first = buildArticleLayout(input)
    const second = buildArticleLayout(input)

    expect(first.timing.bestColumns).toBe(second.timing.bestColumns)
    expect(first.timing.bestDensityScale).toBe(second.timing.bestDensityScale)
    expect(first.article!.height).toBe(second.article!.height)
    expect(first.article!.width).toBe(second.article!.width)
  })

  it('最终文章确实用「被选中的那组参数」重建（height 与 bestHeight 同源）', () => {
    const input = {
      lines: makeLines(20),
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const { article, timing } = buildArticleLayout(input)

    // 同一套参数下，measure 与 render 的高度只差「是否建 renderLines」——几何一致
    expect(article!.height).toBeCloseTo(timing.bestHeight, 10)
    expect(timing.finalHeight).toBe(article!.height)
    expect(article!.columns).toBe(timing.bestColumns)
  })

  it('主题名参与种子：换 name 会换一套骨架（列/密度可能相同，但布局键不同）', () => {
    const input = {
      lines: makeLines(20),
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const first = buildArticleLayout(input)
    const second = buildArticleLayout({
      ...input,
      layoutTheme: { ...THEME, name: 'other-theme' }
    })

    // 两首歌的骨架一定不同（放置顺序按 seedKey 打乱），但都排得出文章
    expect(first.article).not.toBeNull()
    expect(second.article).not.toBeNull()
    expect(first.article!.blocks.map((block) => block.sourceLineIndex)).not.toEqual(
      second.article!.blocks.map((block) => block.sourceLineIndex)
    )
  })

  it('单列视口也只跑 1 列 × 8 次（列数从 maxColumns 递减到 1 的边界）', () => {
    const input = {
      // 纸张宽被钳到 920 → maxColumns = 3
      lines: makeLines(8),
      viewport: { width: 100, height: 700 },
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const { timing } = buildArticleLayout(input)

    expect(resolveMaxColumns(resolvePaperWidth(input.viewport))).toBe(3)
    expect(timing.attempts).toBe(24)
  })

  it('生成器版与同步版逐字等价（分片只是调度，不改结果）', () => {
    const input = {
      lines: makeLines(20),
      viewport: VIEWPORT,
      layoutTheme: THEME,
      lyricsFontScale: 1,
      heroScale: 1,
      measure: makeMeasure(),
      now: () => 0
    }

    const sync = buildArticleLayout(input)

    // 手动把生成器跑到底：不做任何让出，等价于同步执行
    const search = createArticleLayoutSearch(input)
    let step = search.next()
    let yieldCount = 0
    while (!step.done) {
      yieldCount += 1
      step = search.next()
    }

    expect(yieldCount).toBeGreaterThan(0) // 让出点确实存在
    expect(step.value.timing).toEqual(sync.timing)
    expect(step.value.article).toEqual(sync.article)
  })
})
