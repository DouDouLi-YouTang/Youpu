/**
 * Canvas 文字绘制的**纯几何**单测（移植规格书 §10.1–§10.3）。
 *
 * 为什么只测纯函数：单测跑在 node，没有 canvas；而这一层真正的风险不在 API 调用，
 * 而在**几何**——留白少一个像素、画布尺寸少一次 ceil、裁剪矩形差一位。
 * 这类错误在浏览器里的表现是「块边缘被切掉一条」「标题比实时绘制低 1px」
 * 「打印到一半突然缺一段字」，都是很难当场归因到某个公式的静默偏差，
 * 所以期望值全部**手算写死**，而不是把实现里的公式再抄一遍（抄公式的断言等于没测）。
 *
 * `createStaticBlockSnapshot` / `drawRenderTextRun` 这两个薄层（碰 context）不在这里测，
 * 与 §15.1 的分层一致。
 */

import { describe, expect, it } from 'vitest'

import {
  FUME_SNAPSHOT_MIN_PADDING_PX,
  FUME_SNAPSHOT_MAX_RASTER_SCALE,
  FUME_TEXT_ALIGN,
  FUME_TEXT_BASELINE,
  buildTextStyleKey,
  resolveBaselineOffset,
  resolveFumeFontSpec,
  resolveSnapshotCanvasSize,
  resolveSnapshotPadding,
  resolveSnapshotRasterScale,
  resolveStaticSnapshotPlan,
  resolveTextRunClip
} from './canvas-text'
import {
  makeFumeBlock,
  makeFumeLine,
  makeFumeTheme,
  makeRenderLine
} from '../core/fume-test-fixtures'

/** 内置衬线族的字面量（与 `shared/folia-font.ts` 的常量、`fonts.scss` 的 @font-face 对齐） */
const BUILTIN_SERIF = '"Folia Noto Serif SC"'
/** 默认主题解析出的完整字体栈（serif 档） */
const DEFAULT_FAMILY = `${BUILTIN_SERIF}, serif`

describe('resolveFumeFontSpec（规格书 §10.1）', () => {
  it('body / hero 的默认字重分别是 640 / 780', () => {
    expect(resolveFumeFontSpec({ fontPx: 32, variant: 'body' }, makeFumeTheme())).toBe(
      `640 32px ${DEFAULT_FAMILY}`
    )
    expect(resolveFumeFontSpec({ fontPx: 48, variant: 'hero' }, makeFumeTheme())).toBe(
      `780 48px ${DEFAULT_FAMILY}`
    )
  })

  it('主题给字重时覆盖档位默认值', () => {
    expect(
      resolveFumeFontSpec({ fontPx: 32, variant: 'body' }, makeFumeTheme({ fontWeight: 700 }))
    ).toBe(`700 32px ${DEFAULT_FAMILY}`)
  })

  it('字号保留小数（字号二分的结果不是整数）', () => {
    expect(resolveFumeFontSpec({ fontPx: 17.5, variant: 'body' }, makeFumeTheme())).toBe(
      `640 17.5px ${DEFAULT_FAMILY}`
    )
  })

  it('主题的自定义族排在内置族之前（顺序就是优先级）', () => {
    expect(
      resolveFumeFontSpec({ fontPx: 32, variant: 'body' }, makeFumeTheme({ fontFamily: 'My Font' }))
    ).toBe(`640 32px "My Font", ${DEFAULT_FAMILY}`)
  })

  it('textAlign / textBaseline 取 §10.1 的固定值', () => {
    expect(FUME_TEXT_ALIGN).toBe('left')
    expect(FUME_TEXT_BASELINE).toBe('middle')
  })
})

