<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { usePlayerStore } from '@/stores/player.store'
import {
  FLUID_BLUR_MAP,
  FLUID_FPS_MAP,
  useImmersiveSettingsStore
} from '../immersive-settings.store'
import { loadCrossOriginImage } from '../image-color'
import { useBackgroundCoverUrl } from './use-background-cover'

/**
 * 流体背景（`backgroundType = 'fluid'`）—— 逐字移植参考项目 background.js + background.scss。
 *
 * 构成：整张专辑图铺底，其上叠 4 个 100×100 canvas（各取专辑图一个象限），
 * CSS 旋转动画 + SVG feTurbulence+feDisplacementMap 扭曲 + backdrop-filter 模糊。
 * 暂停时停止旋转（`.paused`），静态流体用随机 animation-delay 定格到某帧。
 *
 * 音频响应（参考项目用 LibFrontendPlay/registerAudioLevelCallback 驱动
 * feDisplacementMap scale）在独立播放器中无音频分析器，故位移固定 400。
 *
 * 与改造前的差异：本组件只在选中「流体」时挂载，所以不再需要「当前类型是不是我」
 * 的判断；原先挂在常驻组件上的 `type` watcher 拆成了 `onMounted`（进入）与
 * `onBeforeUnmount`（离开）两半。
 */
const settings = useImmersiveSettingsStore()
const player = usePlayerStore()

const coverUrl = useBackgroundCoverUrl()
const isPlaying = computed(() => player.isPlaying)

// ── canvas 四象限贴图 ──
const canvasEls = ref<(HTMLCanvasElement | null)[]>([null, null, null, null])
const feTurbulence = ref<SVGFETurbulenceElement | null>(null)
const fluidRect = ref<HTMLElement | null>(null)

// 静态流体：随机定格帧的 animation-delay（对齐参考项目 random*150s / random*60s）
const staticContainerDelay = ref(0)
const staticCanvasDelays = ref<number[]>([0, 0, 0, 0])

/** 重新生成静态流体的随机定格偏移（每次封面变化 / 组件挂载时调用） */
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

/** 清空 4 个流体 canvas —— 切到无封面歌曲时移除上一首封面的残留帧 */
function clearFluidCanvases(): void {
  fluidDrawToken++
  for (const canvas of canvasEls.value) {
    if (!canvas) continue
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
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

onMounted(() => {
  void nextTick(() => {
    setupFluidObserver()
    // 无封面时 clear(顺带自增令牌)
    if (coverUrl.value) void drawFluidImage(coverUrl.value)
    else clearFluidCanvases()
  })
})

onBeforeUnmount(() => {
  // 作废在途绘制：卸载后它可能落到已拆走的 canvas 上
  fluidDrawToken++
  resizeObserver?.disconnect()
  resizeObserver = null
})

watch(coverUrl, (url) => {
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
</script>

<template>
  <!-- 单根 div：父组件 `.rnp-bg > div` 的定位规则靠 scoped 命中子组件根元素，
       所以 SVG 滤镜定义必须收在这个 div 内部（0×0，不占布局） -->
  <div class="rnp-background-fluid" :style="fluidBgStyle">
    <!-- SVG 扭曲滤镜定义：feTurbulence 噪声 + feDisplacementMap 位移。
         固定 scale 400（无音频分析器），id 被下方 rect 的 filter 引用 -->
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
</template>

<style scoped lang="scss" src="./fluid-background.scss"></style>
