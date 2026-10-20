/**
 * 「浮名」的**每帧绘制流程**（移植规格书 §11.3）。
 *
 * ## 一条 rAF，严格按序
 *
 * ```
 * ① 尺寸 / DPR 复查 + setTransform + clearRect
 * ② 无文章：只画背景，世界中心对到视口中心，结束
 * ③ 首次打印回调（一次性，切歌要重置）
 * ④ 相机步进（§9.7）
 * ⑤ 背景层（含 §9.8 的视差视图）
 * ⑥ 世界变换 + 逐区块（静态快照 or 实时绘制）
 * ⑦ 清缓存 + 续帧
 * ```
 *
 * 顺序不是风格问题：`clearRect` 必须在所有绘制之前、相机必须在背景之前
 * （背景的视差读相机）、世界变换必须在文字之前、续帧必须在最后
 * （否则异常会让队列里堆两条 rAF）。
 *
 * ## 为什么不再自己起一条 rAF（F3 时是分开的）
 *
 * F3 阶段只有背景，`use-fume-background.ts` 自己跑一条循环还算合理。
 * 但 §11.3 的流程要求背景与文字**共用同一套 context 变换与同一份清屏**，
 * 两条 rAF 会让「谁先跑」取决于订阅顺序（不可见），于是：
 * - 背景可能画在文字之上（清屏把它抹掉 / 盖住字）；
 * - 每帧的 `setTransform` 会互相覆盖，`drawImage` 的坐标系漂移。
 *
 * 所以本文件是**唯一的绘制循环**，F3 的背景逻辑（尺寸复查、时间轴、
 * 无文章分支、停帧语义）原样并进来，行为不变 —— 只是不再需要 `scene` ref 的
 * watch 来唤醒：场景本身就是本 hook 的入参。
 *
 * ## 停帧语义（§16.4）
 *
 * 有文章 + 暂停 → **画完当前帧就不排下一帧**（CPU 真降到 0，而不是空转）。
 * 无文章时仍排帧（背景要转）。所以 `playing` 必须是**可 watch 的 ref**：
 * 停帧之后没有任何 rAF 能发现「用户又按了播放」，只能靠它的变化唤醒。
 *
 * ## 每帧不许新建对象（§16.2）
 *
 * `liveParams` / `staticLayerInput` / `liveFrame` 这些逐帧入参在闭包里**只建一次**，
 * 每次改动字段后复用。60fps 下每帧新建几个对象就是每秒几百个短命对象，
 * GC 抖动会直接表现为掉帧。
 */

import { onBeforeUnmount, watch, type Ref } from 'vue'

import type { FoliaBackgroundView, FoliaBackgroundWorld } from '../shared/folia-background-world'
import {
  FUME_BLOCK_OVERSCAN_PX,
  isFumeBlockOnScreen,
  resolveFumeBlockTiming,
  resolveFumeGlowBases,
  resolveFumeStaticLayers
} from './core/block-frame'
import {
  CAMERA_SCALE_MAX,
  CAMERA_SCALE_MIN,
  resolveFocusBlock,
  resolveFumeBackgroundView
} from './core/camera'
import {
  clampCameraFrameDeltaMs,
  createFumeCameraState,
  reanchorFumeCamera,
  stepFumeCamera,
  syncFumeCameraToArticle,
  type FumeCameraStepInput,
  type FumeCameraStepResult
} from './core/camera-step'
import type {
  FumeArticleLayout,
  FumeAudioLevels,
  FumeBackgroundScene,
  FumeBlock,
  FumeCameraTrackingMode,
  FumeCameraState,
  FumeStaticBlockSnapshot,
  FumeTheme,
  FumeViewportSize
} from './core/fume-types'
import { drawFumeBackground } from './render/background'
import { createStaticBlockSnapshot } from './render/canvas-text'
import { drawFumeLiveBlock, type FumeLiveBlockParams } from './render/canvas-text-live'
import { FumeLiveRaster, type FumeLiveRasterFrame } from './render/live-raster'
import { isGlowBlurQuantized } from '../shared/glow-blur-quantize'
import { resolveFumePassedFadeDurationMs } from './core/text-style'
import {
  acquireFumeSnapshot,
  createFumeSnapshotCache,
  releaseFumeSnapshots,
  type FumeSnapshotCache
} from './render/snapshot-cache'
import { createFumeRetiredSnapshotQueue } from './render/retired-snapshot-queue'
import { FUME_BLOCK_MEASURE } from './measure/fume-block-measure'
import { FUME_IDLE_TIME_DRIFT } from './fume-adapter'
import { clamp } from './core/fume-math'
import { resolveFumeThemeFingerprint } from './core/theme-fingerprint'

