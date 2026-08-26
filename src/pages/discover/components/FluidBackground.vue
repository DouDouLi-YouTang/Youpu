<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { loadCrossOriginImage } from '@/features/immersive/image-color'

/**
 * 独立流体背景组件 -- 从 ImmersiveBackground 的 fluid 模式抽取核心效果。
 *
 * 实现：4 个 100×100 canvas 各取封面四分之一象限（blur 5px）+ SVG
 *   feTurbulence+feDisplacementMap 扭曲 + CSS 旋转动画 + backdrop-filter
 *   blur。不依赖 ImmersiveBackground 的设置/store/其他模式，可独立用于
 *   任意需要"歌词面板流动效果"的容器。
 *
 * 竞态防护：fluidDrawToken 自增令牌，await 后校验，防止快速切歌时旧封面
 *   覆盖当前帧。跨域污染/加载失败 try/catch 降级（保留上一帧，不崩）。
 */

const props = defineProps<{
  coverUrl: string | null | undefined
}>()

/** 唯一 SVG 滤镜 id，避免与 ImmersiveBackground 的 rnp-fluid-filter 冲突 */
const filterId = `fluid-bg-filter-${Math.random().toString(36).slice(2, 8)}`

const canvasEls = ref<(HTMLCanvasElement | null)[]>([null, null, null, null])
const feTurbulence = ref<SVGFETurbulenceElement | null>(null)
const fluidRect = ref<HTMLElement | null>(null)

function setCanvasRef(el: Element | null, i: number): void {
  canvasEls.value[i] = el as HTMLCanvasElement | null
}

/** 封面底图（整张铺底，4 canvas 是其上的扭曲副本） */
const baseStyle = computed(() => ({
  backgroundImage: props.coverUrl ? `url("${props.coverUrl}")` : 'none'
}))

/** 把封面图四个象限分别画到 4 个 canvas（每个 100×100，filter blur 5px） */
let fluidDrawToken = 0
async function drawFluidImage(url: string): Promise<void> {
  const token = ++fluidDrawToken
  await nextTick()
  try {
    const img = await loadCrossOriginImage(url)
    // await 期间可能已切歌(令牌被后续绘制/清除改写),不许旧封面覆盖当前帧
    if (token !== fluidDrawToken) return
    const { width, height } = img
    const hw = width / 2
    const hh = height / 2
    const quads: Array<[number, number]> = [
      [0, 0],
      [hw, 0],
      [0, hh],
      [hw, hh]
    ]
    canvasEls.value.forEach((canvas, i) => {
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.filter = 'blur(5px)'
      const [sx, sy] = quads[i]
      ctx.drawImage(img, sx, sy, hw, hh, 0, 0, 100, 100)
    })
    // 每次换图重新随机扰动种子，让扭曲形态不同
    if (feTurbulence.value) {
      feTurbulence.value.setAttribute('seed', String(Math.floor(Math.random() * 1000)))
    }
  } catch {
    /* 跨域污染 / 加载失败 -> 保留上一帧 canvas，不崩 */
  }
}

/** 清空 4 个流体 canvas -- 无封面时移除上一首封面的残留帧 */
function clearFluidCanvases(): void {
  fluidDrawToken++
  for (const canvas of canvasEls.value) {
    if (!canvas) continue
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }
}

/** ResizeObserver 定位：4 个 canvas 放在四角，对齐 ImmersiveBackground onResize */
function layoutFluidCanvases(): void {
  const host = fluidRect.value?.parentElement
  if (!host) return
  const width = host.clientWidth
  const height = host.clientHeight
  const viewSize = Math.max(width, height)
  const canvasSize = viewSize * 0.707
  for (let x = 0; x <= 1; x++) {
    for (let y = 0; y <= 1; y++) {
      const canvas = canvasEls.value[y * 2 + x]
      if (!canvas) continue
      canvas.style.width = `${canvasSize}px`
      canvas.style.height = `${canvasSize}px`
      const signX = x === 0 ? -1 : 1
      const signY = y === 0 ? -1 : 1
      canvas.style.left = `${width / 2 + signX * canvasSize * 0.35 - canvasSize / 2}px`
      canvas.style.top = `${height / 2 + signY * canvasSize * 0.35 - canvasSize / 2}px`
    }
  }
}

let resizeObserver: globalThis.ResizeObserver | null = null
function setupFluidObserver(): void {
  const host = fluidRect.value?.parentElement
  if (!host || resizeObserver) return
  resizeObserver = new globalThis.ResizeObserver(() => layoutFluidCanvases())
  resizeObserver.observe(host)
  layoutFluidCanvases()
}

watch(
  () => props.coverUrl,
  (url) => {
    void nextTick(() => {
      setupFluidObserver()
      if (url) void drawFluidImage(url)
      else clearFluidCanvases()
    })
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <!-- SVG 扭曲滤镜定义：feTurbulence 噪声 + feDisplacementMap 位移（固定 scale 400） -->
  <svg width="0" height="0" class="fluid-bg-svg" aria-hidden="true">
    <filter
      :id="filterId"
      x="-20%"
      y="-20%"
      width="140%"
      height="140%"
      filter-units="objectBoundingBox"
      primitive-units="userSpaceOnUse"
      color-interpolation-filters="sRGB"
    >
      <feTurbulence
        ref="feTurbulence"
        type="fractalNoise"
        base-frequency="0.005"
        num-octaves="1"
        seed="0"
      />
      <feDisplacementMap in="SourceGraphic" scale="400" />
    </filter>
  </svg>

  <div class="fluid-bg-root">
    <!-- 封面底图：整张专辑图铺底，4 canvas 是其上的扭曲副本 -->
    <div class="fluid-bg-base" :style="baseStyle"></div>

    <!-- 4 canvas 旋转容器 + SVG 扭曲滤镜 -->
    <div
      ref="fluidRect"
      class="fluid-bg-rect"
      :style="{ filter: `saturate(1.5) brightness(0.8) url(#${filterId})` }"
    >
      <canvas
        v-for="i in 4"
        :key="i"
        :ref="(el) => setCanvasRef(el as Element | null, i - 1)"
        width="100"
        height="100"
        class="fluid-bg-canvas"
        :data-idx="i - 1"
      />
    </div>

    <!-- backdrop blur：模糊底图 + canvas，形成流体融合效果 -->
    <div class="fluid-bg-blur"></div>
  </div>
</template>

<style lang="scss" scoped>
.fluid-bg-svg {
  position: absolute;
  pointer-events: none;
}

.fluid-bg-root {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.fluid-bg-base {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

.fluid-bg-rect {
  position: relative;
  width: 100%;
  height: 100%;
  animation: fluid-bg-container-rotate 150s linear infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
}

.fluid-bg-canvas {
  position: absolute;
  animation: fluid-bg-block-rotate 60s linear infinite;

  &[data-idx='0'] {
    animation-delay: 0s;
  }
  &[data-idx='1'] {
    animation-delay: -5s;
  }
  &[data-idx='2'] {
    animation-delay: -10s;
  }
  &[data-idx='3'] {
    animation-delay: -15s;
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
}

.fluid-bg-blur {
  position: absolute;
  inset: 0;
  backdrop-filter: blur(64px);
}

@keyframes fluid-bg-block-rotate {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

@keyframes fluid-bg-container-rotate {
  0% {
    transform: scale(1.2) rotate(0deg);
  }
  100% {
    transform: scale(1.2) rotate(-360deg);
  }
}
</style>
