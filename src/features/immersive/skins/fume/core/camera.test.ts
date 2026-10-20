/**
 * 「浮名」相机纯函数单测（规格书 §9.2–§9.6 + §9.8）。
 *
 * 这里断言的是**几何组合关系**（下标 × 50px 的线性假测量），不是把实现里的公式
 * 再抄一遍：每个期望值都能拿纸笔从 §9 的伪码推出来，推不出来的值说明实现和规格书
 * 已经在某个分支上分叉了。
 */

import { describe, expect, it } from 'vitest'
import {
  CAMERA_SCALE_MAX,
  CAMERA_SCALE_MIN,
  FUME_BACKGROUND_PARALLAX_X,
  FUME_BACKGROUND_PARALLAX_Y,
  FUME_BACKGROUND_SCALE_FACTOR,
  FUME_BACKGROUND_VERTICAL_OFFSET_RATIO,
  FUME_CAMERA_TELEPORT_TRIGGER_SCREENS,
  OVERVIEW_CAMERA_SOURCE,
  resolveArticleOverviewCamera,
  resolveBlockEntryFocusPoint,
  resolveCameraRetargetDurationMs,
  resolveCameraScaleForBlock,
  resolveFocusBlock,
  resolveFumeBackgroundView,
  resolveOverviewFlightBridge,
  resolveOverviewRetargetDurationMs,
  resolveSmoothBlockFocusPoint,
  resolveSteppedBlockFocusPoint
} from './camera'
import {
  FIXTURE_MEASURE,
  FIXTURE_VIEWPORT,
  makeFumeBlock,
  makeFumeCamera,
  makeFumeLine
} from './fume-test-fixtures'
import type { FumeArticleLayout, FumeBlock } from './fume-types'

/** 便捷构造：只有 blocks 需要给，其余派生字段按夹具口径补齐 */
function makeArticleFromBlocks(
  blocks: FumeBlock[],
  paper: { width: number; height: number }
): FumeArticleLayout {
  return {
    width: paper.width,
    height: paper.height,
    viewportHeight: 800,
    columns: 2,
    gap: 40,
    paperBounds: { left: 0, top: 0, right: paper.width, bottom: paper.height },
    blocks,
    blockBySourceLineIndex: new Map(blocks.map((block) => [block.sourceLineIndex, block])),
    chronologicalBlocks: [...blocks].sort(
      (left, right) => left.sourceLineIndex - right.sourceLineIndex
    ),
    firstRenderableStartTimeMs: 1000,
    lastChronologicalRenderEndTimeMs: 4240
  }
}

/** 造一段「时间轴上互不重叠」的假文章：两块，分别对应 0 / 1 号源行 */
function makeTwoBlockArticle(): FumeArticleLayout {
  const firstBlock = makeFumeBlock({
    sourceLineIndex: 0,
    line: makeFumeLine({ startTimeMs: 1000, endTimeMs: 2000 })
  })
  const secondBlock = makeFumeBlock({
    sourceLineIndex: 1,
    line: makeFumeLine({ startTimeMs: 3000, endTimeMs: 4000 }),
    x: 1000,
    y: 200
  })

  return {
    width: 1400,
    height: 240,
    viewportHeight: 800,
    columns: 2,
    gap: 40,
    paperBounds: { left: 0, top: 0, right: 1400, bottom: 240 },
    blocks: [firstBlock, secondBlock],
    blockBySourceLineIndex: new Map([
      [0, firstBlock],
      [1, secondBlock]
    ]),
    chronologicalBlocks: [firstBlock, secondBlock],
    firstRenderableStartTimeMs: 1000,
    // 末行的渲染结束时间（3000→4000 的 normal 行 = 4240）
    lastChronologicalRenderEndTimeMs: 4240
  }
}

describe('§9.1 常量', () => {
  it('缩放下限 / 上限 / 总览哨兵 / 桥接阈值与原实现一致', () => {
    expect(CAMERA_SCALE_MIN).toBe(0.22)
    expect(CAMERA_SCALE_MAX).toBe(2.24)
    expect(OVERVIEW_CAMERA_SOURCE).toBe(-2)
    expect(FUME_CAMERA_TELEPORT_TRIGGER_SCREENS).toBe(2.75)
  })

  it('背景视差四常数与原实现一致', () => {
    expect(FUME_BACKGROUND_PARALLAX_X).toBe(0.9)
    expect(FUME_BACKGROUND_PARALLAX_Y).toBe(0.74)
    expect(FUME_BACKGROUND_SCALE_FACTOR).toBe(0.94)
    expect(FUME_BACKGROUND_VERTICAL_OFFSET_RATIO).toBe(0.22)
  })
})