/** 舞台逻辑尺寸（CSS px）—— 排版与绘制共用同一个来源（`FumeStage` 的 resize 事件） */
export interface FumeStageSize {
  width: number
  height: number
}

export interface UseFumeStageOptions {
  context: Ref<CanvasRenderingContext2D | null>
  canvas: Ref<HTMLCanvasElement | null>
  size: Ref<FumeViewportSize>
  theme: Ref<FumeTheme>
  /** 排好的文章；null = 还没排出来（前奏 / 加载中） */
  article: Ref<FumeArticleLayout | null>
  backgroundScene: Ref<FumeBackgroundScene | null>
  /** 覆盖背景的固定文章世界；原生背景或透明模式时为 null。 */
  backgroundWorld?: Ref<FoliaBackgroundWorld | null>
  /** 同一帧同步覆盖背景视图；不能经过 Vue 响应式，否则会晚于文字一帧。 */
  onBackgroundView?: (view: FoliaBackgroundView) => void
  /** 总览镜头；`article === null` 时为 null */
  overviewCamera: Ref<{ x: number; y: number; scale: number } | null>
  /** 总览开始时刻（毫秒）；`+Infinity` = 永不 */
  overviewStartTimeMs: Ref<number>
  cameraSpeed: number
  /** 相机跟随模式（`'smooth'` = 按浮点打印进度连续滑动，见 §14.1） */
  cameraTrackingMode: FumeCameraTrackingMode
  glowIntensity: number
  showPrintStamp: boolean
  textHoldRatio: number
  backgroundOpacityMultiplier: number
  /** 逐帧读：播放时间（毫秒，已含歌词偏移） */
  currentTimeMs: () => number
  /** 逐帧读：频带（0–255 量纲） */
  audioLevels: () => FumeAudioLevels
  /** 逐帧读：当前高亮行下标（-1 = 尚未到首行） */
  currentLineIndex: () => number
  /** 第一个区块开始打印时回调一次（入场动画用） */
  onPrintedContent: () => void
  playing: Ref<boolean>
  /** 恒定为 false（本项目没有 OBS 静态档，见 `SkinFume.vue`） */
  staticMode: Ref<boolean>
}

export interface UseFumeStageResult {
  /** 相机状态（**普通对象**，见下）；需要调试时可读 */
  cameraState: FumeCameraState
}

