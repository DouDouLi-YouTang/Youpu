/**
 * 「浮名」实时区块的**量化栅格**（移植规格书 §11.4 / §11.5）。
 *
 * ## 它解决的真实故障
 *
 * 正在打印的区块直接画在舞台的世界变换下时，它的文字会随相机浮动 / 缩放而**连续**
 * 变化设备倍率。Chromium 按「字形 + 设备尺寸」缓存字形 strike，倍率每帧都变 →
 * 每帧铸一个新 strike，每个 strike 占一块 4KiB 共享内存且**永不归还**；
 * Linux 上 renderer 的软限制（1024）约 35 分钟后耗尽，合成器直接停止出帧
 * （原项目 `docs/linux-glyph-cache-fd-leak.md`）。
 *
 * 解法是**把倍率离散化**：区块先画进自己的 canvas，倍率取「不小于当前设备倍率的最小
 * 档位」（每倍频 {@link LIVE_RASTER_LEVELS_PER_OCTAVE} 档），再整张贴回舞台。
 * 于是字形尺寸的集合有界，而相机本身仍然是连续的 —— 代价是贴回时最多缩小
 * `2^(1/48) - 1 ≈ 1.45%`，肉眼不可见。
 *
 * ## 为什么用 class 而不是一堆纯函数
 *
 * 本模块的全部价值在于**跨帧持有**一批 canvas（每个区块一张）。上游就是一个类；
 * 本项目 `render/` 下其它模块是纯函数 + 注入，但那些模块没有自己的可变状态。
 * 这里若拆成「Map + 自由函数」，调用方就得自己拿着那张 Map 到处传，反而更容易漏调
 * `sweep`。所以保留类，但**不引入任何全局状态**：实例由 stage 的 effect 持有。
 *
 * ## 与上游的差异（有意）
 *
 * 1. **拿不到 2d context 时不抛错**，而是返回 `null`。上游在这里 `throw`，而本函数
 *    跑在 `requestAnimationFrame` 回调里 —— 抛出去等于整个渲染循环死掉、画面冻住。
 *    本项目在快照层（§11.1）已经定了同一条策略：离屏画布失败就回落到直接绘制，
 *    宁可多花一点算力，也不要让整页停摆。调用方按 `null` 处理即可（这一帧不贴图）。
 * 2. **返回对象复用**（见 `image` 字段）：上游每次 `draw` 都新建一个字面量，
 *    而本函数每帧每个在屏区块都调一次 —— §16.2 明确要求不要在帧循环里分配。
 *
 * ## 单位
 *
 * 全部是**设备像素 / 世界 px**，不涉及时间（`nowMs` 只用于空闲回收）。
 */

import { drawFumeLiveBlock, type FumeLiveBlockParams } from './canvas-text-live'
import type { FumeBlockTiming } from '../core/block-frame'
import type { FumeBlock } from '../core/fume-types'

/** 超过这段时间没被用到的栅格 canvas 会被释放（§11.5）；重画的成本远低于一直占显存 */
export const LIVE_IDLE_MS = 5000

/** 画布容量按这个粒度的整数倍增长：相机缩放时不会每帧重新分配后备缓冲 */
export const LIVE_CANVAS_GRANULE = 256

/** 每倍频的栅格档数：48 档意味着相邻档位之间最多差 `2^(1/48) - 1 ≈ 1.45%` */
export const LIVE_RASTER_LEVELS_PER_OCTAVE = 48

/**
 * 不小于 `scale` 的最小栅格档位（§11.5）。
 *
 * 为什么是「向上取」而不是四舍五入：贴回舞台时是**缩小**，缩小只会让字略糊一点点；
 * 若取到比设备倍率小的档位就成了**放大**，字会明显发虚、边缘发毛。
 *
 * 两个常数各有作用，别删：
 * - `1e-3` 下限兜住「相机缩到极小 / 传了 0」——`log2(0)` 是 `-Infinity`，
 *   会让整条公式返回 0，画布尺寸直接变 0；
 * - `- 1e-9` 把「正好落在档位上」的情况拉回本档。浮点误差会让 `log2(2) * 48`
 *   算成 `48.000000000000007`，不修正就会白升一档（多 1.45% 的锐度损失）。
 */
