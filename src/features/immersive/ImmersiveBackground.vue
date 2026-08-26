<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { usePlayerStore } from '@/stores/player.store'
import {
  FLUID_BLUR_MAP,
  FLUID_FPS_MAP,
  useImmersiveSettingsStore
} from './immersive-settings.store'
import { getGradientFromPalette } from './color-utils'
import { getDominantRgbPalette, loadCrossOriginImage } from './image-color'

/**
 * 沉浸式动态背景 —— 逐字移植参考项目 background.js + background.scss。
 *
 * 五种模式由 settings.backgroundType 切换（fluid / blur / gradient / solid / none）。
 * 流体：4 个 100×100 canvas 各取专辑图四分之一象限，CSS 旋转动画 +
 *   SVG feTurbulence+feDisplacementMap 扭曲 + backdrop-filter blur。
 *   暂停时停止旋转（.paused），静态流体用随机 animation-delay 定格到某帧。
 * 音频响应（参考项目用 LibFrontendPlay/registerAudioLevelCallback 驱动
 *   feDisplacementMap scale）在独立播放器中无音频分析器，故位移固定 400。
 */

const settings = useImmersiveSettingsStore()
const player = usePlayerStore()

const coverUrl = computed(() => player.currentItem?.song?.coverUrl ?? null)
const isPlaying = computed(() => player.isPlaying)
const type = computed(() => settings.backgroundType)

// ── fluid ──
const canvasEls = ref<(HTMLCanvasElement | null)[]>([null, null, null, null])
const feTurbulence = ref<SVGFETurbulenceElement | null>(null)
const fluidRect = ref<HTMLElement | null>(null)

// 静态流体：随机定格帧的 animation-delay（对齐参考项目 random*150s / random*60s）
const staticContainerDelay = ref(0)
const staticCanvasDelays = ref<number[]>([0, 0, 0, 0])

// 重新生成静态流体的随机定格偏移（每次封面变化 / 组件挂载时调用）
function rollStaticFluidDelays(): void {
  staticContainerDelay.value = -(Math.random() * 150)
  staticCanvasDelays.value = Array.from({ length: 4 }, () => -(Math.random() * 60))
}

function setCanvasRef(el: Element | null, i: number): void {
  canvasEls.value[i] = el as HTMLCanvasElement | null
}

/** 把专辑图四个象限分别画到 4 个 canvas（每个 100×100，filter blur 5px） */
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
    rollStaticFluidDelays()
  } catch {
    /* 跨域污染 / 加载失败 → 保留上一帧 canvas，不崩 */
  }
}

/** ResizeObserver 定位：4 个 canvas 放在四角，对齐参考项目 onResize */
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
  () => type.value === 'fluid',
  (isFluid) => {
    if (isFluid) {
      void nextTick(() => {
        setupFluidObserver()
        // 无封面时 clear(顺带自增令牌):离开 fluid 期间在途的旧封面绘制,
        // 否则会在切回 fluid 后落到新挂载的空白 canvas 上
        if (coverUrl.value) void drawFluidImage(coverUrl.value)
        else clearFluidCanvases()
      })
    } else {
      // 离开 fluid 即作废在途绘制:此期间 coverUrl watcher 对 fluid 提前 return,
      // 无人自增令牌,旧绘制完成后令牌校验会误判为仍然有效
      fluidDrawToken++
      resizeObserver?.disconnect()
      resizeObserver = null
    }
  },
  { immediate: true }
)

/** 清空 4 个流体 canvas —— 切到无封面歌曲时移除上一首封面的残留帧 */
function clearFluidCanvases(): void {
  fluidDrawToken++
  for (const canvas of canvasEls.value) {
    if (!canvas) continue
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }
}

watch(coverUrl, (url) => {
  if (type.value !== 'fluid') return
  if (url) void drawFluidImage(url)
  else clearFluidCanvases()
})

// 帧率节流 class（对齐参考项目 experimental.scss 的 steps() 机制）
const fluidFramerateClass = computed(() => {
  const fps = FLUID_FPS_MAP[settings.fluidMaxFramerate]
  if (fps === Infinity) return 'rnp-fluid-max-framerate-inf'
  return `rnp-fluid-max-framerate-${fps}`
})

// fluid-blur 档位 → px(32/64/128),单一来源 FLUID_BLUR_MAP
const fluidBlurVar = computed(() => `${FLUID_BLUR_MAP[settings.fluidBlur] ?? 32}px`)

