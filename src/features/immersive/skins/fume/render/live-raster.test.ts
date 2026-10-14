/**
 * 实时区块栅格的单测（移植规格书 §11.4 / §11.5）。
 *
 * ## 这层要钉住什么
 *
 * 它的存在理由只有一个：让「字形尺寸的集合有界」，从而不让 Chromium 在 Linux 上
 * 每帧铸一个新 strike 直到耗尽共享内存（见 `live-raster.ts` 文件头）。所以断言的重点
 * 不是"画得对不对"，而是**倍率离散化的档位是否成立**、**画布容量是否只增不减**、
 * **空闲回收的边界是否与快照层一致** —— 这三条错了都不会立刻报错，而是几十分钟后
 * 卡死或者内存缓慢上涨。
 *
 * ## 为什么用假 canvas
 *
 * node 里没有 `HTMLCanvasElement`，而 `drawFumeLiveBlock` 需要真实的 2D 方法。
 * 下面的桩件实现了它真正会调到的那几个方法（`setTransform` / `clearRect` /
 * `fillText` / `fillRect` / `save` / `restore` / `rect` / `clip` / `measureText`），
 * 并把调用记下来，于是「先清屏再变换」这种顺序也能断言。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FumeLiveRaster,
  LIVE_CANVAS_GRANULE,
  LIVE_IDLE_MS,
  LIVE_RASTER_LEVELS_PER_OCTAVE,
  resolveLiveRasterScale,
  type FumeLiveRasterFrame
} from './live-raster'
import { setGlowBlurQuantized } from '../../shared/glow-blur-quantize'
import { resolveFumeBlockTiming } from '../core/block-frame'
import { makeFumeBlock, makeFumeLine, makeFumeTheme } from '../core/fume-test-fixtures'
import type { FumeBlock } from '../core/fume-types'

const VISIBLE_ALL: FumeLiveRasterFrame['visible'] = {
  left: -100_000,
  top: -100_000,
  right: 100_000,
  bottom: 100_000
}

/** 造一个实时绘制的区块：200×40、字号 32、行高 40 */
function makeBlock(overrides: Partial<FumeBlock> = {}): FumeBlock {
  return makeFumeBlock({
    id: 'fume-0-0',
    x: 100,
    y: 200,
    width: 200,
    height: 40,
    fontPx: 32,
    lineHeight: 40,
    line: makeFumeLine({ startTimeMs: 0, endTimeMs: 1000, fullText: '一二三四' }),
    graphemes: ['一', '二', '三', '四'],
    renderLines: [],
    wordRanges: [],
    ...overrides
  })
}

function makeParams() {
  return {
    timeMs: 0,
    theme: makeFumeTheme(),
    glowIntensity: 1,
    activeGlowBoost: 1,
    passedGlowBase: 1,
    showPrintStamp: false
  }
}

/** 假 2D context：记录调用序列，`setTransform` / `clearRect` 的参数原样留下 */
function createFakeContext() {
  const calls: { kind: string; args: number[] }[] = []
  const context = {
    font: '',
    textAlign: '',
    textBaseline: '',
    fillStyle: '',
    filter: '',
    shadowBlur: 0,
    shadowColor: 'transparent',
    calls,
    setTransform(...args: number[]) {
      calls.push({ kind: 'setTransform', args })
    },
    clearRect(...args: number[]) {
      calls.push({ kind: 'clearRect', args })
    },
    save() {
      calls.push({ kind: 'save', args: [] })
    },
    restore() {
      calls.push({ kind: 'restore', args: [] })
    },
    fillText() {
      calls.push({ kind: 'fillText', args: [] })
    },
    fillRect(...args: number[]) {
      calls.push({ kind: 'fillRect', args })
    },
    measureText: () => ({
      width: 0,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 0,
      actualBoundingBoxAscent: 0,
      actualBoundingBoxDescent: 0
    }),
    beginPath() {},
    rect() {},
    clip() {}
  }
  return context as unknown as CanvasRenderingContext2D & {
    calls: { kind: string; args: number[] }[]
  }
}

