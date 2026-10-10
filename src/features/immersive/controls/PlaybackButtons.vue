<script setup lang="ts">
import { computed } from 'vue'
import { DislikeOutlined, HeartFilled, HeartOutlined } from '@ant-design/icons-vue'

import { usePlayerStore } from '@/stores/player.store'
import PlaybackModeIcon from '@/components/music/PlaybackModeIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'

/**
 * 控制条中列播放控件：上一首 / 播放暂停 / 下一首 / 播放模式 / 喜欢 / FM 不感兴趣。
 * 根节点是 .immersive-controls-buttons（外壳 .immersive-controls-center 内），
 * 样式由外壳的 immersive-controls.scss 用 :deep() 统一提供。
 */
const player = usePlayerStore()

const song = computed(() => player.currentItem?.song ?? null)

// ── 播放模式 ──
// 模式图标走 PlaybackModeIcon 共享组件(与 PlayerBar 一致),单曲循环用自带"1"的
// repeat-one 图标替代 a-badge。
const modeLabel = computed(() => {
  switch (player.mode) {
    case 'sequence':
      return '顺序播放'
    case 'repeat-all':
      return '列表循环'
    case 'repeat-one':
      return '单曲循环'
    case 'shuffle':
      return '随机播放'
    case 'heart':
      return '心动模式'
    default:
      return '顺序播放'
  }
})
function toggleMode(): void {
  player.toggleMode()
}
</script>

<template>
  <div class="immersive-controls-buttons">
    <AppTooltip title="上一首">
      <button
        v-if="!player.fmMode && player.mode !== 'heart'"
        type="button"
        class="rnp-ctrl-btn"
        aria-label="上一首"
        :disabled="!song"
        @click="player.previous()"
      >
        <svg class="rnp-mask-icon rnp-icon-prev" aria-hidden="true"></svg>
      </button>
    </AppTooltip>
    <button
      type="button"
      class="rnp-ctrl-btn rnp-ctrl-play play-toggle"
      :class="player.isPlaying ? 'play-toggle-pause' : 'play-toggle-play'"
      :aria-label="player.isPlaying ? '暂停' : '播放'"
      :disabled="player.state === 'loading'"
      @click="player.togglePlay()"
    >
      <!-- 双 svg + clip-path 在 play/pause 间变形(对齐参考 .btnp:188-261) -->
      <svg class="play-toggle-svg play-toggle-svg-first" aria-hidden="true"></svg>
      <svg class="play-toggle-svg play-toggle-svg-last" aria-hidden="true"></svg>
    </button>
    <AppTooltip title="下一首">
      <button
        type="button"
        class="rnp-ctrl-btn"
        aria-label="下一首"
        :disabled="!song"
        @click="player.next()"
      >
        <svg class="rnp-mask-icon rnp-icon-next" aria-hidden="true"></svg>
      </button>
    </AppTooltip>
    <AppTooltip :title="modeLabel">
      <button
        v-if="!player.fmMode"
        type="button"
        class="rnp-ctrl-btn rnp-mode-btn"
        :aria-label="modeLabel"
        :disabled="!song"
        @click="toggleMode"
      >
        <!-- 模式图标:单色 mask SVG(对齐参考 .type:162-187 实心填充)。
             单曲循环用 repeat-one 自带"1",替代 antd a-badge(参考无角标圆点)。
             图标统一走 PlaybackModeIcon 共享组件,与 PlayerBar 一致。 -->
        <PlaybackModeIcon :mode="player.mode" />
      </button>
    </AppTooltip>
    <AppTooltip :title="player.isCurrentLiked ? '取消喜欢' : '喜欢'">
      <button
        type="button"
        class="rnp-ctrl-btn"
        :class="{ 'rnp-ctrl-liked': player.isCurrentLiked }"
        :aria-label="player.isCurrentLiked ? '取消喜欢' : '喜欢'"
        :disabled="!song"
        @click="player.toggleLike()"
      >
        <HeartFilled v-if="player.isCurrentLiked" />
        <HeartOutlined v-else />
      </button>
    </AppTooltip>
    <!-- FM 垃圾桶:把当前歌扔进垃圾桶并拉下一首,影响后续 FM 推荐。仅 FM 模式显示。 -->
    <AppTooltip title="不感兴趣">
      <button
        v-if="player.fmMode || player.mode === 'heart'"
        type="button"
        class="rnp-ctrl-btn"
        aria-label="不感兴趣"
        :disabled="!song"
        @click="player.dislikeCurrentFm()"
      >
        <DislikeOutlined />
      </button>
    </AppTooltip>
  </div>
</template>
