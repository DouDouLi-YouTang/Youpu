<script setup lang="ts">
import { computed, toRef } from 'vue'

import FoliaFallbackGradient from '../shared/FoliaFallbackGradient.vue'
import type { FoliaTheme } from '../types'
import {
  resolveNomandSourceUrl,
  resolveNomandTuning,
  type NomandBackgroundTuning
} from './nomand-tuning'
import { useNomandRender } from './use-nomand-render'

/**
 * nomand 模式 —— 封面 / 上传图 + 单档 Paper 图像滤镜（五种 effect）。
 *
 * 层序（规格 §5.1）：
 *  0. 父容器底色 `theme.backgroundColor`：图源为空时这就是全部内容
 *  1. 单个 Paper shader（`dithering` / `fluted-glass` / `paper-texture` /
 *     `halftone-dots` / `lens-distortion` 五选一）
 *  2. overlay（主题底色 × overlayOpacity）—— 压暗/压平，与 latent 同一套写法
 *
 * ⚠️ nomand **不吃 `paused` / `staticMode`**：Folia 的 `nomand/entry.tsx:17-24`
 * 只取 `config / coverUrl / theme / isDaylight`。这是事实，不是遗漏 —— 不要「顺手」加。
 */
const props = defineProps<{
  theme: FoliaTheme
  coverUrl: string | null
  isDaylight: boolean
  /** 用户上传图 URL（`config.customImage.url`）；与 monet 共用同一张 */
  customImageUrl?: string | null
  tuning?: Partial<NomandBackgroundTuning>
}>()

const tuning = computed(() => resolveNomandTuning(props.tuning))

/** 图源选择：`uploaded-global` 优先用户上传图，否则优先封面（两种顺序都由 tuning 决定） */
const sourceUrl = computed(() =>
  resolveNomandSourceUrl(props.coverUrl, props.customImageUrl ?? null, tuning.value.imageSource)
)

const themeRef = toRef(props, 'theme')
const isDaylightRef = toRef(props, 'isDaylight')
const sourceUrlRef = computed(() => sourceUrl.value)

const { host, showFallback } = useNomandRender({
  theme: themeRef,
  isDaylight: isDaylightRef,
  sourceUrl: sourceUrlRef,
  tuning
})

const rootStyle = computed(() => ({
  backgroundColor: props.theme.backgroundColor,
  pointerEvents: 'none' as const
}))

const showOverlay = computed(() => tuning.value.overlayEnabled && tuning.value.overlayOpacity > 0)

const overlayStyle = computed(() => ({
  backgroundColor: props.theme.backgroundColor,
  opacity: tuning.value.overlayOpacity
}))

defineExpose({ resolvedTuning: tuning, sourceUrl })
</script>

<template>
  <div class="folia-nomand" :style="rootStyle">
    <!-- shader 没挂上且全局标记置位 → 主题底色渐变兜底（不再是纯底色） -->
    <FoliaFallbackGradient v-if="showFallback" :theme="theme" />
    <div v-else ref="host" class="folia-nomand-shader" />

    <div v-if="showOverlay" class="folia-nomand-overlay" :style="overlayStyle" />
  </div>
</template>

<style scoped>
/* 宿主必须是有尺寸的块级元素：paper 注入的样式把 canvas 绝对定位到宿主上，
   宿主尺寸为 0 时 canvas 就是 0×0（shader 完全不画） */
.folia-nomand {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}

.folia-nomand-shader {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.folia-nomand-overlay {
  position: absolute;
  inset: 0;
}
</style>