// 流体底图：参考项目 .rnp-background-fluid 以整张专辑图铺底，4 canvas 是其上的扭曲副本
const fluidBgStyle = computed(() => ({
  '--fluid-blur': fluidBlurVar.value,
  backgroundImage: coverUrl.value ? `url("${coverUrl.value}")` : 'none'
}))

// 静态流体的内联 style：暂停动画 + 随机 delay 定格帧
const staticContainerStyle = computed(() =>
  settings.staticFluid
    ? {
        animationPlayState: 'paused' as const,
        animationDelay: `${staticContainerDelay.value}s`
      }
    : {}
)

function staticCanvasStyle(i: number): Record<string, string> {
  if (!settings.staticFluid) return {}
  return {
    animationPlayState: 'paused',
    animationDelay: `${staticCanvasDelays.value[i]}s`
  }
}

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

// ── blur ──
const blurUrl = ref<string>('')
const blurStyle = computed(() => ({
  backgroundImage: blurUrl.value ? `url("${blurUrl.value}")` : 'none'
}))
watch(
  [coverUrl, type],
  ([url, currentType]) => {
    if (currentType !== 'blur') return
    // 无封面时清空,避免切到无封面歌曲后仍显示上一首的模糊背景
    blurUrl.value = url ?? ''
  },
  { immediate: true }
)

// ── gradient ──
const DEFAULT_GRADIENT = 'linear-gradient(-45deg, #666, #fff)'
const gradient = ref<string>(DEFAULT_GRADIENT)
const gradientStyle = computed(() => ({ backgroundImage: gradient.value }))
// 竞态防护令牌:watcher 每次触发自增,慢的取色恢复后令牌不匹配则丢弃,
// 防止快速切歌时上一首封面的渐变覆盖当前封面
let gradientToken = 0
watch(
  [coverUrl, type],
  async ([url, currentType]) => {
    const token = ++gradientToken
    if (currentType !== 'gradient') return
    if (!url) {
      // 无封面时回退默认渐变,避免残留上一首的配色
      gradient.value = DEFAULT_GRADIENT
      return
    }
    const palette = await getDominantRgbPalette(url, 8)
    if (token !== gradientToken) return
    if (palette && palette.length > 0) {
      gradient.value = getGradientFromPalette(palette)
    }
  },
  { immediate: true }
)
</script>

<template>
  <!-- SVG 扭曲滤镜定义：feTurbulence 噪声 + feDisplacementMap 位移。固定 scale 400（无音频分析器） -->
  <svg width="0" height="0" class="rnp-fluid-svg" aria-hidden="true">
    <filter
      id="rnp-fluid-filter"
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

  <div class="rnp-bg">
    <!-- blur -->
    <div v-if="type === 'blur'" class="rnp-background-blur" :style="blurStyle" />

    <!-- gradient -->
    <div
      v-else-if="type === 'gradient'"
      class="rnp-background-gradient"
      :class="{ 'gradient-bg-dynamic': settings.gradientBgDynamic }"
      :style="gradientStyle"
    />

    <!-- fluid -->
    <div v-else-if="type === 'fluid'" class="rnp-background-fluid" :style="fluidBgStyle">
      <div
        ref="fluidRect"
        class="rnp-background-fluid-rect"
        :class="[fluidFramerateClass, { paused: !isPlaying, 'static-fluid': settings.staticFluid }]"
        :style="staticContainerStyle"
      >
        <canvas
          v-for="i in 4"
          :key="i"
          :ref="(el) => setCanvasRef(el as Element | null, i - 1)"
          :canvas-id="String(i)"
          width="100"
          height="100"
          class="rnp-background-fluid-canvas"
          :style="staticCanvasStyle(i - 1)"
        />
      </div>
    </div>

    <!-- solid -->
    <div v-else-if="type === 'solid'" class="rnp-background-solid" />

    <!-- none -->
    <div v-else class="rnp-background-none" />
  </div>
</template>

<style scoped lang="scss">
.rnp-fluid-svg {
  position: absolute;
  pointer-events: none;
}

.rnp-bg {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: hidden;
  pointer-events: none;

  > div {
    position: absolute;
    inset: 0;
  }
}

