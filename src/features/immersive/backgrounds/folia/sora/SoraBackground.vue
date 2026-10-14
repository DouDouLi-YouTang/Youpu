<script setup lang="ts">
import { computed, toRef } from 'vue'

import FoliaFallbackGradient from '../shared/FoliaFallbackGradient.vue'
import type { FoliaTheme } from '../types'
import { resolveSoraTuning, type SoraBackgroundTuning } from './sora-tuning'
import { useSoraRender } from './use-sora-render'

/**
 * sora 模式 —— twgl.js 手写 GLSL 星空（150 个 `gl.POINTS`）。
 *
 * 层序（规格 §6.1）：
 *  0. 外层纯黑（深色）/ 纯白（浅色）底 —— 这就是 `blank` 模式下的**全部**内容
 *  1. 单个 canvas（`willChange: transform` + `translateZ(0)` 让它独占合成层，
 *     免得每帧重绘时把上层歌词一起重排）
 *
 * ⚠️ 两条不能改的事实：
 *  - `blank = true` 时**完全不挂 canvas**（不是「挂了但不画」）。这样才真的省掉
 *    一个 WebGL context 与它的帧循环，也是 Folia 注释里写明的意图。
 *  - 宿主传进来的 `paused` 已经把 `staticMode` 合并进去了（见 `host-props.ts`），
 *    所以这一层不用再区分两者：**sora 的 staticMode = 冻结**（不是隐藏）。
 */
const props = defineProps<{
  theme: FoliaTheme
  isDaylight: boolean
  paused: boolean
  tuning?: Partial<SoraBackgroundTuning>
}>()

const tuning = computed(() => resolveSoraTuning(props.tuning))
const themeRef = toRef(props, 'theme')
const isDaylightRef = toRef(props, 'isDaylight')
const pausedRef = toRef(props, 'paused')

const { canvas, showFallback } = useSoraRender({
  theme: themeRef,
  isDaylight: isDaylightRef,
  paused: pausedRef
})

/**
 * 只有「本意要画星空」时兜底才成立。
 *
 * `blank = true` 是用户明确要一块纯黑/纯白 —— 那时不挂 canvas 是**正确结果**，不是失败。
 * 若不排除它，全局标记（可能由 latent 那边的失败置位）会让 blank 模式冒出一层主题渐变，
 * 直接违背这个开关的语义。
 */
const showFallbackGradient = computed(() => !tuning.value.blank && showFallback.value)

const rootStyle = computed(() => ({
  backgroundColor: props.isDaylight ? '#ffffff' : '#000000'
}))

const canvasStyle = {
  width: '100%',
  height: '100%',
  willChange: 'transform',
  transform: 'translateZ(0)'
} as const

defineExpose({ resolvedTuning: tuning })
</script>

<template>
  <div class="folia-sora" :style="rootStyle">
    <!-- WebGL 挂了 → 主题底色渐变兜底；blank 永远走下面的纯底色，不参与兜底 -->
    <FoliaFallbackGradient v-if="showFallbackGradient" :theme="theme" />
    <!-- blank：整块底色，不建 WebGL context（这是它唯一的可见内容） -->
    <canvas v-else-if="!tuning.blank" ref="canvas" class="folia-sora-canvas" :style="canvasStyle" />
  </div>
</template>

<style scoped>
.folia-sora {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}

.folia-sora-canvas {
  position: absolute;
  inset: 0;
  display: block;
  pointer-events: none;
}
</style>
