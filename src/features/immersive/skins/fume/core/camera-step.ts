/**
 * 相机的逐帧运动（移植规格书 §9.7）：选目标 → 加呼吸浮动 → 桥接或弹簧。
 *
 * ## 为什么是「原地 mutate 一个普通对象」
 *
 * 相机状态必须**跨 stage 重建存活**（§17.1 第 1 条）：切歌、改设置都会重建整个
 * stage，但镜头不该跟着闪。所以状态由组件持有、本函数原地积分。
 *
 * ⚠️ 这个状态必须是**普通对象**，绝不是 `reactive` / `ref`：每帧要写十几个字段，
 * 进了响应式系统就是每帧十几次依赖通知，帧率会直接掉下来。
 *
 * ## 顺序本身就是算法
 *
 * 1. 决定目标（总览 / 焦点块 / 页面中心），并在**目标变化时**建一次 `retarget`；
 * 2. 由 `retarget` 进度算进场偏置与呼吸浮动（浮动在**屏幕空间**定义，再折回世界）；
 * 3. 本帧若发生重定位，决定桥接模式（none / direct / overview）与路径点；
 * 4. 桥接期间走「解析路径 + 指数追赶」，不走弹簧；
 * 5. 非桥接期间走「一阶软焦点 + 二阶弹簧」；
 * 6. 返回 `shouldShowOverview` 与 `overviewTextRestoreProgress`。
 *
 * 步骤 3 刻意排在浮动之后：桥接距离要用**加过浮动**的目标来算，
 * 否则「缓慢漂移的目标」与「静止的目标」会得到不同的桥接判定。
 *
 * ## 单位
 *
 * 上游时间单位是秒、墙钟是毫秒；本项目统一成**毫秒**：
 * - `timeMs` 播放时间、`nowMs` 墙钟（驱动呼吸浮动，暂停时也继续漂）、`dtMs` 本帧耗时。
 * - 上游把 `dt` 钳到 `[1/240, 0.05]` 秒，这里对应 `[1000/240, 50]` 毫秒。
 *   **上限 50ms 很重要**：暂停后恢复的第一帧、或主线程被排版卡住的一帧，`dt` 可能是
 *   几百毫秒，不钳会让弹簧一步跨过目标再弹回来（视觉上是镜头「抽一下」）。
 *   本模块的 `clampCameraFrameDeltaMs` 提供这一步，调用方（stage）必须用它。
 */

import { clamp, easeInOutCubic, easeOutCubic, mix, quadraticBezier } from './fume-math'
import { resolvePrintedGraphemeCount, resolvePrintedGraphemeProgress } from './fume-reveal'
import {
  CAMERA_SCALE_MAX,
  CAMERA_SCALE_MIN,
  OVERVIEW_CAMERA_SOURCE,
  resolveBlockEntryFocusPoint,
  resolveCameraRetargetDurationMs,
  resolveCameraScaleForBlock,
  resolveFocusBlock,
  resolveOverviewFlightBridge,
  resolveOverviewRetargetDurationMs,
  resolveSmoothBlockFocusPoint,
  resolveSteppedBlockFocusPoint,
  type FumeBlockMeasure
} from './camera'
import type {
  FumeArticleLayout,
  FumeCameraRetargetState,
  FumeCameraState,
  FumeCameraTrackingMode,
  FumeCameraViewTarget,
  FumeTheme,
  FumeViewportSize
} from './fume-types'

/** 帧间隔下限（对应上游 1/240 秒）：同一毫秒内重复调用时不让弹簧「零步前进」 */
export const MIN_CAMERA_FRAME_DELTA_MS = 1000 / 240

/** 帧间隔上限（对应上游 0.05 秒）：卡顿 / 暂停恢复后的第一帧不许一步跨过目标 */
export const MAX_CAMERA_FRAME_DELTA_MS = 50