/** 假 canvas：`width` / `height` 可写，`getContext` 返回同一个假 context */
function createFakeCanvas() {
  const context = createFakeContext()
  const canvas = {
    width: 0,
    height: 0,
    context,
    getContext: (kind: string) => (kind === '2d' ? context : null)
  }
  return canvas as unknown as HTMLCanvasElement & {
    context: ReturnType<typeof createFakeContext>
  }
}

/** 安装 `document.createElement` 桩件，并返回所有被创建过的假 canvas */
function stubDocument() {
  const created: ReturnType<typeof createFakeCanvas>[] = []
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = createFakeCanvas()
      created.push(canvas)
      return canvas
    }
  })
  return created
}

beforeEach(() => {
  // 与 canvas-text-live 的单测同款：显式关掉 Linux 降级开关，避免平台判定改变
  // `fillGlowText` 的分支、进而改变调用序列
  setGlowBlurQuantized(false)
})

afterEach(() => {
  setGlowBlurQuantized(false)
  vi.unstubAllGlobals()
})

describe('resolveLiveRasterScale（规格书 §11.5）', () => {
  it('每倍频 48 档（常数本身就是契约）', () => {
    expect(LIVE_RASTER_LEVELS_PER_OCTAVE).toBe(48)
  })

  it('正好落在档位上时返回原值（不白升一档）', () => {
    expect(resolveLiveRasterScale(1)).toBe(1)
    expect(resolveLiveRasterScale(2)).toBe(2)
    expect(resolveLiveRasterScale(0.5)).toBe(0.5)
    expect(resolveLiveRasterScale(4)).toBe(4)
  })

  it('单调不减：输入变大，档位不会变小', () => {
    let previous = resolveLiveRasterScale(1e-3)
    for (let scale = 1e-3; scale <= 8; scale *= 1.07) {
      const level = resolveLiveRasterScale(scale)
      expect(level).toBeGreaterThanOrEqual(previous)
      previous = level
    }
  })

  it('永不低于输入（贴回舞台只会缩小，不会放大）', () => {
    for (let scale = 1e-3; scale <= 8; scale *= 1.03) {
      expect(resolveLiveRasterScale(scale)).toBeGreaterThanOrEqual(scale - 1e-12)
    }
  })

  it('最多比输入高 1.45%（2^(1/48) - 1）', () => {
    const maxRatio = 2 ** (1 / LIVE_RASTER_LEVELS_PER_OCTAVE)
    for (let scale = 1e-3; scale <= 8; scale *= 1.01) {
      const level = resolveLiveRasterScale(scale)
      expect(level / scale).toBeLessThanOrEqual(maxRatio + 1e-12)
    }
  })

  it('0 / 负数 / 非有限值都兜到 1e-3 档，不返回 0 或 NaN', () => {
    for (const scale of [0, -1, -1e9]) {
      const level = resolveLiveRasterScale(scale)
      expect(Number.isFinite(level)).toBe(true)
      expect(level).toBeGreaterThan(0)
      expect(level).toBeLessThanOrEqual(1e-3 * 2 ** (1 / LIVE_RASTER_LEVELS_PER_OCTAVE))
    }
  })
})