describe('§9.2 resolveBlockEntryFocusPoint', () => {
  it('默认块：第一渲染行左端的中点', () => {
    // 块 (100,200)、行 left = 0、top = 0、lineHeight 40 → y = 200 + 0 + 20
    expect(resolveBlockEntryFocusPoint(makeFumeBlock())).toEqual({ x: 100, y: 220 })
  })

  it('hero 块的 left 偏移要计入 x', () => {
    const block = makeFumeBlock({ renderLines: [{ ...makeFumeBlock().renderLines[0], left: 32 }] })
    expect(resolveBlockEntryFocusPoint(block)).toEqual({ x: 132, y: 220 })
  })

  it('没有渲染行 → 回落区块中心（而不是 NaN）', () => {
    const block = makeFumeBlock({ renderLines: [] })
    expect(resolveBlockEntryFocusPoint(block)).toEqual({ x: 300, y: 220 })
  })
})

describe('§9.2 resolveSteppedBlockFocusPoint', () => {
  it('整数光标落在字素边界上：3 个字 → 行首 + 150px', () => {
    expect(resolveSteppedBlockFocusPoint(makeFumeBlock(), 3, FIXTURE_MEASURE)).toEqual({
      x: 250,
      y: 220
    })
  })

  it('0 个字 → 行首（x = block.x，不含行内偏移）', () => {
    expect(resolveSteppedBlockFocusPoint(makeFumeBlock(), 0, FIXTURE_MEASURE)).toEqual({
      x: 100,
      y: 220
    })
  })

  it('超出字素数时钳到行尾（不是无限延伸）', () => {
    // 行宽 400 → 行尾 x = 500
    expect(resolveSteppedBlockFocusPoint(makeFumeBlock(), 99, FIXTURE_MEASURE)).toEqual({
      x: 500,
      y: 220
    })
  })

  it('负光标钳到 0', () => {
    expect(resolveSteppedBlockFocusPoint(makeFumeBlock(), -5, FIXTURE_MEASURE)).toEqual({
      x: 100,
      y: 220
    })
  })

  it('多行块：offset 落进第二行时 y 跟着走', () => {
    // 两行各 8 字素：offset 9 → 第二行 localOffset 1 → x = 100 + 50（第二行 left 仍是 0）
    const block = makeFumeBlock({
      graphemes: new Array<string>(16).fill('一'),
      renderLines: [
        { ...makeFumeBlock().renderLines[0], id: '0-0' },
        { ...makeFumeBlock().renderLines[0], id: '8-1', start: 8, end: 16, top: 40 }
      ]
    })
    expect(resolveSteppedBlockFocusPoint(block, 9, FIXTURE_MEASURE)).toEqual({ x: 150, y: 260 })
  })

  it('多行块：offset 正好等于上一行 end 时归上一行（<= 判定）', () => {
    const block = makeFumeBlock({
      graphemes: new Array<string>(16).fill('一'),
      renderLines: [
        { ...makeFumeBlock().renderLines[0], id: '0-0' },
        { ...makeFumeBlock().renderLines[0], id: '8-1', start: 8, end: 16, top: 40 }
      ]
    })
    // offset 8：第一行 end = 8，findRenderLineIndex 的 `offset <= end` 命中第一行 → 行尾 x = 500
    expect(resolveSteppedBlockFocusPoint(block, 8, FIXTURE_MEASURE)).toEqual({ x: 500, y: 220 })
  })

  it('没有渲染行 → 区块中心', () => {
    expect(
      resolveSteppedBlockFocusPoint(makeFumeBlock({ renderLines: [] }), 3, FIXTURE_MEASURE)
    ).toEqual({ x: 300, y: 220 })
  })
})

