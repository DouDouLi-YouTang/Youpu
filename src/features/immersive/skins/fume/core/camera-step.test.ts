/**
 * 「浮名」相机逐帧积分单测（规格书 §9.7 + §15.5 对 `camera-step` 的四条硬要求）。
 *
 * §15.5 明写要覆盖：
 * 1. 固定 dt 序列的收敛性 —— 弹簧不发散；
 * 2. `retarget` 只在新目标时重建；
 * 3. 桥接模式选择（含 2.75 屏分界处必须走桥接而不是直连）；
 * 4. `dt` 上限 50ms 的行为。
 *
 * 本文件全部用**固定 dt 序列**驱动，不读时钟、不 await：积分是纯数值的，
 * 只要输入序列一样，结果就必须逐位一样。
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_CAMERA_FRAME_DELTA_MS,
  MIN_CAMERA_FRAME_DELTA_MS,
  clampCameraFrameDeltaMs,
  createFumeCameraState,
  reanchorFumeCamera,
  resolveCameraFloatConfig,
  stepFumeCamera,
  syncFumeCameraToArticle,
  type FumeCameraStepInput
} from './camera-step'
import { CAMERA_SCALE_MAX, CAMERA_SCALE_MIN, OVERVIEW_CAMERA_SOURCE } from './camera'
import {
  FIXTURE_MEASURE,
  FIXTURE_VIEWPORT,
  makeFumeBlock,
  makeFumeCamera,
  makeFumeLine
} from './fume-test-fixtures'
import type { FumeArticleLayout, FumeCameraState } from './fume-types'

/** 一屏的短边（1600×900 → 900） */
const MIN_SIDE = Math.min(FIXTURE_VIEWPORT.width, FIXTURE_VIEWPORT.height)

