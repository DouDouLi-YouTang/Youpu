import { describe, expect, it } from 'vitest'

import {
  FUME_BLOCK_OVERSCAN_PX,
  MAX_COLOR_TRAIL_DURATION_MS,
  MIN_BLOCK_LINE_DURATION_MS,
  MIN_COLOR_TRAIL_DURATION_MS,
  isFumeBlockOnScreen,
  resolveFumeBlockTiming,
  resolveFumeGlowBases,
  resolveFumeStaticLayers,
  worldToScreenX,
  worldToScreenY,
  type FumeSnapshotSpec
} from './block-frame'
import type { FumeBlock, FumeCameraTarget, FumeTheme, FumeViewportSize } from './fume-types'

const VIEWPORT: FumeViewportSize = { width: 1000, height: 800 }

function makeCamera(overrides: Partial<FumeCameraTarget> = {}): FumeCameraTarget {
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

function makeTheme(overrides: Partial<FumeTheme> = {}): FumeTheme {
  return {
    name: 'test',
    primaryColor: 'rgb(244, 244, 245)',
    accentColor: 'rgb(234, 88, 12)',
    secondaryColor: 'rgb(113, 113, 122)',
    fontStyle: 'serif',
    animationIntensity: 'normal',
    ...overrides
  }
}

/** 造一个区块：时间 1000→2000ms 的正常行（renderEnd = 2240） */
function makeBlock(overrides: Partial<FumeBlock> = {}): FumeBlock {
  const line = {
    startTimeMs: 1000,
    endTimeMs: 2000,
    fullText: '测试行',
    words: []
  }
  return {
    id: 'fume-1000-0',
    sourceLineIndex: 0,
    line,
    variant: 'body',
    x: 0,
    y: 0,
    width: 400,
    height: 60,
    innerWidth: 400,
    fontPx: 40,
    lineHeight: 42,
    prepared: {} as FumeBlock['prepared'],
    layout: {} as FumeBlock['layout'],
    graphemes: [],
    segmentMetas: [],
    wordRanges: [],
    wordRangeIndexByOffset: [],
    colorRangeIndexByOffset: [],
    renderLines: [],
    ...overrides
  }
}

describe('resolveFumeGlowBases（规格书 §8.1）', () => {
  it('三档强度 × 辉光倍率', () => {
    expect(resolveFumeGlowBases('chaotic', 1)).toEqual({
      activeGlowBoost: 1.15,
      passedGlowBase: 0.95
    })
    expect(resolveFumeGlowBases('calm', 1)).toEqual({
      activeGlowBoost: 0.72,
      passedGlowBase: 0.35
    })
    expect(resolveFumeGlowBases('normal', 1)).toEqual({
      activeGlowBoost: 0.92,
      passedGlowBase: 0.62
    })
  })

  it('glowIntensity 直接线性乘上去（0 时两个基量都为 0）', () => {
    expect(resolveFumeGlowBases('normal', 0)).toEqual({
      activeGlowBoost: 0,
      passedGlowBase: 0
    })
    expect(resolveFumeGlowBases('chaotic', 1.8)).toEqual({
      activeGlowBoost: 1.15 * 1.8,
      passedGlowBase: 0.95 * 1.8
    })
  })

  it('余辉的变化幅度明显大于活跃辉光（上游刻意的不对称）', () => {
    const calm = resolveFumeGlowBases('calm', 1)
    const chaotic = resolveFumeGlowBases('chaotic', 1)
    const activeRatio = chaotic.activeGlowBoost / calm.activeGlowBoost
    const passedRatio = chaotic.passedGlowBase / calm.passedGlowBase
    expect(activeRatio).toBeLessThan(passedRatio)
  })
})

describe('worldToScreenX / worldToScreenY 与 isFumeBlockOnScreen（规格书 §8.2）', () => {
  it('相机在原点时，世界原点落在视口中心', () => {
    const camera = makeCamera()
    expect(worldToScreenX(0, camera, VIEWPORT, camera.scale)).toBe(500)
    expect(worldToScreenY(0, camera, VIEWPORT, camera.scale)).toBe(400)
  })

  it('缩放线性作用在「世界坐标 - 相机坐标」上', () => {
    const camera = makeCamera({ x: 100, y: 50, scale: 2 })
    // (120 - 100) * 2 = 40 → 500 + 40
    expect(worldToScreenX(120, camera, VIEWPORT, camera.scale)).toBe(540)
    // (50 - 50) * 2 = 0 → 400
    expect(worldToScreenY(50, camera, VIEWPORT, camera.scale)).toBe(400)
  })

  it('完全在屏内的区块算在屏', () => {
    // 区块世界矩形 (0,0)-(400,60)；相机在原点 → 屏幕矩形 (500,400)-(900,460)
    expect(isFumeBlockOnScreen(makeBlock(), makeCamera(), VIEWPORT)).toBe(true)
  })

  it('判定用的是「整块都跑出去」：区块右边缘 < -overscan 才算左侧出界', () => {
    // 区块屏幕矩形宽 400：screenRight = 500 - camera.x + 400
    // camera.x = 1080 → screenRight = -180（边界值算在屏）
    expect(isFumeBlockOnScreen(makeBlock(), makeCamera({ x: 1080 }), VIEWPORT)).toBe(true)
    expect(isFumeBlockOnScreen(makeBlock(), makeCamera({ x: 1080.001 }), VIEWPORT)).toBe(false)
  })

  it('越过右边界 / 上边界 / 下边界同样受 overscan 保护', () => {
    const block = makeBlock()
    // 右边界：screenLeft > width + 180 → 500 - camera.x > 1180 → camera.x < -680
    expect(isFumeBlockOnScreen(block, makeCamera({ x: -680 }), VIEWPORT)).toBe(true)
    expect(isFumeBlockOnScreen(block, makeCamera({ x: -680.001 }), VIEWPORT)).toBe(false)

    // 上边界：screenBottom = 400 - camera.y + 60 < -180 → camera.y > 640
    expect(isFumeBlockOnScreen(block, makeCamera({ y: 640 }), VIEWPORT)).toBe(true)
    expect(isFumeBlockOnScreen(block, makeCamera({ y: 640.001 }), VIEWPORT)).toBe(false)

    // 下边界：screenTop = 400 - camera.y > 800 + 180 → camera.y < -580
    expect(isFumeBlockOnScreen(block, makeCamera({ y: -580 }), VIEWPORT)).toBe(true)
    expect(isFumeBlockOnScreen(block, makeCamera({ y: -580.001 }), VIEWPORT)).toBe(false)
  })

  it('默认 overscan 是 180px（可用参数覆盖，用于测试与将来的性能档）', () => {
    expect(FUME_BLOCK_OVERSCAN_PX).toBe(180)
    // 左边界恰好在 -180：把 overscan 调小就会出界
    expect(isFumeBlockOnScreen(makeBlock(), makeCamera({ x: 1080 }), VIEWPORT)).toBe(true)
    expect(isFumeBlockOnScreen(makeBlock(), makeCamera({ x: 1080 }), VIEWPORT, 179)).toBe(false)
  })

  it('缩放同时作用于区块尺寸与位移（scale = 0.5 时屏幕宽 200）', () => {
    const camera = (x: number) => makeCamera({ x, scale: 0.5 })
    // screenRight = 500 - 0.5 * camera.x + 200
    // camera.x = 1760 → -180（边界值在屏）；1760.001 → 出界
    expect(isFumeBlockOnScreen(makeBlock(), camera(1760), VIEWPORT)).toBe(true)
    expect(isFumeBlockOnScreen(makeBlock(), camera(1760.001), VIEWPORT)).toBe(false)
  })
})

describe('resolveFumeBlockTiming（规格书 §8.3）', () => {
  const block = makeBlock()
  // 行 1000→2000：renderEnd = 2000 + 60 + 180 = 2240；行时长 2240-1000 = 1240
  // body 拖尾 = clamp(1240 * 0.52, 450, 1450) = 644.8 → passed 从 2240 + 644.8 开始

  it('样式的两个不透明度与变体挂钩', () => {
    expect(resolveFumeBlockTiming(block, 0, null, 1).waitingOpacity).toBe(0.035)
    expect(resolveFumeBlockTiming(block, 0, null, 1).activeOpacity).toBe(0.92)
    const hero = makeBlock({ variant: 'hero' })
    expect(resolveFumeBlockTiming(hero, 0, null, 1).waitingOpacity).toBe(0.06)
    expect(resolveFumeBlockTiming(hero, 0, null, 1).activeOpacity).toBe(0.985)
  })

  it('textHoldRatio >= 1 → standard（本项目恒走这条）', () => {
    const timing = resolveFumeBlockTiming(block, 1500, null, 1)
    expect(timing.effectiveTextHoldStyle).toBe('standard')
    expect(timing.passedStyle.opacity).toBe(0.58)
    // transitionPassedStyle 恒为 standard 档（总览恢复清晰用）
    expect(timing.transitionPassedStyle).toEqual(timing.passedStyle)
  })

  it('textHoldRatio < 1 → dimmed，transitionPassedStyle 仍然是 standard', () => {
    const timing = resolveFumeBlockTiming(block, 1500, null, 0.5)
    expect(timing.effectiveTextHoldStyle).toBe('dimmed')
    expect(timing.passedStyle.opacity).toBe(0.075)
    expect(timing.transitionPassedStyle.opacity).toBe(0.58)
  })

  it('CJK 行的基线是 0.52，其它是 0.5', () => {
    expect(resolveFumeBlockTiming(block, 1500, null, 1).baselineOffset).toBe(42 * 0.52)
    const latin = makeBlock({ line: { ...block.line, fullText: 'hello' } })
    expect(resolveFumeBlockTiming(latin, 1500, null, 1).baselineOffset).toBe(42 * 0.5)
  })

  it('staticState 的三态与两处精确边界', () => {
    const timing = resolveFumeBlockTiming(block, 0, null, 1)
    const passedAt = timing.lineEndTimeMs + timing.colorTrailDurationMs

    // 起点之前（严格小于）→ waiting
    expect(resolveFumeBlockTiming(block, 999.999, null, 1).staticState).toBe('waiting')
    // 恰好落在起点 → 不是 waiting，而是实时绘制（用 <= 会看到一次跳帧）
    expect(resolveFumeBlockTiming(block, 1000, null, 1).staticState).toBeNull()
    // 打印中 → 实时绘制
    expect(resolveFumeBlockTiming(block, 1500, null, 1).staticState).toBeNull()
    // 拖尾刚好结束（>=）→ passed
    expect(resolveFumeBlockTiming(block, passedAt - 0.001, null, 1).staticState).toBeNull()
    expect(resolveFumeBlockTiming(block, passedAt, null, 1).staticState).toBe('passed')
  })

  it('拖尾时长按变体取系数，并钳在 450..1450ms', () => {
    // body：1240 * 0.52 = 644.8
    expect(resolveFumeBlockTiming(block, 0, null, 1).colorTrailDurationMs).toBeCloseTo(644.8, 6)
    // hero：1240 * 0.42 = 520.8
    const hero = makeBlock({ variant: 'hero' })
    expect(resolveFumeBlockTiming(hero, 0, null, 1).colorTrailDurationMs).toBeCloseTo(520.8, 6)
  })

  it('行时长下限 180ms：极短行的拖尾不会被算得比地板还短', () => {
    const tiny = makeBlock({
      line: { startTimeMs: 1000, endTimeMs: 1050, fullText: '嗨', words: [] }
    })
    const timing = resolveFumeBlockTiming(tiny, 0, null, 1)
    // micro 行的 renderEnd = 1067，lineDuration = max(67, 180) = 180
    expect(timing.lineDurationMs).toBe(MIN_BLOCK_LINE_DURATION_MS)
    expect(timing.colorTrailDurationMs).toBe(MIN_COLOR_TRAIL_DURATION_MS)
  })

  it('超长行的拖尾被 1450ms 上限截断', () => {
    const long = makeBlock({
      line: { startTimeMs: 0, endTimeMs: 60_000, fullText: '很长的一行', words: [] }
    })
    expect(resolveFumeBlockTiming(long, 0, null, 1).colorTrailDurationMs).toBe(
      MAX_COLOR_TRAIL_DURATION_MS
    )
  })

  it('hasRevealCompleted 用 line.endTimeMs，hasPassCutoffReached 用截止时间', () => {
    const timing = resolveFumeBlockTiming(block, 2000, 5000, 1)
    // 行尾一到就算揭示完成
    expect(timing.hasRevealCompleted).toBe(true)
    // 但「唱过」还没到：截止时间取 min(renderEnd 2240, 下一行 5000) = 2240
    expect(timing.linePassCutoffTimeMs).toBe(2240)
    expect(timing.hasPassCutoffReached).toBe(false)
    expect(resolveFumeBlockTiming(block, 2240, 5000, 1).hasPassCutoffReached).toBe(true)
  })

  it('下一行更早开始时，截止时间被拉到下一行起点', () => {
    const timing = resolveFumeBlockTiming(block, 1500, 2100, 1)
    expect(timing.linePassCutoffTimeMs).toBe(2100)
    expect(timing.hasPassCutoffReached).toBe(false)
    expect(resolveFumeBlockTiming(block, 2100, 2100, 1).hasPassCutoffReached).toBe(true)
  })

  it('没有下一行时截止时间就是 renderEndTime', () => {
    expect(resolveFumeBlockTiming(block, 0, null, 1).linePassCutoffTimeMs).toBe(2240)
  })
})

describe('resolveFumeStaticLayers（规格书 §8.4）', () => {
  const theme = makeTheme()
  const baseInput = {
    timeMs: 0,
    theme,
    passedGlowBase: 0.62,
    passedFadeDurationMs: 10_000,
    overviewTextRestoreProgress: 0,
    snapshotScale: 1
  }

  /** 记录每次请求的快照描述，并按 key 造一个字符串当「快照对象」 */
  function makeRecorder() {
    const requests: FumeSnapshotSpec[] = []
    const getSnapshot = (spec: FumeSnapshotSpec): string | undefined => {
      requests.push(spec)
      return `snapshot:${spec.key}`
    }
    return { requests, getSnapshot }
  }

  it('staticState 为 null（正在打印）时返回 null，调用方回落到实时绘制', () => {
    const block = makeBlock()
    const timing = resolveFumeBlockTiming(block, 1500, null, 1)
    const { requests, getSnapshot } = makeRecorder()
    expect(resolveFumeStaticLayers(block, timing, baseInput, getSnapshot)).toBeNull()
    // 不该浪费一次快照请求
    expect(requests).toEqual([])
  })

  it('waiting：0 辉光、透明阴影、fill 用 waitingOpacity', () => {
    const block = makeBlock()
    const timing = resolveFumeBlockTiming(block, 0, null, 1)
    const { requests, getSnapshot } = makeRecorder()
    const layers = resolveFumeStaticLayers(block, timing, baseInput, getSnapshot)

    expect(layers).toEqual([{ snapshot: 'snapshot:fume-1000-0:waiting:base:1', alpha: 1 }])
    expect(requests).toHaveLength(1)
    expect(requests[0]).toEqual({
      key: 'fume-1000-0:waiting:base:1',
      fill: 'rgba(244, 244, 245, 0.035)',
      shadowBlur: 0,
      shadowColor: 'transparent'
    })
  })

  it('passed（standard）：一层快照，辉光按 (2 + fontPx*0.1) * 0.65 * passedGlowBase', () => {
    const block = makeBlock()
    const timing = resolveFumeBlockTiming(block, 3000, null, 1)
    const { requests, getSnapshot } = makeRecorder()
    const layers = resolveFumeStaticLayers(block, timing, baseInput, getSnapshot)

    expect(layers).toEqual([{ snapshot: 'snapshot:fume-1000-0:passed:standard:1', alpha: 1 }])
    expect(requests).toHaveLength(1)
    // (2 + 40 * 0.1) * 0.65 * 0.62 * 1 = 6 * 0.65 * 0.62 = 2.418
    expect(requests[0].shadowBlur).toBeCloseTo(2.418, 6)
    expect(requests[0].fill).toBe('rgba(244, 244, 245, 0.58)')
    expect(requests[0].shadowColor).toBe('rgba(244, 244, 245, 0.1)')
  })

  it('dimAmount <= 0（刚进 passed，还没开始变暗）→ 只画 standard 一张', () => {
    const block = makeBlock()
    // 变暗的起点 = renderEnd + 拖尾 = 2240 + 644.8 = 2884.8；取 2884.8 时 baseDim = 0
    const timing = resolveFumeBlockTiming(block, 2884.8, null, 0.5)
    expect(timing.staticState).toBe('passed')
    const { requests, getSnapshot } = makeRecorder()
    const layers = resolveFumeStaticLayers(
      block,
      timing,
      { ...baseInput, timeMs: 2884.8 },
      getSnapshot
    )

    expect(layers).toEqual([{ snapshot: 'snapshot:fume-1000-0:passed:standard:1', alpha: 1 }])
    expect(requests).toHaveLength(2) // dimmed 那张也会被请求（顺序上是先 dimmed 后 standard）
  })

  it('0 < dimAmount < 1 → 两张快照，alpha 之和恒为 1', () => {
    const block = makeBlock()
    // baseDim = easeInCubic(0.5) = 0.125 → 落在 (0,1) 区间
    const timeMs = 2884.8 + 5000
    const timing = resolveFumeBlockTiming(block, timeMs, null, 0.5)
    const { getSnapshot } = makeRecorder()
    const layers = resolveFumeStaticLayers(block, timing, { ...baseInput, timeMs }, getSnapshot)

    expect(layers).toHaveLength(2)
    expect(layers![0].snapshot).toBe('snapshot:fume-1000-0:passed:standard:1')
    expect(layers![1].snapshot).toBe('snapshot:fume-1000-0:passed:dimmed:1')
    expect(layers![0].alpha + layers![1].alpha).toBeCloseTo(1, 12)
    expect(layers![0].alpha).toBeCloseTo(1 - 0.125, 12)
    expect(layers![1].alpha).toBeCloseTo(0.125, 12)
  })

  it('总览进度会抵消变暗：overviewTextRestoreProgress 到 1 时只剩 standard 一张', () => {
    const block = makeBlock()
    const timeMs = 2884.8 + 5000
    const timing = resolveFumeBlockTiming(block, timeMs, null, 0.5)
    const { getSnapshot } = makeRecorder()
    const layers = resolveFumeStaticLayers(
      block,
      timing,
      { ...baseInput, timeMs, overviewTextRestoreProgress: 1 },
      getSnapshot
    )
    expect(layers).toEqual([{ snapshot: 'snapshot:fume-1000-0:passed:standard:1', alpha: 1 }])
  })

  it('总览进度 0.5 时变暗量减半（1 - dim/2 与 dim/2）', () => {
    const block = makeBlock()
    const timeMs = 2884.8 + 5000
    const timing = resolveFumeBlockTiming(block, timeMs, null, 0.5)
    const { getSnapshot } = makeRecorder()
    const layers = resolveFumeStaticLayers(
      block,
      timing,
      { ...baseInput, timeMs, overviewTextRestoreProgress: 0.5 },
      getSnapshot
    )
    expect(layers![0].alpha).toBeCloseTo(1 - 0.0625, 12)
    expect(layers![1].alpha).toBeCloseTo(0.0625, 12)
  })

  it('dimAmount >= 1（已经完全变暗）时退回单张 dimmed', () => {
    const block = makeBlock()
    const timeMs = 2884.8 + 20_000
    const timing = resolveFumeBlockTiming(block, timeMs, null, 0.5)
    const { getSnapshot } = makeRecorder()
    const layers = resolveFumeStaticLayers(block, timing, { ...baseInput, timeMs }, getSnapshot)
    expect(layers).toEqual([{ snapshot: 'snapshot:fume-1000-0:passed:dimmed:1', alpha: 1 }])
  })

  it('主快照拿不到时返回 null（调用方回落到实时绘制）', () => {
    const block = makeBlock()
    const timing = resolveFumeBlockTiming(block, 0, null, 1)
    expect(resolveFumeStaticLayers(block, timing, baseInput, () => undefined)).toBeNull()
  })

  it('standard 快照拿不到时仍然画 dimmed 那张（不回落实时绘制）', () => {
    const block = makeBlock()
    const timeMs = 2884.8 + 5000
    const timing = resolveFumeBlockTiming(block, timeMs, null, 0.5)
    const getSnapshot = (spec: FumeSnapshotSpec) =>
      spec.key.includes(':dimmed:') ? `snapshot:${spec.key}` : undefined
    const layers = resolveFumeStaticLayers(block, timing, { ...baseInput, timeMs }, getSnapshot)
    expect(layers).toEqual([{ snapshot: 'snapshot:fume-1000-0:passed:dimmed:1', alpha: 1 }])
  })

  it('snapshotScale 参与缓存键（跨屏拖动 / DPR 变化会重建）', () => {
    const block = makeBlock()
    const timing = resolveFumeBlockTiming(block, 3000, null, 1)
    const { requests, getSnapshot } = makeRecorder()
    resolveFumeStaticLayers(block, timing, { ...baseInput, snapshotScale: 2 }, getSnapshot)
    expect(requests[0].key).toBe('fume-1000-0:passed:standard:2')
  })
})