describe('resolveBaselineOffset（规格书 §10.1 与 §8.3 共用的基线公式）', () => {
  it('CJK 用 0.52、纯拉丁用 0.5', () => {
    expect(resolveBaselineOffset(40, '一二三四五')).toBe(40 * 0.52)
    expect(resolveBaselineOffset(40, 'Hello')).toBe(40 * 0.5)
  })

  it('混排里有 CJK 就按 CJK 算（中英同行的视觉重心以汉字为准）', () => {
    expect(resolveBaselineOffset(42, 'abc 世界')).toBe(42 * 0.52)
  })

  it('空文本按拉丁算（退化成几何中线，不会抖出 0.02 的偏移）', () => {
    expect(resolveBaselineOffset(42, '')).toBe(21)
  })
})

describe('resolveSnapshotRasterScale（规格书 §10.2）', () => {
  it('钳到 [1, 2]', () => {
    expect(resolveSnapshotRasterScale(0.5)).toBe(1)
    expect(resolveSnapshotRasterScale(1)).toBe(1)
    expect(resolveSnapshotRasterScale(1.75)).toBe(1.75)
    expect(resolveSnapshotRasterScale(2)).toBe(2)
    expect(resolveSnapshotRasterScale(3)).toBe(FUME_SNAPSHOT_MAX_RASTER_SCALE)
  })

  it('非数字 / 缺失 / 负数一律退化成 1（部分嵌入环境会给 0）', () => {
    expect(resolveSnapshotRasterScale(Number.NaN)).toBe(1)
    expect(resolveSnapshotRasterScale(Number.POSITIVE_INFINITY)).toBe(1)
    expect(resolveSnapshotRasterScale(-2)).toBe(1)
    expect(resolveSnapshotRasterScale(undefined)).toBe(1)
    expect(resolveSnapshotRasterScale(null)).toBe(1)
  })
})

describe('resolveSnapshotPadding（规格书 §10.2）', () => {
  it('字号主导：fontPx × 0.32 向上取整', () => {
    expect(resolveSnapshotPadding(30)).toBe(10) // 9.6
    expect(resolveSnapshotPadding(32)).toBe(11) // 10.24
  })

  it('辉光主导：shadowBlur + fontPx × 0.08', () => {
    // max(32 × 0.32 = 10.24, 40 + 2.56 = 42.56, 4) → 43
    expect(resolveSnapshotPadding(32, 40)).toBe(43)
  })

  it('小字号落到 4px 下限（即使不发光也要留出字形外扩）', () => {
    expect(resolveSnapshotPadding(8)).toBe(FUME_SNAPSHOT_MIN_PADDING_PX)
    expect(resolveSnapshotPadding(12, -100)).toBe(FUME_SNAPSHOT_MIN_PADDING_PX)
  })

  it('取整方向是 ceil（少一个像素就会切掉最亮的边缘）', () => {
    expect(resolveSnapshotPadding(20)).toBe(7) // 6.4 → 7
    expect(resolveSnapshotPadding(31)).toBe(10) // 9.92 → 10
  })
})

describe('resolveSnapshotCanvasSize（规格书 §10.2）', () => {
  it('先加两侧留白，再乘栅格缩放，最后向上取整', () => {
    expect(resolveSnapshotCanvasSize(400, 40, 11, 2)).toEqual({ width: 844, height: 124 })
    expect(resolveSnapshotCanvasSize(399.5, 40.5, 10, 1.5)).toEqual({ width: 630, height: 91 })
  })

  it('没有留白、缩放为 1 时就是块尺寸本身', () => {
    expect(resolveSnapshotCanvasSize(400, 40, 0, 1)).toEqual({ width: 400, height: 40 })
  })

  it('退化输入不会造出 0 尺寸画布（getContext 之前就崩）', () => {
    expect(resolveSnapshotCanvasSize(0, 0, 0, 1)).toEqual({ width: 1, height: 1 })
    expect(resolveSnapshotCanvasSize(0.2, 0.2, 0, 1)).toEqual({ width: 1, height: 1 })
  })
})