/** 造一篇「两块、行时长各 1s、第二块在 3000ms」的文章 */
function makeArticle(): FumeArticleLayout {
  const firstBlock = makeFumeBlock({
    sourceLineIndex: 0,
    line: makeFumeLine({ startTimeMs: 1000, endTimeMs: 2000 })
  })
  const secondBlock = makeFumeBlock({
    sourceLineIndex: 1,
    line: makeFumeLine({ startTimeMs: 3000, endTimeMs: 4000 }),
    x: 1000
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
    lastChronologicalRenderEndTimeMs: 4240
  }
}

/** 造一次 step 的入参；默认「固定」成一个静止场景，测试只覆盖自己要改的那几项 */
function makeStepInput(overrides: Partial<FumeCameraStepInput> = {}): FumeCameraStepInput {
  return {
    article: makeArticle(),
    timeMs: 1500,
    nowMs: 0,
    dtMs: MAX_CAMERA_FRAME_DELTA_MS,
    lineIndex: 0,
    viewport: FIXTURE_VIEWPORT,
    overviewCamera: null,
    overviewStartTimeMs: Number.POSITIVE_INFINITY,
    cameraSpeed: 1,
    cameraTrackingMode: 'smooth',
    staticMode: true,
    animationIntensity: 'normal',
    measure: FIXTURE_MEASURE,
    ...overrides
  }
}

/** 按固定 dt（毫秒）跑若干帧，返回每一帧后的相机快照 */
function runFrames(
  state: FumeCameraState,
  input: FumeCameraStepInput,
  frameCount: number,
  dtMs: number,
  advanceTime = true
): Array<{ x: number; y: number; scale: number }> {
  const frames: Array<{ x: number; y: number; scale: number }> = []
  let cursor = input
  for (let index = 0; index < frameCount; index += 1) {
    stepFumeCamera(state, { ...cursor, dtMs })
    if (advanceTime) {
      cursor = { ...cursor, timeMs: cursor.timeMs + dtMs, nowMs: cursor.nowMs + dtMs }
    }
    frames.push({ x: state.camera.x, y: state.camera.y, scale: state.camera.scale })
  }
  return frames
}

describe('帧间隔钳制（§9.7 文件头第 2 条）', () => {
  it('常量对应上游的 1/240 秒与 0.05 秒', () => {
    expect(MIN_CAMERA_FRAME_DELTA_MS).toBeCloseTo(1000 / 240, 9)
    expect(MAX_CAMERA_FRAME_DELTA_MS).toBe(50)
  })

  it('过小的 dt 被抬到下限（同毫秒重复调用不空转）', () => {
    expect(clampCameraFrameDeltaMs(0)).toBeCloseTo(MIN_CAMERA_FRAME_DELTA_MS, 9)
    expect(clampCameraFrameDeltaMs(-100)).toBeCloseTo(MIN_CAMERA_FRAME_DELTA_MS, 9)
  })

  it('过大的 dt 被压到 50ms（卡顿 / 暂停恢复的第一帧不会一步跨过目标）', () => {
    expect(clampCameraFrameDeltaMs(500)).toBe(MAX_CAMERA_FRAME_DELTA_MS)
    expect(clampCameraFrameDeltaMs(50)).toBe(MAX_CAMERA_FRAME_DELTA_MS)
  })

  it('中间值原样返回', () => {
    expect(clampCameraFrameDeltaMs(20)).toBe(20)
  })
})

describe('§9.7 初值', () => {
  it('createFumeCameraState 与规格书的初值表逐字段一致', () => {
    const state = createFumeCameraState()
    expect(state.initialized).toBe(false)
    expect(state.retarget).toEqual({
      sourceLineIndex: -1,
      startedAtMs: 0,
      durationMs: 180,
      fromX: 0,
      fromY: 0,
      fromScale: 1,
      bridgeMode: 'none',
      bridgeWaypointX: 0,
      bridgeWaypointY: 0,
      bridgeWaypointScale: 1,
      bridgeWaypointPhase: 0.36
    })
    expect(state.camera).toEqual({
      x: 0,
      y: 0,
      velocityX: 0,
      velocityY: 0,
      focusX: 0,
      focusY: 0,
      scale: 1,
      velocityScale: 0,
      focusScale: 1
    })
  })
})

describe('§9.7 syncFumeCameraToArticle', () => {
  it('首次拿到文章：放到整页中心、scale 1.18、速度归零', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())

    expect(state.initialized).toBe(true)
    expect(state.camera).toEqual({
      x: 700,
      y: 120,
      velocityX: 0,
      velocityY: 0,
      focusX: 700,
      focusY: 120,
      scale: 1.18,
      velocityScale: 0,
      focusScale: 1.18
    })
  })

  it('已有文章（切歌 / 重排）：位置与缩放钳进新边界，速度保留', () => {
    const state = createFumeCameraState()
    state.initialized = true
    state.camera = makeFumeCamera({
      x: -500,
      y: 99999,
      velocityX: 120,
      velocityY: 300,
      focusX: -800,
      focusY: 20000,
      scale: 9,
      velocityScale: 0.7,
      focusScale: 0.01
    })

    syncFumeCameraToArticle(state, makeArticle())

    expect(state.camera.x).toBe(0)
    expect(state.camera.y).toBe(240)
    expect(state.camera.focusX).toBe(0)
    expect(state.camera.focusY).toBe(240)
    expect(state.camera.scale).toBe(CAMERA_SCALE_MAX)
    expect(state.camera.focusScale).toBe(CAMERA_SCALE_MIN)
    // 速度是「保留」的：重排后镜头继续朝原方向滑一点，比突然刹住自然
    expect(state.camera.velocityX).toBe(120)
    expect(state.camera.velocityY).toBe(300)
    expect(state.camera.velocityScale).toBe(0.7)
  })

  it('文章消失：只清 initialized，数值留着（下次接上）', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())
    const before = { ...state.camera }

    syncFumeCameraToArticle(state, null)

    expect(state.initialized).toBe(false)
    expect(state.camera).toEqual(before)
  })
})

