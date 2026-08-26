<script setup lang="ts">
import { computed } from 'vue'

/**
 * 下载进度圆环。
 *
 * 用于侧边栏下载入口:圆环描边表示整体下载进度,中心数字表示正在下载的任务数。
 * 也用于下载列表中单曲进度的紧凑展示。颜色跟随主题主色 (--color-primary)。
 */
const props = withDefaults(
  defineProps<{
    percent: number
    count?: number
    size?: number
    stroke?: number
  }>(),
  {
    count: undefined,
    size: 28,
    stroke: 2.5
  }
)

const clampedPercent = computed(() => Math.max(0, Math.min(100, props.percent)))
const radius = computed(() => (props.size - props.stroke) / 2)
const center = computed(() => props.size / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const dashOffset = computed(() => circumference.value * (1 - clampedPercent.value / 100))
const rotateTransform = computed(() => `rotate(-90 ${center.value} ${center.value})`)
const displayCount = computed(() => {
  if (props.count == null) return ''
  return props.count > 99 ? '99+' : String(props.count)
})
const fontSize = computed(() => (props.size <= 24 ? 9 : 10))
</script>

<template>
  <span
    class="download-progress-ring inline-flex items-center justify-center align-middle"
    :style="{ width: `${size}px`, height: `${size}px` }"
    role="progressbar"
    :aria-valuenow="clampedPercent"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <svg :width="size" :height="size" class="absolute inset-0">
      <circle
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        stroke="var(--color-control)"
        :stroke-width="stroke"
      />
      <circle
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        stroke="var(--color-primary)"
        :stroke-width="stroke"
        stroke-linecap="round"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
        :transform="rotateTransform"
        class="ring-progress"
      />
    </svg>
    <span
      v-if="count != null"
      class="relative z-10 font-semibold leading-none text-text-primary"
      :style="{ fontSize: `${fontSize}px` }"
      >{{ displayCount }}</span
    >
  </span>
</template>

<style lang="scss" scoped>
.download-progress-ring {
  position: relative;
  flex: none;
}

.ring-progress {
  transition: stroke-dashoffset 0.3s ease;
}
</style>
