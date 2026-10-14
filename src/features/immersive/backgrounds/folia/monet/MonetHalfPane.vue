<script setup lang="ts">
import { computed, type ComponentPublicInstance } from 'vue'

/**
 * monet 布局 B：`half-pane-gradient` —— 左侧蒙版窗内放图，右侧靠渐变接住文字。
 *
 * 层序（规格 §4.1 布局 B）：
 *  0. 底色 + fallback 渐变
 *  1. 左侧蒙版窗（`mask-image` 横向淡出）→ 窗内漂移容器 → 图
 *  2. 横向压暗 → 左上光斑 → 可读性渐变
 *
 * 两个容易踩的点：
 *  - `mask-image` 必须同时写 `-webkit-mask-image`：Chromium 现在支持无前缀版本，
 *    但 Electron 里一旦回退到旧内核就整块蒙版消失（表现为图铺满整屏）。
 *  - 窗口宽度用的是响应式断点（72% / 68% / 60%），不是固定像素 ——
 *    移动端窗口窄时留白太多会把图压成一条。
 */
const props = defineProps<{
  backgroundImage: string
  layerKey: string
  backgroundColor: string
  fallbackGradient: string
  readabilityGradient: string
  /** 图的不透明度：`base(isDaylight ? 0.7 : 0.3) + overlay * 0.16` */
  imageOpacity: number
  /** `background-position` 的 X 百分比：`clamp(50 + offsetX, 10, 90)` */
  imagePositionX: number
  /** 横向压暗（`bg @ 0.14 → 0.86`） */
  scrimGradient: string
  /** 左上角光斑（`accent @ 0.18`） */
  bloomGradient: string
  blurStyle: Record<string, string>
  driftEnabled: boolean
  /** 漂移容器交给父组件的通道（Vue 没有「父取子内 div」的模板 ref，只能回调上去） */
  driftRef?: (element: HTMLElement | null) => void
}>()

/** 模板 ref 的回调签名比 DOM ref 宽（可能是子组件实例），这里收窄到 HTMLElement。 */
function setDriftRef(element: Element | ComponentPublicInstance | null): void {
  props.driftRef?.(element instanceof HTMLElement ? element : null)
}

/** 64% 附近的半透明白渐变，唯一作用是让图的左半边「实」、右半边化掉。 */
const MASK_GRADIENT =
  'linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.94) 48%, rgba(0,0,0,0.46) 74%, rgba(0,0,0,0) 100%)'

const maskStyle = computed(() => ({
  maskImage: MASK_GRADIENT,
  WebkitMaskImage: MASK_GRADIENT
}))

const imageStyle = computed(() => ({
  backgroundImage: props.backgroundImage,
  backgroundRepeat: 'no-repeat',
  backgroundSize: 'cover',
  backgroundPosition: `${props.imagePositionX}% center`,
  opacity: String(props.imageOpacity),
  ...props.blurStyle
}))

const driftStyle = computed(() => (props.driftEnabled ? { willChange: 'transform' } : undefined))
</script>

<template>
  <div class="folia-monet-half">
    <div
      class="folia-monet-half-base"
      :style="{ backgroundColor: props.backgroundColor, backgroundImage: props.fallbackGradient }"
    />

    <Transition name="folia-monet-fade">
      <div
        v-if="layerKey !== ''"
        :key="layerKey"
        class="folia-monet-half-window"
        :style="maskStyle"
      >
        <div :ref="setDriftRef" class="folia-monet-half-drift" :style="driftStyle">
          <div class="folia-monet-half-image" :style="imageStyle" />
        </div>
      </div>
    </Transition>

    <div class="folia-monet-half-scrim" :style="{ background: props.scrimGradient }" />
    <div class="folia-monet-half-bloom" :style="{ backgroundImage: props.bloomGradient }" />
    <div class="folia-monet-half-readability" :style="{ background: props.readabilityGradient }" />
  </div>
</template>

<style scoped>
.folia-monet-half,
.folia-monet-half-base,
.folia-monet-half-drift,
.folia-monet-half-image,
.folia-monet-half-scrim,
.folia-monet-half-bloom,
.folia-monet-half-readability {
  position: absolute;
  inset: 0;
}

.folia-monet-half {
  overflow: hidden;
}

.folia-monet-half-window {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 72%;
  overflow: hidden;
}

@media (min-width: 640px) {
  .folia-monet-half-window {
    width: 68%;
  }
}

@media (min-width: 1024px) {
  .folia-monet-half-window {
    width: 60%;
  }
}

.folia-monet-fade-enter-active,
.folia-monet-fade-leave-active {
  transition: opacity 0.8s ease-in-out;
}

.folia-monet-fade-enter-from,
.folia-monet-fade-leave-to {
  opacity: 0;
}
</style>
