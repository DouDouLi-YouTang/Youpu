<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useCommentsPanel } from '@/features/comments/use-comments-panel'
import { usePlayerStore } from '@/stores/player.store'
import { useSongStore } from '@/stores/song.store'

const route = useRoute()
const router = useRouter()
const songStore = useSongStore()
const playerStore = usePlayerStore()
const { openPanel: openComments } = useCommentsPanel()

const song = computed(() => songStore.currentSong)

function parseId(): number {
  const raw = route.params.id
  const value = Array.isArray(raw) ? raw[0] : raw
  const id = Number(value)
  return Number.isFinite(id) ? id : 0
}

function handleRetry(): void {
  const id = parseId()
  if (id > 0) void songStore.loadSong(id)
}

function handlePlay(): void {
  const s = song.value
  if (!s) return
  playerStore.playFromList([s], 0, 'song')
}

function handleOpenComments(): void {
  const s = song.value
  if (!s) return
  openComments({ type: 0, id: s.id }, s.name)
}

function goToArtist(artistId: number): void {
  void router.push('/artist/' + artistId)
}

function goToAlbum(albumId: number): void {
  void router.push('/album/' + albumId)
}

onMounted(() => {
  const id = parseId()
  if (id > 0) void songStore.loadSong(id)
})

onUnmounted(() => {
  songStore.clear()
})
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-4 px-4 py-4">
    <div v-if="songStore.loading" class="flex flex-1 items-center justify-center">
      <a-spin tip="加载歌曲中..." />
    </div>
    <div v-else-if="songStore.error" class="flex flex-1 flex-col items-center justify-center gap-3">
      <a-empty :description="songStore.error.message" />
      <a-button size="small" @click="handleRetry">重试</a-button>
    </div>
    <template v-else-if="song">
      <a-card class="[&_.ant-card-body]:!p-4">
        <div class="flex items-start gap-5">
          <a-avatar
            :src="song.coverUrl || undefined"
            :size="200"
            shape="square"
            class="!rounded-lg !text-xs"
          >
            无封面
          </a-avatar>
          <div class="min-w-0 flex-1">
            <h2 class="text-2xl font-semibold text-text-primary">{{ song.name }}</h2>
            <p class="mt-2 text-sm text-text-secondary">
              歌手：
              <span
                v-for="(artist, index) in song.artists"
                :key="artist.id"
                class="cursor-pointer hover:text-text-primary"
                @click="goToArtist(artist.id)"
              >
                {{ artist.name }}<span v-if="index < song.artists.length - 1"> / </span>
              </span>
            </p>
            <p class="mt-1 text-sm text-text-secondary">
              专辑：
              <span
                v-if="song.album"
                class="cursor-pointer hover:text-text-primary"
                @click="goToAlbum(song.album.id)"
              >
                {{ song.album.name }}
              </span>
              <span v-else>未知</span>
            </p>
            <p class="mt-1 text-sm text-text-secondary">
              时长：{{ Math.floor((song.durationMs || 0) / 1000 / 60) }}:{{
                String(Math.floor(((song.durationMs || 0) / 1000) % 60)).padStart(2, '0')
              }}
            </p>
          </div>
          <a-space>
            <a-button type="primary" @click="handlePlay">播放</a-button>
            <a-button @click="handleOpenComments">查看评论</a-button>
          </a-space>
        </div>
      </a-card>
    </template>
  </section>
</template>
