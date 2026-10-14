/**
 * 实时逐字素绘制的单测（移植规格书 §10.4 / §10.5）。
 *
 * ## 为什么用「假 context + 调用序列」而不是截图
 *
 * 这一层要钉住的是**行为**而不是几何（几何已经在 `live-style.test.ts` 里断言过）：
 * 相邻同样式字素有没有合并成一次绘制、不可见的字素有没有真的跳过、印章有没有
 * 落在字之前、退出时 context 状态有没有漏出去。这些在截图里全是「看起来差不多」，
 * 只有记录调用序列才能分辨。
 *
 * 假 context 实现了 `save` / `restore` 的状态栈（canvas 的真实语义），
 * 于是「忘了 restore」这类错误会直接表现为**函数返回后状态没回到初始值**。
 *
 * ## 两条红线之一在这里被钉住
 *
 * §11.3 禁止使用 `globalCompositeOperation`。它唯一的自动化保障就是本文件里那条
 * 「全程未被赋值」的用例：给假 context 装一个计数用的 setter，只要有代码碰它，
 * 计数就不再是 0。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { drawFumeLiveBlock, type FumeLiveBlockParams } from './canvas-text-live'
import { resolveFumeFontSpec } from './canvas-text'
import { setGlowBlurQuantized } from '../../shared/glow-blur-quantize'
import { resolveFumeBlockTiming, type FumeBlockTiming } from '../core/block-frame'
import { makeFumeBlock, makeFumeLine, makeFumeTheme } from '../core/fume-test-fixtures'
import type { FumeBlock, FumeRenderLineSlice, FumeWordRange } from '../core/fume-types'

const GRAPHEMES = ['一', '二', '三', '四']
const ACCENT = 'rgb(234, 88, 12)'
const PRIMARY = 'rgb(244, 244, 245)'

/**
 * 显式关掉 Linux 的字形缓存降级开关。
 *
 * node 环境本来就判定为非 Linux（`detectLinux` 先看 `window`），所以默认值已经是关；
 * 但这里**显式**关一次是有意义的：降级模式下 `fillGlowText` 会走「测量包围盒 + 裁剪」
 * 那条分支，多出一次 `rect`，而下面「合并 run」的断言正是按 `rect` 次数数的。
 * 不写这一行的话，将来平台判定一变，这批断言会在某个平台上**静默换成另一套语义**。
 */
beforeEach(() => {
  setGlowBlurQuantized(false)
})

afterEach(() => {
  setGlowBlurQuantized(false)
})

/** 造一条渲染行：4 个字素、每字素 50px，全部在同一个片段里 */
function makeLiveRenderLine(): FumeRenderLineSlice {
  return {
    id: '0-0',
    text: '一二三四',
    start: 0,
    end: 4,
    graphemes: [...GRAPHEMES],
    glyphOffsets: [0, 50, 100, 150],
    segments: [
      {
        text: '一二三四',
        start: 0,
        end: 4,
        localStart: 0,
        localEnd: 4,
        x: 0,
        width: 200,
        isFullSegment: true,
        measuredGlyphOffsets: [0, 50, 100, 150, 200]
      }
    ],
    left: 0,
    top: 0,
    width: 200
  }
}

/**
 * 造一个实时绘制的区块：0→1000ms 的一行、4 个字素。
 *
 * 默认 `wordRanges` 为空 —— 于是所有字素都没有时间可依附，样式只由
 * 「等待 / 前沿 / 已打印」三档决定，正好用来测**合并**。
 */
function makeLiveBlock(overrides: Partial<FumeBlock> = {}): FumeBlock {
  return makeFumeBlock({
    line: makeFumeLine({ startTimeMs: 0, endTimeMs: 1000, fullText: '一二三四' }),
    x: 100,
    y: 200,
    width: 200,
    height: 40,
    fontPx: 32,
    lineHeight: 40,
    graphemes: [...GRAPHEMES],
    renderLines: [makeLiveRenderLine()],
    wordRanges: [],
    wordRangeIndexByOffset: [-1, -1, -1, -1],
    colorRangeIndexByOffset: [-1, -1, -1, -1],
    ...overrides
  })
}

/** 两个词的布局：前 2 个字素属于词 A（0→500ms），后 2 个属于词 B（500→1000ms） */
function withTwoWords(block: FumeBlock): FumeBlock {
  const wordRanges: FumeWordRange[] = [
    {
      wordIndex: 0,
      word: { text: '一二', startTimeMs: 0, endTimeMs: 500 },
      start: 0,
      end: 2,
      colorStart: 0,
      colorEnd: 2,
      graphemeTimings: []
    },
    {
      wordIndex: 1,
      word: { text: '三四', startTimeMs: 500, endTimeMs: 1000 },
      start: 2,
      end: 4,
      colorStart: 2,
      colorEnd: 4,
      graphemeTimings: []
    }
  ]

  return {
    ...block,
    wordRanges,
    wordRangeIndexByOffset: [0, 0, 1, 1],
    colorRangeIndexByOffset: [0, 0, 1, 1]
  }
}