describe('FumeLiveRaster.draw 的裁剪与返回值（规格书 §11.5）', () => {
  it('区块完全在可见区外时返回 null（不分配画布）', () => {
    const created = stubDocument()
    const raster = new FumeLiveRaster()
    const block = makeBlock({ x: 1000, y: 1000 })
    const frame: FumeLiveRasterFrame = {
      deviceScale: 1,
      visible: { left: 0, top: 0, right: 500, bottom: 500 }
    }

    const image = raster.draw(
      block,
      resolveFumeBlockTiming(block, 0, null, 1),
      makeParams(),
      frame,
      0
    )

    expect(image).toBeNull()
    expect(created).toHaveLength(0)
  })

  it('可见区只有一条缝（宽度为 0）时返回 null', () => {
    const created = stubDocument()
    const raster = new FumeLiveRaster()
    const block = makeBlock()
    const frame: FumeLiveRasterFrame = {
      deviceScale: 1,
      visible: { left: 400, top: -1000, right: 400, bottom: 1000 }
    }

    expect(
      raster.draw(block, resolveFumeBlockTiming(block, 0, null, 1), makeParams(), frame, 0)
    ).toBeNull()
    expect(created).toHaveLength(0)
  })

  it('裁剪框含 pad：世界矩形比区块本身更大（辉光与印章要留出余量）', () => {
    stubDocument()
    const raster = new FumeLiveRaster()
    const block = makeBlock()
    const frame: FumeLiveRasterFrame = { deviceScale: 1, visible: VISIBLE_ALL }

    const image = raster.draw(
      block,
      resolveFumeBlockTiming(block, 0, null, 1),
      makeParams(),
      frame,
      0
    )!

    // pad = ceil(40 × 0.5 + (12 + 32 × 0.7) × 1 × 1.5 / 1) = ceil(20 + 51.6) = 72
    expect(image.x).toBe(100 - 72)
    expect(image.y).toBe(200 - 72)
    expect(image.width).toBe(Math.ceil((200 + 72 * 2) * 1))
    expect(image.height).toBe(Math.ceil((40 + 72 * 2) * 1))
  })

  it('worldWidth / worldHeight = width / height ÷ scale', () => {
    stubDocument()
    const raster = new FumeLiveRaster()
    const block = makeBlock()
    const frame: FumeLiveRasterFrame = { deviceScale: 2, visible: VISIBLE_ALL }

    const image = raster.draw(
      block,
      resolveFumeBlockTiming(block, 0, null, 1),
      makeParams(),
      frame,
      0
    )!
    const scale = resolveLiveRasterScale(2)

    expect(image.worldWidth).toBeCloseTo(image.width / scale, 10)
    expect(image.worldHeight).toBeCloseTo(image.height / scale, 10)
  })

  it('每次 draw 都先清屏再设置世界变换（顺序反了会留下残影）', () => {
    stubDocument()
    const raster = new FumeLiveRaster()
    const block = makeBlock()
    const frame: FumeLiveRasterFrame = { deviceScale: 1, visible: VISIBLE_ALL }

    raster.draw(block, resolveFumeBlockTiming(block, 0, null, 1), makeParams(), frame, 0)

    const canvas = raster.draw(
      block,
      resolveFumeBlockTiming(block, 0, null, 1),
      makeParams(),
      frame,
      16
    )!
    const calls = (canvas.canvas as unknown as { context: { calls: { kind: string }[] } }).context
      .calls
    const kinds = calls.map((call) => call.kind)

    expect(kinds.slice(0, 3)).toEqual(['setTransform', 'clearRect', 'setTransform'])
  })

  it('拿不到 2d context 时返回 null 而不是抛错（抛出去会让渲染循环整帧死掉）', () => {
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => null })
    })
    const raster = new FumeLiveRaster()
    const block = makeBlock()
    const frame: FumeLiveRasterFrame = { deviceScale: 1, visible: VISIBLE_ALL }

    expect(
      raster.draw(block, resolveFumeBlockTiming(block, 0, null, 1), makeParams(), frame, 0)
    ).toBeNull()
  })

  it('返回值是**复用**的同一个对象（每帧每个在屏区块不分配新对象）', () => {
    stubDocument()
    const raster = new FumeLiveRaster()
    const frame: FumeLiveRasterFrame = { deviceScale: 1, visible: VISIBLE_ALL }
    const first = makeBlock({ id: 'a' })
    const second = makeBlock({ id: 'b' })

    const firstImage = raster.draw(
      first,
      resolveFumeBlockTiming(first, 0, null, 1),
      makeParams(),
      frame,
      0
    )
    const secondImage = raster.draw(
      second,
      resolveFumeBlockTiming(second, 0, null, 1),
      makeParams(),
      frame,
      0
    )

    expect(firstImage).toBe(secondImage)
  })
})