/** 桥接模式的择优阈值（屏占比）：≥ 0.42 屏就不走弹簧，改用直线桥接 */
const DIRECT_BRIDGE_TRIGGER_SCREENS = 0.42

/** 呼吸浮动的三档配置（§9.7 步骤 2）：距离是屏幕 px，时长是秒 */
export interface FumeCameraFloatConfig {
  distance: number
  durationSeconds: number
  scaleAmplitude: number
}

/** 把帧间隔钳进 [MIN, MAX]（stage 每帧调用一次，见文件头第 2 条） */
export function clampCameraFrameDeltaMs(deltaMs: number): number {
  return clamp(deltaMs, MIN_CAMERA_FRAME_DELTA_MS, MAX_CAMERA_FRAME_DELTA_MS)
}

/** 新建一个初值状态的相机（§9.7 的初值表，逐字段对应） */
export function createFumeCameraState(): FumeCameraState {
  return {
    initialized: false,
    retarget: {
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
    },
    camera: {
      x: 0,
      y: 0,
      velocityX: 0,
      velocityY: 0,
      focusX: 0,
      focusY: 0,
      scale: 1,
      velocityScale: 0,
      focusScale: 1
    }
  }
}

/** 建一次重定位：把「相机现在的样子」记为起点，并清掉上一次的桥接路径 */
function beginRetarget(
  state: FumeCameraState,
  sourceLineIndex: number,
  startedAtMs: number,
  durationMs: number
): void {
  const retarget: FumeCameraRetargetState = {
    sourceLineIndex,
    startedAtMs,
    durationMs,
    fromX: state.camera.x,
    fromY: state.camera.y,
    fromScale: state.camera.scale,
    bridgeMode: 'none',
    bridgeWaypointX: 0,
    bridgeWaypointY: 0,
    bridgeWaypointScale: 1,
    bridgeWaypointPhase: 0.36
  }
  state.retarget = retarget
}

/**
 * 按「焦点在世界里的位移」重锚相机（视口变化导致重排后调用）。
 *
 * ## 为什么需要它（不是「顺手优化」）
 *
 * 窗口一改大小，整篇文章会被重排：纸张宽度、栏数、字号、每个区块的 `x/y` 全都变。
 * 相机状态**刻意跨文章存活**（§17.1 第 1 条），而 `syncFumeCameraToArticle` 对
 * 已有文章只做 clamp —— 于是相机还停在旧文章坐标系里的那个点。新文章里同一句歌词
 * 已经挪到别处，画面就表现为「歌词与背景一起瞬移」；更糟的是暂停时绘制循环会停帧，
 * 错位的一帧会**永久留在屏幕上**（用户看到的是「暂停后停在未知位置」）。
 *
 * 所以重排后要把相机平移到「焦点的新位置 + 原来的屏幕偏移」，屏幕偏移为零时
 * 等价于「镜头重新对准同一句歌词」。缩放按视口短边比例折算：`resolveCameraScaleForBlock`
 * 的目标字号本来就是视口短边的 11.5%，不跟着折算会让画面在重排瞬间明显变大/变小。
 *
 * 切歌**不能**走这条路径（那是另一篇文章，应当保留镜头惯性继续滑，见文件头的
 * 原语义）—— 调用方用「视口变化」来区分。
 */
export function reanchorFumeCamera(
  state: FumeCameraState,
  anchor: { x: number; y: number },
  viewportScale: number
): void {
  if (!state.initialized) return

  const scale = clamp(
    state.camera.scale * clamp(viewportScale, 0.25, 4),
    CAMERA_SCALE_MIN,
    CAMERA_SCALE_MAX
  )

  state.camera.x = anchor.x
  state.camera.y = anchor.y
  state.camera.focusX = anchor.x
  state.camera.focusY = anchor.y
  state.camera.scale = scale
  state.camera.focusScale = scale
  state.camera.velocityX = 0
  state.camera.velocityY = 0
  state.camera.velocityScale = 0
  // 旧的桥接路径是按旧文章算的，重锚后继续走会在两个坐标系之间插值
  state.retarget.bridgeMode = 'none'
  state.retarget.fromX = anchor.x
  state.retarget.fromY = anchor.y
  state.retarget.fromScale = scale
}

