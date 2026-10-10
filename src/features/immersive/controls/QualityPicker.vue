<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import { usePlayerStore } from '@/stores/player.store'
import type { PlayableLevel } from '@/domain/player'
import { QUALITY_OPTIONS, qualityLabel } from '@/domain/quality'
import { resetIdle } from '@/features/immersive/controls/use-controls-idle'

/**
 * 控制条右侧音质选择（对齐参考 .brt 码率按钮）：码率胶囊按钮 + 悬停弹出列表。
 * 根节点是 .rnp-level，样式（.rnp-level / .rnp-level-btn / .level-popup*）由外壳的
 * immersive-controls.scss 用 :deep() 统一提供（与左侧倍速弹层共用同一套弹层样式）。
 */
const player = usePlayerStore()

// ── 音质(对齐参考 .brt 码率按钮)──
// 后端仅支持码率切换(player.setLevel);速度/音效/一起听/歌曲收藏均无后端,不补。
const levelOptions = QUALITY_OPTIONS
const levelLabel = computed(() => qualityLabel(player.level))
const levelPopupVisible = ref(false)
let levelHideTimer: ReturnType<typeof setTimeout> | undefined
function showLevelPopup(): void {
  if (levelHideTimer) {
    clearTimeout(levelHideTimer)
    levelHideTimer = undefined
  }
  levelPopupVisible.value = true
}
function scheduleHideLevelPopup(): void {
  levelHideTimer = setTimeout(() => {
    levelPopupVisible.value = false
    levelHideTimer = undefined
  }, 150)
}
function onLevelSelect(level: PlayableLevel): void {
  player.setLevel(level)
  levelPopupVisible.value = false
  resetIdle()
}
onBeforeUnmount(() => {
  if (levelHideTimer) clearTimeout(levelHideTimer)
})
</script>

<template>
  <div class="rnp-level" @mouseenter="showLevelPopup" @mouseleave="scheduleHideLevelPopup">
    <button type="button" class="rnp-ctrl-btn rnp-level-btn" aria-label="切换音质">
      {{ levelLabel }}
    </button>
    <div class="level-popup" :class="{ shown: levelPopupVisible }">
      <button
        v-for="opt in levelOptions"
        :key="opt.value"
        type="button"
        class="level-popup-item"
        :class="{ active: opt.value === player.level }"
        @click="onLevelSelect(opt.value)"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>
</template>
