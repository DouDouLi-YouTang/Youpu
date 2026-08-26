<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  CaretRightOutlined,
  FullscreenExitOutlined,
  PauseOutlined,
  PushpinOutlined,
  StepBackwardOutlined,
  StepForwardOutlined
} from '@ant-design/icons-vue'

import { useMiniMode } from '@/features/player/use-mini-mode'
import { toggleAlwaysOnTop } from '@platform/electron/window'
import { usePlayerStore } from '@/stores/player.store'
import { formatDuration } from '@/utils/format'

const player = usePlayerStore()
const { toggle: exitMini } = useMiniMode()

const song = computed(() => player.currentItem?.song ?? null)
const pinned = ref(true)
const seekValue = ref(0)
const isDragging = ref(false)

const totalTime = computed(() => player.durationMs || song.value?.durationMs || 0)
const sliderMax = computed(() => Math.max(0, Math.ceil(totalTime.value / 100) * 100))
const cometProgress = computed(() => {
  if (sliderMax.value <= 0) return 0
  return Math.max(0, Math.min(100, (seekValue.value / sliderMax.value) * 100))
})

const cometParticles = [
  { delay: '0s', travel: '-18px', drift: '3px', size: '3px', opacity: '0.95' },
  { delay: '-0.13s', travel: '-26px', drift: '-3px', size: '2px', opacity: '0.82' },
  { delay: '-0.27s', travel: '-36px', drift: '5px', size: '2px', opacity: '0.72' },
  { delay: '-0.41s', travel: '-44px', drift: '-4px', size: '2px', opacity: '0.62' },
  { delay: '-0.55s', travel: '-54px', drift: '4px', size: '1.5px', opacity: '0.52' },
  { delay: '-0.69s', travel: '-64px', drift: '-2px', size: '1.5px', opacity: '0.43' },
  { delay: '-0.83s', travel: '-72px', drift: '3px', size: '1px', opacity: '0.36' },
  { delay: '-0.97s', travel: '-82px', drift: '-3px', size: '1px', opacity: '0.3' },
  { delay: '-1.11s', travel: '-92px', drift: '2px', size: '1px', opacity: '0.24' },
  { delay: '-1.25s', travel: '-102px', drift: '-2px', size: '1px', opacity: '0.2' }
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

watch(
  () => player.currentTimeMs,
  (t) => {
    if (!isDragging.value) seekValue.value = t
  },
  { immediate: true }
)

function formatMs(value: number | number[]): string {
  const ms = Array.isArray(value) ? value[0] : value
  return formatDuration(ms)
}

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
  }, 120)
}

async function handleTogglePin(): Promise<void> {
  pinned.value = await toggleAlwaysOnTop().catch(() => pinned.value)
}
</script>

<template>
  <a-dropdown :trigger="['contextmenu']">
    <div
      class="mini-root relative flex h-full w-full flex-col overflow-hidden select-none"
      style="-webkit-app-region: drag"
    >
      <img
        v-if="player.coverUrl"
        :src="player.coverUrl"
        class="mini-bg"
        referrerpolicy="no-referrer"
      />
      <div class="mini-mask" />

      <div
        class="mini-main relative z-[1] flex h-full min-h-0 w-full items-center gap-2.5 px-2.5 py-2"
      >
        <div
          class="mini-cover"
          :class="player.isPlaying ? 'mini-cover--spin' : 'mini-cover--paused'"
        >
          <img
            v-if="player.coverUrl"
            :src="player.coverUrl"
            class="mini-cover__img"
            referrerpolicy="no-referrer"
          />
          <div v-else class="mini-cover__placeholder" />
        </div>

        <div class="mini-content flex h-full min-w-0 flex-1 flex-col justify-center gap-1">
          <div class="mini-top flex min-w-0 shrink-0 items-center gap-2.5">
            <div class="mini-meta min-w-0 flex-1">
              <p
                class="mini-title m-0 overflow-hidden whitespace-nowrap text-ellipsis text-[13px] font-semibold text-white"
              >
                {{ song?.name ?? '未在播放' }}
              </p>
            </div>
            <div
              class="mini-ctrls flex shrink-0 items-center gap-0.5 no-drag"
              style="-webkit-app-region: no-drag"
            >
              <button
                type="button"
                class="mini-btn"
                :disabled="!song"
                aria-label="上一首"
                @click="player.previous()"
              >
                <StepBackwardOutlined />
              </button>
              <button
                type="button"
                class="mini-btn mini-btn--play"
                :disabled="!song"
                :aria-label="player.isPlaying ? '暂停' : '播放'"
                @click="player.togglePlay()"
              >
                <PauseOutlined v-if="player.isPlaying" />
                <CaretRightOutlined v-else />
              </button>
              <button
                type="button"
                class="mini-btn"
                :disabled="!song"
                aria-label="下一首"
                @click="player.next()"
              >
                <StepForwardOutlined />
              </button>
              <button type="button" class="mini-btn" aria-label="退出迷你模式" @click="exitMini()">
                <FullscreenExitOutlined />
              </button>
            </div>
          </div>

          <div
            class="mini-seek no-drag relative flex h-3.5 w-full shrink-0 items-center"
            :class="{ 'is-dragging': isDragging }"
            style="-webkit-app-region: no-drag"
          >
            <a-slider
              :value="seekValue"
              class="mini-seek__slider"
              :min="0"
              :max="sliderMax"
              :step="100"
              :disabled="!song"
              :tip-formatter="formatMs"
              :tooltip="{ formatter: formatMs }"
              aria-label="播放进度"
              @change="onSliderChange"
              @after-change="onSliderAfterChange"
            />
            <span
              v-if="song && sliderMax > 0 && !isDragging"
              class="mini-seek__comet-stream"
              :style="{ '--comet-progress': `${cometProgress}%` }"
              aria-hidden="true"
            >
              <i
                v-for="(particle, index) in cometParticles"
                :key="index"
                class="mini-seek__comet-particle"
                :style="cometParticleStyle(particle)"
              />
            </span>
          </div>
        </div>
      </div>
    </div>

    <template #overlay>
      <a-menu>
        <a-menu-item key="pin" @click="handleTogglePin">
          <PushpinOutlined />
          <span>{{ pinned ? '取消窗口置顶' : '窗口置顶' }}</span>
        </a-menu-item>
      </a-menu>
    </template>
  </a-dropdown>
</template>

<style scoped lang="scss" src="./mini-player.scss"></style>