describe('§9.2 resolveSmoothBlockFocusPoint', () => {
  it('浮点光标：3.5 个字 → 行首 + 175px（字素推进线性插值）', () => {
    const point = resolveSmoothBlockFocusPoint(makeFumeBlock(), 3.5, FIXTURE_MEASURE)
    expect(point.x).toBeCloseTo(275, 6)
    expect(point.y).toBeCloseTo(220, 6)
  })

  it('接近行尾时提前滑向下一行的起点（跨行混合窗口内 y 已经开始变）', () => {
    const block = makeFumeBlock({
      graphemes: new Array<string>(16).fill('一'),
      renderLines: [
        { ...makeFumeBlock().renderLines[0], id: '0-0' },
        { ...makeFumeBlock().renderLines[0], id: '8-1', start: 8, end: 16, top: 40 }
      ]
    })
    const before = resolveSmoothBlockFocusPoint(block, 7, FIXTURE_MEASURE)
    const inside = resolveSmoothBlockFocusPoint(block, 7.5, FIXTURE_MEASURE)

    expect(before.y).toBeCloseTo(220, 6)
    expect(inside.y).toBeGreaterThan(220)
    expect(inside.y).toBeLessThan(260)
    // 纯行内插值给 475，混向下一行起点（100）后落在中间偏左
    expect(inside.x).toBeGreaterThan(400)
    expect(inside.x).toBeLessThan(475)
  })

  it('刚折到新行时混回上一行的末尾（否则折行瞬间会跳）', () => {
    const block = makeFumeBlock({
      graphemes: new Array<string>(16).fill('一'),
      renderLines: [
        { ...makeFumeBlock().renderLines[0], id: '0-0' },
        { ...makeFumeBlock().renderLines[0], id: '8-1', start: 8, end: 16, top: 40 }
      ]
    })
    const point = resolveSmoothBlockFocusPoint(block, 8.05, FIXTURE_MEASURE)

    expect(point.y).toBeGreaterThan(220)
    expect(point.y).toBeLessThan(240)
    expect(point.x).toBeGreaterThan(490)
  })

  it('混合窗口之外就是本行内的纯插值（不留残留偏置）', () => {
    const block = makeFumeBlock({
      graphemes: new Array<string>(16).fill('一'),
      renderLines: [
        { ...makeFumeBlock().renderLines[0], id: '0-0' },
        { ...makeFumeBlock().renderLines[0], id: '8-1', start: 8, end: 16, top: 40 }
      ]
    })
    // 第二行 localOffset 1.9 → x = 100 + 50 + 45 = 195；y = 260
    const point = resolveSmoothBlockFocusPoint(block, 9.9, FIXTURE_MEASURE)
    expect(point.x).toBeCloseTo(195, 6)
    expect(point.y).toBeCloseTo(260, 6)
  })

  it('没有渲染行 → 区块中心', () => {
    expect(
      resolveSmoothBlockFocusPoint(makeFumeBlock({ renderLines: [] }), 3, FIXTURE_MEASURE)
    ).toEqual({ x: 300, y: 220 })
  })
})

describe('§9.3 resolveCameraScaleForBlock', () => {
  it('视口短边 900 时目标行高 103.5 → 常见块缩放 1', () => {
    // clamp(900 * 0.115, 64, 124) = 103.5；103.5 / 103.5 = 1
    expect(resolveCameraScaleForBlock({ lineHeight: 103.5 }, FIXTURE_VIEWPORT)).toBeCloseTo(1, 6)
  })

  it('小视口：行高没到下限，缩放被 0.88 兜住', () => {
    // clamp(400 * 0.115, 64, 124) = 64；64 / 64 = 1
    expect(resolveCameraScaleForBlock({ lineHeight: 64 }, { width: 400, height: 400 })).toBeCloseTo(
      1,
      6
    )
  })

  it('大视口：行高没到上限，缩放被 124 / lineHeight 给定', () => {
    expect(
      resolveCameraScaleForBlock({ lineHeight: 124 }, { width: 4000, height: 2000 })
    ).toBeCloseTo(1, 6)
  })

  it('大行高把缩放压到 0.88 下限', () => {
    // 103.5 / 200 = 0.5175 → 0.88
    expect(resolveCameraScaleForBlock({ lineHeight: 200 }, FIXTURE_VIEWPORT)).toBe(0.88)
  })

  it('小行高把缩放抬到 2.2 上限', () => {
    expect(resolveCameraScaleForBlock({ lineHeight: 40 }, FIXTURE_VIEWPORT)).toBe(2.2)
  })

  it('lineHeight 为 0 时不除零（按 1 处理 → 上限 2.2）', () => {
    expect(resolveCameraScaleForBlock({ lineHeight: 0 }, FIXTURE_VIEWPORT)).toBe(2.2)
  })

  it('视口为 0 时不产生 NaN / Infinity', () => {
    const scale = resolveCameraScaleForBlock({ lineHeight: 64 }, { width: 0, height: 0 })
    expect(Number.isFinite(scale)).toBe(true)
    expect(scale).toBe(1)
  })
})