describe('画布容量：256 取整且只增不减（规格书 §11.5）', () => {
  it('容量按 LIVE_CANVAS_GRANULE 向上取整', () => {
    stubDocument()
    const raster = new FumeLiveRaster()
    const block = makeBlock()
    const frame: FumeLiveRasterFrame = { deviceScale: 1, visible: VISIBLE_ALL }

    const image = raster.draw(
      block,
      resolveFumeBlockTiming(block, 0, null, 1),
      makeParams(),
      frame,
      0
    )!
    const canvas = image.canvas

    expect(LIVE_CANVAS_GRANULE).toBe(256)
    // 需要 344×184 → 容量 512×256
    expect(canvas.width).toBe(512)
    expect(canvas.height).toBe(256)
    expect(canvas.width % LIVE_CANVAS_GRANULE).toBe(0)
    expect(canvas.height % LIVE_CANVAS_GRANULE).toBe(0)
    expect(canvas.width).toBeGreaterThanOrEqual(image.width)
    expect(canvas.height).toBeGreaterThanOrEqual(image.height)
  })

  it('第二次需要更小的画布时不缩小（相机缩回来不该重新分配）', () => {
    stubDocument()
    const raster = new FumeLiveRaster()
    const block = makeBlock()
    const timing = resolveFumeBlockTiming(block, 0, null, 1)

    const first = raster.draw(
      block,
      timing,
      makeParams(),
      { deviceScale: 1, visible: VISIBLE_ALL },
      0
    )!
    // ⚠️ 返回值是**复用**的同一个对象（见 live-raster.ts 的 FumeLiveRasterImage），
    // 所以必须在第二次 draw 之前把字段抄出来，否则读到的已经是第二次的值
    const firstCanvas = first.canvas
    const firstWidth = first.width
    const firstHeight = first.height

    const second = raster.draw(
      block,
      timing,
      makeParams(),
      { deviceScale: 0.5, visible: VISIBLE_ALL },
      16
    )!

    expect(second.canvas).toBe(firstCanvas)
    expect(second.canvas.width).toBe(512)
    expect(second.canvas.height).toBe(256)
    // 贴回的世界矩形用的是**本次**需要的尺寸，不是画布容量
    expect(second.width).toBeLessThan(firstWidth)
    expect(second.height).toBeLessThan(firstHeight)
  })

  it('需要更大时按粒度增长（不是精确尺寸）', () => {
    stubDocument()
    const raster = new FumeLiveRaster()
    const block = makeBlock()
    const timing = resolveFumeBlockTiming(block, 0, null, 1)

    raster.draw(block, timing, makeParams(), { deviceScale: 1, visible: VISIBLE_ALL }, 0)
    const grown = raster.draw(
      block,
      timing,
      makeParams(),
      { deviceScale: 4, visible: VISIBLE_ALL },
      16
    )!

    // 需要 1064 → 容量 1280
    expect(grown.canvas.width).toBe(1280)
    expect(grown.canvas.width).toBeGreaterThanOrEqual(grown.width)
  })

  it('不同区块各有一张画布（按 block.id 分桶）', () => {
    stubDocument()
    const raster = new FumeLiveRaster()
    const frame: FumeLiveRasterFrame = { deviceScale: 1, visible: VISIBLE_ALL }
    const a = makeBlock({ id: 'a' })
    const b = makeBlock({ id: 'b' })

    // 同样要在第二次调用前抄出 canvas 引用（返回值是复用的）
    const canvasA = raster.draw(
      a,
      resolveFumeBlockTiming(a, 0, null, 1),
      makeParams(),
      frame,
      0
    )!.canvas
    const canvasB = raster.draw(
      b,
      resolveFumeBlockTiming(b, 0, null, 1),
      makeParams(),
      frame,
      0
    )!.canvas

    expect(canvasA).not.toBe(canvasB)
  })
})