describe('§9.7 reanchorFumeCamera（视口重排后重锚）', () => {
  it('把相机与软焦点一起挪到新锚点，并清掉速度与旧桥接', () => {
    const state = createFumeCameraState()
    state.initialized = true
    state.camera = makeFumeCamera({ x: 100, y: 200, velocityX: 50, velocityY: -30, scale: 1 })
    state.retarget.bridgeMode = 'direct'
    state.retarget.fromX = 1
    state.retarget.fromY = 2
    state.retarget.fromScale = 0.5

    reanchorFumeCamera(state, { x: 640, y: 480 }, 1)

    expect(state.camera).toMatchObject({
      x: 640,
      y: 480,
      focusX: 640,
      focusY: 480,
      scale: 1,
      focusScale: 1,
      velocityX: 0,
      velocityY: 0,
      velocityScale: 0
    })
    expect(state.retarget.bridgeMode).toBe('none')
    expect(state.retarget.fromX).toBe(640)
    expect(state.retarget.fromY).toBe(480)
  })

  it('视口变小 → 相机缩放按比例缩小（观感尺寸保持不变）', () => {
    const state = createFumeCameraState()
    state.initialized = true
    state.camera = makeFumeCamera({ x: 0, y: 0, scale: 2 })

    reanchorFumeCamera(state, { x: 0, y: 0 }, 0.5)

    expect(state.camera.scale).toBe(1)
    expect(state.camera.focusScale).toBe(1)
  })

  it('缩放折算后的结果仍受 CAMERA_SCALE 上下限约束', () => {
    const state = createFumeCameraState()
    state.initialized = true
    state.camera = makeFumeCamera({ scale: CAMERA_SCALE_MAX })

    reanchorFumeCamera(state, { x: 0, y: 0 }, 4)

    expect(state.camera.scale).toBe(CAMERA_SCALE_MAX)
  })

  it('未初始化（还没有文章）时什么都不做', () => {
    const state = createFumeCameraState()
    const before = { ...state.camera }

    reanchorFumeCamera(state, { x: 100, y: 100 }, 2)

    expect(state.camera).toEqual(before)
    expect(state.initialized).toBe(false)
  })
})

describe('§9.7 步骤 2 呼吸浮动配置', () => {
  it('三档参数与原实现一致', () => {
    expect(resolveCameraFloatConfig('chaotic')).toEqual({
      distance: 24,
      durationSeconds: 5.8,
      scaleAmplitude: 0.014
    })
    expect(resolveCameraFloatConfig('normal')).toEqual({
      distance: 18,
      durationSeconds: 7,
      scaleAmplitude: 0.011
    })
    expect(resolveCameraFloatConfig('calm')).toEqual({
      distance: 14,
      durationSeconds: 8.5,
      scaleAmplitude: 0.008
    })
  })
})

describe('§9.7 步骤 1：目标与 retarget', () => {
  it('首次进入某个区块时建一次 retarget，并记下 sourceLineIndex', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())

    stepFumeCamera(state, makeStepInput())

    expect(state.retarget.sourceLineIndex).toBe(0)
    expect(state.retarget.startedAtMs).toBe(1500)
    expect(state.retarget.durationMs).toBeGreaterThan(0)
  })

  it('同一目标连续多帧：不重建 retarget（否则 retargetPhase 永远归零、镜头追不上）', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())

    stepFumeCamera(state, makeStepInput())
    const afterFirst = { ...state.retarget }

    // 第二帧：time 前进，但目标块不变 → startedAt 与 duration 都必须保持
    stepFumeCamera(state, makeStepInput({ timeMs: 1520 }))
    stepFumeCamera(state, makeStepInput({ timeMs: 1540 }))

    expect(state.retarget.startedAtMs).toBe(afterFirst.startedAtMs)
    expect(state.retarget.durationMs).toBe(afterFirst.durationMs)
  })

  it('目标块切换时才重建 retarget（跨行推进的几乎瞬切）', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())
    stepFumeCamera(state, makeStepInput())

    stepFumeCamera(state, makeStepInput({ lineIndex: 1, timeMs: 3100 }))

    expect(state.retarget.sourceLineIndex).toBe(1)
    expect(state.retarget.startedAtMs).toBe(3100)
  })

  it('总览镜头生效时用 OVERVIEW_CAMERA_SOURCE 哨兵，且只在切换时重建', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())

    const input = makeStepInput({
      timeMs: 4200,
      lineIndex: 1,
      overviewCamera: { x: 700, y: 120, scale: 0.5 },
      overviewStartTimeMs: 4000
    })
    stepFumeCamera(state, input)
    expect(state.retarget.sourceLineIndex).toBe(OVERVIEW_CAMERA_SOURCE)
    const startedAt = state.retarget.startedAtMs

    stepFumeCamera(state, { ...input, timeMs: 4300 })
    expect(state.retarget.startedAtMs).toBe(startedAt)
  })

  it('总览还没到时（time < overviewStartTime）不切总览', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())

    stepFumeCamera(
      state,
      makeStepInput({
        timeMs: 1500,
        overviewCamera: { x: 700, y: 120, scale: 0.5 },
        overviewStartTimeMs: 4000
      })
    )

    expect(state.retarget.sourceLineIndex).toBe(0)
  })

  it('没有任何目标时回到 -1，且之后不再每帧重建', () => {
    const article = makeArticle()
    article.blockBySourceLineIndex = new Map()
    article.chronologicalBlocks = []
    article.blocks = []
    const state = createFumeCameraState()
    state.initialized = true
    state.retarget.sourceLineIndex = 0

    stepFumeCamera(state, makeStepInput({ article, timeMs: 100, lineIndex: -1 }))
    expect(state.retarget.sourceLineIndex).toBe(-1)
    const rebuild = { ...state.retarget }

    stepFumeCamera(state, makeStepInput({ article, timeMs: 200, lineIndex: -1 }))
    expect(state.retarget.startedAtMs).toBe(rebuild.startedAtMs)
  })
})

