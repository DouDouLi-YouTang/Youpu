<script setup lang="ts">
import type { PlaybackMode } from '@/domain/player'

defineProps<{ mode: PlaybackMode }>()
</script>

<template>
  <svg v-if="mode === 'shuffle'" class="mode-mask-icon mode-icon-shuffle" aria-hidden="true" />
  <svg
    v-else-if="mode === 'repeat-one'"
    class="mode-mask-icon mode-icon-repeat-one"
    aria-hidden="true"
  />
  <svg
    v-else-if="mode === 'repeat-all'"
    class="mode-mask-icon mode-icon-repeat"
    aria-hidden="true"
  />
  <svg
    v-else-if="mode === 'heart'"
    class="mode-heartbeat-icon"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path d="M2.5 12h3l1.7-3.4 2.35 7.1 2.1-8.7 1.65 5H16" />
    <path d="M17.15 7.25a2.7 2.7 0 0 1 4.35 3.18L18 15l-3.5-4.57a2.7 2.7 0 0 1 2.65-3.18Z" />
  </svg>
  <svg v-else class="mode-mask-icon mode-icon-sequence" aria-hidden="true" />
</template>

<style scoped lang="scss">
// package-0.1.21 拆分样式(playback-mode)并入本文件:图标元素(含 heartbeat 的 path 子元素)
// 全部由本组件模板渲染,均带本组件 data-v,无需 :deep()。
// 层叠依赖:本文件 .mode-mask-icon / .mode-heartbeat-icon 的选择器特异性 (0,2,0) 需继续被外层
// CtrlButton.vue 的 .ctrl-btn :deep(svg) (0,2,1) 压过(PlayerBar 场景);同一条依赖对
// ImmersiveControls.vue 的 .rnp-ctrl-btn :deep(svg)(同为 0,2,1,本任务未改动该文件)也成立——不要提升本选择器特异性。
.mode-mask-icon {
  width: 24px;
  height: 24px;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: 20px 20px;
  mask-size: 20px 20px;
  fill: none;
  /* 让点击穿透到父 button,避免 svg 拦截首次点击 */
  pointer-events: none;
}

.mode-heartbeat-icon {
  width: 24px;
  height: 24px;
  overflow: visible;
  color: currentColor;
  pointer-events: none;
  path {
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.9;
  }
  path:last-child {
    fill: color-mix(in srgb, currentColor 16%, transparent);
  }
}

.mode-icon-repeat {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z'/%3E%3C/svg%3E");
}

.mode-icon-sequence {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M15 5l-1.41 1.41L18.17 11H2v2h16.17l-4.59 4.59L15 19l7-7z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M15 5l-1.41 1.41L18.17 11H2v2h16.17l-4.59 4.59L15 19l7-7z'/%3E%3C/svg%3E");
}

.mode-icon-repeat-one {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z'/%3E%3C/svg%3E");
}

.mode-icon-shuffle {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z'/%3E%3C/svg%3E");
}
</style>