describe('§9.3 resolveCameraRetargetDurationMs', () => {
  it('normal 行（1000ms）钳到上限 130ms', () => {
    const line = makeFumeLine({ startTimeMs: 1000, endTimeMs: 2000 })
    // enter = min(420, max(220, 1000 * 0.34)) = 340；hold = 60
    // 340 * 0.44 + 60 * 0.22 = 149.6 + 13.2 = 162.8 → 130
    expect(resolveCameraRetargetDurationMs(line)).toBeCloseTo(130, 6)
  })

  it('190ms 才刚够 normal（阈值是 < 180 为 short）：enter 被 220 地板抬起 → 110ms', () => {
    const line = makeFumeLine({ startTimeMs: 1000, endTimeMs: 1190 })
    // enter = min(420, max(220, 190 * 0.34)) = 220；hold = 60
    // 220 * 0.44 + 60 * 0.22 = 96.8 + 13.2 = 110
    expect(resolveCameraRetargetDurationMs(line)).toBeCloseTo(110, 6)
  })

  it('short 行（150ms）走 fast 档：enter 60 / exit 33 → 50.4 → 55 下限', () => {
    const line = makeFumeLine({ startTimeMs: 1000, endTimeMs: 1150 })
    // enter = clamp(150 * 0.45, 45, 60) = 67.5 → 60? 不，67.5 被上限 60 钳住 → 60
    // exit = clamp(150 * 0.22, 30, 40) = 33
    // 60 * 0.5 + 33 * 0.12 = 30 + 3.96 = 33.96 → 55 下限
    expect(resolveCameraRetargetDurationMs(line)).toBeCloseTo(55, 6)
  })

  it('micro 行（50ms）走 none 档：rawDuration 参与缩放但钳在 40..75', () => {
    const line = makeFumeLine({ startTimeMs: 1000, endTimeMs: 1050 })
    // max(50, 80) * 0.34 = 27.2 → 40
    expect(resolveCameraRetargetDurationMs(line)).toBeCloseTo(40, 6)
  })

  it('micro 行里较长的一条仍被 40ms 地板兜住', () => {
    const line = makeFumeLine({ startTimeMs: 1000, endTimeMs: 1095 })
    expect(resolveCameraRetargetDurationMs(line)).toBeCloseTo(40, 6)
  })

  it('已烘好的 renderHints 优先于行时长重算', () => {
    // 行本身 1000ms，但 hints 说它是 micro → 走 none 档
    const line = makeFumeLine({
      startTimeMs: 1000,
      endTimeMs: 2000,
      renderHints: {
        rawDurationMs: 1000,
        timingClass: 'micro',
        renderEndTimeMs: 2000,
        lineTransitionMode: 'none',
        wordRevealMode: 'instant'
      }
    })
    // max(1000, 80) * 0.34 = 340 → 75
    expect(resolveCameraRetargetDurationMs(line)).toBeCloseTo(75, 6)
  })
})

describe('§9.3 resolveOverviewRetargetDurationMs', () => {
  it('1600×900 → 580ms 上限', () => {
    expect(resolveOverviewRetargetDurationMs(FIXTURE_VIEWPORT)).toBeCloseTo(580, 6)
  })

  it('900×600 → 400ms', () => {
    expect(resolveOverviewRetargetDurationMs({ width: 900, height: 600 })).toBeCloseTo(400, 6)
  })

  it('小视口 → 380ms 下限', () => {
    expect(resolveOverviewRetargetDurationMs({ width: 200, height: 200 })).toBeCloseTo(380, 6)
  })
})

