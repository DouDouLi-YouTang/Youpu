/**
 * 「浮名」背景的**每帧接线**（F3 阶段：只画背景，还没有文字）。
 *
 * 分工：`render/background.ts` 是纯几何 + 一次绘制；本文件负责
 * 「算视差 → 每帧调用一次 → 卸载时收尾」。
 *
 * ## 为什么自己跑一条 rAF
 *
 * 浮名的绘制是**一整帧的连续工作**：背景 → 相机 → 文字块 → 印章，共用同一套
 * context 变换。挂在共享时钟的 `onFrame` 上会让执行顺序取决于订阅顺序（不可见），
 * 而那条 rAF 的语义是「时间源」，不该承担绘制。所以这里自己起一条；
 * F4/F6 的 `use-fume-stage.ts` 落地后，本层会成为它内部的第一步。
 *
 * ## 视差不是「整层平移」
 *
 * 每个形状按自己的 `depth` 用**不同比例**跟随相机（见 `render/background.ts`），
 * 所以这里只把相机中心与原点交给绘制层，逐形状的系数在那边算。
 *
 * ## 场景重建与视口绑定，与播放时间无关
 *
 * 场景里 20 个形状每个都要跑十几次 `seeded()`（FNV 哈希）。每帧重建等于每帧
 * 做几百次字符串哈希 —— 这是上游专门做调度缓存（§7.9）的原因，也是本文件的红线。
 */

import { onBeforeUnmount, shallowRef, watch, type Ref } from 'vue'

import { buildFumeBackgroundScene, drawFumeBackground } from './render/background'
import { FUME_IDLE_TIME_DRIFT } from './fume-adapter'
import type { FumeAudioLevels, FumeBackgroundScene, FumeTheme } from './core/fume-types'

/** 逻辑尺寸（CSS px） */
export interface FumeStageSize {
  width: number
  height: number
}

/** 世界矩形（文章排版后的画布范围） */
export interface FumeWorldRect {
  width: number
  height: number
}

/** 纸张范围（文章的文字区域） */
export interface FumePaperBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface UseFumeBackgroundOptions {
  /** 舞台 canvas 的 2D 上下文；未就绪时为 null（挂载前） */
  context: Ref<CanvasRenderingContext2D | null>
  /** canvas 元素（位图尺寸由本层按 DPR 设置，见 §11.3 ①） */
  canvas: Ref<HTMLCanvasElement | null>
  /** 舞台逻辑尺寸；0 尺寸时不出帧 */
  size: Ref<FumeStageSize>
  theme: Ref<FumeTheme>
  /** 文章世界尺寸；null = 还没有文章（走视口 ×1.8 兜底，见 §7.10） */
  world: Ref<FumeWorldRect | null>
  /** 纸张范围（有文章时才有） */
  paperBounds: Ref<FumePaperBounds | null>
  /** 背景种子（含主题名，见 `fume-adapter`） */
  seed: Ref<string>
  /** 相机位置（世界坐标） */
  cameraX: Ref<number>
  cameraY: Ref<number>
  /** 相机视差原点（通常是文章中心） */
  originX: Ref<number>
  originY: Ref<number>
  /** 播放时间（毫秒），每帧读一次 */
  currentTimeMs: () => number
  /**
   * 是否正在播放。
   *
   * ⚠️ 必须是**可 watch 的 ref**（不是 getter）：暂停时本层会停止排帧（§16.4），
   * 此时没有任何 rAF 能发现"用户又按了播放"。靠这个 ref 的变化重新唤醒。
   */
  playing: Ref<boolean>
  /** 频带能量（0–255 量纲），每帧读一次 */
  audioLevels: () => FumeAudioLevels
  /** 背景形状不透明度倍率（`FUME_BACKGROUND_OPACITY_MULTIPLIER`） */
  opacityMultiplier: number
  /** `true` = 不画（演示模式 / 静态档） */
  staticMode: Ref<boolean>
}

