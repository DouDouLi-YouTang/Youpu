<script setup lang="ts">
import { computed, type ComponentPublicInstance } from 'vue'

/**
 * monet 布局 A：`full-overlay`（默认）—— 整屏一张图 + 可读性渐变。
 *
 * 层序（DOM 顺序 = 层叠顺序，规格 §4.1）：
 *  漂移容器 → 图（含淡入淡出）→ 可读性渐变
 *
 * ⚠️ 图的**进出场淡入淡出**在 Folia 是 `AnimatePresence` + `motion.div`。
 * 本项目不引入 framer-motion，改用 Vue `<Transition>` + CSS 过渡实现同一件事：
 * `key` 变化（换图 / 烘焙结果回来）时旧层淡出、新层淡入，时长 0.8s / ease-in-out。
 * CSS 过渡的合成器行为与 WAAPI 一致，不会掉帧。
 */
const props = defineProps<{
  /** 已解析的 background-image 串（烘焙结果 / 渐变 + 原图 / 纯渐变） */
  backgroundImage: string
  /** 换图时的过渡 key：`pipelineUrl || sourceUrl || 'fallback'` */
  layerKey: string
  backgroundColor: string
  /** 可读性渐变（压住图，保证歌词能读） */
  readabilityGradient: string
  /** `prefers-reduced-motion` 或 `ctx.filter` 不支持时的 CSS 模糊样式 */
  blurStyle: Record<string, string>
  /** `staticMode` 或全局降低动效时为假（决定要不要给漂移容器加 will-change） */
  driftEnabled: boolean
  /** 漂移容器交给父组件的通道（Vue 没有「父取子内 div」的模板 ref，只能回调上去） */
  driftRef?: (element: HTMLElement | null) => void
}>()

/** 模板 ref 的回调签名比 DOM ref 宽（可能是子组件实例），这里收窄到 HTMLElement。 */
function setDriftRef(element: Element | ComponentPublicInstance | null): void {
  props.driftRef?.(element instanceof HTMLElement ? element : null)
}

const backgroundStyle = computed(() => ({
  backgroundColor: props.backgroundColor,
  backgroundImage: props.backgroundImage,
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  ...props.blurStyle
}))

const driftStyle = computed(() => (props.driftEnabled ? { willChange: 'transform' } : undefined))
</script>

<template>
  <div class="folia-monet-full">
    <div :ref="setDriftRef" class="folia-monet-full-drift" :style="driftStyle">
      <Transition name="folia-monet-fade">
        <div :key="layerKey" class="folia-monet-full-image" :style="backgroundStyle" />
      </Transition>
    </div>
    <div class="folia-monet-full-readability" :style="{ background: props.readabilityGradient }" />
  </div>
</template>

<style scoped>
.folia-monet-full,
.folia-monet-full-drift,
.folia-monet-full-image {
  position: absolute;
  inset: 0;
}

.folia-monet-full {
  overflow: hidden;
}

.folia-monet-full-readability {
  position: absolute;
  inset: 0;
}

.folia-monet-fade-enter-active,
.folia-monet-fade-leave-active {
  transition: opacity 0.8s ease-in-out;
}

/* 进出场同时进行（与 AnimatePresence 的默认行为一致），否则换图中间会闪一帧底色 */
.folia-monet-fade-enter-from,
.folia-monet-fade-leave-to {
  opacity: 0;
}

.folia-monet-fade-leave-active {
  position: absolute;
  inset: 0;
}
</style>
