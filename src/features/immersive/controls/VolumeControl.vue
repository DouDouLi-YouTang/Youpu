<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { AudioMutedOutlined, SoundOutlined } from '@ant-design/icons-vue'

import { usePlayerStore } from '@/stores/player.store'
import { resetIdle } from '@/features/immersive/controls/use-controls-idle'

/**
 * 控制条右侧音量控件：静音按钮 + 悬停弹出竖向滑块（对齐参考 .prg-spk:491-548）。
 * 根节点是 .immersive-volume，样式 + 弹层 antd 覆盖由外壳的 immersive-controls.scss
 * 用 :deep() 统一提供。
 */
const VOLUME_WHEEL_STEP = 5

const player = usePlayerStore()

// ── 音量 ──
const volumePct = computed(() => Math.round(player.volume * 100))
const volumePopup = ref(false)
// 悬停弹出用延迟隐藏:鼠标在按钮↔弹层之间瞬时越过(进度条/动画边缘)不立即收起,
// 回到弹层内即清除计时。对齐参考项目网易云原生音量条 hover 的延迟容忍行为。
let volumeHideTimer: ReturnType<typeof setTimeout> | undefined
// slider 直接绑 volumePct(computed get/set):拖动 set → setVolume → player.volume 同步更新 →
// volumePct 变 → get 返回新值。不用独立 ref + watch 回写,避免拖动中 watch 把
// volumeModel 回写成滞后/舍入值与 v-model 竞争,导致音量偶发跳 0。
const volumeModel = computed<number>({
  get: () => volumePct.value,
  set: (v) => {
    player.setVolume(v / 100)
    // 拖动/点击轨道期间持续保持弹层,避免 mouseleave 计时收起中断调节
    showVolumePopup()
    // 拖动音量期间保持控制条显示:antd slider 拖动用 setPointerCapture,
    // window mousemove 在捕获期可能不触发,导致 idle 计时不被重置、控制条淡出。
    resetIdle()
  }
})
function adjustVolumeByWheel(event: globalThis.WheelEvent): void {
  if (event.deltaY === 0) return
  event.preventDefault()
  event.stopPropagation()

  const delta = event.deltaY < 0 ? VOLUME_WHEEL_STEP : -VOLUME_WHEEL_STEP
  const nextPct = Math.max(0, Math.min(100, volumePct.value + delta))
  player.setVolume(nextPct / 100)
  showVolumePopup()
  resetIdle()
}
function showVolumePopup(): void {
  if (volumeHideTimer) {
    clearTimeout(volumeHideTimer)
    volumeHideTimer = undefined
  }
  volumePopup.value = true
}
function scheduleHideVolumePopup(): void {
  volumeHideTimer = setTimeout(() => {
    volumePopup.value = false
    volumeHideTimer = undefined
  }, 150)
}
onBeforeUnmount(() => {
  if (volumeHideTimer) clearTimeout(volumeHideTimer)
})
</script>

<template>
  <div class="immersive-volume" @mouseenter="showVolumePopup" @mouseleave="scheduleHideVolumePopup">
    <button
      type="button"
      class="rnp-ctrl-btn"
      :aria-label="player.muted ? '取消静音' : '静音'"
      @click="player.toggleMute()"
      @wheel="adjustVolumeByWheel"
    >
      <AudioMutedOutlined v-if="player.muted || player.volume === 0" />
      <SoundOutlined v-else />
    </button>
    <!-- 音量悬停弹出竖向滑块(对齐参考 .prg-spk:491-548:36×120 圆角弹层 + 竖向 8px 轨/18px 手柄) -->
    <div class="volume-popup" :class="{ shown: volumePopup }">
      <a-slider
        v-model:value="volumeModel"
        vertical
        :min="0"
        :max="100"
        :tooltip="{ open: false }"
        aria-label="音量"
      />
    </div>
  </div>
</template>