describe('§9.4 resolveArticleOverviewCamera', () => {
  it('两块文章：包围盒中心 + 内边距，但缩放被 0.72 上限压住', () => {
    const article = makeTwoBlockArticle()
    const overview = resolveArticleOverviewCamera(article, FIXTURE_VIEWPORT)

    // 包围盒 (100..1400, 200..240) → 中心 (750, 220)
    expect(overview.x).toBeCloseTo(750, 6)
    expect(overview.y).toBeCloseTo(220, 6)
    // paddingX = clamp(320, 120, 280) = 280；framedWidth = 1300 + 560 = 1860 → 1600/1860 > 0.72
    expect(overview.scale).toBe(0.72)
  })

  it('极小文章不会超过 0.72 上限', () => {
    const tiny = makeFumeBlock({ width: 20, height: 10, innerWidth: 20 })
    const overview = resolveArticleOverviewCamera(
      makeArticleFromBlocks([tiny], { width: 20, height: 10 }),
      FIXTURE_VIEWPORT
    )
    expect(overview.scale).toBe(0.72)
  })

  it('没有区块时退回「装进纸」并乘 0.92', () => {
    const overview = resolveArticleOverviewCamera(
      { blocks: [], width: 4000, height: 3000 },
      FIXTURE_VIEWPORT
    )
    // min(1600/4000, 900/3000) * 0.92 = 0.3 * 0.92 = 0.276
    expect(overview.x).toBe(2000)
    expect(overview.y).toBe(1500)
    expect(overview.scale).toBeCloseTo(0.276, 6)
  })

  it('巨大的纸被 CAMERA_SCALE_MIN 兜住', () => {
    const overview = resolveArticleOverviewCamera(
      { blocks: [], width: 400000, height: 300000 },
      FIXTURE_VIEWPORT
    )
    expect(overview.scale).toBe(CAMERA_SCALE_MIN)
  })
})

describe('§9.5 resolveFocusBlock', () => {
  const article = makeTwoBlockArticle()
  const [firstBlock, secondBlock] = article.chronologicalBlocks

  it('当前行下标有效 → 直接给对应块', () => {
    expect(resolveFocusBlock(article, 1, 1500)).toBe(secondBlock)
  })

  it('当前行下标越界 → 忽略它，继续走时间轴降级', () => {
    expect(resolveFocusBlock(article, 999, 9000)).toBe(secondBlock)
  })

  it('全篇唱完（time >= 末块 renderEnd） → 给时间序最后一块', () => {
    expect(resolveFocusBlock(article, -1, 4240)).toBe(secondBlock)
  })

  it('差一毫秒没到「全篇唱完」：仍走反向扫描（3100 时命中已开始打印的第二块）', () => {
    expect(resolveFocusBlock(article, -1, 3100)).toBe(secondBlock)
  })

  it('间奏（当前行还没到）→ 从后往前找最近打印过的一块', () => {
    expect(resolveFocusBlock(article, -1, 1500)).toBe(firstBlock)
  })

  it('还没开始唱 → 第一块', () => {
    expect(resolveFocusBlock(article, -1, 0)).toBe(firstBlock)
  })

  it('空文章 → null', () => {
    expect(
      resolveFocusBlock(makeArticleFromBlocks([], { width: 0, height: 0 }), -1, 1000)
    ).toBeNull()
  })
})

describe('§9.6 resolveOverviewFlightBridge', () => {
  const viewport = FIXTURE_VIEWPORT
  const minSide = Math.min(viewport.width, viewport.height)
  const threshold = minSide * FUME_CAMERA_TELEPORT_TRIGGER_SCREENS
  const overviewCamera = { x: 2000, y: 1000, scale: 0.5 }

  it('正好 2.75 屏之下不触发（严格 < 判定）', () => {
    const bridge = resolveOverviewFlightBridge({
      fromX: 0,
      fromY: 0,
      fromScale: 1,
      targetX: threshold - 0.001,
      targetY: 0,
      targetScale: 1,
      overviewCamera,
      viewport
    })
    expect(bridge).toBeNull()
  })

  it('到达 2.75 屏即触发（>= 判定）', () => {
    const bridge = resolveOverviewFlightBridge({
      fromX: 0,
      fromY: 0,
      fromScale: 1,
      targetX: threshold,
      targetY: 0,
      targetScale: 1,
      overviewCamera,
      viewport
    })
    expect(bridge).not.toBeNull()
    expect(bridge?.waypointPhase).toBeGreaterThanOrEqual(0.26)
    expect(bridge?.waypointPhase).toBeLessThanOrEqual(0.44)
    expect(bridge?.durationMs).toBeGreaterThanOrEqual(300)
    expect(bridge?.durationMs).toBeLessThanOrEqual(680)
  })

  it('没有总览镜头 → null（不知道往哪绕）', () => {
    expect(
      resolveOverviewFlightBridge({
        fromX: 0,
        fromY: 0,
        fromScale: 1,
        targetX: 99999,
        targetY: 0,
        targetScale: 1,
        overviewCamera: null,
        viewport
      })
    ).toBeNull()
  })

  it('起终点重合 → null（不需要飞）', () => {
    expect(
      resolveOverviewFlightBridge({
        fromX: 0,
        fromY: 0,
        fromScale: 1,
        targetX: 0,
        targetY: 0,
        targetScale: 1,
        overviewCamera,
        viewport
      })
    ).toBeNull()
  })

  it('路径点的缩放一定比两端更远，且不低于相机下限', () => {
    const bridge = resolveOverviewFlightBridge({
      fromX: 0,
      fromY: 0,
      fromScale: 1.6,
      targetX: threshold,
      targetY: 0,
      targetScale: 2,
      overviewCamera,
      viewport
    })
    expect(bridge).not.toBeNull()
    expect(bridge!.waypointScale).toBeLessThanOrEqual(Math.max(2 * 0.92, CAMERA_SCALE_MIN))
    expect(bridge!.waypointScale).toBeGreaterThanOrEqual(CAMERA_SCALE_MIN)
  })

  it('距离越远：路径点越小、时长越大（loftStrength 单调）', () => {
    // 距离直接用「屏数」给，避免与世界单位换算混淆
    const make = (screenCount: number) =>
      resolveOverviewFlightBridge({
        fromX: 0,
        fromY: 0,
        fromScale: 1,
        targetX: minSide * screenCount,
        targetY: 0,
        targetScale: 1,
        overviewCamera,
        viewport
      })!

    const near = make(FUME_CAMERA_TELEPORT_TRIGGER_SCREENS)
    const far = make(40)
    expect(far.waypointScale).toBeLessThan(near.waypointScale)
    expect(far.durationMs).toBeGreaterThan(near.durationMs)
    expect(far.waypointScale).toBeGreaterThanOrEqual(CAMERA_SCALE_MIN)
    expect(far.durationMs).toBeLessThanOrEqual(680)
  })
})

