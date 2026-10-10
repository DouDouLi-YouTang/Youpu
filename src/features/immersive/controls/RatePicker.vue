<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { usePlayerStore } from '@/stores/player.store'
import { resetIdle } from '@/features/immersive/controls/use-controls-idle'

/**
 * 控制条左列倍速控件（贴在封面信息后，悬停展开，与右侧音质弹层同款）。
 * 根节点是 .rnp-level.rnp-level--left（外壳 .immersive-controls-left 内），
 * 样式（.rnp-level* / .level-popup* / .rate-popup）由外壳的 immersive-controls.scss
 * 用 :deep() 统一提供。
 */
const player = usePlayerStore()

// ── 倍速（生产包左侧封面信息后悬停展开）──
const rateOptions = [0.5, 0.75, 1, 1.25, 1.5]
const rateLabel = computed(() => {
  const rate = Math.min(1.5, Math.max(0.5, player.playbackRate))
  return `${Number.isInteger(rate) ? rate.toFixed(1) : String(rate)}x`
})
const rateModel = ref(Math.min(1.5, Math.max(0.5, player.playbackRate)))
watch(
  () => player.playbackRate,
  (rate) => {
    rateModel.value = Math.min(1.5, Math.max(0.5, rate))
  }
)
const ratePopupVisible = ref(false)
let rateHideTimer: ReturnType<typeof setTimeout> | undefined
function showRatePopup(): void {
  if (rateHideTimer) {
    clearTimeout(rateHideTimer)
    rateHideTimer = undefined
  }
  ratePopupVisible.value = true
}
function scheduleHideRatePopup(): void {
  rateHideTimer = setTimeout(() => {
    ratePopupVisible.value = false
    rateHideTimer = undefined
  }, 150)
}
function onRateSlider(value: number | number[]): void {
  const rate = Array.isArray(value) ? value[0] : value
  rateModel.value = rate
  player.setPlaybackRate(rate)
}
function onRateSelect(rate: number): void {
  player.setPlaybackRate(rate)
  rateModel.value = rate
  ratePopupVisible.value = false
  resetIdle()
}
onBeforeUnmount(() => {
  if (rateHideTimer) clearTimeout(rateHideTimer)
})
</script>

<template>
  <div
    class="rnp-level rnp-level--left"
    @mouseenter="showRatePopup"
    @mouseleave="scheduleHideRatePopup"
  >
    <button type="button" class="rnp-ctrl-btn rnp-level-btn" aria-label="切换播放倍速">
      {{ rateLabel }}
    </button>
    <div class="level-popup rate-popup level-popup--center" :class="{ shown: ratePopupVisible }">
      <div class="rate-popup__value">{{ rateLabel }}</div>
      <div class="rate-popup__slider">
        <a-slider
          :value="rateModel"
          :min="0.5"
          :max="1.5"
          :step="0.05"
          :tooltip="{ open: false }"
          aria-label="播放倍速"
          @change="onRateSlider"
        />
      </div>
      <div class="rate-popup__presets">
        <button
          v-for="rate in rateOptions"
          :key="rate"
          type="button"
          class="level-popup-item"
          :class="{ active: Math.abs(player.playbackRate - rate) < 1e-3 }"
          @click="onRateSelect(rate)"
        >
          {{ rate }}x
        </button>
      </div>
    </div>
  </div>
</template>
