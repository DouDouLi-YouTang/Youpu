/**
 * 「流光」需要的视口尺寸（宽 + 高），一个 resize 监听搞定两处消费。
 *
 * ## 为什么不用 CSS 变量 / `100vw`
 *
 * 消费方是 **JS**：逐词几何要用像素字号算词宽（`resolvePixelFontSize` 的三个锚点
 * 里有一项是 `6vw`），而字号不是纯 CSS 能问的 —— 得有一份 JS 侧的数。
 *
 * ## 为什么宽高拆开
 *
 * 两者是**不同的依赖**，不该捆在一起：
 *
 *  - **宽度**参与逐词几何（字号 → 词宽 → 精确右边距），宽度变就**必须**重测；
 *  - **高度**只影响舞台的视觉占位（`--glow-stage-height` 用的是 vh，由 CSS 解析），
 *    JS 侧读它目前**没有消费方** —— 留着它是为了让"窗口变高"这件事在需要时
 *    （例如纵向上再加一档自适应）不用重写监听。
 *
 * 若把两者合成一个 `{ width, height }` 对象，宽度变化会让所有读高度的 computed
 * 一起失效（反之亦然），在窄窗口上拖动改尺寸时就是双倍无谓计算。
 *
 * ## 为什么初值读一次就够
 *
 * `window.innerWidth` / `innerHeight` 在 setup 时已经可用（组件挂在已布局的 DOM 上），
 * 不需要等 `onMounted`。轮询 / `ResizeObserver` 都不必要：窗口尺寸只有 resize 事件。
 * 屏幕旋转、DPI 变化在 Electron 桌面端最终也会落到 resize 上。
 */

import { onBeforeUnmount, ref, type Ref } from 'vue'

export interface GlowViewport {
  /** 视口宽度（px）；0 = 拿不到（非浏览器环境） */
  viewportWidth: Ref<number>
  /** 视口高度（px）；0 = 拿不到 */
  viewportHeight: Ref<number>
}

function readWidth(): number {
  const value = typeof window === 'undefined' ? 0 : window.innerWidth
  return Number.isFinite(value) && value > 0 ? value : 0
}

function readHeight(): number {
  const value = typeof window === 'undefined' ? 0 : window.innerHeight
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function useGlowViewport(): GlowViewport {
  const viewportWidth = ref(readWidth())
  const viewportHeight = ref(readHeight())

  function handleResize(): void {
    const width = readWidth()
    const height = readHeight()
    // 各自比较后再写：不比较的话每次 resize 都触发整棵树的失效，
    // 而拖拽改尺寸会连续触发几十次事件
    if (width !== viewportWidth.value) viewportWidth.value = width
    if (height !== viewportHeight.value) viewportHeight.value = height
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleResize)
    onBeforeUnmount(() => window.removeEventListener('resize', handleResize))
  }

  return { viewportWidth, viewportHeight }
}
