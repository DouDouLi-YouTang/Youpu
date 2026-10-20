<script setup lang="ts">
import { computed, ref } from 'vue'

import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import { usePlayerStore } from '@/stores/player.store'
import { useLyricStore } from '@/stores/lyric.store'
import { formatDuration } from '@/utils/format'
import { useControlsProgress } from '@/features/immersive/controls/use-progress'
import { useIdleHoldOnPointerPress } from '@/features/immersive/controls/use-idle-hold'

/**
 * 沉浸控制条 —— 贴底进度条 + 悬停歌词预览。
 *
 * 两个根节点都是独立 fixed 元素（不在 .immersive-controls 网格内，z-index 也低于控制条）：
 * 隐藏态由外壳把 hidden 传进来（跟控制条一起下滑/淡出），拖拽状态经 use-progress 与
 * 右侧时间指示器共享。样式见 ./progress-bar.scss。
 */
defineProps<{
  /** 控制条 idle 隐藏态（外壳的 hidden computed）：驱动 is-idle / is-idle-fade */
  hidden: boolean
}>()

const settings = useImmersiveSettingsStore()
const player = usePlayerStore()
const lyric = useLyricStore()
const { seekValue, totalTime, sliderMax, onSliderChange, onSliderAfterChange } =
  useControlsProgress()

const song = computed(() => player.currentItem?.song ?? null)

// 按住进度条（含拖动）期间不自动隐藏：它是独立 fixed 元素、在控制条之外，
// antd 拖动会 setPointerCapture + stopPropagation，既不触发控制条的 pointerdown
// 也没有 mousemove，只能自己持有。
const { onPointerDown: onBarPointerDown } = useIdleHoldOnPointerPress()

const formatMs = (value: number | number[]): string => {
  const v = Array.isArray(value) ? value[0] : value
  return formatDuration(v)
}

// 开启自定义歌词预览时关闭 AntD 默认 tooltip，避免悬停进度条时出现双重预览。
const progressSliderTooltip = computed(() =>
  settings.enableProgressbarPreview ? { open: false } : undefined
)

// ── 进度条悬停预览（对齐参考项目 progressbar-preview）──
const previewVisible = ref(false)
const previewTimeMs = ref(0)
const previewLyricTimeMs = computed(() => previewTimeMs.value + settings.lyricOffset)
const previewX = ref(0)
const previewY = ref(0)
const previewLineIndex = computed(() => {
  const lines = lyric.lines
  if (lines.length === 0) return -1
  let idx = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeMs <= previewLyricTimeMs.value) idx = i
    else break
  }
  return idx
})
const previewLine = computed(() => lyric.lines[previewLineIndex.value] ?? null)
const previewLineStartTimeMs = computed(() => {
  const line = previewLine.value
  if (!line) return 0
  return Math.max(0, line.timeMs - settings.lyricOffset)
})
const previewSubProgress = computed(() => {
  const line = previewLine.value
  if (!line) return 0
  const nextLine = lyric.lines[previewLineIndex.value + 1]
  const duration = nextLine
    ? nextLine.timeMs - line.timeMs
    : totalTime.value - previewLineStartTimeMs.value
  if (duration <= 0) return 0
  return Math.max(0, Math.min(100, ((previewLyricTimeMs.value - line.timeMs) / duration) * 100))
})
const previewStyle = computed(() => ({
  left: `${previewX.value}px`,
  top: `${previewY.value}px`
}))
const canShowProgressPreview = computed(
  () =>
    settings.enableProgressbarPreview &&
    Boolean(song.value) &&
    totalTime.value > 0 &&
    !lyric.isPureMusic &&
    lyric.lines.length > 0
)
const showProgressPreview = computed(
  () => canShowProgressPreview.value && previewVisible.value && Boolean(previewLine.value)
)

function updateProgressPreview(e: globalThis.MouseEvent, el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  previewTimeMs.value = totalTime.value * percent
  previewX.value = Math.max(12, Math.min(window.innerWidth - 12, e.clientX))
  previewY.value = rect.top - 8
}

function onProgressPreviewEnter(e: globalThis.MouseEvent): void {
  if (!canShowProgressPreview.value) return
  const el = e.currentTarget as HTMLElement
  previewVisible.value = true
  updateProgressPreview(e, el)
}
function onProgressPreviewMove(e: globalThis.MouseEvent): void {
  if (!previewVisible.value || !canShowProgressPreview.value) return
  const el = e.currentTarget as HTMLElement
  updateProgressPreview(e, el)
}
function onProgressPreviewLeave(): void {
  previewVisible.value = false
}

function karaokePreviewWordStyle(timeMs: number, durationMs: number): Record<string, string> {
  const percent = Math.max(
    0,
    Math.min(1, (previewLyricTimeMs.value - timeMs) / Math.max(durationMs, 1))
  )
  return { WebkitMaskPosition: `${100 * (1 - percent)}%` }
}
</script>

<template>
  <!-- 进度条:固定贴底细条(对齐参考 .m-player .prg:81-136)。默认贴在控制条上方
       bottom:calc(bottombar-height-6px)、手柄可见;bottomProgressbar 开启则贴窗口最底 0、手柄隐藏。 -->
  <div
    v-if="!settings.presentationMode"
    class="immersive-progressbar"
    :class="{
      'at-very-bottom': settings.bottomProgressbar,
      'is-idle': hidden && !settings.bottomProgressbar,
      'is-idle-fade': hidden && settings.bottomProgressbar
    }"
    @pointerdown="onBarPointerDown"
    @mouseenter="onProgressPreviewEnter"
    @mousemove="onProgressPreviewMove"
    @mouseleave="onProgressPreviewLeave"
  >
    <a-slider
      :value="seekValue"
      :min="0"
      :max="sliderMax"
      :step="100"
      :disabled="!song"
      :tip-formatter="formatMs"
      :tooltip="progressSliderTooltip"
      aria-label="播放进度"
      @change="onSliderChange"
      @after-change="onSliderAfterChange"
    />
  </div>

  <div class="progressbar-preview" :class="{ visible: showProgressPreview }" :style="previewStyle">
    <div v-if="previewLine" class="progressbar-preview-number">
      {{ previewLineIndex + 1 }} / {{ lyric.lines.length }}
    </div>
    <div v-if="previewLine?.words?.length" class="progressbar-preview-line-karaoke">
      <span
        v-for="(word, index) in previewLine.words"
        :key="index"
        class="progressbar-preview-line-karaoke-word"
        :class="{
          current:
            previewLyricTimeMs >= word.timeMs &&
            previewLyricTimeMs <= word.timeMs + word.durationMs,
          upcoming: previewLyricTimeMs < word.timeMs
        }"
        :style="karaokePreviewWordStyle(word.timeMs, word.durationMs)"
      >
        {{ word.word }}
      </span>
    </div>
    <div v-else class="progressbar-preview-line-original">
      {{ previewLine?.text || '♪' }}
    </div>
    <div v-if="previewLine?.translation" class="progressbar-preview-line-translated">
      {{ previewLine.translation }}
    </div>
    <div class="progressbar-preview-subprogressbar">
      <div
        class="progressbar-preview-subprogressbar-inner"
        :style="{ width: `${previewSubProgress}%` }"
      />
    </div>
    <div class="progressbar-preview-line-time">
      <span>{{ formatDuration(previewLineStartTimeMs) }}</span>
      <span>{{ formatDuration(previewTimeMs) }}</span>
    </div>
  </div>
</template>

<style scoped lang="scss" src="./progress-bar.scss"></style>