// blur
.rnp-background-blur {
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  transition: background-image 1.5s ease;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--rnp-accent-color-overlay);
    opacity: var(--bg-dim, 0.55);
    pointer-events: none;
  }

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    backdrop-filter: blur(var(--bg-blur, 90px));
    pointer-events: none;
  }
}

// gradient
.rnp-background-gradient {
  background-size: 400% 400%;
  background-position: 50% 50%;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--rnp-accent-color-overlay);
    opacity: var(--bg-dim-for-gradient-bg, 0.45);
    pointer-events: none;
  }
}

.gradient-bg-dynamic {
  animation: rnp-bg-gradient-animation 120s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
}

@keyframes rnp-bg-gradient-animation {
  0% {
    background-position: 0% 0%;
  }
  25% {
    background-position: 100% 0%;
  }
  50% {
    background-position: 100% 100%;
  }
  75% {
    background-position: 0% 100%;
  }
  100% {
    background-position: 0% 0%;
  }
}

// fluid
.rnp-background-fluid {
  // 流体背景容器需用专辑图填底（canvas 仅覆盖四角）
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  width: calc(100% + 150px);
  height: calc(100% + 150px);
  left: -150px;
  top: -150px;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    backdrop-filter: blur(var(--fluid-blur, 64px));
  }

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--rnp-accent-color-overlay);
    opacity: var(--bg-dim-for-fluid-bg, 0.3);
    z-index: 1;
    pointer-events: none;
  }
}

.rnp-background-fluid-rect {
  position: relative;
  width: max(100vw, 100vh);
  height: max(100vw, 100vh);
  top: calc(50% - 50vh);
  left: calc(50% - 50vw);
  filter: saturate(1.5) brightness(0.8) url(#rnp-fluid-filter);
  animation: rnp-fluid-container-rotate 150s linear infinite;

  &.paused {
    animation-play-state: paused;

    .rnp-background-fluid-canvas {
      animation-play-state: paused;
    }
  }

  // 流体帧率节流（对齐参考项目 experimental.scss 的 steps() 机制）
  // 帧率 class 打在 .rnp-background-fluid-rect 自身
  &.rnp-fluid-max-framerate-5 {
    animation-timing-function: steps(750);
  }
  &.rnp-fluid-max-framerate-10 {
    animation-timing-function: steps(1500);
  }
  &.rnp-fluid-max-framerate-30 {
    animation-timing-function: steps(4500);
  }
  &.rnp-fluid-max-framerate-60 {
    animation-timing-function: steps(9000);
  }
}

.rnp-background-fluid-canvas {
  position: absolute;
  animation: rnp-fluid-block-rotate 60s linear infinite;
  opacity: 1;

  &[canvas-id='1'] {
    animation-delay: 0s;
  }
  &[canvas-id='2'] {
    animation-delay: -5s;
  }
  &[canvas-id='3'] {
    animation-delay: -10s;
  }
  &[canvas-id='4'] {
    animation-delay: -15s;
  }
}

// canvas 是 rect 的子元素,保持后代选择器即可
.rnp-fluid-max-framerate-5 {
  .rnp-background-fluid-canvas {
    animation-timing-function: steps(300);
  }
}

.rnp-fluid-max-framerate-10 {
  .rnp-background-fluid-canvas {
    animation-timing-function: steps(600);
  }
}

.rnp-fluid-max-framerate-30 {
  .rnp-background-fluid-canvas {
    animation-timing-function: steps(1800);
  }
}

.rnp-fluid-max-framerate-60 {
  .rnp-background-fluid-canvas {
    animation-timing-function: steps(3600);
  }
}

@keyframes rnp-fluid-block-rotate {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
@keyframes rnp-fluid-container-rotate {
  0% {
    transform: scale(1.2) rotate(0deg);
  }
  100% {
    transform: scale(1.2) rotate(-360deg);
  }
}

// solid
.rnp-background-solid {
  background-color: var(--rnp-accent-color-bg);
  transition: background-color 1s ease;
}

// none
.rnp-background-none {
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    backdrop-filter: blur(var(--bg-blur-for-none-bg-mask, 0px));
  }

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--rnp-accent-color-overlay);
    opacity: var(--bg-dim-for-none-bg-mask, 0);
    z-index: 1;
    pointer-events: none;
  }
}
</style>

<!-- package-0.1.21 拆分块：必须排在上方旧内联块之后，同特异性下靠 cascade 后者赢压住旧内联 -->
<style scoped lang="scss" src="./rnp-background.scss"></style>
