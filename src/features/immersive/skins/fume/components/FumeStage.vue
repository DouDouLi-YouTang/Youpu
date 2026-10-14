<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 「浮名」的 canvas 宿主（薄壳）。
 *
 * 只做三件事：**建 canvas、观察宿主尺寸、把上下文交出去**。
 *
 * ## 为什么位图尺寸 / DPR 变换**不在这里**
 *
 * 上游把尺寸复查放进每帧流程的第一条（§11.3 ①）：跨屏拖动会让 `devicePixelRatio`
 * 在**没有 resize 事件**的情况下变化，只在挂载与 resize 时设一次就会画糊。
 * 所以位图尺寸与 `setTransform` 的唯一权威在绘制层（`use-fume-stage` 的每帧流程第一条），
 * 本组件只提供「逻辑尺寸变了」这个信号与上下文 —— 两处都写 `canvas.width`
 * 是明确的 bug 来源（谁后写谁生效，且改尺寸会清空画布）。
 */

const emit = defineEmits<{
  /** 上下文就绪（挂载后一次）。canvas 也要交出去：位图尺寸由绘制层按 DPR 设 */
  ready: [context: CanvasRenderingContext2D, canvas: HTMLCanvasElement]
  /** 逻辑尺寸变化（含首次） */
  resize: [size: { width: number; height: number }]
}>()

/** 舞台容器：canvas 的尺寸以它为准（不是 window，见下） */
const hostRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

let observer: ResizeObserver | null = null
let context: CanvasRenderingContext2D | null = null
/** 上一次上报的逻辑尺寸；只在真变了才 emit（拖动窗口会连续触发几十次） */
let lastSize = { width: 0, height: 0 }

function reportSize(width: number, height: number): void {
  if (width <= 0 || height <= 0) return
  if (width === lastSize.width && height === lastSize.height) return
  lastSize = { width, height }
  emit('resize', { width, height })
}

onMounted(() => {
  const canvas = canvasRef.value
  const host = hostRef.value
  if (!canvas || !host) return

  context = canvas.getContext('2d')
  if (!context) return

  const rect = host.getBoundingClientRect()
  reportSize(rect.width, rect.height)
  emit('ready', context, canvas)

  // ⚠️ 观察**宿主**而不是 window：沉浸页有底栏、侧栏与窗口拖拽带，
  // 窗口尺寸不变时舞台也可能变（例如底栏折叠）
  observer = new ResizeObserver((entries) => {
    const entry = entries[0]
    if (!entry) return
    const box = entry.borderBoxSize?.[0]
    const width = box ? box.inlineSize : entry.contentRect.width
    const height = box ? box.blockSize : entry.contentRect.height
    reportSize(width, height)
  })
  observer.observe(host)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  context = null
  lastSize = { width: 0, height: 0 }
})
</script>

<template>
  <div ref="hostRef" class="fume-stage-host">
    <canvas ref="canvasRef" class="fume-canvas" />
    <slot />
  </div>
</template>

<style scoped lang="scss" src="./fume-stage.scss"></style>
