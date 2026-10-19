<script setup lang="ts">
import { computed } from 'vue'

import FoliaBackground from '@/features/immersive/backgrounds/folia/FoliaBackground.vue'
import type { FoliaBackgroundMode } from '@/features/immersive/backgrounds/folia/types'
import {
  resolveFoliaSkinId,
  useImmersiveSettingsStore
} from '@/features/immersive/immersive-settings.store'
import { audioBands } from '@/features/immersive/use-audio-bands'
import type { AudioBands } from '@/features/immersive/use-audio-bands'
import type { SmoothClock } from './use-smooth-clock'

/**
 * Folia 三主题的背景适配层。
 *
 * `native` 直接渲染 slot 中的原生背景；其他模式交给已经移植好的
 * `FoliaBackground`。透明度与模糊只加在覆盖背景这一层，绝不作用到宿主根节点，
 * 否则歌词与 canvas 会一起被淡掉。
 */
const props = defineProps<{
  coverUrl: string | null
  palette: {
    background: string
    primary: string
    accent: string
    secondary: string
  }
  isDaylight: boolean
  paused: boolean
  clock?: SmoothClock
}>()

const settings = useImmersiveSettingsStore()

const backgroundMode = computed(
  () => settings.folia.backgroundModes[resolveFoliaSkinId(settings.skin)]
)
const isNative = computed(() => backgroundMode.value === 'native')
const isTransparent = computed(() => backgroundMode.value === 'transparent')
const overlayMode = computed(() => backgroundMode.value as FoliaBackgroundMode)

/**
 * FoliaBackground 的两个音频入参是**函数**，不是响应式值。
 * 这里返回稳定的读取函数，每个 rAF 都读当前时钟的同一帧。
 */
function readAudioPower(): number {
  return props.clock?.bands().power ?? audioBands.value.power
}

function readAudioBands(): AudioBands {
  if (!props.clock) return audioBands.value
  const bands = props.clock.bands()
  return {
    low: bands.bass,
    mid: bands.mid,
    high: bands.treble,
    power: bands.power
  }
}

const overlayStyle = computed<Record<string, string>>(() => ({
  opacity: String(settings.folia.backgroundOpacity / 100),
  filter: settings.folia.backgroundBlur > 0 ? `blur(${settings.folia.backgroundBlur}px)` : 'none'
}))
</script>

<template>
  <template v-if="isNative">
    <slot />
  </template>
  <div v-else-if="!isTransparent" class="folia-skin-background" :style="overlayStyle">
    <FoliaBackground
      :mode="overlayMode"
      :cover-url="props.coverUrl"
      :palette="props.palette"
      :is-daylight="props.isDaylight"
      :paused="props.paused"
      :seed="props.coverUrl ?? 'default'"
      :audio-power="readAudioPower"
      :audio-bands="readAudioBands"
    />
  </div>
</template>

<style scoped>
.folia-skin-background {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  transform: translateZ(0);
}
</style>
