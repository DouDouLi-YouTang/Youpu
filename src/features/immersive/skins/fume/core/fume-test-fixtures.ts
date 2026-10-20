/**
 * 「浮名」core 层单测的共用夹具（**仅测试用**，不进产物）。
 *
 * 为什么单独一个文件：`camera.test.ts` 与 `camera-step.test.ts` 都要造「区块 + 文章」，
 * 而 `FumeBlock` 有二十多个字段。两处各写一份的话，将来加字段就要改两遍，
 * 且容易出现「A 的夹具与 B 的夹具不一样」这种只在某个断言上暴露的偏差。
 *
 * 夹具里的尺寸故意取「整」「半」这类好算的数（宽 400 / 行高 40 / 每字素 50px），
 * 这样断言里的期望值可以直接手算，不必把实现里的公式再抄一遍 ——
 * 抄公式的断言等于没测。
 */

import type {
  FumeArticleLayout,
  FumeBlock,
  FumeCameraTarget,
  FumeLine,
  FumeRenderLineSlice,
  FumeTheme
} from './fume-types'
import type { FumeBlockMeasure } from './camera'

/** 每个字素 50px、每行 8 个字素（宽 400px）—— 让所有几何断言都能整除 */
export const FIXTURE_GLYPH_ADVANCE = 50
export const FIXTURE_GLYPHS_PER_LINE = 8
export const FIXTURE_LINE_WIDTH = FIXTURE_GLYPH_ADVANCE * FIXTURE_GLYPHS_PER_LINE

/** 造一行歌词（默认 1000→2000ms 的正常行） */
export function makeFumeLine(overrides: Partial<FumeLine> = {}): FumeLine {
  return {
    words: [],
    startTimeMs: 1000,
    endTimeMs: 2000,
    fullText: '一二三四五六七八',
    ...overrides
  }
}

/** 造一条渲染行：默认从 `start` 起 8 个字素、绝对 x = `left` */
export function makeRenderLine(overrides: Partial<FumeRenderLineSlice> = {}): FumeRenderLineSlice {
  const start = overrides.start ?? 0
  const end = overrides.end ?? start + FIXTURE_GLYPHS_PER_LINE
  const graphemeCount = end - start
  return {
    id: `${start}-0`,
    text: '一'.repeat(graphemeCount),
    start,
    end,
    graphemes: new Array<string>(graphemeCount).fill('一'),
    glyphOffsets: Array.from(
      { length: graphemeCount },
      (_, index) => index * FIXTURE_GLYPH_ADVANCE
    ),
    segments: [],
    left: 0,
    top: 0,
    width: graphemeCount * FIXTURE_GLYPH_ADVANCE,
    ...overrides
  }
}

/** 造一个区块（默认：世界坐标 (100,200)、400×40、一条 8 字素渲染行）。 */
export function makeFumeBlock(overrides: Partial<FumeBlock> = {}): FumeBlock {
  const line = overrides.line ?? makeFumeLine()
  return {
    id: `fume-${line.startTimeMs}-${overrides.sourceLineIndex ?? 0}`,
    sourceLineIndex: 0,
    line,
    variant: 'body',
    x: 100,
    y: 200,
    width: FIXTURE_LINE_WIDTH,
    height: 40,
    innerWidth: FIXTURE_LINE_WIDTH,
    fontPx: 32,
    lineHeight: 40,
    prepared: {} as FumeBlock['prepared'],
    layout: {} as FumeBlock['layout'],
    graphemes: new Array<string>(FIXTURE_GLYPHS_PER_LINE).fill('一'),
    segmentMetas: [],
    wordRanges: [],
    wordRangeIndexByOffset: [],
    colorRangeIndexByOffset: [],
    renderLines: [makeRenderLine()],
    ...overrides
  }
}

/**
 * 假测量层：把所有几何都化成「下标 × 50px」。
 *
 * 真实实现（§4.4）会读 pretext 的 `widths` / `breakableFitAdvances`，
 * 而相机层只关心「这些数字怎么被组合」—— 用线性假函数反而能把组合关系测准。
 * 第二个参数返回 50 是把「字素推进」固定成整数，于是 `glyphAdvance * fractionalOffset`
 * 的断言可以精确写出来。
 */
export const FIXTURE_MEASURE: FumeBlockMeasure = {
  widthBetweenOffsets: (_block, startOffset, endOffset) =>
    Math.max(endOffset - startOffset, 0) * FIXTURE_GLYPH_ADVANCE,
  resolveGlyphAdvance: () => FIXTURE_GLYPH_ADVANCE
}

/** 造一篇文章：给定区块列表，自动补齐派生字段 */
export function makeFumeArticle(blocks: FumeBlock[]): FumeArticleLayout {
  const chronologicalBlocks = [...blocks].sort(
    (left, right) => left.sourceLineIndex - right.sourceLineIndex
  )
  const blockBySourceLineIndex = new Map<number, FumeBlock>(
    blocks.map((block) => [block.sourceLineIndex, block])
  )
  const width = blocks.reduce((max, block) => Math.max(max, block.x + block.width), 0)
  const height = blocks.reduce((max, block) => Math.max(max, block.y + block.height), 0)

  return {
    width: Math.max(width, 1),
    height: Math.max(height, 1),
    viewportHeight: 800,
    columns: 2,
    gap: 40,
    paperBounds: { left: 0, top: 0, right: width, bottom: height },
    blocks,
    blockBySourceLineIndex,
    chronologicalBlocks,
    firstRenderableStartTimeMs:
      chronologicalBlocks[0]?.line.startTimeMs ?? Number.POSITIVE_INFINITY,
    lastChronologicalRenderEndTimeMs:
      chronologicalBlocks.length > 0
        ? // 与实现同口径：末行的渲染结束时间（1000→2000 的 normal 行 = 2240）
          chronologicalBlocks[chronologicalBlocks.length - 1].line.endTimeMs + 240
        : Number.NEGATIVE_INFINITY
  }
}

/** 造一个相机（默认在原点、scale 1） */
export function makeFumeCamera(overrides: Partial<FumeCameraTarget> = {}): FumeCameraTarget {
  return {
    x: 0,
    y: 0,
    velocityX: 0,
    velocityY: 0,
    focusX: 0,
    focusY: 0,
    scale: 1,
    velocityScale: 0,
    focusScale: 1,
    ...overrides
  }
}

/** 造一个主题（颜色固定成 `rgb(...)`，因为 `colorWithAlpha` 只认 hex 与 rgb） */
export function makeFumeTheme(overrides: Partial<FumeTheme> = {}): FumeTheme {
  return {
    name: 'folia',
    primaryColor: 'rgb(244, 244, 245)',
    accentColor: 'rgb(234, 88, 12)',
    secondaryColor: 'rgb(113, 113, 122)',
    fontStyle: 'serif',
    animationIntensity: 'normal',
    ...overrides
  }
}

/** 1600×900 的视口（短边 900）—— 断言里 `min(width, height)` 一目了然 */
export const FIXTURE_VIEWPORT = { width: 1600, height: 900 }
