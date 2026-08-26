<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AudioMutedOutlined,
  CaretRightOutlined,
  CommentOutlined,
  DislikeOutlined,
  HeartFilled,
  HeartOutlined,
  PauseOutlined,
  SoundOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
  UnorderedListOutlined
} from '@ant-design/icons-vue'

import type { PlayableLevel } from '@/domain/player'
import { QUALITY_OPTIONS, qualityLabel } from '@/domain/quality'
import { usePlayerStore } from '@/stores/player.store'
import { useImmersivePlayer } from '@/features/immersive/use-immersive-player'
import { useCommentsPanel } from '@/features/comments/use-comments-panel'
import { formatDuration } from '@/utils/format'
import PlayQueuePanel from '@/features/player/PlayQueuePanel.vue'
import PlaybackModeIcon from '@/components/music/PlaybackModeIcon.vue'
import CtrlButton from '@/components/common/CtrlButton.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'

const player = usePlayerStore()
const { open: immersiveOpen, toggle: toggleImmersive } = useImmersivePlayer()
const { openPanel: openComments, open: commentsOpen } = useCommentsPanel()
const isCommentsPanelOpen = computed(() => commentsOpen.value)

const VOLUME_WHEEL_STEP = 5
const queueVisible = ref(false)

const seekValue = ref(0)
const totalTime = computed(() => player.durationMs || song.value?.durationMs || 0)
const sliderMax = computed(() => Math.max(0, Math.ceil(totalTime.value / 100) * 100))

const song = computed(() => player.currentItem?.song ?? null)
const artistsText = computed(() =>
  song.value ? song.value.artists.map((a) => a.name).join(' / ') : ''
)

function openSongComments(): void {
  const s = song.value
  if (!s) return
  openComments({ type: 0, id: s.id }, s.name, 'page')
}

const isDragging = ref(false)

watch(
  () => player.currentTimeMs,
  (t) => {
    if (!isDragging.value) seekValue.value = t
  },
  { immediate: true }
)

const volumePct = computed(() => Math.round(player.volume * 100))
const volumeModel = ref(volumePct.value)
watch(volumePct, (v) => {
  volumeModel.value = v
})

function onSliderChange(value: number | number[]): void {
  const v = Array.isArray(value) ? value[0] : value
  seekValue.value = v
  isDragging.value = true
}

function onSliderAfterChange(value: number | number[]): void {
  const v = Array.isArray(value) ? value[0] : value
  seekValue.value = v
  player.seek(v)
  setTimeout(() => {
    isDragging.value = false
  }, 150)
}

function onVolumeChange(value: number | number[]): void {
  const v = Array.isArray(value) ? value[0] : value
  player.setVolume(v / 100)
}

function adjustVolumeByWheel(event: globalThis.WheelEvent): void {
  if (event.deltaY === 0) return
  event.preventDefault()
  event.stopPropagation()
  const delta = event.deltaY < 0 ? VOLUME_WHEEL_STEP : -VOLUME_WHEEL_STEP
  const nextPct = Math.max(0, Math.min(100, volumePct.value + delta))
  player.setVolume(nextPct / 100)
}

const formatMs = (value: number | number[]): string => {
  const v = Array.isArray(value) ? value[0] : value
  return formatDuration(v)
}

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

// ── 倍速（对齐打包 0.1.21）──
const rateOptions = [0.5, 0.75, 1, 1.25, 1.5]
const rateLabel = computed(() => {
  const r = Math.min(1.5, Math.max(0.5, player.playbackRate))
  return `${Number.isInteger(r) ? r.toFixed(1) : r}x`
})
const rateModel = ref(Math.min(1.5, Math.max(0.5, player.playbackRate)))
watch(
  () => player.playbackRate,
  (r) => {
    rateModel.value = Math.min(1.5, Math.max(0.5, r))
  }
)
function setRate(rate: number): void {
  player.setPlaybackRate(rate)
}
function onRateSlider(value: number | number[]): void {
  const v = Array.isArray(value) ? value[0] : value
  rateModel.value = v
  player.setPlaybackRate(v)
}

// ── 音质（对齐打包 0.1.21）──
const levelOptions = QUALITY_OPTIONS
const levelLabel = computed(() => qualityLabel(player.level))
function setLevel(level: PlayableLevel): void {
  player.setLevel(level)
}

