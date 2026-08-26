<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CaretRightOutlined, CommentOutlined } from '@ant-design/icons-vue'

import SongListHeader from '@/components/music/SongListHeader.vue'
import VirtualSongList from '@/components/music/VirtualSongList.vue'
import type { Song } from '@/domain/song'
import { useCommentsPanel } from '@/features/comments/use-comments-panel'
import { useAlbumStore } from '@/stores/album.store'
import { usePlayerStore } from '@/stores/player.store'

const route = useRoute()
const router = useRouter()
const albumStore = useAlbumStore()
const playerStore = usePlayerStore()
const { openPanel: openComments } = useCommentsPanel()

const album = computed(() => albumStore.currentAlbum)

function parseId(): number {
  const raw = route.params.id
  const value = Array.isArray(raw) ? raw[0] : raw
  const id = Number(value)
  return Number.isFinite(id) ? id : 0
}

function handleRetry(): void {
  const id = parseId()
  if (id > 0) void albumStore.loadAlbum(id)
}

function playAt(index: number): void {
  const songs = album.value?.songs
  if (!songs || songs.length === 0) return
  playerStore.playFromList(songs, index, 'album')
}

function playAll(): void {
  playAt(0)
}

function playSong(song: Song): void {
  const songs = album.value?.songs
  if (!songs) return
  const index = songs.findIndex((s) => s.id === song.id)
  if (index < 0) return
  playAt(index)
}

function handleOpenComments(): void {
  const al = album.value
  if (!al) return
  openComments({ type: 3, id: al.id }, al.name)
}

function openArtist(id: number): void {
  void router.push(`/artist/${id}`)
}

onMounted(() => {
  const id = parseId()
  if (id > 0) void albumStore.loadAlbum(id)
})

onUnmounted(() => {
  albumStore.clear()
})
</script>

<template>
  <section class="album-page flex h-full min-h-0 flex-col">
    <div v-if="albumStore.loading" class="flex flex-1 items-center justify-center">
      <a-spin tip="加载专辑中..." />
    </div>
    <div
      v-else-if="albumStore.error"
      class="flex flex-1 flex-col items-center justify-center gap-3"
    >
      <a-empty :description="albumStore.error.message" />
      <a-button size="small" @click="handleRetry">重试</a-button>
    </div>
    <template v-else-if="album">
      <header class="album-hero relative isolate shrink-0 overflow-hidden px-5 pb-5 pt-6">
        <div class="album-hero__visual pointer-events-none" aria-hidden="true">
          <div
            class="album-hero__cover"
            :style="{
              backgroundImage: album.coverUrl ? `url(&quot;${album.coverUrl}&quot;)` : 'none'
            }"
          />
          <div class="album-hero__veil" />
        </div>
        <div class="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-end">
          <div
            class="h-36 w-36 shrink-0 overflow-hidden rounded-2xl bg-[var(--color-bg-elevated)] shadow-[0_18px_48px_rgba(0,0,0,0.35)] ring-1 ring-white/10 sm:h-40 sm:w-40"
          >
            <img
              v-if="album.coverUrl"
              :src="album.coverUrl"
              :alt="album.name"
              class="h-full w-full object-cover"
              referrerpolicy="no-referrer"
            />
            <div v-else class="grid h-full w-full place-items-center text-sm text-text-secondary">
              无封面
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <p class="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
              专辑
            </p>
            <h1
              class="line-clamp-2 text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl"
            >
              {{ album.name }}
            </h1>
            <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/75">
              <span class="flex flex-wrap items-center gap-x-1">
                <template v-if="album.artists.length">
                  <button
                    v-for="(artist, i) in album.artists"
                    :key="artist.id"
                    type="button"
                    class="transition hover:text-white"
                    @click="openArtist(artist.id)"
                  >
                    {{ artist.name
                    }}<span v-if="i < album.artists.length - 1" class="text-white/40"> / </span>
                  </button>
                </template>
                <template v-else>未知歌手</template>
              </span>
              <span>{{ album.size ?? album.songs.length }} 首</span>
            </div>
            <div class="mt-4 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                class="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--color-primary)] px-5 text-sm font-semibold text-white shadow-[0_10px_28px_color-mix(in_srgb,var(--color-primary)_45%,transparent)] transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="album.songs.length === 0"
                @click="playAll"
              >
                <CaretRightOutlined class="text-base" />
                播放全部
              </button>
              <button
                type="button"
                class="album-hero__button inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium text-white transition active:scale-[0.98]"
                @click="handleOpenComments"
              >
                <CommentOutlined />
                评论
              </button>
            </div>
          </div>
        </div>
      </header>

      <div class="flex min-h-0 flex-1 flex-col px-3 pt-1 sm:px-4">
        <template v-if="album.songs.length > 0">
          <SongListHeader :sticky="false" class="shrink-0" />
          <VirtualSongList :songs="album.songs" class="pb-4" @play="playSong" />
        </template>
        <a-empty
          v-else
          description="该专辑暂无歌曲"
          class="flex flex-1 items-center justify-center"
        />
      </div>
    </template>
  </section>
</template>

<style scoped lang="scss">
.album-hero {
  &__visual {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
  }

  &__cover {
    position: absolute;
    inset: -40px;
    background-position: center;
    background-size: cover;
    filter: blur(48px) saturate(1.1);
    opacity: 0.55;
    transform: scale(1.1);
  }

  &__veil {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(
        180deg,
        rgba(12, 14, 16, 0.42) 0%,
        rgba(12, 14, 16, 0.58) 42%,
        color-mix(in srgb, var(--color-bg-primary) 88%, $color-black) 100%
      ),
      linear-gradient(
        90deg,
        rgba(10, 12, 14, 0.45) 0%,
        rgba(10, 12, 14, 0.12) 55%,
        transparent 100%
      );
  }

  &__button {
    background: rgba(255, 255, 255, 0.16);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
    backdrop-filter: blur(10px);

    &:hover {
      background: rgba(255, 255, 255, 0.24);
    }
  }
}
</style>