interface FillTextCall {
  kind: 'fillText'
  text: string
  x: number
  y: number
  fillStyle: string
  font: string
  textAlign: string
  textBaseline: string
  shadowBlur: number
  shadowColor: string
}

interface FillRectCall {
  kind: 'fillRect'
  x: number
  y: number
  width: number
  height: number
  fillStyle: string
}

type RecordedCall = FillTextCall | FillRectCall | { kind: string }

/**
 * 假 canvas context：实现 `save` / `restore` 的状态栈，并记录每次 `fillText` /
 * `fillRect` 时的**样式快照** —— 只记录"被调过"是不够的，很多错误是"用了错的样式"。
 *
 * `globalCompositeOperation` 是访问器，只计数不存值：只要有任何一处写它，
 * `compositeWrites` 就不再是 0（§11.3 的红线）。
 */
function createFakeContext() {
  const calls: RecordedCall[] = []
  const stack: Record<string, unknown>[] = []
  let compositeWrites = 0

  const context = {
    font: '',
    textAlign: '',
    textBaseline: '',
    fillStyle: '',
    filter: '',
    shadowBlur: 0,
    shadowColor: 'transparent',
    calls,
    get compositeWrites() {
      return compositeWrites
    },
    get stackDepth() {
      return stack.length
    },
    save() {
      stack.push({
        font: context.font,
        textAlign: context.textAlign,
        textBaseline: context.textBaseline,
        fillStyle: context.fillStyle,
        filter: context.filter,
        shadowBlur: context.shadowBlur,
        shadowColor: context.shadowColor
      })
      calls.push({ kind: 'save' })
    },
    restore() {
      const previous = stack.pop()
      if (previous) Object.assign(context, previous)
      calls.push({ kind: 'restore' })
    },
    fillText(text: string, x: number, y: number) {
      calls.push({
        kind: 'fillText',
        text,
        x,
        y,
        fillStyle: context.fillStyle,
        font: context.font,
        textAlign: context.textAlign,
        textBaseline: context.textBaseline,
        shadowBlur: context.shadowBlur,
        shadowColor: context.shadowColor
      })
    },
    fillRect(x: number, y: number, width: number, height: number) {
      calls.push({
        kind: 'fillRect',
        x,
        y,
        width,
        height,
        fillStyle: context.fillStyle
      })
    },
    measureText: () => ({
      width: 0,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 0,
      actualBoundingBoxAscent: 0,
      actualBoundingBoxDescent: 0
    }),
    beginPath() {},
    rect(x: number, y: number, width: number, height: number) {
      // 每次 run 恰好一次 rect（裁剪矩形），所以它同时是「画了几段 run」的计数依据
      calls.push({ kind: 'rect', x, y, width, height } as RecordedCall)
    },
    clip() {}
  }

  Object.defineProperty(context, 'globalCompositeOperation', {
    get: () => 'source-over',
    set: () => {
      compositeWrites += 1
    },
    configurable: true
  })

  return context as unknown as CanvasRenderingContext2D & {
    calls: RecordedCall[]
    compositeWrites: number
    stackDepth: number
  }
}

function makeParams(overrides: Partial<FumeLiveBlockParams> = {}): FumeLiveBlockParams {
  return {
    timeMs: 0,
    theme: makeFumeTheme({ accentColor: ACCENT, primaryColor: PRIMARY }),
    glowIntensity: 1,
    activeGlowBoost: 1.2,
    passedGlowBase: 0.8,
    showPrintStamp: false,
    ...overrides
  }
}

function fillTextCalls(context: { calls: RecordedCall[] }): FillTextCall[] {
  return context.calls.filter((call): call is FillTextCall => call.kind === 'fillText')
}

function fillRectCalls(context: { calls: RecordedCall[] }): FillRectCall[] {
  return context.calls.filter((call): call is FillRectCall => call.kind === 'fillRect')
}

/**
 * 「画了几段 run」= 几次 `rect`。
 *
 * 为什么要靠 `rect` 数而不是 `fillText` 数：{@link drawRenderTextRun} 每次都把
 * **整段文本**交给 `fillText`，靠裁剪矩形截出这一 run 的范围（canvas 的裁剪是状态，
 * 不是绘制参数）。所以「合并 run」在调用序列上的表现是**少几次 rect**，
 * 而不是 `fillText` 的文本变短。这个差别不写清楚很容易把断言写反。
 */