// 流星进度粒子（打包版 seek 终点光效）
const cometProgress = computed(() => {
  if (sliderMax.value <= 0) return 0
  return Math.min(100, Math.max(0, (seekValue.value / sliderMax.value) * 100))
})
const cometParticles = [
  { delay: '0s', travel: '-20px', drift: '3px', size: '3px', opacity: '0.95' },
  { delay: '-0.13s', travel: '-28px', drift: '-3px', size: '2px', opacity: '0.82' },
  { delay: '-0.27s', travel: '-38px', drift: '5px', size: '2px', opacity: '0.72' },
  { delay: '-0.41s', travel: '-46px', drift: '-4px', size: '2px', opacity: '0.62' },
  { delay: '-0.55s', travel: '-56px', drift: '4px', size: '1.5px', opacity: '0.52' },
  { delay: '-0.69s', travel: '-66px', drift: '-2px', size: '1.5px', opacity: '0.43' },
  { delay: '-0.83s', travel: '-74px', drift: '3px', size: '1px', opacity: '0.36' },
  { delay: '-0.97s', travel: '-84px', drift: '-3px', size: '1px', opacity: '0.3' },
  { delay: '-1.11s', travel: '-94px', drift: '2px', size: '1px', opacity: '0.24' },
  { delay: '-1.25s', travel: '-104px', drift: '-2px', size: '1px', opacity: '0.2' }
]
function cometParticleStyle(particle: (typeof cometParticles)[number]): Record<string, string> {
  return {
    '--comet-delay': particle.delay,
    '--comet-travel': particle.travel,
    '--comet-drift': particle.drift,
    '--comet-size': particle.size,
    '--comet-opacity': particle.opacity
  }
}
</script>