describe('sweep / clear 的空闲回收（规格书 §11.5）', () => {
  it('恰好卡在 LIVE_IDLE_MS 上的这一帧仍然保留', () => {
    stubDocument()
    const raster = new FumeLiveRaster()
    const block = makeBlock()
    const frame: FumeLiveRasterFrame = { deviceScale: 1, visible: VISIBLE_ALL }
    const firstCanvas = raster.draw(
      block,
      resolveFumeBlockTiming(block, 0, null, 1),
      makeParams(),
      frame,
      1000
    )!.canvas

    raster.sweep(1000 + LIVE_IDLE_MS)

    expect(LIVE_IDLE_MS).toBe(5000)
    expect(firstCanvas.width).toBe(512)
    // 5 秒整没被回收：同一条记录还在，复用同一张画布
    expect(
      raster.draw(
        block,
        resolveFumeBlockTiming(block, 0, null, 1),
        makeParams(),
        frame,
        1000 + LIVE_IDLE_MS
      )!.canvas
    ).toBe(firstCanvas)
  })

  it('超过 LIVE_IDLE_MS 后释放：先把后备存储归零再删记录', () => {
    stubDocument()
    const raster = new FumeLiveRaster()
    const block = makeBlock()
    const frame: FumeLiveRasterFrame = { deviceScale: 1, visible: VISIBLE_ALL }
    const image = raster.draw(
      block,
      resolveFumeBlockTiming(block, 0, null, 1),
      makeParams(),
      frame,
      1000
    )!

    raster.sweep(1000 + LIVE_IDLE_MS + 1)

    expect(image.canvas.width).toBe(0)
    expect(image.canvas.height).toBe(0)
  })

  it('释放后重新绘制会拿到一张新画布', () => {
    const created = stubDocument()
    const raster = new FumeLiveRaster()
    const block = makeBlock()
    const frame: FumeLiveRasterFrame = { deviceScale: 1, visible: VISIBLE_ALL }
    const timing = resolveFumeBlockTiming(block, 0, null, 1)

    const firstCanvas = raster.draw(block, timing, makeParams(), frame, 0)!.canvas
    raster.sweep(LIVE_IDLE_MS + 1)
    const secondCanvas = raster.draw(block, timing, makeParams(), frame, LIVE_IDLE_MS + 2)!.canvas

    expect(secondCanvas).not.toBe(firstCanvas)
    expect(created).toHaveLength(2)
  })

  it('clear() 释放全部（文章 / 主题变化与卸载时调）', () => {
    stubDocument()
    const raster = new FumeLiveRaster()
    const frame: FumeLiveRasterFrame = { deviceScale: 1, visible: VISIBLE_ALL }
    const a = makeBlock({ id: 'a' })
    const b = makeBlock({ id: 'b' })
    const imageA = raster.draw(a, resolveFumeBlockTiming(a, 0, null, 1), makeParams(), frame, 0)!
    const imageB = raster.draw(b, resolveFumeBlockTiming(b, 0, null, 1), makeParams(), frame, 0)!

    raster.clear()

    expect([imageA.canvas.width, imageB.canvas.width]).toEqual([0, 0])
  })

  it('sweep 的 now 是 NaN 时一律不动（时钟拿不到时全清最糟）', () => {
    stubDocument()
    const raster = new FumeLiveRaster()
    const block = makeBlock()
    const frame: FumeLiveRasterFrame = { deviceScale: 1, visible: VISIBLE_ALL }
    const image = raster.draw(
      block,
      resolveFumeBlockTiming(block, 0, null, 1),
      makeParams(),
      frame,
      0
    )!

    raster.sweep(Number.NaN)

    expect(image.canvas.width).toBe(512)
  })
})
