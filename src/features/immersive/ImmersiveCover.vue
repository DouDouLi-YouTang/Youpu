<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { usePlayerStore } from '@/stores/player.store'
import { isWindowMaximized, onMaximizeChange } from '@/platform/electron/window'
import { useImmersiveSettingsStore } from './immersive-settings.store'

const COMPACT_COVER_MAX_PX = 280

const player = usePlayerStore()
const settings = useImmersiveSettingsStore()

const song = computed(() => player.currentItem?.song ?? null)
const coverUrl = computed(() => player.coverUrl)
const isPlaying = computed(() => player.isPlaying)
const artistsText = computed(() =>
  song.value ? song.value.artists.map((artist) => artist.name).join(' / ') : ''
)
const aliasesText = computed(() => song.value?.aliases?.join(' / ') ?? '')
const albumName = computed(() => song.value?.album?.name ?? '')
const coverSrc = computed(() => coverUrl.value)

const isFullscreen = ref(false)
const isMaximized = ref(false)
let offMaximizeChange: (() => void) | null = null

function syncFullscreen(): void {
  isFullscreen.value = Boolean(document.fullscreenElement)
}

const useCompactCover = computed(() => isFullscreen.value || isMaximized.value)
const coverSizePx = computed(() => {
  const settingMax = settings.albumSize || 400
  if (useCompactCover.value) {
    const max = Math.min(settingMax, COMPACT_COVER_MAX_PX)
    return `min(${max}px, 16vw, 28vh)`
  }
  return `min(${settingMax}px, 20vw, 42vh)`
})

const shadowStyle = computed(() =>
  coverSrc.value
    ? {
        backgroundImage: `url("${coverSrc.value}")`,
        width: coverSizePx.value,
        height: coverSizePx.value
      }
    : { width: coverSizePx.value, height: coverSizePx.value }
)

const coverRootStyle = computed(() => ({ '--rnp-cover-size': coverSizePx.value }))

onMounted(() => {
  syncFullscreen()
  document.addEventListener('fullscreenchange', syncFullscreen)
  void isWindowMaximized()
    .then((maximized) => {
      isMaximized.value = maximized
    })
    .catch(() => {
      isMaximized.value = false
    })
  offMaximizeChange = onMaximizeChange((maximized) => {
    isMaximized.value = maximized
  })
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreen)
  offMaximizeChange?.()
  offMaximizeChange = null
})
</script>

<template>
  <div
    class="rnp-cover"
    :class="{
      'rectangle-cover': settings.rectangleCover,
      'cover-blurry-shadow': settings.coverBlurryShadow,
      'song-info-center': settings.songInfoAlign === 'center'
    }"
    :style="coverRootStyle"
  >
    <div
      v-if="settings.coverBlurryShadow && coverSrc"
      class="rnp-cover-shadow"
      :style="shadowStyle"
    />
    <div class="rnp-cover-cd" :class="{ paused: !isPlaying }">
      <img
        v-if="coverSrc"
        :src="coverSrc"
        :alt="song?.name ?? ''"
        class="rnp-cover-img"
        draggable="false"
      />
      <div v-else class="rnp-cover-placeholder">无封面</div>
    </div>
    <div class="rnp-cover-meta">
      <h2 class="rnp-cover-title">{{ song?.name ?? '未播放' }}</h2>
      <p v-if="aliasesText" class="rnp-cover-alias">{{ aliasesText }}</p>
      <p class="rnp-cover-artist">{{ artistsText || '—' }}</p>
      <p v-if="albumName" class="rnp-cover-album">{{ albumName }}</p>
    </div>
  </div>
</template>