export function resolveLiveRasterScale(scale: number): number {
  const safe = Math.max(scale, 1e-3)
  const level = Math.ceil(Math.log2(safe) * LIVE_RASTER_LEVELS_PER_OCTAVE - 1e-9)
  return 2 ** (level / LIVE_RASTER_LEVELS_PER_OCTAVE)
}

/** 本帧的相机信息（§11.5 的入参对象） */
export interface FumeLiveRasterFrame {
  /** 舞台的「设备像素 / 世界 px」= 相机缩放 × `devicePixelRatio` */
  deviceScale: number
  /** 本帧屏幕上可见的世界矩形（调用方已按 §8.2 外扩 overscan） */
  visible: { left: number; top: number; right: number; bottom: number }
}

/**
 * 贴回舞台的指令：把 `canvas` 的 `(0, 0, width, height)` 画到世界矩形
 * `(x, y, worldWidth, worldHeight)`。
 *
 * ⚠️ 这个对象由 {@link FumeLiveRaster.draw} **复用**，调用方必须在同一次循环迭代里
 * 立刻用完（`drawImage` 之后就不要留引用）。返回新对象会让每帧每个在屏区块多一次分配。
 */
export interface FumeLiveRasterImage {
  canvas: HTMLCanvasElement
  width: number
  height: number
  x: number
  y: number
  worldWidth: number
  worldHeight: number
}

/** 一张区块栅格的内部状态 */
interface LiveCanvas {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  lastUsed: number
  /** 上一帧真正画到的设备像素范围；下一帧要先把它清掉（画布容量可能更大） */
  usedWidth: number
  usedHeight: number
}

export class FumeLiveRaster {
  private readonly canvases = new Map<string, LiveCanvas>()

  /** 复用的返回值（见 {@link FumeLiveRasterImage} 的说明） */
  private readonly image: FumeLiveRasterImage = {
    canvas: null as unknown as HTMLCanvasElement,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    worldWidth: 0,
    worldHeight: 0
  }

  /**
   * 把一个正在打印的区块画进它的栅格 canvas，并返回贴回舞台所需的矩形。
   *
   * 返回 `null` 有两种情形，调用方按同一种方式处理（这一帧不贴图）：
   * 1. 区块裁剪后没有面积（完全在可见区之外）；
   * 2. 拿不到离屏 canvas 的 2d context（见文件头第 1 条）。
   */
  draw(
    block: FumeBlock,
    timing: FumeBlockTiming,
    params: FumeLiveBlockParams,
    frame: FumeLiveRasterFrame,
    nowMs: number
  ): FumeLiveRasterImage | null {
    const { deviceScale, visible } = frame
    const scale = resolveLiveRasterScale(deviceScale)

    // 留白要盖住两样东西：辉光（它的模糊半径是设备像素，所以要除以倍率折回世界）
    // 与打印印章（它从行的上方落下来）。0.7 / 1.5 是上游按 hero 字号与印章下落
    // 距离量出来的包络，改小会让亮块的边缘被切掉一条。
    const glowReach = (12 + block.fontPx * 0.7) * Math.max(params.glowIntensity, 1) * 1.5
    const pad = Math.ceil(block.lineHeight * 0.5 + glowReach / Math.max(scale, 0.01))

    const left = Math.max(block.x - pad, visible.left)
    const top = Math.max(block.y - pad, visible.top)
    const right = Math.min(block.x + block.width + pad, visible.right)
    const bottom = Math.min(block.y + block.height + pad, visible.bottom)
    if (right <= left || bottom <= top) return null

    const width = Math.max(1, Math.ceil((right - left) * scale))
    const height = Math.max(1, Math.ceil((bottom - top) * scale))

    const live = this.ensure(block.id, width, height)
    if (!live) return null

    const { context, canvas } = live
    // 画布容量可能比这次要画的大（只增不减），所以清理范围取「上次画过的」与
    // 「这次要画的」的较大者 —— 少清一块会留下上一帧的残影
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, Math.max(live.usedWidth, width), Math.max(live.usedHeight, height))
    // 世界坐标 → 本画布的**设备像素**：先缩放，再平移掉裁剪框的左上角
    context.setTransform(scale, 0, 0, scale, -left * scale, -top * scale)
    drawFumeLiveBlock(context, block, timing, params)