/**
 * 把相机同步到（新的）文章（§9.7）。
 *
 * - **首次**拿到文章：放到整页中心、scale 1.18、速度归零。1.18 不是随便取的：
 *   它明显小于 `CAMERA_SCALE_MAX`，但大于总览的 0.72 上限 —— 开场是「凑近看第一句」，
 *   而不是「先看全篇」。
 * - **已有文章**（切歌 / 重排）：位置与缩放**钳进新边界**，保留速度。保留是有意的：
 *   重排后镜头继续朝原方向滑一点，比突然刹住自然。
 * - **文章消失**（清空歌词）：只清 `initialized`，数值留着 —— 下次拿到同尺寸的文章时
 *   镜头能接上（状态由组件持有，stage 重建不影响）。
 */
export function syncFumeCameraToArticle(
  state: FumeCameraState,
  article: FumeArticleLayout | null
): void {
  if (article && !state.initialized) {
    state.camera = {
      x: article.width * 0.5,
      y: article.height * 0.5,
      velocityX: 0,
      velocityY: 0,
      focusX: article.width * 0.5,
      focusY: article.height * 0.5,
      scale: 1.18,
      velocityScale: 0,
      focusScale: 1.18
    }
    state.initialized = true
    return
  }

  if (article) {
    state.camera.x = clamp(state.camera.x, 0, article.width)
    state.camera.y = clamp(state.camera.y, 0, article.height)
    state.camera.focusX = clamp(state.camera.focusX, 0, article.width)
    state.camera.focusY = clamp(state.camera.focusY, 0, article.height)
    state.camera.scale = clamp(state.camera.scale, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX)
    state.camera.focusScale = clamp(state.camera.focusScale, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX)
    return
  }

  state.initialized = false
}

/** `stepFumeCamera` 的输入（§9.7 的输入表，时间单位统一为毫秒） */
export interface FumeCameraStepInput {
  article: FumeArticleLayout
  /** 播放时间（毫秒） */
  timeMs: number
  /** 墙钟（毫秒，驱动呼吸浮动） */
  nowMs: number
  /** 本帧耗时（毫秒）。**已由 `clampCameraFrameDeltaMs` 钳过** */
  dtMs: number
  lineIndex: number
  viewport: FumeViewportSize
  overviewCamera: FumeCameraViewTarget | null
  overviewStartTimeMs: number
  cameraSpeed: number
  cameraTrackingMode: FumeCameraTrackingMode
  staticMode: boolean
  animationIntensity: FumeTheme['animationIntensity']
  /** 字素度量（焦点计算用），见 `camera.ts` 的 `FumeBlockMeasure` */
  measure: FumeBlockMeasure
}

/** 每帧返回值（§9.7 的返回值表） */
export interface FumeCameraStepResult {
  shouldShowOverview: boolean
  /** 总览进场过程中 0→1；§8.4 用它把纸痕「重新变清楚」 */
  overviewTextRestoreProgress: number
}

/** 呼吸浮动配置（§9.7 步骤 2 的三档） */
export function resolveCameraFloatConfig(
  animationIntensity: FumeTheme['animationIntensity']
): FumeCameraFloatConfig {
  if (animationIntensity === 'chaotic') {
    return { distance: 24, durationSeconds: 5.8, scaleAmplitude: 0.014 }
  }
  if (animationIntensity === 'calm') {
    return { distance: 14, durationSeconds: 8.5, scaleAmplitude: 0.008 }
  }
  return { distance: 18, durationSeconds: 7, scaleAmplitude: 0.011 }
}