describe('§9.8 resolveFumeBackgroundView', () => {
  const scene = { width: 1000, height: 2000 }

  it('相机在场景中心时：背景中轴对齐，整体下移', () => {
    const view = resolveFumeBackgroundView(
      scene,
      makeFumeCamera({ x: 500, y: 1000, scale: 1 }),
      FIXTURE_VIEWPORT
    )

    expect(view.backgroundCenterX).toBe(500)
    expect(view.backgroundCenterY).toBe(1000)
    expect(view.backgroundCameraX).toBe(500)
    // 下移量 = clamp(900 * 0.22 / 1, 48, 180) = 180
    expect(view.backgroundCameraY).toBe(820)
    expect(view.backgroundScale).toBeCloseTo(0.94, 6)
  })

  it('缩放越大，世界单位下的下移量越小（屏幕上恒定 22% 视口高）', () => {
    const view = resolveFumeBackgroundView(
      scene,
      makeFumeCamera({ x: 500, y: 1000, scale: 5 }),
      FIXTURE_VIEWPORT
    )
    // clamp(900 * 0.22 / 5, 48, 180) = 48
    expect(view.backgroundCameraY).toBeCloseTo(952, 6)
  })

  it('背景缩放是相机 ×0.94，且不低于相机下限', () => {
    const tiny = resolveFumeBackgroundView(
      scene,
      makeFumeCamera({ scale: CAMERA_SCALE_MIN }),
      FIXTURE_VIEWPORT
    )
    const huge = resolveFumeBackgroundView(
      scene,
      makeFumeCamera({ scale: CAMERA_SCALE_MAX }),
      FIXTURE_VIEWPORT
    )
    // 0.22 * 0.94 = 0.2068 → 下限 0.22；2.24 * 0.94 = 2.1056（本来就没到上限）
    expect(tiny.backgroundScale).toBe(CAMERA_SCALE_MIN)
    expect(huge.backgroundScale).toBeCloseTo(CAMERA_SCALE_MAX * FUME_BACKGROUND_SCALE_FACTOR, 6)
  })

  it('视差：x 跟 90%、y 跟 74%（背景比纸慢）', () => {
    const view = resolveFumeBackgroundView(
      scene,
      makeFumeCamera({ x: 1500, y: 3000, scale: 1 }),
      FIXTURE_VIEWPORT
    )
    // mix(500, 1500, 0.9) = 1400；mix(1000, 3000, 0.74) - 180 = 2480 - 180
    expect(view.backgroundCameraX).toBeCloseTo(1400, 6)
    expect(view.backgroundCameraY).toBeCloseTo(2300, 6)
  })
})