describe('resolveStaticSnapshotPlan（规格书 §10.2 的纯部分）', () => {
  it('默认 body 块：留白 / 画布像素 / CJK 基线 / 每行落点都能手算', () => {
    const block = makeFumeBlock()
    const plan = resolveStaticSnapshotPlan(block, makeFumeTheme(), 0, 2)

    expect(plan.padding).toBe(11)
    expect(plan.canvasWidth).toBe(844)
    expect(plan.canvasHeight).toBe(124)
    expect(plan.rasterScale).toBe(2)
    expect(plan.baselineOffset).toBe(40 * 0.52)
    expect(plan.fontSpec).toBe(`640 32px ${DEFAULT_FAMILY}`)
    expect(plan.lines).toEqual([{ text: '一一一一一一一一', x: 0 + 11, y: 0 + 40 * 0.52 + 11 }])
  })

  it('hero 的行内缩进与行号参与落点（忽略 left 会让快照和实时绘制错位）', () => {
    const block = makeFumeBlock({
      variant: 'hero',
      fontPx: 48,
      lineHeight: 49,
      line: makeFumeLine({ fullText: 'Hello' }),
      renderLines: [
        makeRenderLine({
          text: 'Hello',
          graphemes: ['H', 'e', 'l', 'l', 'o'],
          glyphOffsets: [0, 20, 40, 60, 80],
          width: 100,
          left: 12,
          top: 0
        }),
        makeRenderLine({
          text: 'world',
          graphemes: ['w', 'o', 'r', 'l', 'd'],
          glyphOffsets: [0, 20, 40, 60, 80],
          width: 100,
          left: 12,
          top: 49
        })
      ]
    })
    const plan = resolveStaticSnapshotPlan(block, makeFumeTheme(), 0, 1)

    expect(plan.padding).toBe(16) // 48 × 0.32 = 15.36 → 16
    expect(plan.baselineOffset).toBe(49 * 0.5) // 纯拉丁
    expect(plan.fontSpec).toBe(`780 48px ${DEFAULT_FAMILY}`)
    expect(plan.lines).toEqual([
      { text: 'Hello', x: 12 + 16, y: 0 + 24.5 + 16 },
      { text: 'world', x: 12 + 16, y: 49 + 24.5 + 16 }
    ])
  })

  it('辉光半径进入留白（亮字的快照要比暗字多留一圈）', () => {
    const block = makeFumeBlock()
    const plan = resolveStaticSnapshotPlan(block, makeFumeTheme(), 40, 1)

    expect(plan.padding).toBe(43)
    expect(plan.canvasWidth).toBe(400 + 86)
    expect(plan.canvasHeight).toBe(40 + 86)
  })
})

describe('buildTextStyleKey（规格书 §10.3）', () => {
  it('shadowBlur 取三位小数（尾数抖动不该拆开本可合并的 run）', () => {
    expect(buildTextStyleKey('rgb(1, 2, 3)', 0.1, 'rgb(0, 0, 0)')).toBe(
      'rgb(1, 2, 3)|rgb(0, 0, 0)|0.100'
    )
    expect(buildTextStyleKey('rgb(1, 2, 3)', 0.1000001, 'rgb(0, 0, 0)')).toBe(
      buildTextStyleKey('rgb(1, 2, 3)', 0.1, 'rgb(0, 0, 0)')
    )
    expect(buildTextStyleKey('rgb(1, 2, 3)', 1.23456, 'rgb(0, 0, 0)')).toBe(
      'rgb(1, 2, 3)|rgb(0, 0, 0)|1.235'
    )
  })

  it('字色 / 辉光色 / 辉光半径任一不同就是不同的键', () => {
    const base = buildTextStyleKey('rgb(1, 2, 3)', 8, 'rgb(0, 0, 0)')

    expect(buildTextStyleKey('rgb(4, 5, 6)', 8, 'rgb(0, 0, 0)')).not.toBe(base)
    expect(buildTextStyleKey('rgb(1, 2, 3)', 8, 'rgb(9, 9, 9)')).not.toBe(base)
    expect(buildTextStyleKey('rgb(1, 2, 3)', 9, 'rgb(0, 0, 0)')).not.toBe(base)
    expect(buildTextStyleKey('rgb(1, 2, 3)', 8, 'rgb(0, 0, 0)')).toBe(base)
  })
})