/** 本帧的目标（步骤 1 的产物；`entryFocusPoint` 供步骤 2 的进场偏置用） */
interface FumeCameraStepTarget {
  x: number
  y: number
  scale: number
  entryFocusPoint: { x: number; y: number } | null
  shouldShowOverview: boolean
}

/** 本帧目标 + 是否刚建过 retarget */
interface FumeCameraTargetResolution {
  target: FumeCameraStepTarget
  didRetargetThisFrame: boolean
}

/**
 * 步骤 1：决定目标（§9.7 步骤 1）。
 *
 * 四种情形：总览 > 焦点块 > 「原本有目标但现在没了」（归位到页面中心）> 保持现状。
 * 最后一个分支**不建 retarget**，这是有意的：`sourceLineIndex` 已经是 -1 时每帧重建
 * 会让 `retargetPhase` 永远回到 0，镜头永远追不上 —— 表现为「镜头卡在原地不动」。
 */
function resolveStepTarget(
  state: FumeCameraState,
  input: FumeCameraStepInput
): FumeCameraTargetResolution {
  const { article, timeMs, lineIndex, viewport } = input
  const focusBlock = resolveFocusBlock(article, lineIndex, timeMs)
  const shouldShowOverview = input.overviewCamera !== null && timeMs >= input.overviewStartTimeMs

  const target: FumeCameraStepTarget = {
    x: article.width * 0.5,
    y: article.height * 0.5,
    scale: 1.18,
    entryFocusPoint: null,
    shouldShowOverview
  }

  if (shouldShowOverview && input.overviewCamera) {
    target.x = input.overviewCamera.x
    target.y = input.overviewCamera.y
    target.scale = input.overviewCamera.scale

    if (state.retarget.sourceLineIndex !== OVERVIEW_CAMERA_SOURCE) {
      beginRetarget(
        state,
        OVERVIEW_CAMERA_SOURCE,
        timeMs,
        clamp(resolveOverviewRetargetDurationMs(viewport) / input.cameraSpeed, 120, 1200)
      )
      return { target, didRetargetThisFrame: true }
    }
    return { target, didRetargetThisFrame: false }
  }

  if (focusBlock) {
    const focusPoint =
      input.cameraTrackingMode === 'stepped'
        ? resolveSteppedBlockFocusPoint(
            focusBlock,
            resolvePrintedGraphemeCount(
              focusBlock.line,
              focusBlock.wordRanges,
              focusBlock.graphemes.length,
              timeMs
            ),
            input.measure
          )
        : resolveSmoothBlockFocusPoint(
            focusBlock,
            resolvePrintedGraphemeProgress(
              focusBlock.line,
              focusBlock.wordRanges,
              focusBlock.graphemes.length,
              timeMs
            ),
            input.measure
          )
    target.entryFocusPoint = resolveBlockEntryFocusPoint(focusBlock)
    target.x = focusPoint.x
    target.y = focusPoint.y
    target.scale = resolveCameraScaleForBlock(focusBlock, viewport)

    if (state.retarget.sourceLineIndex !== focusBlock.sourceLineIndex) {
      beginRetarget(
        state,
        focusBlock.sourceLineIndex,
        timeMs,
        clamp(resolveCameraRetargetDurationMs(focusBlock.line) / input.cameraSpeed, 30, 300)
      )
      return { target, didRetargetThisFrame: true }
    }
    return { target, didRetargetThisFrame: false }
  }

  if (state.retarget.sourceLineIndex !== -1) {
    beginRetarget(state, -1, timeMs, clamp(180 / input.cameraSpeed, 50, 400))
    return { target, didRetargetThisFrame: true }
  }

  return { target, didRetargetThisFrame: false }
}

/**
 * 步骤 3：本帧发生重定位时，决定桥接模式并（可能）算总览绕行的路径点（§9.7 步骤 3）。
 *
 * 两个阈值是**择优**关系：先按 ≥ 0.42 屏判 `direct`，再尝试升级成 `overview`
 * （≥ 2.75 屏 + 有总览镜头 + 目标是区块）。`sourceLineIndex >= 0` 这个条件是必须的：
 * 总览镜头与「页面中心」这两种目标自己就在远处，再绕一次没有意义。
 */
