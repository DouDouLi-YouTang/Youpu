<script setup lang="ts">
import { computed, toRef } from 'vue'

import type { FoliaAudioBands, FoliaTheme } from '../types'
import { resolveLatentTuning, type LatentBackgroundTuning } from './latent-tuning'
import { useLatentRender } from './use-latent-render'

/**
 * latent 模式（默认背景）—— 封面取色双 shader 叠层 + 音频驱动。
 *
 * 层序（DOM 顺序 = 层叠顺序，规格 §3.1）：
 *  0. 父容器底色（`theme.backgroundColor`）：只为 shader 边缘兜底
 *  1. mesh-gradient（`scale(1.025)`）—— 底层流动色块
 *  2. dithering（`mixBlendMode: soft-light`、`scale(1.015)`）—— 上层网点，用下面的 mesh 当底色
 *  3. overlay（主题底色 × overlayOpacity）—— 压暗/压平
 *
 * ⚠️ latent **不吃 `common.*` 的任何开关**（不含几何层、不含 vignette），
 * 这是 Folia 的事实（`latent/entry.tsx` 只渲染这个组件）；不要「顺手」给它加几何层。
 */
const props = defineProps<{
  theme: FoliaTheme
  coverUrl: string | null
  isDaylight: boolean
  paused: boolean
  staticMode?: boolean
  audioPower: () => number
  audioBands: () => FoliaAudioBands
  tuning?: Partial<LatentBackgroundTuning>
}>()

const staticMode = computed(() => props.staticMode === true)
const themeRef = toRef(props, 'theme')
const coverUrlRef = toRef(props, 'coverUrl')
const tuningRef = computed(() => resolveLatentTuning(props.tuning))

const { meshHost, ditherHost, meshLayer, ditherLayer, showMesh, showDithering } = useLatentRender({
  theme: themeRef,
  coverUrl: coverUrlRef,
  audioPower: () => props.audioPower(),
  audioBands: () => props.audioBands(),
  paused: () => props.paused,
  staticMode,
  tuning: tuningRef
})

const showOverlay = computed(
  () => tuningRef.value.overlayEnabled && tuningRef.value.overlayOpacity > 0
)

/**
 * 层的**初始**样式（与 Folia JSX 的 style 逐字一致）。
 * 运行期逐帧的音频幅度由 `useLatentRender` 直接写 element.style —— 绕过 VDOM，
 * 避免每帧触发重渲染（见 GeometricBackground.vue 里同一套做法的说明）。
 */
const meshLayerStyle = computed(() => ({
  transform: 'scale(1.025)',
  transformOrigin: 'center'
}))

const ditherLayerStyle = computed(() => ({
  mixBlendMode: showMesh.value ? ('soft-light' as const) : ('normal' as const),
  opacity: showMesh.value ? String(tuningRef.value.ditheringOpacity) : '1',
  transform: 'scale(1.015)',
  transformOrigin: 'center'
}))

const rootStyle = computed(() => ({
  backgroundColor: props.theme.backgroundColor,
  pointerEvents: 'none' as const
}))

const overlayStyle = computed(() => ({
  backgroundColor: props.theme.backgroundColor,
  opacity: tuningRef.value.overlayOpacity
}))

/** 只读调试面：拿到当前解出的完整 tuning（未接设置面板时即 DEFAULT_* 的全字段版本） */
defineExpose({ resolvedTuning: tuningRef, showMesh, showDithering })
</script>

<template>
  <div class="folia-latent" :style="rootStyle">
    <div v-if="showMesh" ref="meshLayer" class="folia-latent-layer" :style="meshLayerStyle">
      <div ref="meshHost" class="folia-latent-shader" />
    </div>

    <div
      v-if="showDithering"
      ref="ditherLayer"
      class="folia-latent-layer"
      :style="ditherLayerStyle"
    >
      <div ref="ditherHost" class="folia-latent-shader" />
    </div>

    <div v-if="showOverlay" class="folia-latent-overlay" :style="overlayStyle" />
  </div>
</template>

<style scoped>
/* 宿主必须是**有尺寸的块级元素**：paper 注入的样式把 canvas 绝对定位到宿主上，
   宿主尺寸为 0 时 canvas 就是 0×0（shader 完全不画） */
.folia-latent {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}

.folia-latent-layer,
.folia-latent-shader {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.folia-latent-overlay {
  position: absolute;
  inset: 0;
}
</style>