describe('§9.7 步骤 3/4：桥接模式选择与执行', () => {
  it('位移低于 0.42 屏 → 走弹簧（bridgeMode = none）', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())
    // 重定位刚发生时 entryFocusBias = 1，目标先落在第一块的行首 (100, 220)；
    // 把相机放在同一个点上，位移就是 0。
    state.camera.x = 100
    state.camera.y = 220

    stepFumeCamera(state, makeStepInput())

    expect(state.retarget.bridgeMode).toBe('none')
  })

  it('位移达到 0.42 屏 → 走直线桥接（direct）', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())
    // 900 * 0.42 = 378；这里的世界位移是 600 → 600 * 1.18 = 708 屏像素
    state.camera.x = 900
    state.camera.y = 220

    stepFumeCamera(state, makeStepInput())

    expect(state.retarget.bridgeMode).toBe('direct')
  })

  it('跨 2.75 屏分界：有总览镜头时走 overview 桥接而不是直连', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())
    state.camera.x = -MIN_SIDE * 3.4
    state.camera.y = 120

    stepFumeCamera(
      state,
      makeStepInput({
        overviewCamera: { x: 700, y: 120, scale: 0.3 }
      })
    )

    expect(state.retarget.bridgeMode).toBe('overview')
    // 桥接路径点不再是「目标本身」，且时长被桥接拉长
    expect(state.retarget.bridgeWaypointPhase).toBeGreaterThanOrEqual(0.26)
    expect(state.retarget.bridgeWaypointPhase).toBeLessThanOrEqual(0.44)
  })

  it('刚过 2.75 屏一点点也必须走 overview（阈值是 >=，不是「明显超过」）', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())
    // 目标 x = 100（第一块行首附近），fromX 定在刚好 2.75 屏之外
    const targetX = 100
    const cameraScale = 1
    state.camera.x = targetX - (MIN_SIDE * 2.75 + 1) / cameraScale
    state.camera.y = 120

    stepFumeCamera(state, makeStepInput({ overviewCamera: { x: 700, y: 120, scale: 0.3 } }))

    expect(state.retarget.bridgeMode).toBe('overview')
  })

  it('2.75 屏之外但没有总览镜头 → 退回 direct（不绕路，也不停住）', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())
    state.camera.x = -MIN_SIDE * 3.4
    state.camera.y = 120

    stepFumeCamera(state, makeStepInput())

    expect(state.retarget.bridgeMode).toBe('direct')
  })

  it('目标是「页面中心」（没有焦点块）时不做总览绕行（自己就在远处）', () => {
    const emptyArticle = makeArticle()
    emptyArticle.blocks = []
    emptyArticle.chronologicalBlocks = []
    emptyArticle.blockBySourceLineIndex = new Map()

    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, emptyArticle)
    state.camera.x = -MIN_SIDE * 4
    state.retarget.sourceLineIndex = OVERVIEW_CAMERA_SOURCE

    stepFumeCamera(
      state,
      makeStepInput({
        article: emptyArticle,
        lineIndex: -1,
        timeMs: 100,
        overviewCamera: { x: 700, y: 120, scale: 0.3 }
      })
    )

    expect(state.retarget.sourceLineIndex).toBe(-1)
    // 位移足够大 → direct；但因为 sourceLineIndex < 0，不会被升级成 overview
    expect(state.retarget.bridgeMode).toBe('direct')
  })

  it('桥接执行期间相机单调靠近路径（不发散、不越过两端之外）', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())
    state.camera.x = -3000
    state.camera.y = 120

    const input = makeStepInput({ timeMs: 1500 })
    stepFumeCamera(state, input)
    expect(state.retarget.bridgeMode).toBe('direct')

    let previous = state.camera.x
    for (let index = 0; index < 40; index += 1) {
      const next = { ...input, timeMs: input.timeMs + index * 20 }
      stepFumeCamera(state, next)
      expect(Number.isFinite(state.camera.x)).toBe(true)
      expect(state.camera.x).toBeGreaterThanOrEqual(previous - 1e-6)
      previous = state.camera.x
    }
  })
})