describe('resolveTextRunClip（规格书 §10.3）', () => {
  /** 一条 8 字素、每字素 50px 的行（行宽 400） */
  const renderLine = makeRenderLine()
  /** 前 4 个字素的片段：实测偏移比 pretext 略宽（55 / 105 / 160 / 210） */
  const segment = { localStart: 0, x: 0, measuredGlyphOffsets: [0, 55, 105, 160, 210] }

  it('横向夹在两个字素的实测偏移之间', () => {
    // runStart = 1 → 55；runEnd = 2 → 105；宽度 50
    expect(resolveTextRunClip(renderLine, segment, 1, 2, 1000, 500)).toEqual({
      x: 1055,
      y: 500 - 50 - 64,
      width: 50,
      height: 256
    })
  })

  it('纵向框随字宽增长（128 + clipWidth × 2，下限 256）', () => {
    // clipWidth = 210 - 55 = 155 → 128 + 310 = 438 > 256
    expect(resolveTextRunClip(renderLine, segment, 1, 99, 0, 0)).toEqual({
      x: 55,
      y: -155 - 64,
      width: 155,
      height: 438
    })
  })

  it('runStart 早于片段起点时钳到片段首', () => {
    // max(-5 - 0, 0) = 0 → clipLeft = 0；runEnd = 1 → clipRight = 55
    expect(resolveTextRunClip(renderLine, segment, -5, 1, 1000, 500)).toEqual({
      x: 1000,
      y: 500 - 55 - 64,
      width: 55,
      height: 256
    })
  })

  it('runEnd 超过片段末时钳到最后一项（末尾是整段宽）', () => {
    const clip = resolveTextRunClip(renderLine, segment, 0, 99, 0, 0)

    expect(clip.width).toBe(210)
    expect(clip.x).toBe(0)
  })

  it('实测偏移相同 → 宽度 0（调用方据此跳过 fillText，不要画零宽裁剪）', () => {
    const flat = { localStart: 0, x: 0, measuredGlyphOffsets: [0, 40, 40, 90] }

    expect(resolveTextRunClip(renderLine, flat, 1, 2, 1000, 500)).toEqual({
      x: 1040,
      y: 500 - 1 - 64,
      width: 0,
      height: 256
    })
  })

  it('区间反向时宽度钳到 0（不是负数，负宽 rect 的行为随浏览器而异）', () => {
    const clip = resolveTextRunClip(renderLine, segment, 3, 2, 0, 0)

    expect(clip.width).toBe(0)
    expect(clip.x).toBe(160)
  })

  it('下标越出实测表时退回 pretext 口径的 x，宽度 0 且不会出现 NaN', () => {
    // 后半段的片段：局部起点 6、行内 x = 300、只有 2 个字素的实测数据
    const tail = { localStart: 6, x: 300, measuredGlyphOffsets: [0, 40, 85] }
    const clip = resolveTextRunClip(renderLine, tail, 9, 12, 1000, 500)

    // runStart = 9 超出片段的实测表 → clipLeft = resolveRenderLineOffset(line, 9) - 300 = 100
    expect(clip.x).toBe(1000 + 400)
    expect(clip.width).toBe(0)
    expect(clip.y).toBe(500 - 1 - 64)
  })

  it('片段整体在行首之后时 x 含片段自身的行内偏移', () => {
    const tail = { localStart: 6, x: 300, measuredGlyphOffsets: [0, 40, 85] }

    // runStart = 7（片段内第 1 个字素）→ clipLeft = 40；runEnd = 8 → clipRight = 85
    expect(resolveTextRunClip(renderLine, tail, 7, 8, 1000, 500)).toEqual({
      x: 1340,
      y: 500 - 45 - 64,
      width: 45,
      height: 256
    })
  })
})