function runCount(context: { calls: RecordedCall[] }): number {
  return context.calls.filter((call) => call.kind === 'rect').length
}

describe('drawFumeLiveBlock（规格书 §10.4）', () => {
  it('稳定段落合并成一段 run（4 个字素 → 1 次裁剪绘制）', () => {
    const block = makeLiveBlock()
    const context = createFakeContext()
    const timing = resolveFumeBlockTiming(block, 0, null, 1)

    drawFumeLiveBlock(context, block, timing, makeParams({ timeMs: 0 }))

    // 时间 0：还没打印任何字、也不是前沿 → 4 个字素全是同一个 waiting 样式
    expect(runCount(context)).toBe(1)
  })

  it('样式不同处断开：前沿与等待态不能并进同一次绘制', () => {
    const block = makeLiveBlock()
    const context = createFakeContext()
    // 300ms → 词内均分下 printedCount = floor(0.3 × 4 + 1) = 2
    const timing = resolveFumeBlockTiming(block, 300, null, 1)

    drawFumeLiveBlock(context, block, timing, makeParams({ timeMs: 300 }))

    // 已打印「一二」/ 前沿「三」/ 等待「四」——三段样式各不相同
    expect(runCount(context)).toBe(3)
  })

  it('每个字素的 alpha 落在预期档位（已打印 0.92 / 前沿 0.82 / 等待 0.035）', () => {
    const block = makeLiveBlock()
    const context = createFakeContext()
    const timing = resolveFumeBlockTiming(block, 300, null, 1)

    drawFumeLiveBlock(context, block, timing, makeParams({ timeMs: 300 }))

    // 先滤掉整行辉光（它是 accentColor，且整段一次画完）
    const styles = fillTextCalls(context)
      .map((call) => call.fillStyle)
      .filter((style) => style.startsWith('rgba(244, 244, 245'))
    expect(styles[0]).toBe(`rgba(244, 244, 245, ${timing.activeOpacity})`)
    expect(styles[1]).toBe('rgba(244, 244, 245, 0.82)')
    expect(styles[2]).toBe('rgba(244, 244, 245, 0.035)')
  })

  it('整行辉光用 accentColor 且整段一次画完（不是逐字素）', () => {
    const block = makeLiveBlock()
    const context = createFakeContext()
    const timing = resolveFumeBlockTiming(block, 0, null, 1)

    drawFumeLiveBlock(context, block, timing, makeParams({ timeMs: 0 }))

    const first = fillTextCalls(context)[0]
    expect(first.text).toBe('一二三四')
    expect(first.fillStyle).toBe('rgba(234, 88, 12, 0.12)')
    // 辉光画在正文之前：第一条 fillText 必须是辉光
    expect(context.calls[0].kind).not.toBe('fillRect')
  })

  it('行不活跃时不画整行辉光（时间超过 linePassCutoff）', () => {
    const block = makeLiveBlock()
    const context = createFakeContext()
    const timing = resolveFumeBlockTiming(block, 2000, null, 1)

    drawFumeLiveBlock(context, block, timing, makeParams({ timeMs: 2000 }))

    const accentCalls = fillTextCalls(context).filter((call) =>
      call.fillStyle.startsWith('rgba(234, 88, 12')
    )
    expect(timing.linePassCutoffTimeMs).toBeLessThan(2000)
    expect(accentCalls).toEqual([])
  })

  it('所有绘制都发生在正确的字体下（字体串只在入口设一次）', () => {
    const block = makeLiveBlock()
    const context = createFakeContext()
    const theme = makeFumeTheme({ accentColor: ACCENT, primaryColor: PRIMARY })
    const timing = resolveFumeBlockTiming(block, 0, null, 1)

    drawFumeLiveBlock(context, block, timing, makeParams({ theme, timeMs: 0 }))

    const expected = resolveFumeFontSpec(block, theme)
    for (const call of fillTextCalls(context)) {
      expect(call.font).toBe(expected)
      // 对齐方式是**绘制时**的状态（函数退出后会 restore 回调用方的值）
      expect(call.textAlign).toBe('left')
      expect(call.textBaseline).toBe('middle')
    }
  })

  it('alpha 低于可见阈值（0.002）的字素完全不画', () => {
    const block = makeLiveBlock()
    const context = createFakeContext()
    // 手工造一份 timing：waitingOpacity 压到 0.001，整行都应该被跳过
    const timing = resolveFumeBlockTiming(block, 0, null, 1)
    const invisible: FumeBlockTiming = { ...timing, waitingOpacity: 0.001 }

    drawFumeLiveBlock(context, block, invisible, makeParams({ timeMs: 0 }))

    const texts = fillTextCalls(context).map((call) => call.text)
    // 只剩整行辉光那一条（它不受字素 alpha 影响）
    expect(texts).toEqual(['一二三四'])
  })

  it('全程不碰 globalCompositeOperation（§11.3 红线）', () => {
    const block = withTwoWords(makeLiveBlock())
    const context = createFakeContext()
    const timing = resolveFumeBlockTiming(block, 250, null, 1)

    drawFumeLiveBlock(context, block, timing, makeParams({ timeMs: 250, showPrintStamp: true }))

    expect(context.compositeWrites).toBe(0)
  })

  it('退出时 context 状态完全复位（save / restore 成对，无泄漏）', () => {
    const block = withTwoWords(makeLiveBlock())
    const context = createFakeContext()
    // 初始值故意设成哨兵：任何一处漏写都会让它们变化
    context.fillStyle = 'sentinel-fill'
    context.filter = 'sentinel-filter'
    context.shadowBlur = 7
    context.shadowColor = 'sentinel-shadow'
    const timing = resolveFumeBlockTiming(block, 250, null, 1)

    drawFumeLiveBlock(context, block, timing, makeParams({ timeMs: 250, showPrintStamp: true }))

    expect(context.stackDepth).toBe(0)
    expect(context.fillStyle).toBe('sentinel-fill')
    expect(context.filter).toBe('sentinel-filter')
    expect(context.shadowBlur).toBe(7)
    expect(context.shadowColor).toBe('sentinel-shadow')
  })

  it('空区块（没有渲染行）不画任何东西也不报错', () => {
    const block = makeLiveBlock({ renderLines: [], graphemes: [] })
    const context = createFakeContext()
    const timing = resolveFumeBlockTiming(block, 0, null, 1)

    drawFumeLiveBlock(context, block, timing, makeParams({ timeMs: 0 }))

    expect(fillTextCalls(context)).toEqual([])
    expect(context.stackDepth).toBe(0)
  })
})