function resolveBridgeMode(
  state: FumeCameraState,
  input: FumeCameraStepInput,
  targetX: number,
  targetY: number,
  targetScale: number
): void {
  const bridgeScale = Math.max(state.camera.scale, targetScale, 0.001)
  const screenDistance =
    Math.hypot(targetX - state.retarget.fromX, targetY - state.retarget.fromY) * bridgeScale

  state.retarget.bridgeMode =
    screenDistance >=
    Math.min(input.viewport.width, input.viewport.height) * DIRECT_BRIDGE_TRIGGER_SCREENS
      ? 'direct'
      : 'none'
  // 默认路径点就是目标本身：direct 模式下 `bridgeWaypointPhase = 0.5`，
  // 「前半程到中点、后半程到目标」在直线情况下等价于一次 `easeInOutCubic` 插值
  state.retarget.bridgeWaypointX = targetX
  state.retarget.bridgeWaypointY = targetY
  state.retarget.bridgeWaypointScale = targetScale
  state.retarget.bridgeWaypointPhase = 0.5

  if (state.retarget.sourceLineIndex < 0) return

  const overviewFlightBridge = resolveOverviewFlightBridge({
    fromX: state.retarget.fromX,
    fromY: state.retarget.fromY,
    fromScale: state.retarget.fromScale,
    targetX,
    targetY,
    targetScale,
    overviewCamera: input.overviewCamera,
    viewport: input.viewport
  })
  if (!overviewFlightBridge) return

  state.retarget.bridgeMode = 'overview'
  state.retarget.bridgeWaypointX = overviewFlightBridge.waypointX
  state.retarget.bridgeWaypointY = overviewFlightBridge.waypointY
  state.retarget.bridgeWaypointScale = overviewFlightBridge.waypointScale
  state.retarget.bridgeWaypointPhase = overviewFlightBridge.waypointPhase
  // 绕行比直线长得多，所以时长只增不减
  state.retarget.durationMs = Math.max(
    state.retarget.durationMs,
    clamp(overviewFlightBridge.durationMs / input.cameraSpeed, 160, 900)
  )
}

/**
 * 步骤 4：桥接执行（§9.7 步骤 4）—— 解析路径 + 按 `retargetPhase` 加速的指数追赶。
 *
 * 路径保证**视觉形状**（弧线 / 直线），追赶保证**不穿帮**：路径因浮动或目标变化而漂移时，
 * 相机会跟上。追赶率随 `retargetPhase` 增大而提高（越接近终点追得越紧）。
 */
function stepBridge(
  state: FumeCameraState,
  dtSeconds: number,
  retargetPhase: number,
  targetX: number,
  targetY: number,
  targetScale: number
): void {
  const { retarget, camera } = state
  const isOverview = retarget.bridgeMode === 'overview'
  let bridgedX: number
  let bridgedY: number
  let bridgedScale: number

  if (isOverview) {
    // 总览绕行用 **easeOutCubic**：起步快（先迅速拉远），到路径点后减速转向目标。
    // 注意二次贝塞尔的 `t` 是 `bridgePhase`，不是 `retargetPhase` —— 两者不同是刻意的。
    const bridgePhase = easeOutCubic(retargetPhase)
    bridgedX = quadraticBezier(retarget.fromX, retarget.bridgeWaypointX, targetX, bridgePhase)
    bridgedY = quadraticBezier(retarget.fromY, retarget.bridgeWaypointY, targetY, bridgePhase)
    bridgedScale = quadraticBezier(
      retarget.fromScale,
      retarget.bridgeWaypointScale,
      targetScale,
      bridgePhase
    )
  } else {
    const bridgePhase = easeInOutCubic(retargetPhase)
    bridgedX = mix(retarget.fromX, targetX, bridgePhase)
    bridgedY = mix(retarget.fromY, targetY, bridgePhase)
    bridgedScale = mix(retarget.fromScale, targetScale, bridgePhase)
  }

  const bridgeCatchUp =
    1 -
    Math.exp(
      -dtSeconds *
        (isOverview ? mix(12.5, 22, 1 - retargetPhase) : mix(10.5, 17.5, 1 - retargetPhase))
    )

  camera.focusX = bridgedX
  camera.focusY = bridgedY
  camera.focusScale = bridgedScale
  camera.x += (bridgedX - camera.x) * bridgeCatchUp
  camera.y += (bridgedY - camera.y) * bridgeCatchUp
  camera.scale = clamp(
    camera.scale + (bridgedScale - camera.scale) * bridgeCatchUp,
    CAMERA_SCALE_MIN,
    CAMERA_SCALE_MAX
  )
  // 桥接期间弹簧速度只用来**衰减**：不衰减的话，退出桥接那一刻会带着旧速度冲出去
  camera.velocityX *= 0.72
  camera.velocityY *= 0.72
  camera.velocityScale *= 0.68
}