export function useFumeBackground(options: UseFumeBackgroundOptions): {
  scene: Ref<FumeBackgroundScene | null>
} {
  const scene = shallowRef<FumeBackgroundScene | null>(null)

  watch(
    [options.size, options.world, options.paperBounds, options.seed],
    () => {
      const size = options.size.value
      if (size.width <= 0 || size.height <= 0) {
        scene.value = null
        return
      }
      const world = options.world.value ?? {
        width: Math.max(size.width * 1.8, size.width),
        height: Math.max(size.height * 1.8, size.height)
      }
      scene.value = buildFumeBackgroundScene({
        viewport: size,
        world,
        paperBounds: options.paperBounds.value ?? undefined,
        seed: options.seed.value
      })
    },
    { immediate: true }
  )

  let rafId: number | null = null
  let disposed = false

  /** 本帧该不该继续排下一帧（§11.3 ⑦ / §16.4 的停帧语义，见函数尾） */
  function shouldKeepFrames(): boolean {
    // 没有文章（前奏 / 加载）时仍然排帧：背景要转，这是唯一的"空转"场景
    if (!options.world.value) return true
    return options.playing.value
  }

  function tick(stamp: number): void {
    if (disposed) return
    rafId = null

    const context = options.context.value
    const canvas = options.canvas.value
    const current = scene.value
    const size = options.size.value

    if (
      context &&
      canvas &&
      current &&
      size.width > 0 &&
      size.height > 0 &&
      !options.staticMode.value
    ) {
      // ① 尺寸 / DPR 复查（§11.3 ①）：跨屏拖动会让 devicePixelRatio 在**没有
      // resize 事件**的情况下变化，只在挂载时设一次就会画糊。改 canvas.width
      // 会清空画布并重置变换，所以这一步**必须在 setTransform 之前**。
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const pixelWidth = Math.max(1, Math.floor(size.width * dpr))
      const pixelHeight = Math.max(1, Math.floor(size.height * dpr))
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, size.width, size.height)

      // 时间轴（§12.7）：有文章严格跟播放进度；没有则叠一层墙钟漂移，
      // 否则前奏期间形状完全静止。`stamp` 是 rAF 时间戳（毫秒）
      const world = options.world.value
      const timeSeconds =
        options.currentTimeMs() / 1000 + (world ? 0 : stamp * FUME_IDLE_TIME_DRIFT)

      context.save()
      if (world) {
        // 有文章：平移让「相机看到的世界点」落在舞台中心
        context.translate(
          size.width / 2 - options.cameraX.value,
          size.height / 2 - options.cameraY.value
        )
      } else {
        // 无文章：世界中心对到视口中心，否则形状都挤在左上角
        context.translate(size.width / 2 - current.width / 2, size.height / 2 - current.height / 2)
      }
      drawFumeBackground({
        context,
        scene: current,
        theme: options.theme.value,
        time: timeSeconds,
        audioLevels: options.audioLevels(),
        parallax: {
          cameraX: options.cameraX.value,
          cameraY: options.cameraY.value,
          originX: options.originX.value,
          originY: options.originY.value
        },
        objectOpacityMultiplier: options.opacityMultiplier
      })
      context.restore()
    }

    // ② 续帧（§11.3 ⑦ / §16.4）：暂停 + 有文章时**不排下一帧** —— CPU 真降到 0，
    // 而不是"排了但什么都不做"。恢复播放 / 尺寸变化 / 主题变化会重新排帧。
    if (shouldKeepFrames()) {
      rafId = requestAnimationFrame(tick)
    }
  }

  /** 排一帧（已在队列里就不重复排）。外部条件变化时也用它重新唤醒。 */
  function schedule(): void {
    if (disposed || rafId !== null) return
    rafId = requestAnimationFrame(tick)
  }

  // 重新唤醒的入口：这些都改变画面，但停帧期间没有 rAF 能发现它们
  watch(
    [
      options.canvas,
      options.context,
      options.size,
      options.staticMode,
      options.theme,
      options.playing,
      scene
    ],
    schedule
  )

  schedule()

  onBeforeUnmount(() => {
    disposed = true
    if (rafId !== null) cancelAnimationFrame(rafId)
    rafId = null
  })

  return { scene }
}