<template>
  <footer v-show="!immersiveOpen" class="player-bar">
    <!-- 进度轨贴顶 -->
    <div
      class="player-bar__seek"
      :class="{
        'is-dragging': isDragging,
        'player-bar__seek--above-comments': isCommentsPanelOpen
      }"
    >
      <a-slider
        :value="seekValue"
        class="player-bar__seek-slider"
        :min="0"
        :max="sliderMax"
        :step="100"
        :disabled="!song"
        :tip-formatter="formatMs"
        aria-label="播放进度"
        @change="onSliderChange"
        @after-change="onSliderAfterChange"
      />
      <span
        v-if="song && sliderMax > 0 && !isDragging"
        class="player-bar__comet-stream"
        :style="{ '--comet-progress': `${cometProgress}%` }"
        aria-hidden="true"
      >
        <i
          v-for="(particle, index) in cometParticles"
          :key="index"
          class="player-bar__comet-particle"
          :style="cometParticleStyle(particle)"
        />
      </span>
    </div>

    <div class="player-bar__main">
      <!-- Left -->
      <div class="player-bar__left">
        <button
          type="button"
          class="player-now"
          :disabled="!song"
          :aria-label="immersiveOpen ? '退出沉浸播放' : '沉浸播放'"
          @click="toggleImmersive()"
        >
          <a-avatar
            :src="player.coverUrl || undefined"
            :size="44"
            shape="square"
            class="!shrink-0 !rounded-[10px] !text-[10px]"
          >
            无封面
          </a-avatar>
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-text-primary">
              {{ song?.name ?? '未播放' }}
            </p>
            <p class="truncate text-xs text-text-secondary">{{ artistsText || '—' }}</p>
          </div>
        </button>

        <a-dropdown :trigger="['click']" placement="top" :destroy-popup-on-hide="false">
          <template #overlay>
            <div class="player-popover" @click.stop>
              <div class="player-popover__value">{{ rateLabel }}</div>
              <div class="player-popover__slider">
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
              <div class="player-popover__presets">
                <button
                  v-for="r in rateOptions"
                  :key="r"
                  type="button"
                  class="player-popover__item"
                  :class="{ 'player-popover__item--on': Math.abs(player.playbackRate - r) < 1e-3 }"
                  @click="setRate(r)"
                >
                  {{ r }}x
                </button>
              </div>
            </div>
          </template>
          <button
            type="button"
            class="player-chip"
            :disabled="!song"
            :title="`倍速 ${rateLabel}`"
            aria-label="倍速播放"
          >
            {{ rateLabel }}
          </button>
        </a-dropdown>
      </div>

      <!-- Center transport -->
      <div class="player-bar__center">
        <div class="player-bar__transport">
          <CtrlButton
            v-if="!player.fmMode && player.mode !== 'heart'"
            tooltip="上一首"
            aria-label="上一首"
            :disabled="!song"
            @click="player.previous()"
          >
            <StepBackwardOutlined />
          </CtrlButton>
          <CtrlButton
            variant="play"
            :tooltip="player.isPlaying ? '暂停' : '播放'"
            :aria-label="player.isPlaying ? '暂停' : '播放'"
            :disabled="player.state === 'loading'"
            @click="player.togglePlay()"
          >
            <PauseOutlined v-if="player.isPlaying" />
            <CaretRightOutlined v-else />
          </CtrlButton>
          <CtrlButton
            tooltip="下一首"
            aria-label="下一首"
            :disabled="!song || player.intelligenceLoading"
            @click="player.next()"
          >
            <StepForwardOutlined />
          </CtrlButton>
          <CtrlButton
            v-if="!player.fmMode"
            :tooltip="modeLabel"
            :aria-label="modeLabel"
            :disabled="!song"
            @click="toggleMode"
          >
            <PlaybackModeIcon :mode="player.mode" />
          </CtrlButton>
          <CtrlButton
            :variant="player.isCurrentLiked ? 'liked' : 'default'"
            :tooltip="player.isCurrentLiked ? '取消喜欢' : '喜欢'"
            :aria-label="player.isCurrentLiked ? '取消喜欢' : '喜欢'"
            :disabled="!song"
            @click="player.toggleLike()"
          >
            <HeartFilled v-if="player.isCurrentLiked" />
            <HeartOutlined v-else />
          </CtrlButton>
          <CtrlButton
            v-if="player.fmMode || player.mode === 'heart'"
            tooltip="不感兴趣"
            aria-label="不感兴趣"
            :disabled="!song"
            @click="player.dislikeCurrentFm()"
          >
            <DislikeOutlined />
          </CtrlButton>
        </div>
      </div>

      <!-- Right -->
      <div class="player-bar__right">
        <div class="player-bar__volume hidden md:flex">
          <CtrlButton
            :size="32"
            :icon-size="16"
            :tooltip="player.muted ? '取消静音' : '静音'"
            :aria-label="player.muted ? '取消静音' : '静音'"
            @click="player.toggleMute()"
            @wheel="adjustVolumeByWheel"
          >
            <AudioMutedOutlined v-if="player.muted || player.volume === 0" />
            <SoundOutlined v-else />
          </CtrlButton>
          <a-slider
            v-model:value="volumeModel"
            class="min-w-0 flex-1"
            :min="0"
            :max="100"
            :tooltip="{ open: false }"
            aria-label="音量"
            @change="onVolumeChange"
          />
        </div>

        <a-dropdown :trigger="['click']" placement="topRight">
          <template #overlay>
            <div class="player-popover player-popover--level" @click.stop>
              <button
                v-for="opt in levelOptions"
                :key="opt.value"
                type="button"
                class="player-popover__item player-popover__item--block"
                :class="{ 'player-popover__item--on': player.level === opt.value }"
                @click="setLevel(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </template>
          <button
            type="button"
            class="player-chip"
            :disabled="!song"
            :title="`音质 ${levelLabel}`"
            aria-label="切换音质"
          >
            {{ levelLabel }}
          </button>
        </a-dropdown>

        <AppTooltip title="评论">
          <button
            type="button"
            class="player-icon-btn"
            :disabled="!song"
            aria-label="查看评论"
            @click="openSongComments"
          >
            <CommentOutlined />
          </button>
        </AppTooltip>
        <AppTooltip v-if="!player.fmMode" :title="`播放队列 · ${player.queue.length} 首`">
          <button
            type="button"
            class="player-icon-btn"
            :class="{ 'player-icon-btn--on': queueVisible }"
            data-queue-trigger
            aria-label="播放队列"
            @click="queueVisible = !queueVisible"
          >
            <UnorderedListOutlined />
            <span v-if="player.queue.length > 0" class="player-icon-btn__badge">
              {{ player.queue.length > 99 ? '99+' : player.queue.length }}
            </span>
          </button>
        </AppTooltip>
      </div>
    </div>
  </footer>

  <PlayQueuePanel v-model:visible="queueVisible" />
</template>

<style scoped lang="scss" src="./player-bar.scss"></style>