/**
 * 步骤 5：普通弹簧收敛（§9.7 步骤 5）。
 *
 * 两层结构：先一阶「软焦点」追目标（吸收抖动），再二阶弹簧追软焦点（产生运动感）。
 * `retargetBoost` 把刚度从 208 拉到 260..780 —— 「刚切行时收紧、稳定后放松」。
 *
 * 阻尼系数 **1.36** 是临界阻尼的 1.36 倍（过阻尼）：镜头不会过冲回弹，只会稳稳贴上。
 * 缩放单独一组参数（刚度 54..108、速度上限 ±1.6/秒）：尺度是 0.22..2.24 的量，
 * 用位移那套刚度会让缩放瞬间跳完。
 */
function stepSpring(
  state: FumeCameraState,
  dtSeconds: number,
  retargetBoost: number,
  targetX: number,
  targetY: number,
  targetScale: number
): void {
  const { camera, retarget } = state
  const durationSeconds = Math.max(retarget.durationMs / 1000, 0.05)
  const cameraDistance = Math.hypot(targetX - camera.x, targetY - camera.y)

  const boostedCatchUpRate = clamp(4.8 / durationSeconds, 20, 54)
  const targetCatchUp = 1 - Math.exp(-dtSeconds * mix(11.2, boostedCatchUpRate, retargetBoost))
  camera.focusX += (targetX - camera.focusX) * targetCatchUp
  camera.focusY += (targetY - camera.focusY) * targetCatchUp
  camera.focusScale +=
    (targetScale - camera.focusScale) * (1 - Math.exp(-dtSeconds * mix(5.4, 12.8, retargetBoost)))

  const springStrength = mix(
    208,
    clamp(15.8 / Math.max(durationSeconds * durationSeconds, 0.0064), 260, 780),
    retargetBoost
  )
  const damping = mix(24, clamp(Math.sqrt(springStrength) * 1.36, 24, 40), retargetBoost)
  camera.velocityX +=
    ((camera.focusX - camera.x) * springStrength - camera.velocityX * damping) * dtSeconds
  camera.velocityY +=
    ((camera.focusY - camera.y) * springStrength - camera.velocityY * damping) * dtSeconds

  const maxVelocity = mix(
    1320,
    clamp(cameraDistance / Math.max(durationSeconds * 0.28, 0.028), 2600, 8800),
    retargetBoost
  )
  camera.velocityX = clamp(camera.velocityX, -maxVelocity, maxVelocity)
  camera.velocityY = clamp(camera.velocityY, -maxVelocity, maxVelocity)
  camera.x += camera.velocityX * dtSeconds
  camera.y += camera.velocityY * dtSeconds

  const scaleSpringStrength = mix(54, 108, retargetBoost)
  const scaleDamping = mix(13.5, 21, retargetBoost)
  camera.velocityScale +=
    ((camera.focusScale - camera.scale) * scaleSpringStrength -
      camera.velocityScale * scaleDamping) *
    dtSeconds
  camera.velocityScale = clamp(camera.velocityScale, -1.6, 1.6)
  camera.scale = clamp(
    camera.scale + camera.velocityScale * dtSeconds,
    CAMERA_SCALE_MIN,
    CAMERA_SCALE_MAX
  )
}