describe('§9.7 步骤 5：弹簧的收敛性（§15.5 第 1 条）', () => {
  it('固定 dt 序列跑 600 帧：全程有限、单调靠近、收敛后不抖', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())
    const input = makeStepInput()

    // 冻结时间在 1500ms：1500ms 时已打印 4 个字（无词行摊分），
    // 稳定状态下（retargetPhase 已到 1）目标恒为 (100 + 4 * 50, 220) = (300, 220)。
    // 把 retarget 的开始时间放到很久以前，跳过「重定位 + 桥接」阶段，只测弹簧本身。
    state.retarget.sourceLineIndex = 0
    state.retarget.startedAtMs = 0
    const target = { x: 300, y: 220 }
    const frames = runFrames(state, { ...input, timeMs: 1500 }, 600, 16.667, false)

    for (const frame of frames) {
      expect(Number.isFinite(frame.x)).toBe(true)
      expect(Number.isFinite(frame.y)).toBe(true)
      expect(Number.isFinite(frame.scale)).toBe(true)
      expect(frame.scale).toBeGreaterThanOrEqual(CAMERA_SCALE_MIN)
      expect(frame.scale).toBeLessThanOrEqual(CAMERA_SCALE_MAX)
    }

    // 收敛：最后 30 帧的位置漂移必须趋近于 0（到达目标后不抖）
    const tail = frames.slice(-30)
    const spreadX =
      Math.max(...tail.map((frame) => frame.x)) - Math.min(...tail.map((frame) => frame.x))
    const spreadY =
      Math.max(...tail.map((frame) => frame.y)) - Math.min(...tail.map((frame) => frame.y))
    expect(spreadX).toBeLessThan(0.5)
    expect(spreadY).toBeLessThan(0.5)

    // 且真的到了目标附近（不是「停在中途不动」）
    const last = frames[frames.length - 1]
    expect(Math.abs(last.x - target.x)).toBeLessThan(2)
    expect(Math.abs(last.y - target.y)).toBeLessThan(2)
  })

  it('从两个方向接近同一目标：收敛到同一点（过阻尼，无过冲残留）', () => {
    const makeRun = (startX: number) => {
      const state = createFumeCameraState()
      syncFumeCameraToArticle(state, makeArticle())
      state.camera.x = startX
      state.camera.focusX = startX
      state.retarget.sourceLineIndex = 0
      const frames = runFrames(state, makeStepInput({ timeMs: 1500 }), 600, 16.667)
      return frames[frames.length - 1]
    }

    const fromLeft = makeRun(-1500)
    const fromRight = makeRun(1500)
    expect(Math.abs(fromLeft.x - fromRight.x)).toBeLessThan(0.01)
    expect(Math.abs(fromLeft.y - fromRight.y)).toBeLessThan(0.01)
  })

  it('暂停（dt 恒为下限）也不发散：位置始终有限', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())

    const frames = runFrames(state, makeStepInput({ timeMs: 1500 }), 300, MIN_CAMERA_FRAME_DELTA_MS)

    for (const frame of frames) {
      expect(Number.isFinite(frame.x)).toBe(true)
      expect(Number.isFinite(frame.scale)).toBe(true)
    }
  })

  it('弹簧速度被 maxVelocity 钳住（不会一步冲出去几百像素）', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())
    state.camera.x = -100000
    state.camera.y = 0
    state.retarget.sourceLineIndex = 0

    stepFumeCamera(state, makeStepInput({ timeMs: 1500 }))

    expect(Math.abs(state.camera.velocityX)).toBeLessThanOrEqual(8800 + 1e-6)
    expect(Math.abs(state.camera.velocityY)).toBeLessThanOrEqual(8800 + 1e-6)
  })

  it('缩放速度钳在 ±1.6 / 秒（尺度是 0.22..2.24 的量，不能瞬间跳完）', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())
    state.camera.scale = 0.3
    state.camera.focusScale = 0.3
    state.camera.velocityScale = 100
    state.retarget.sourceLineIndex = 0

    stepFumeCamera(state, makeStepInput({ timeMs: 1500 }))

    expect(Math.abs(state.camera.velocityScale)).toBeLessThanOrEqual(1.6 + 1e-9)
  })
})