describe('drawFumeLiveBlock 的打印印章（规格书 §10.5）', () => {
  it('印章落在字之前（印模先落下，字随后盖上去）', () => {
    const block = withTwoWords(makeLiveBlock())
    const context = createFakeContext()
    const timing = resolveFumeBlockTiming(block, 0, null, 1)

    drawFumeLiveBlock(context, block, timing, makeParams({ timeMs: 0, showPrintStamp: true }))

    const rectIndex = context.calls.findIndex((call) => call.kind === 'fillRect')
    // 第一个「正文 run」的起点：整行辉光也是 fillText，但它不裁剪，所以找 rect 更准
    const firstRunIndex = context.calls.findIndex((call) => call.kind === 'rect')
    expect(rectIndex).toBeGreaterThanOrEqual(0)
    expect(rectIndex).toBeLessThan(firstRunIndex)
  })

  it('同一帧里只有处在窗口内的那个字素出印章', () => {
    const block = withTwoWords(makeLiveBlock())
    const context = createFakeContext()
    const timing = resolveFumeBlockTiming(block, 0, null, 1)

    drawFumeLiveBlock(context, block, timing, makeParams({ timeMs: 0, showPrintStamp: true }))

    // 时间 0 时只有第一个字素的窗口（-115..112.2ms）包含它
    expect(fillRectCalls(context)).toHaveLength(1)
  })

  it('showPrintStamp 为 false 时一个印章都不画', () => {
    const block = withTwoWords(makeLiveBlock())
    const context = createFakeContext()
    const timing = resolveFumeBlockTiming(block, 0, null, 1)

    drawFumeLiveBlock(context, block, timing, makeParams({ timeMs: 0, showPrintStamp: false }))

    expect(fillRectCalls(context)).toEqual([])
  })

  it('空白字素不出印章（空格没有"印模"可言）', () => {
    const line = makeLiveRenderLine()
    const spaced = makeLiveBlock({
      line: makeFumeLine({ startTimeMs: 0, endTimeMs: 1000, fullText: '一 二' }),
      graphemes: ['一', ' ', '二', '三'],
      renderLines: [
        {
          ...line,
          text: '一 二三',
          graphemes: ['一', ' ', '二', '三'],
          segments: [
            {
              ...line.segments[0],
              text: '一 二三',
              measuredGlyphOffsets: [0, 50, 60, 110, 160]
            }
          ]
        }
      ]
    })
    const block = withTwoWords(spaced)
    const context = createFakeContext()
    const timing = resolveFumeBlockTiming(block, 0, null, 1)

    drawFumeLiveBlock(context, block, timing, makeParams({ timeMs: 0, showPrintStamp: true }))

    // 只有第一个字素（'一'）在窗口内；空格即便在窗口内也不画
    expect(fillRectCalls(context)).toHaveLength(1)
  })
})