/**
 * 相机的每帧步进（§9.7）。**原地 mutate `state`**；返回值只带两个给渲染层用的标志。
 */
export function stepFumeCamera(
  state: FumeCameraState,
  input: FumeCameraStepInput
): FumeCameraStepResult {
  const dtSeconds = input.dtMs / 1000

  // ── 步骤 1：目标 ──────────────────────────────────────────────────────────
  const { target, didRetargetThisFrame } = resolveStepTarget(state, input)

  // ── 步骤 2：进度、进场偏置与呼吸浮动 ─────────────────────────────────────
  const retargetElapsedMs = Math.max(input.timeMs - state.retarget.startedAtMs, 0)
  const retargetPhase = clamp(retargetElapsedMs / Math.max(state.retarget.durationMs, 0.001), 0, 1)
  const overviewTextRestoreProgress =
    target.shouldShowOverview && state.retarget.sourceLineIndex === OVERVIEW_CAMERA_SOURCE
      ? easeInOutCubic(retargetPhase)
      : 0
  const retargetBoost = 1 - easeOutCubic(retargetPhase)
  const entryFocusBias = Math.pow(retargetBoost, 0.58)

  let targetX = target.x
  let targetY = target.y
  let targetScale = target.scale

  if (target.entryFocusPoint) {
    targetX = mix(targetX, target.entryFocusPoint.x, entryFocusBias)
    targetY = mix(targetY, target.entryFocusPoint.y, entryFocusBias)
  }

  if (!input.staticMode) {
    const floatConfig = resolveCameraFloatConfig(input.animationIntensity)
    const floatPhase = (input.nowMs / 1000 / floatConfig.durationSeconds) * Math.PI * 2
    const overviewAttenuation = target.shouldShowOverview ? 0.36 : 1
    const screenFloatX = Math.sin(floatPhase * 0.74 + 0.8) * floatConfig.distance * 0.34
    // 横向浮动**不衰减**，纵向衰减到 36%：总览时纸不再上下晃，但仍会轻微左右漂
    const screenFloatY =
      (Math.sin(floatPhase) * floatConfig.distance +
        Math.sin(floatPhase * 0.5 + 1.1) * floatConfig.distance * 0.22) *
      overviewAttenuation
    const worldFloatDivisor = Math.max(targetScale, 0.001)

    targetX -= screenFloatX / worldFloatDivisor
    targetY -= screenFloatY / worldFloatDivisor
    targetScale = clamp(
      targetScale *
        (1 + Math.sin(floatPhase + 0.9) * floatConfig.scaleAmplitude * overviewAttenuation),
      CAMERA_SCALE_MIN,
      CAMERA_SCALE_MAX
    )
  }

  // ── 步骤 3：本帧重定位则决定桥接模式 ─────────────────────────────────────
  if (didRetargetThisFrame) {
    resolveBridgeMode(state, input, targetX, targetY, targetScale)
  }

  // ── 步骤 4 / 5：桥接或弹簧 ───────────────────────────────────────────────
  if (state.retarget.bridgeMode !== 'none' && retargetPhase < 1) {
    stepBridge(state, dtSeconds, retargetPhase, targetX, targetY, targetScale)
  } else {
    stepSpring(state, dtSeconds, retargetBoost, targetX, targetY, targetScale)
  }

  return {
    shouldShowOverview: target.shouldShowOverview,
    overviewTextRestoreProgress
  }
}