export function useFumeStage(options: UseFumeStageOptions): UseFumeStageResult {
  /**
   * 相机状态：**普通对象、绝不放 `reactive`/`ref`**（§17.1 第 1 条 / §15.3）。
   * 它是每帧被原地积分的可变对象；放进响应式代理会让每次改 `x`/`velocityX`
   * 都触发依赖更新，帧率立刻掉下来。
   *
   * 它还有一个更重要的语义：必须**跨文章重排存活**。切歌会换掉 `article`，
   * 但镜头不该瞬移回纸张中心 —— 所以它建在 setup 作用域，只在组件卸载时丢弃。
   */
  const cameraState = createFumeCameraState()

  /**
   * 静态快照缓存：跨帧存活（§11.1）。
   *
   * ⚠️ 是 `let` 而不是 `const`：文章 / 主题变化时它会被**整张换掉**
   * （见 `retireSnapshotCache`），换下来的那张进分批释放队列。
   */
  let snapshotCache: FumeSnapshotCache = createFumeSnapshotCache()

  /**
   * 已退休、正在分批释放的快照缓存（性能修复，2026-10-14）。
   *
   * 为什么不在切歌那一帧一次清完：实测 300 张 512×256 全清要 14.1ms ——
   * 那一帧必定掉，而切歌本来就已经有排版要跑。改成每帧放一小批之后，
   * 同样的活被摊到十几帧里，每帧不到 1ms。
   *
   * 队列本体住在 `render/retired-snapshot-queue.ts`：那里的「搬运时重新编号」是
   * 一段有静默 bug 风险的逻辑（键会撞），单独成文件才钉得住。
   */
  const retiredSnapshots = createFumeRetiredSnapshotQueue()

  /**
   * 实时区块的量化栅格（§11.5）。**只有 Linux 降级档会真正用到它**
   * （`isGlowBlurQuantized()` 默认只在 Linux 上为 true），但实例常驻：
   * 平台在会话内不会变，判断放在每帧反而要多读一次模块级变量。
   *
   * 它跨帧存活的理由与快照缓存相同 —— 栅格 canvas 是「只增不减」的，
   * 每帧新建就等于每帧重新分配一块后备缓冲。
   */
  const liveRaster = new FumeLiveRaster()

  /** 上一帧时间戳（`performance.now()` 同源，毫秒）；null = 本段循环的第一帧 */
  let lastFrameAt: number | null = null
  /** 「第一个区块开始打印」是否已经回调过；`article` 变化时重置（§17.1 第 5 条） */
  let hasPrintedContent = false
  /** 「已经排过一版文章」——用来区分「暂停」与「还没开始」 */
  let lastArticle: FumeArticleLayout | null = null
  /**
   * 上一版文章对应的屏幕位置（世界坐标 → 屏幕中心的位移，屏幕 px）与视口短边。
   *
   * 窗口 resize 会触发整篇重排：同一句歌词在新文章里的世界坐标会变。相机跨文章存活，
   * 必须按「焦点旧位置 → 新位置」重锚，否则歌词与背景会一起跳到别处（暂停时更明显，
   * 因为停帧后错位的那一帧会永久留在画面上）。这里记住重排前的焦点在屏幕上的偏移，
   * 重排后原样保留 —— 用户拖动窗口时，正在看的那句应当停在原地。
   */
  let lastFocus: { x: number; y: number } | null = null
  /**
   * 上一帧焦点在**文章世界里的位置比例**（0–1）与当时的屏幕偏移（px）。
   *
   * 为什么不能只存绝对坐标：暂停时绘制循环停帧，`lastFocus` 会停在旧文章里；
   * 重排后同一句歌词在文章中的**相对位置**基本不变（列 / 行重排只是把纸张变宽变窄），
   * 比例比绝对坐标更可靠。绝对坐标仍保留给「同尺寸重排」这种比例不变的场景。
   */
  let lastFocusRatio: { x: number; y: number } | null = null
  /** 上一帧焦点相对屏幕中心的偏移（屏幕 px，含缩放） */
  let lastFocusScreenOffset: { x: number; y: number } | null = null
  let lastViewportSide = 0
  /**
   * 上一帧的主题指纹（§11.1 的失效清单）。
   *
   * 快照与栅格里**烤了颜色与字体**，而这两样都能在播放中途变（切明暗主题、
   * 换专辑主色、内置字体从兜底字形换成真字形）。不比对指纹的话，已经画成
   * 上一套配色的那些块会一直用旧图 —— 表现是「切主题后只有正在唱的那块变色」。
   *
   * 指纹只取参与绘制的字段：`name`（参与背景种子与布局键）、三色、字体三件套。
   * 与 §11.1 的清单逐项对应，**不要**图省事把整个 theme 塞进来 ——
   * `animationIntensity` / `wordColors` 不进快照，它们变了没必要重建。
   */
  let lastThemeFingerprint: string | null = null

  // ── 每帧复用的入参对象（§16.2：不在 draw 里新建对象） ──────────────────────
  const liveParams: FumeLiveBlockParams = {
    timeMs: 0,
    theme: options.theme.value,
    glowIntensity: options.glowIntensity,
    activeGlowBoost: 0,
    passedGlowBase: 0,
    showPrintStamp: options.showPrintStamp
  }
  const staticLayerInput = {
    timeMs: 0,
    theme: options.theme.value,
    passedGlowBase: 0,
    passedFadeDurationMs: Number.POSITIVE_INFINITY,
    overviewTextRestoreProgress: 0,
    snapshotScale: 1
  }
  /** 实时绘制的可见区间（世界坐标），供裁剪用 */
  const visibleRect = { left: 0, top: 0, right: 0, bottom: 0 }
  /**
   * 实时栅格的每帧入参（§16.2：复用同一个对象）。
   *
   * `visible` 直接引用上面那个 `visibleRect` —— 两者语义完全相同（都是本帧可见的
   * 世界矩形），复制一份字段只会多出「改了一处忘改另一处」的机会。
   */
  const liveFrame: FumeLiveRasterFrame = { deviceScale: 1, visible: visibleRect }
  const cameraStepInput: Partial<FumeCameraStepInput> = {}
  /**
   * 每帧复用的视口对象（§16.2）。
   *
   * `resolveFumeBackgroundView` 与 `isFumeBlockOnScreen` 都只要 `{width, height}`，
   * 若在调用点写 `{ width, height }` 字面量就是**每帧两个新对象** —— 60fps 下每秒 120 个，
   * 纯粹喂给 GC。它们只读、不持有引用，所以复用一个可变对象是安全的。
   */
  const viewportRef = { width: 0, height: 0 }
  /** 复用同一对象，避免 60fps 下每帧分配一个背景视图。 */
  const backgroundView: FoliaBackgroundView = {
    viewportWidth: 0,
    viewportHeight: 0,
    cameraX: 0,
    cameraY: 0,
    scale: 1
  }
  /**
   * 唱过文字的渐隐总时长（§6.3）。
   *
   * ⚠️ **不在每帧算**：它只依赖「全篇时间线 + `textHoldRatio`」，两者都只在换文章时变，
   * 而算它要遍历全部区块（`resolveFumePassedFadeDurationMs` 内部还会 `.map().sort()`）。
   * 放在每帧就是每秒几十次几百条行的排序 —— 上游把它放在 effect 里算一次，
   * 这里同样只在文章变化时重算（见 `draw` 里的 `article !== lastArticle` 分支）。
   */
  let passedFadeDurationMs = Number.POSITIVE_INFINITY

  let rafId: number | null = null
  let disposed = false

  /**
   * 把当前快照缓存**整张退休**：换一张新的给后续帧用，旧的排队分批释放。
   *
   * 为什么是「换一张」而不是「原地标记」：文章 / 主题一变，旧缓存里的每一张都作废，
   * 后续帧必须立刻看不到它们（否则会贴出上一套配色的字）。换引用是一步到位的，
   * 不需要给每条记录加一个「作废」标志，也就不会出现「漏标一条」这种 bug。
   */
  function retireSnapshotCache(): void {
    if (snapshotCache.size === 0) return
    retiredSnapshots.retire(snapshotCache)
    snapshotCache = createFumeSnapshotCache()
  }

  /** 立刻释放全部快照（**只在卸载时用**：那时没有「下一帧」可以摊） */
  function releaseAllSnapshotsNow(): void {
    releaseFumeSnapshots(snapshotCache, Number.POSITIVE_INFINITY)
    retiredSnapshots.releaseAll()
  }

  /** 暂停 + 已经有文章 → 画完这一帧就停（§16.4）；空态时仍要转背景 */
  function shouldKeepFrames(): boolean {
    if (!lastArticle && !options.article.value) return true
    return options.playing.value
  }

  /** 当前帧的焦点世界坐标（与相机步进同源：行下标 + 播放时间） */
  function resolveCurrentFocus(article: FumeArticleLayout): { x: number; y: number } | null {
    const block = resolveFocusBlock(article, options.currentLineIndex(), options.currentTimeMs())
    if (!block) return null
    return { x: block.x + block.width * 0.5, y: block.y + block.height * 0.5 }
  }

  /**
   * 视口变化导致重排后，把相机重新锚到「同一句歌词 + 原来的屏幕偏移」。
   *
   * 两次焦点读的都是**当帧时间**：重排只改世界坐标，当前句没变，所以新旧焦点
   * 指向的是同一句歌词的两个位置，差值就是重排带来的位移。
   *
   * 视口比例按短边算 —— 与 `resolveCameraScaleForBlock` 的目标字号同源
   * （短边的 11.5%）：不折算的话，拖动窗口会让画面在重排瞬间突然放大/缩小。
   */
  function reanchorToCurrentFocus(article: FumeArticleLayout, width: number, height: number): void {
    const viewportSide = Math.max(Math.min(width, height), 1)
    const scaleRatio = lastViewportSide > 0 ? viewportSide / lastViewportSide : 1
    const nextScale = clamp(
      cameraState.camera.scale * clamp(scaleRatio, 0.25, 4),
      CAMERA_SCALE_MIN,
      CAMERA_SCALE_MAX
    )

    // 新文章里同一句的位置：能按行下标拿到就用它；拿不到时按比例映射。
    const nextFocus =
      resolveCurrentFocus(article) ??
      (lastFocusRatio
        ? { x: lastFocusRatio.x * article.width, y: lastFocusRatio.y * article.height }
        : null)

    // 首帧还没有任何焦点记录（挂载后第一次重排）：退回整页中心，
    // 至少不会停在新文章边界之外。
    if (!nextFocus) {
      reanchorFumeCamera(
        cameraState,
        { x: article.width * 0.5, y: article.height * 0.5 },
        scaleRatio
      )
      return
    }

    // 重排前焦点相对屏幕中心的偏移（px）；新相机让同一句留在同一位置。
    const offsetX =
      lastFocusScreenOffset?.x ??
      (lastFocus ? (lastFocus.x - cameraState.camera.x) * cameraState.camera.scale : 0)
    const offsetY =
      lastFocusScreenOffset?.y ??
      (lastFocus ? (lastFocus.y - cameraState.camera.y) * cameraState.camera.scale : 0)
    reanchorFumeCamera(
      cameraState,
      { x: nextFocus.x - offsetX / nextScale, y: nextFocus.y - offsetY / nextScale },
      scaleRatio
    )
  }

  /**
   * 记录本帧焦点（世界坐标 / 文章比例 / 屏幕偏移）。
   *
   * **每一帧都要调**（包括暂停后的第一帧）：暂停时绘制循环停帧，但「焦点在屏幕上的
   * 位置」必须与当时画出来的那一帧一致，否则下一次重排的屏幕偏移会取到上一帧的值。
   */
  function rememberFocus(article: FumeArticleLayout, width: number, height: number): void {
    const block = resolveCurrentFocus(article)
    if (!block) return
    lastFocus = block
    lastFocusRatio = {
      x: article.width > 0 ? block.x / article.width : 0.5,
      y: article.height > 0 ? block.y / article.height : 0.5
    }
    lastFocusScreenOffset = {
      x: (block.x - cameraState.camera.x) * cameraState.camera.scale,
      y: (block.y - cameraState.camera.y) * cameraState.camera.scale
    }
    lastViewportSide = Math.max(Math.min(width, height), 1)
  }

  /**
   * 取一张快照：命中缓存直接返回，未命中现做一张。
   *
   * ⚠️ 这里刻意**不复用 `acquireFumeSnapshot` 的返回结构**，而是复用「待建快照的入参」：
   * 传入的回调必须是**外层建一次的同一个函数**，否则每次调用都会新建一个闭包。
   * 一个在屏区块每帧问一次快照，闭包按次分配就是每秒上千个短命函数（§16.2）。
   *
   * 具体做法：把「这次要建什么」暂存到下面两个外层变量，回调从它们读。
   * 变量名叫 `pending*` 是因为它们的语义就是「这一次 pending 的创建请求」。
   */
  function getSnapshot(
    spec: { key: string; fill: string; shadowBlur: number; shadowColor: string },
    block: FumeBlock,
    now: number
  ): FumeStaticBlockSnapshot | undefined {
    pendingSnapshotBlock = block
    pendingSnapshotSpec = spec
    return acquireFumeSnapshot(snapshotCache, spec.key, now, createPendingSnapshot)
  }

  /**
   * 建「这一次 pending 的快照」。它是外层建一次的**普通函数**，不是按次闭包，
   * 状态从 `pendingSnapshot*` 读 —— 这也是 `acquireFumeSnapshot` 只在未命中时
   * 才调它的前提（命中时这个函数根本不会被执行）。
   */
  function createPendingSnapshot(): FumeStaticBlockSnapshot | null {
    const block = pendingSnapshotBlock
    const spec = pendingSnapshotSpec
    if (!block || !spec) return null
    return createStaticBlockSnapshot({
      block,
      theme: options.theme.value,
      fillStyle: spec.fill,
      shadowBlur: spec.shadowBlur,
      shadowColor: spec.shadowColor,
      rasterScale: staticLayerInput.snapshotScale
    })
  }

  /** 这一次 pending 的快照入参（见 `getSnapshot` 的说明） */
  let pendingSnapshotBlock: FumeBlock | null = null
  let pendingSnapshotSpec: {
    key: string
    fill: string
    shadowBlur: number
    shadowColor: string
  } | null = null
  /** `resolveFumeStaticLayers` 的回调入参（见调用点的说明） */
  let pendingGetSnapshotBlock: FumeBlock | null = null
  let pendingGetSnapshotNow = 0

  /** `resolveFumeStaticLayers` 的稳定回调：只把「当前块 + 当前帧号」转交给 `getSnapshot` */
  function resolvePendingSnapshot(spec: {
    key: string
    fill: string
    shadowBlur: number
    shadowColor: string
  }): FumeStaticBlockSnapshot | undefined {
    const block = pendingGetSnapshotBlock
    if (!block) return undefined
    return getSnapshot(spec, block, pendingGetSnapshotNow)
  }

  /** 每帧入口 */
  function draw(now: number): void {
    if (disposed) return
    rafId = null

    const context = options.context.value
    const canvas = options.canvas.value
    const size = options.size.value
    if (!context || !canvas || size.width <= 0 || size.height <= 0 || options.staticMode.value) {
      if (shouldKeepFrames()) rafId = requestAnimationFrame(draw)
      return
    }

    // ── ① 尺寸 / DPR 复查（§11.3 ①） ──────────────────────────────────────
    // 跨屏拖动会让 devicePixelRatio 在没有 resize 事件的情况下变化。
    // ⚠️ 改 canvas.width 会清空画布并**重置变换**，所以必须在 setTransform 之前。
    const dpr = Math.max(1, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
    const width = Math.max(Math.floor(size.width), 1)
    const height = Math.max(Math.floor(size.height), 1)
    const pixelWidth = Math.floor(width * dpr)
    const pixelHeight = Math.floor(height * dpr)
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, width, height)

    const timeMs = options.currentTimeMs()
    const viewportCenterX = width * 0.5
    const viewportCenterY = height * 0.5
    const theme = options.theme.value
    const backgroundScene = options.backgroundScene.value
    const backgroundWorld = options.backgroundWorld?.value ?? null

    /**
     * 主题失效（§11.1）：三色 / 字体任一变化都要把两套缓存丢掉。
     *
     * 放在「无文章」分支**之前**：前奏期间换主题同样要清，否则第一句歌词
     * 一开口就贴出上一套配色的快照（那正是用户最先看到的一帧）。
     * 比对的是字符串指纹而不是对象引用 —— `theme` 是 `computed` 出来的新对象，
     * 按引用比会**每帧都判不等**，等于每帧重建全部快照。
     */
    const themeFingerprint = resolveFumeThemeFingerprint(theme)
    if (themeFingerprint !== lastThemeFingerprint) {
      lastThemeFingerprint = themeFingerprint
      retireSnapshotCache()
      liveRaster.clear()
    }

    // ── ② 无文章：只画背景 ────────────────────────────────────────────────
    const article = options.article.value
    if (!article) {
      if (backgroundWorld) {
        backgroundView.viewportWidth = width
        backgroundView.viewportHeight = height
        backgroundView.cameraX = backgroundWorld.width * 0.5
        backgroundView.cameraY = backgroundWorld.height * 0.5
        backgroundView.scale = 1
        options.onBackgroundView?.(backgroundView)
      }
      if (backgroundScene) {
        context.save()
        context.translate(viewportCenterX, viewportCenterY)
        context.translate(-backgroundScene.width * 0.5, -backgroundScene.height * 0.5)
        drawFumeBackground({
          context,
          scene: backgroundScene,
          theme,
          // 播放时间 + 墙钟漂移（§12.7）：纯跟播放进度会让前奏期间完全静止
          time: timeMs / 1000 + (now * FUME_IDLE_TIME_DRIFT) / 1000,
          audioLevels: options.audioLevels(),
          objectOpacityMultiplier: options.backgroundOpacityMultiplier
        })
        context.restore()
      }
      if (shouldKeepFrames()) rafId = requestAnimationFrame(draw)
      return
    }

    // 文章换了：重置首帧标志与帧计时（相机**不**重置，见文件头）
    if (article !== lastArticle) {
      // 换文章的两条来源必须分开：切歌是「另一篇」，镜头保留惯性继续滑（原语义）；
      // 视口重排是「同一篇的几何变了」，必须按当前焦点重锚，否则画面整体跳走。
      // 判据是「上一版文章的首块起始时间与新版一致」—— 同一首歌重排时首行不变，
      // 切歌时几乎必然不同（`firstRenderableStartTimeMs` 在适配层已归一）。
      const sameSong =
        lastArticle !== null &&
        lastArticle.firstRenderableStartTimeMs === article.firstRenderableStartTimeMs
      const isResizeRebuild = sameSong && lastFocus !== null
      lastArticle = article
      hasPrintedContent = false
      lastFrameAt = null
      syncFumeCameraToArticle(cameraState, article)
      if (isResizeRebuild) reanchorToCurrentFocus(article, width, height)
      // 快照里烤了颜色 / 字体 / 尺寸，文章一换必须全换（§11.1）。
      // 走「整张退休 + 分批释放」而不是一次清完，见 `retireSnapshotCache`。
      retireSnapshotCache()
      // 栅格同理：它烤的是同一批颜色与字体（§11.5 的 clear 走同一条路径）。
      // ⚠️ 栅格**仍然同步清**：它与快照的存活语义不同 —— 栅格是「正在打印的块」，
      // 数量与在屏块数同阶（实测 ≤ 30 张，不是快照那种几百张），同步清的开销
      // 远小于一次 `clearRect`，而推迟释放会让旧字在新文章的头几帧里被贴出来。
      liveRaster.clear()
      // 渐隐总时长只跟「全篇时间线 + textHoldRatio」有关，两者随文章一起换（§6.3）
      passedFadeDurationMs = resolveFumePassedFadeDurationMs(
        article.chronologicalBlocks.map((block) => block.line),
        options.textHoldRatio
      )
    }

    // ── ③ 首次打印回调（一次性） ──────────────────────────────────────────
    if (!hasPrintedContent && timeMs >= article.firstRenderableStartTimeMs) {
      hasPrintedContent = true
      options.onPrintedContent()
    }

    const dtMs = clampCameraFrameDeltaMs(lastFrameAt === null ? 1000 / 60 : now - lastFrameAt)
    lastFrameAt = now

    // ── ④ 相机步进（§9.7） ────────────────────────────────────────────────
    cameraStepInput.article = article
    cameraStepInput.timeMs = timeMs
    cameraStepInput.nowMs = now
    cameraStepInput.dtMs = dtMs
    cameraStepInput.lineIndex = options.currentLineIndex()
    viewportRef.width = width
    viewportRef.height = height
    cameraStepInput.viewport = viewportRef
    cameraStepInput.overviewCamera = options.overviewCamera.value
    cameraStepInput.overviewStartTimeMs = options.overviewStartTimeMs.value
    cameraStepInput.cameraSpeed = options.cameraSpeed
    cameraStepInput.cameraTrackingMode = options.cameraTrackingMode
    cameraStepInput.staticMode = options.staticMode.value
    cameraStepInput.animationIntensity = theme.animationIntensity
    cameraStepInput.measure = FUME_BLOCK_MEASURE
    const stepResult: FumeCameraStepResult = stepFumeCamera(
      cameraState,
      cameraStepInput as FumeCameraStepInput
    )
    const camera = cameraState.camera
    const screenScale = camera.scale

    // ── ④.5 记录本帧焦点（供下一次重排重锚） ──────────────────────────────
    // 必须放在步进**之后**：记录的是这一帧实际画出去的位置。放在步进之前会记到
    // 上一帧的相机上，暂停时（停帧）那次残差值会一直留到下一次 resize。
    rememberFocus(article, width, height)

    // ── ⑤ 背景层（§9.8 的视差视图） ───────────────────────────────────────
    if (backgroundWorld) {
      const view = resolveFumeBackgroundView(backgroundWorld, camera, viewportRef)
      backgroundView.viewportWidth = width
      backgroundView.viewportHeight = height
      backgroundView.cameraX = view.backgroundCameraX
      backgroundView.cameraY = view.backgroundCameraY
      backgroundView.scale = view.backgroundScale
      options.onBackgroundView?.(backgroundView)
    }
    if (backgroundScene) {
      const view = resolveFumeBackgroundView(backgroundScene, camera, viewportRef)
      context.save()
      context.translate(viewportCenterX, viewportCenterY)
      context.scale(view.backgroundScale, view.backgroundScale)
      context.translate(-view.backgroundCameraX, -view.backgroundCameraY)
      drawFumeBackground({
        context,
        scene: backgroundScene,
        theme,
        time: timeMs / 1000,
        audioLevels: options.audioLevels(),
        objectOpacityMultiplier: options.backgroundOpacityMultiplier,
        parallax: {
          cameraX: view.backgroundCameraX,
          cameraY: view.backgroundCameraY,
          originX: view.backgroundCenterX,
          originY: view.backgroundCenterY,
          strength: FUME_BACKGROUND_PARALLAX_STRENGTH
        }
      })
      context.restore()
    }

    // ── ⑥ 文字层 ──────────────────────────────────────────────────────────
    const { activeGlowBoost, passedGlowBase } = resolveFumeGlowBases(
      theme.animationIntensity,
      options.glowIntensity
    )
    liveParams.timeMs = timeMs
    liveParams.theme = theme
    liveParams.activeGlowBoost = activeGlowBoost
    liveParams.passedGlowBase = passedGlowBase
    staticLayerInput.timeMs = timeMs
    staticLayerInput.theme = theme
    staticLayerInput.passedGlowBase = passedGlowBase
    staticLayerInput.passedFadeDurationMs = passedFadeDurationMs
    staticLayerInput.overviewTextRestoreProgress = stepResult.overviewTextRestoreProgress
    staticLayerInput.snapshotScale = resolveSnapshotScale(dpr)

    // 可见区间（世界坐标）：让「即将进屏」的字提前画好，边缘不出现空帧
    const margin = FUME_BLOCK_OVERSCAN_PX / Math.max(screenScale, 0.001)
    visibleRect.left = camera.x - viewportCenterX / screenScale - margin
    visibleRect.top = camera.y - viewportCenterY / screenScale - margin
    visibleRect.right = camera.x + viewportCenterX / screenScale + margin
    visibleRect.bottom = camera.y + viewportCenterY / screenScale + margin
    liveFrame.deviceScale = screenScale * dpr
    /**
     * 实时块是否走量化栅格（§11.4）。
     *
     * 普通档直接在舞台的世界变换下画：相机连续缩放 → Chromium 每帧为新尺寸铸一份
     * 字形 strike，观感最好但 Linux 上会在约半小时后耗尽 renderer 的字形缓存。
     * 降级档改画进一块固定倍率的离屏 canvas 再缩放贴回，字形尺寸集合因此有界，
     * 代价是相机缩放时最多损失 1.45% 锐度（`resolveLiveRasterScale` 的上取整）。
     */
    const rasterLive = isGlowBlurQuantized()

    context.save()
    context.translate(viewportCenterX, viewportCenterY)
    context.scale(screenScale, screenScale)
    context.translate(-camera.x, -camera.y)

    for (const block of article.blocks) {
      if (!isFumeBlockOnScreen(block, camera, viewportRef)) continue

      const timing = resolveFumeBlockTiming(
        block,
        timeMs,
        article.chronologicalBlocks[block.sourceLineIndex + 1]?.line.startTimeMs ?? null,
        options.textHoldRatio
      )

      // ⚠️ 传的必须是**外层建一次的普通函数**，不能写 `(spec) => getSnapshot(spec, block, now)`：
      // 那个箭头函数会被每个在屏区块每帧新建一个（§16.2）。当前块与当前帧号改从
      // `pendingGetSnapshot*` 读 —— 与 `getSnapshot` 内部那对变量同一套做法。
      pendingGetSnapshotBlock = block
      pendingGetSnapshotNow = now
      const layers = resolveFumeStaticLayers(
        block,
        timing,
        staticLayerInput,
        resolvePendingSnapshot
      )

      if (layers && layers.length > 0) {
        for (const layer of layers) {
          context.globalAlpha = layer.alpha
          context.drawImage(
            layer.snapshot.canvas,
            block.x - layer.snapshot.padding,
            block.y - layer.snapshot.padding,
            block.width + layer.snapshot.padding * 2,
            block.height + layer.snapshot.padding * 2
          )
        }
        context.globalAlpha = 1
        continue
      }

      // 正在打印的块：实时逐字素绘制（§10.4，含 §10.5 的打印印章）。
      //
      // `layers === null` 有两条来源，两条都该走实时绘制：
      //  1. §8.3 的 `staticState === null`（正在打印的那一块，主路径）；
      //  2. 快照创建失败（离屏 canvas 拿不到）—— 上游同样在这里回落到实时绘制，
      //     宁可多花点算力，也不要让那块字凭空消失。
      if (!rasterLive) {
        // 调用时 context 的变换已经是「世界坐标 → 设备像素」（本函数上方刚设好），
        // 所以这里传的是世界坐标，不要再自己 translate 到视口。
        drawFumeLiveBlock(context, block, timing, liveParams)
        continue
      }

      // 降级档：先画进离屏栅格，再按世界矩形贴回。
      // ⚠️ `image` 是**复用对象**（见 live-raster 的说明），必须当场用完；
      // 返回 null（区块被裁没了 / 拿不到离屏 context）时这一帧就不贴，不抛错。
      const image = liveRaster.draw(block, timing, liveParams, liveFrame, now)
      if (image) {
        context.drawImage(
          image.canvas,
          0,
          0,
          image.width,
          image.height,
          image.x,
          image.y,
          image.worldWidth,
          image.worldHeight
        )
      }
    }

    context.restore()

    // ── ⑦ 清缓存 + 续帧 ──────────────────────────────────────────────────
    // 两个 Map 遍历都是小常数，比挂定时器更可靠（§16.4）
    liveRaster.sweep(now)
    retiredSnapshots.releaseBatch()
    releaseFumeSnapshots(snapshotCache, now)
    if (shouldKeepFrames()) rafId = requestAnimationFrame(draw)
  }

  /**
   * 排一帧（已在队列里就不重复排）。
   *
   * `options.article` 在下面的 watch 列表里：暂停时绘制循环停帧，重排提交后这个
   * watcher 会唤醒恰好一帧，让 `draw` 走一遍 `article !== lastArticle` 分支完成重锚，
   * 之后照常停帧。
   */
  function schedule(): void {
    if (disposed || rafId !== null) return
    rafId = requestAnimationFrame(draw)
  }

  // 唤醒入口：停帧期间没有 rAF 能发现这些变化
  watch(
    [
      options.canvas,
      options.context,
      options.size,
      options.staticMode,
      options.playing,
      options.article,
      options.theme,
      options.backgroundScene,
      options.backgroundWorld,
      options.overviewCamera,
      options.overviewStartTimeMs
    ],
    schedule
  )

  schedule()

  onBeforeUnmount(() => {
    disposed = true
    if (rafId !== null) cancelAnimationFrame(rafId)
    rafId = null
    // 卸载时把快照画布全部释放（§11.1）：只 delete 不够，要先把尺寸归零。
    // ⚠️ 这里**不能**走分批：组件卸载之后不会再有下一帧，排队就等于永久泄漏。
    releaseAllSnapshotsNow()
    liveRaster.clear()
  })

  return { cameraState }
}

/** 背景视差的强度系数（§9.8 / §11.3 ⑤ 的 `strength: 0.72`） */
export const FUME_BACKGROUND_PARALLAX_STRENGTH = 0.72

/** 快照的栅格倍率：`clamp(dpr, 1, 2)`（§10.2 / §11.3） */
function resolveSnapshotScale(dpr: number): number {
  return Math.max(1, Math.min(2, dpr))
}