    live.usedWidth = width
    live.usedHeight = height
    live.lastUsed = nowMs

    this.image.canvas = canvas
    this.image.width = width
    this.image.height = height
    this.image.x = left
    this.image.y = top
    this.image.worldWidth = width / scale
    this.image.worldHeight = height / scale
    return this.image
  }

  /**
   * 取（必要时新建）某个区块的栅格 canvas。
   *
   * **容量只增不减**：把尺寸按 {@link LIVE_CANVAS_GRANULE} 向上取整，且新尺寸永不小于
   * 旧尺寸。原因是相机缩放是来回摆动的 —— 若每次都精确重设尺寸，`canvas.width = n`
   * 会立刻重新分配后备缓冲并清空内容，缩回去再放大就变成每帧一次分配。
   * 代价是画布可能比当前需要的大一点，而多出来的那点显存远比重分配的抖动便宜。
   *
   * 拿不到 context 时返回 `null`（见文件头第 1 条），不抛错。
   */
  private ensure(id: string, width: number, height: number): LiveCanvas | null {
    const current = this.canvases.get(id)
    if (current && current.canvas.width >= width && current.canvas.height >= height) {
      return current
    }

    if (typeof document === 'undefined') return null

    const canvas = current?.canvas ?? document.createElement('canvas')
    const previousWidth = current?.canvas.width ?? 0
    const previousHeight = current?.canvas.height ?? 0

    // 只增不减：先与旧尺寸取 max，再向上取整到粒度倍数
    canvas.width =
      Math.ceil(Math.max(width, previousWidth) / LIVE_CANVAS_GRANULE) * LIVE_CANVAS_GRANULE
    canvas.height =
      Math.ceil(Math.max(height, previousHeight) / LIVE_CANVAS_GRANULE) * LIVE_CANVAS_GRANULE

    const context = canvas.getContext('2d')
    if (!context) return null

    // 复用同一个对象，只改字段：`ensure` 在「容量够」时根本不会走到这里，
    // 走到这里时也只是换掉 canvas / context 的引用
    const live: LiveCanvas = current ?? {
      canvas,
      context,
      lastUsed: 0,
      usedWidth: 0,
      usedHeight: 0
    }
    live.canvas = canvas
    live.context = context
    this.canvases.set(id, live)
    return live
  }

  /**
   * 释放空闲超过 {@link LIVE_IDLE_MS} 的栅格（§11.5）—— 每帧调一次。
   *
   * 边界与快照层（§11.1）保持一致：`now - lastUsed <= LIVE_IDLE_MS` 的跳过，
   * 恰好卡在 5 秒的那一张这一帧还留着。
   */
  sweep(nowMs: number): void {
    if (Number.isNaN(nowMs)) return

    for (const [id, live] of this.canvases) {
      if (nowMs - live.lastUsed <= LIVE_IDLE_MS) continue
      // 先把后备存储还回去，再删记录：只 delete 的话这块显存要等 GC 才释放
      live.canvas.width = 0
      live.canvas.height = 0
      this.canvases.delete(id)
    }
  }

  /** 释放全部栅格（文章 / 主题变化与组件卸载时调，§16.4） */
  clear(): void {
    this.sweep(Number.POSITIVE_INFINITY)
  }
}
