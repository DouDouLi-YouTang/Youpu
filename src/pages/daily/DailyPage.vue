<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { CaretRightOutlined } from '@ant-design/icons-vue'

import SongListHeader from '@/components/music/SongListHeader.vue'
import VirtualSongList from '@/components/music/VirtualSongList.vue'
import { useDailyStore } from '@/stores/daily.store'
import { usePlayerStore } from '@/stores/player.store'
import type { Song } from '@/domain/song'

const dailyStore = useDailyStore()
const playerStore = usePlayerStore()

const songs = computed(() => dailyStore.songs)

function playAt(index: number): void {
  if (songs.value.length === 0) return
  playerStore.playFromList(songs.value, index, 'daily')
}

function playAll(): void {
  playAt(0)
}

function handlePlay(song: Song): void {
  const index = songs.value.findIndex((s) => s.id === song.id)
  if (index < 0) return
  playAt(index)
}

onMounted(() => {
  void dailyStore.loadDailySongs()
})
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-4 px-4 py-4 sm:px-5">
    <header class="flex shrink-0 items-center justify-between gap-3">
      <div>
        <h2 class="text-2xl font-semibold tracking-tight text-text-primary">每日推荐</h2>
        <p class="mt-1 text-sm text-text-secondary">根据你的口味，每天更新</p>
      </div>
      <button
        v-if="songs.length > 0"
        type="button"
        class="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-primary)] px-4 text-sm font-semibold text-white shadow-md transition hover:brightness-110 active:scale-[0.98]"
        @click="playAll"
      >
        <CaretRightOutlined />
        播放全部
      </button>
    </header>

    <!-- Loading -->
    <div v-if="dailyStore.loading" class="flex flex-1 items-center justify-center">
      <a-spin tip="加载每日推荐中…" />
    </div>

    <!-- Error -->
    <div
      v-else-if="dailyStore.error"
      class="flex flex-1 flex-col items-center justify-center gap-3"
    >
      <a-empty :description="dailyStore.error.message" />
      <a-button size="small" @click="dailyStore.loadDailySongs(true)">重试</a-button>
    </div>

    <!-- Empty -->
    <a-empty
      v-else-if="songs.length === 0"
      description="暂无每日推荐"
      class="flex flex-1 items-center justify-center"
    />

    <!-- List -->
    <div v-else class="flex min-h-0 flex-1 flex-col">
      <SongListHeader :sticky="false" class="shrink-0" />
      <VirtualSongList :songs="songs" @play="handlePlay" />
    </div>
  </section>
</template>
