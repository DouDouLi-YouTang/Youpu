import { describe, expect, it } from 'vitest'

import { buildFumeBackgroundScene } from './background'
import type { FumeBackgroundScene } from '../core/fume-types'

/**
 * `buildFumeBackgroundScene` 的断言（规格书 §12.3 / §12.4）。
 *
 * 只测**场景生成**这一半：它决定了形状数量、分布与确定性，是纯函数。
 * `drawFumeBackground` 需要真实 `CanvasRenderingContext2D`，不进单测
 * （§15.1 的分层：碰 canvas 的部分靠真机截图验收）。
 */

const VIEWPORT = { width: 1600, height: 900 }

function build(overrides: Partial<Parameters<typeof buildFumeBackgroundScene>[0]> = {}) {
  return buildFumeBackgroundScene({ viewport: VIEWPORT, world: VIEWPORT, ...overrides })
}

/** 数出基础形状（非 spark）与火花各多少个 */
function countByKind(scene: FumeBackgroundScene): { base: number; spark: number } {
  let base = 0
  let spark = 0
  for (const shape of scene.shapes) {
    if (shape.kind === 'spark') spark += 1
    else base += 1
  }
  return { base, spark }
}

describe('buildFumeBackgroundScene', () => {
  it('横屏给 8 个基础形状 + 12 个火花', () => {
    expect(countByKind(build())).toEqual({ base: 8, spark: 12 })
  })

  it('竖屏给 7 个基础形状 + 9 个火花', () => {
    // world 需要比 viewport 更"竖"才会走进竖屏分支：worldWidth > worldHeight 才横屏
    const scene = build({
      viewport: { width: 600, height: 1000 },
      world: { width: 600, height: 1000 }
    })
    expect(countByKind(scene)).toEqual({ base: 7, spark: 9 })
  })

  it('形状总数与 id 前缀一一对应', () => {
    const scene = build()
    const ids = scene.shapes.map((shape) => shape.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter((id) => id.startsWith('fume-bg-'))).toHaveLength(8)
    expect(ids.filter((id) => id.startsWith('fume-spark-'))).toHaveLength(12)
  })

  it('同一个种子生成完全相同的场景（位置、尺寸、转速全等）', () => {
    const a = build({ seed: 'same' })
    const b = build({ seed: 'same' })
    expect(a.shapes).toEqual(b.shapes)
  })

  it('不同种子会画出不同的场景（否则"种子"就是摆设）', () => {
    const a = build({ seed: 'alpha' })
    const b = build({ seed: 'beta' })
    expect(a.shapes).not.toEqual(b.shapes)
  })

  it('世界尺寸取"文章与视口 ×1.2"的较大者', () => {
    const scene = build({ world: { width: 100, height: 100 } })
    expect(scene.width).toBeCloseTo(1600 * 1.2, 6)
    expect(scene.height).toBeCloseTo(900 * 1.2, 6)
  })

  it('文章比视口大时以文章为准', () => {
    const scene = build({ world: { width: 5000, height: 4000 } })
    expect(scene.width).toBe(5000)
    expect(scene.height).toBe(4000)
  })

  it('尺寸非法时不生成形状，但仍给出可用的画布尺寸', () => {
    // 0 会让下游除法变成 NaN 坐标：画不出来还白耗每帧
    const scene = buildFumeBackgroundScene({
      viewport: { width: 0, height: 0 },
      world: { width: 0, height: 0 }
    })
    expect(scene.shapes).toEqual([])
    expect(scene.width).toBe(1)
    expect(scene.height).toBe(1)
  })

  it('负尺寸 / NaN 也只返回空场景', () => {
    for (const broken of [-1, Number.NaN]) {
      const scene = buildFumeBackgroundScene({
        viewport: { width: broken, height: 900 },
        world: { width: 1600, height: 900 }
      })
      expect(scene.shapes).toEqual([])
    }
  })

  it('按 depth 升序排列 —— 排序本身就是绘制顺序', () => {
    const depths = build().shapes.map((shape) => shape.depth)
    const sorted = [...depths].sort((a, b) => a - b)
    expect(depths).toEqual(sorted)
  })

  it('基础形状透明度落在 0.01–0.16，火花落在 0.08–0.22（护栏的输入侧）', () => {
    const scene = build()
    for (const shape of scene.shapes) {
      const range = shape.kind === 'spark' ? [0.08, 0.22] : [0.01, 0.16]
      expect(shape.opacity).toBeGreaterThanOrEqual(range[0])
      expect(shape.opacity).toBeLessThanOrEqual(range[1])
    }
  })

  it('只有 ring 带缺口参数，且缺口宽度在 [0.18, PI*0.6] 内', () => {
    for (const shape of build().shapes) {
      if (shape.kind === 'ring') {
        expect(shape.ringGapStart).toBeTypeOf('number')
        expect(shape.ringGapSize).toBeGreaterThanOrEqual(Math.PI * 0.12)
        expect(shape.ringGapSize).toBeLessThanOrEqual(Math.PI * 0.24)
      } else {
        expect(shape.ringGapStart).toBeUndefined()
        expect(shape.ringGapSize).toBeUndefined()
      }
    }
  })

  it('只有 spark 带 audioBand，且频带在五档之内轮换', () => {
    const allowed = new Set(['bass', 'lowMid', 'mid', 'vocal', 'treble'])
    for (const shape of build().shapes) {
      if (shape.kind === 'spark') {
        expect(allowed.has(shape.audioBand ?? '')).toBe(true)
      } else {
        expect(shape.audioBand).toBeUndefined()
      }
    }
  })

  it('形状中心都落在世界范围内（视差只在绘制时偏移，场景本身不出界）', () => {
    const scene = build()
    for (const shape of scene.shapes) {
      expect(shape.x).toBeGreaterThanOrEqual(0)
      expect(shape.x).toBeLessThanOrEqual(scene.width)
      expect(shape.y).toBeGreaterThanOrEqual(0)
      expect(shape.y).toBeLessThanOrEqual(scene.height)
    }
  })

  it('基础尺寸以 min(视口) * 0.72 为基准并被钳到 [320, 760]', () => {
    const scene = build()
    const baseShapes = scene.shapes.filter((shape) => shape.kind !== 'spark')
    // 视口 1600×900 → min = 900 → 648（在 [320, 760] 内，不被钳）
    const baseUnit = 900 * 0.72
    for (const shape of baseShapes) {
      expect(shape.width).toBeGreaterThanOrEqual(baseUnit * 0.82 - 1e-6)
      expect(shape.width).toBeLessThanOrEqual(baseUnit * 1.36 + 1e-6)
      // 基础形状是正方形（height = width）
      expect(shape.height).toBe(shape.width)
    }
  })

  it('极小视口把基准单位抬到下限 320（否则形状小到看不见）', () => {
    const scene = build({
      viewport: { width: 200, height: 150 },
      world: { width: 200, height: 150 }
    })
    const baseShapes = scene.shapes.filter((shape) => shape.kind !== 'spark')
    for (const shape of baseShapes) {
      expect(shape.width).toBeGreaterThanOrEqual(320 * 0.82 - 1e-6)
    }
  })

  it('大视口把基准单位压到上限 760（否则形状糊满整屏）', () => {
    const scene = build({
      viewport: { width: 3840, height: 2160 },
      world: { width: 3840, height: 2160 }
    })
    const baseShapes = scene.shapes.filter((shape) => shape.kind !== 'spark')
    for (const shape of baseShapes) {
      expect(shape.width).toBeLessThanOrEqual(760 * 1.36 + 1e-6)
    }
  })

  it('传入的纸张范围顺序颠倒时会被归正（不让 mix 反着插值）', () => {
    const scene = build({
      paperBounds: { left: 900, top: 700, right: 300, bottom: 100 }
    })
    // 归正后纸在 (300,100)-(900,700)：形状仍需落在世界内，且不应出现 NaN
    for (const shape of scene.shapes) {
      expect(Number.isFinite(shape.x)).toBe(true)
      expect(Number.isFinite(shape.y)).toBe(true)
    }
  })

  it('约 78% 的基础形状**锚点**挂在纸张四条边之外（分布语义，不是均匀撒点）', () => {
    // ⚠️ 判的是**锚点**而不是整个形状：基础形状的尺寸接近纸张本身，
    // 一个锚在纸外的形状，它自身多半仍与纸张矩形重叠 —— 上游的语义是
    // 「锚点环绕纸边并向外溢出」，不是「形状与纸不重叠」。
    // 用多个种子统计比例：单次抽样在 22% 附近的抖动会误伤。
    let outside = 0
    let total = 0
    for (let index = 0; index < 60; index += 1) {
      const scene = build({ seed: `dist-${index}` })
      const worldWidth = scene.width
      const worldHeight = scene.height
      // 与默认纸张范围一致（world 的 24%~76% / 18%~82%）
      const paper = {
        left: worldWidth * 0.24,
        top: worldHeight * 0.18,
        right: worldWidth * 0.76,
        bottom: worldHeight * 0.82
      }
      for (const shape of scene.shapes) {
        if (shape.kind === 'spark') continue
        total += 1
        const anchorOutsidePaper =
          shape.x < paper.left ||
          shape.x > paper.right ||
          shape.y < paper.top ||
          shape.y > paper.bottom
        if (anchorOutsidePaper) outside += 1
      }
    }
    // 上限侧留一点余量：22% 的内部锚点里，贴边的那几个会被 clamp 到纸边界之外
    const ratio = outside / total
    expect(ratio).toBeGreaterThan(0.72)
    expect(ratio).toBeLessThan(0.86)
  })

  it('纸内的锚点会向内缩进 12% 自身尺寸（形状不整个压在纸边上）', () => {
    const scene = build({ seed: 'inside-check' })
    const paper = {
      left: scene.width * 0.24,
      top: scene.height * 0.18,
      right: scene.width * 0.76,
      bottom: scene.height * 0.82
    }
    for (const shape of scene.shapes) {
      if (shape.kind === 'spark') continue
      const anchorInsidePaper =
        shape.x > paper.left &&
        shape.x < paper.right &&
        shape.y > paper.top &&
        shape.y < paper.bottom
      if (!anchorInsidePaper) continue
      expect(shape.x).toBeGreaterThanOrEqual(paper.left + shape.width * 0.12 - 1e-6)
      expect(shape.x).toBeLessThanOrEqual(paper.right - shape.width * 0.12 + 1e-6)
    }
  })
})
