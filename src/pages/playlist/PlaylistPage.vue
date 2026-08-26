<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  CaretRightOutlined,
  CommentOutlined,
  DeleteOutlined,
  UserOutlined
} from '@ant-design/icons-vue'
import { Modal } from 'ant-design-vue'

import SongListHeader from '@/components/music/SongListHeader.vue'
import VirtualSongList from '@/components/music/VirtualSongList.vue'
import { getMessage } from '@/app/message-holder'
import type { Song } from '@/domain/song'
import { useCommentsPanel } from '@/features/comments/use-comments-panel'
import { useCoverColor } from '@/composables/useCoverColor'
import { ApiError } from '@/services/api/errors'
import { useAuthStore } from '@/stores/auth.store'
import { usePlayerStore } from '@/stores/player.store'
import { usePlaylistStore } from '@/stores/playlist.store'

const route = useRoute()
const router = useRouter()
const playlistStore = usePlaylistStore()
const playerStore = usePlayerStore()
const authStore = useAuthStore()
const { openPanel: openComments } = useCommentsPanel()

const playlist = computed(() => playlistStore.currentPlaylist)
const heroColor = useCoverColor(() => playlist.value?.coverUrl)

const canManage = computed(() => {
  const pl = playlist.value
  return !!pl && authStore.userId != null && pl.creator.userId === authStore.userId
})

const isLikedPlaylist = computed(() => playlist.value?.specialType === 5)

const heroBackground = computed(() => {
  const rgb = heroColor.value
  if (!rgb) return 'var(--color-primary)'
  return `rgb(${rgb})`
})

function parseId(): number {
  const raw = route.params.id
  const value = Array.isArray(raw) ? raw[0] : raw
  const id = Number(value)
  return Number.isFinite(id) ? id : 0
}

function handleRetry(): void {
  const id = parseId()
  if (id > 0) void playlistStore.loadPlaylist(id)
}

function handlePlay(song: Song): void {
  const tracks = playlist.value?.tracks
  if (!tracks) return
  const index = tracks.findIndex((s) => s.id === song.id)
  if (index < 0) return
  const id = parseId()
  playerStore.playFromList(tracks, index, 'playlist', id)
}

function playAll(): void {
  const tracks = playlist.value?.tracks
  if (!tracks || tracks.length === 0) return
  const id = parseId()
  playerStore.playFromList(tracks, 0, 'playlist', id)
}

function handleOpenComments(): void {
  const pl = playlist.value
  if (!pl) return
  openComments({ type: 2, id: pl.id }, pl.name)
}

function openCreator(): void {
  const uid = playlist.value?.creator.userId
  if (uid) void router.push(`/user/${uid}`)
}

function handleRemoveSong(song: Song): void {
  if (!playlist.value) return
  Modal.confirm({
    title: '从歌单删除歌曲',
    content: `确定将「${song.name}」从该歌单删除？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    centered: true,
    onOk: async () => {
      try {
        await playlistStore.removeTrack(song.id)
        getMessage().success('已从歌单删除')
      } catch (error) {
        if (error instanceof ApiError && error.code === 'UNAUTHORIZED') {
          authStore.handleUnauthorized()
          return
        }
        const msg = error instanceof Error ? error.message : '删除失败，请稍后重试'
        getMessage().error(msg)
      }
    }
  })
}

function handleDeletePlaylist(): void {
  const pl = playlist.value
  if (!pl) return
  Modal.confirm({
    title: '删除歌单',
    content: `确定删除歌单「${pl.name}」？删除后不可恢复。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    centered: true,
    onOk: async () => {
      try {
        await playlistStore.deleteCurrentPlaylist()
        getMessage().success('歌单已删除')
        void router.push('/library')
      } catch (error) {
        if (error instanceof ApiError && error.code === 'UNAUTHORIZED') {
          authStore.handleUnauthorized()
          return
        }
        getMessage().error('删除歌单失败，请稍后重试')
      }
    }
  })
}

onMounted(() => {
  const id = parseId()
  if (id > 0) void playlistStore.loadPlaylist(id)
})

onUnmounted(() => {
  playlistStore.clear()
})
</script>