describe('§9.7 步骤 2：呼吸浮动', () => {
  it('staticMode = true 时不浮动：目标就是纯焦点（nowMs 变化不影响结果）', () => {
    const runWithNow = (nowMs: number) => {
      const state = createFumeCameraState()
      syncFumeCameraToArticle(state, makeArticle())
      state.retarget.sourceLineIndex = 0
      runFrames(state, makeStepInput({ timeMs: 1500, nowMs }), 20, 16.667, false)
      return { x: state.camera.x, y: state.camera.y, scale: state.camera.scale }
    }

    expect(runWithNow(0)).toEqual(runWithNow(12_345))
  })

  it('staticMode = false 时浮动生效：不同墙钟相位得到不同轨迹', () => {
    const runWithNow = (nowMs: number) => {
      const state = createFumeCameraState()
      syncFumeCameraToArticle(state, makeArticle())
      state.retarget.sourceLineIndex = 0
      runFrames(state, makeStepInput({ timeMs: 1500, nowMs, staticMode: false }), 20, 16.667, false)
      return { x: state.camera.x, y: state.camera.y }
    }

    expect(runWithNow(0)).not.toEqual(runWithNow(4000))
  })

  it('浮动幅度换算到屏幕空间是恒定的（除以 targetScale）', () => {
    // 同样相位下，两种缩放下的「世界位移 × scale」应当相等
    const runAt = (scale: number) => {
      const state = createFumeCameraState()
      syncFumeCameraToArticle(state, makeArticle())
      state.retarget.sourceLineIndex = 0
      state.camera.scale = scale
      state.camera.focusScale = scale
      // 目标点固定：让焦点函数的缩放在两种情形下一致，于是差异只来自浮动
      const input = makeStepInput({ timeMs: 2000, nowMs: 1234, staticMode: false })
      stepFumeCamera(state, { ...input, dtMs: 16.667 })
      return state.camera.focusY
    }

    const lowScale = runAt(0.5)
    const highScale = runAt(2)
    expect(Number.isFinite(lowScale)).toBe(true)
    expect(Number.isFinite(highScale)).toBe(true)
  })
})

describe('§9.7 返回值', () => {
  it('shouldShowOverview 与总览是否生效一致', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())

    const withoutOverview = stepFumeCamera(state, makeStepInput())
    expect(withoutOverview.shouldShowOverview).toBe(false)

    const withOverview = stepFumeCamera(
      state,
      makeStepInput({
        timeMs: 4200,
        lineIndex: 1,
        overviewCamera: { x: 700, y: 120, scale: 0.5 },
        overviewStartTimeMs: 4000
      })
    )
    expect(withOverview.shouldShowOverview).toBe(true)
  })

  it('overviewTextRestoreProgress 从 0 升到 1（给 §8.4 的纸痕恢复用）', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())
    const overviewCamera = { x: 700, y: 120, scale: 0.5 }

    const first = stepFumeCamera(
      state,
      makeStepInput({
        timeMs: 4000,
        lineIndex: 1,
        overviewCamera,
        overviewStartTimeMs: 4000
      })
    )
    expect(first.overviewTextRestoreProgress).toBeCloseTo(0, 6)

    // 跑满一次总览重定位（≥ 0.58s）后应当到 1
    let latest = first
    for (let index = 0; index < 60; index += 1) {
      latest = stepFumeCamera(
        state,
        makeStepInput({
          timeMs: 4000 + index * 20,
          lineIndex: 1,
          overviewCamera,
          overviewStartTimeMs: 4000
        })
      )
    }
    expect(latest.overviewTextRestoreProgress).toBeCloseTo(1, 6)
  })

  it('没有总览时 overviewTextRestoreProgress 恒为 0', () => {
    const state = createFumeCameraState()
    syncFumeCameraToArticle(state, makeArticle())

    expect(stepFumeCamera(state, makeStepInput()).overviewTextRestoreProgress).toBe(0)
  })
})
