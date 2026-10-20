<script setup lang="ts">
import { computed } from 'vue'

import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import { formatDuration } from '@/utils/format'
import { useControlsProgress } from '@/features/immersive/controls/use-progress'

/**
 * 控制条右侧时间指示器：剩余/总时长可点击切换（对齐参考 refined-control-bar.js:34-85），
 * remain 模式显示 -剩余，total 模式显示已播；点击切换并持久化到 settings.timeIndicator。
 *
 * 进度值经 use-progress 与进度条共享（拖动时跟随拖动值）。样式由外壳的
 * immersive-controls.scss 用 :deep(.rnp-time-indicator) 统一提供。
 */
const settings = useImmersiveSettingsStore()
const { seekValue, totalTime } = useControlsProgress()

const timeMode = computed(() => settings.timeIndicator)
const remainingMs = computed(() => Math.max(0, totalTime.value - seekValue.value))
function toggleTimeMode(): void {
  settings.timeIndicator = settings.timeIndicator === 'remain' ? 'total' : 'remain'
}
</script>

<template>
  <button
    type="button"
    class="rnp-time-indicator"
    :aria-label="timeMode === 'remain' ? '剩余时长(点击切换为已播)' : '已播时长(点击切换为剩余)'"
    @click="toggleTimeMode"
  >
    <span v-if="timeMode === 'remain'">-{{ formatDuration(remainingMs) }}</span>
    <span v-else>{{ formatDuration(seekValue) }}</span>
  </button>
</template>