<template>
  <section class="playlist-page flex h-full min-h-0 flex-col">
    <div v-if="playlistStore.loading" class="flex flex-1 items-center justify-center">
      <a-spin tip="加载歌单中..." />
    </div>
    <div
      v-else-if="playlistStore.error"
      class="flex flex-1 flex-col items-center justify-center gap-3"
    >
      <a-empty :description="playlistStore.error.message" />
      <a-button size="small" @click="handleRetry">重试</a-button>
    </div>
    <template v-else-if="playlist">
      <header class="playlist-hero relative isolate shrink-0 overflow-hidden px-5 py-3">
        <div
          class="playlist-hero__visual pointer-events-none"
          aria-hidden="true"
          :style="{ background: heroBackground }"
        />
        <div class="relative z-10 flex items-center gap-3">
          <div
            class="playlist-hero__art relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-[var(--color-bg-elevated)] shadow-[0_6px_18px_rgba(0,0,0,0.4)] ring-1 ring-white/10"
          >
            <img
              v-if="playlist.coverUrl"
              :src="playlist.coverUrl"
              :alt="playlist.name"
              class="h-full w-full object-cover"
              referrerpolicy="no-referrer"
            />
            <div
              v-else
              class="grid h-full w-full place-items-center text-[10px] text-text-secondary"
            >
              无封面
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <h1
              class="playlist-hero__title line-clamp-1 text-[15px] font-bold leading-tight tracking-tight text-white"
            >
              {{ playlist.name }}
            </h1>
            <div
              class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/85"
            >
              <span
                v-if="isLikedPlaylist"
                class="rounded bg-white/20 px-1 py-px text-[10px] font-medium text-white ring-1 ring-white/30"
              >
                红心
              </span>
              <button
                type="button"
                class="inline-flex items-center gap-0.5 rounded-full bg-black/20 px-1.5 py-px text-white/90 ring-1 ring-white/20 backdrop-blur-sm transition hover:bg-black/35"
                @click="openCreator"
              >
                <UserOutlined class="text-[10px]" />
                <span class="max-w-[8rem] truncate">{{ playlist.creator.nickname }}</span>
              </button>
              <span class="tabular-nums">{{ playlist.trackCount }} 首</span>
            </div>
          </div>
          <div class="relative z-10 flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1 rounded-full bg-white px-3 text-xs font-semibold text-black transition hover:brightness-95 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="playlist.tracks.length === 0"
              @click="playAll"
            >
              <CaretRightOutlined class="text-xs" />
              播放全部
            </button>
            <button
              type="button"
              class="playlist-hero__button inline-flex h-8 w-8 items-center justify-center rounded-full text-white transition active:scale-[0.97]"
              title="评论"
              @click="handleOpenComments"
            >
              <CommentOutlined class="text-sm" />
            </button>
            <button
              v-if="canManage && !isLikedPlaylist"
              type="button"
              class="playlist-hero__button playlist-hero__button--danger inline-flex h-8 w-8 items-center justify-center rounded-full text-white transition active:scale-[0.97]"
              title="删除歌单"
              @click="handleDeletePlaylist"
            >
              <DeleteOutlined class="text-sm" />
            </button>
          </div>
        </div>
      </header>

      <div class="flex min-h-0 flex-1 flex-col px-3 pt-1 sm:px-4">
        <template v-if="playlist.tracks.length > 0">
          <SongListHeader :sticky="false" :removable="canManage" class="shrink-0" />
          <VirtualSongList
            :songs="playlist.tracks"
            :removable="canManage"
            :show-liked-icon="!isLikedPlaylist"
            class="pb-4"
            @play="handlePlay"
            @remove="handleRemoveSong"
          />
        </template>
        <a-empty
          v-else
          description="该歌单暂无歌曲"
          class="flex flex-1 items-center justify-center"
        />
      </div>
    </template>
  </section>
</template>

<style scoped lang="scss">
@keyframes playlistHeroIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.playlist-hero {
  position: relative;
  border-bottom: 1px solid var(--color-border);
  animation: playlistHeroIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) backwards;

  &__visual {
    position: absolute;
    inset: 0;
    z-index: 0;
    background-color: var(--color-primary);
    transition: background-color 0.5s ease;

    &::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, rgba(0, 0, 0, 0.28) 0%, rgba(0, 0, 0, 0.42) 100%);
    }
  }

  &__title {
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
  }

  &__button {
    background: rgba(255, 255, 255, 0.16);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.24);
    backdrop-filter: blur(10px);

    &:hover {
      background: rgba(255, 255, 255, 0.26);
    }

    &--danger {
      background: rgba(239, 68, 68, 0.3);
      box-shadow: inset 0 0 0 1px rgba(252, 165, 165, 0.5);

      &:hover {
        background: rgba(239, 68, 68, 0.45);
      }
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
}
</style>
