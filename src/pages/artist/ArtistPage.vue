<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { CaretRightOutlined } from '@ant-design/icons-vue'

import SongListHeader from '@/components/music/SongListHeader.vue'
import VirtualSongList from '@/components/music/VirtualSongList.vue'
import type { Song } from '@/domain/song'
import { useCoverColor } from '@/composables/useCoverColor'
import { useArtistStore } from '@/stores/artist.store'
import { usePlayerStore } from '@/stores/player.store'

type Tab = 'top' | 'songs' | 'albums'

const route = useRoute()
const artistStore = useArtistStore()
const playerStore = usePlayerStore()

const activeTab = ref<Tab>('top')
const artist = computed(() => artistStore.artist)
const topSongs = computed(() => artistStore.topSongs)
const songs = computed(() => artistStore.songs)
const albums = computed(() => artistStore.albums)

const heroColor = useCoverColor(() => artist.value?.picUrl || artist.value?.avatarUrl)
const heroBackground = computed(() => {
  const rgb = heroColor.value
  if (!rgb) return 'var(--color-primary)'
  return `rgb(${rgb})`
})

const tabs: { key: Tab; label: string }[] = [
  { key: 'top', label: '热门歌曲' },
  { key: 'songs', label: '全部歌曲' },
  { key: 'albums', label: '专辑' }
]

function parseId(): number {
  const raw = route.params.id
  const value = Array.isArray(raw) ? raw[0] : raw
  const id = Number(value)
  return Number.isFinite(id) ? id : 0
}

function ensureTab(tab: Tab, id: number): void {
  if (tab === 'top') void artistStore.loadTopSongs(id)
  else if (tab === 'songs') void artistStore.loadSongs(id)
  else void artistStore.loadAlbums(id)
}

function handleRetryArtist(): void {
  const id = parseId()
  if (id > 0) void artistStore.loadArtist(id)
}

function retryTab(): void {
  const id = parseId()
  if (id > 0) ensureTab(activeTab.value, id)
}

function playFrom(song: Song, list: Song[]): void {
  if (!list || list.length === 0) return
  const index = list.findIndex((s) => s.id === song.id)
  if (index < 0) return
  playerStore.playFromList(list, index, 'artist')
}

function playAll(list: Song[]): void {
  if (list.length === 0) return
  playerStore.playFromList(list, 0, 'artist')
}

function coverThumb(url: string | undefined | null, size = 400): string | undefined {
  if (!url) return undefined
  if (url.includes('param=')) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}param=${size}y${size}`
}

function selectTab(tab: Tab): void {
  activeTab.value = tab
}

watch(activeTab, (tab) => {
  const id = parseId()
  if (id > 0) ensureTab(tab, id)
})

onMounted(() => {
  const id = parseId()
  if (id > 0) {
    void artistStore.loadArtist(id)
    void artistStore.loadTopSongs(id)
  }
})

onUnmounted(() => {
  artistStore.clear()
})
</script>

<template>
  <section class="artist-page">
    <div v-if="artistStore.artistLoading" class="artist-state">
      <a-spin tip="加载歌手中..." />
    </div>
    <div v-else-if="artistStore.artistError" class="artist-state artist-state--col">
      <a-empty :description="artistStore.artistError.message" />
      <a-button size="small" @click="handleRetryArtist">重试</a-button>
    </div>
    <template v-else-if="artist">
      <header class="artist-hero">
        <div
          class="artist-hero__visual"
          aria-hidden="true"
          :style="{ background: heroBackground }"
        ></div>
        <div class="artist-hero__body">
          <div class="artist-hero__avatar">
            <img
              v-if="artist.avatarUrl || artist.picUrl"
              :src="coverThumb(artist.avatarUrl || artist.picUrl, 160)"
              :alt="artist.name"
              referrerpolicy="no-referrer"
            />
            <span v-else>{{ artist.name.charAt(0) }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <h1 class="artist-hero__name">{{ artist.name }}</h1>
            <div class="artist-hero__stats">
              <span v-if="artist.musicSize != null">单曲 {{ artist.musicSize }}</span>
              <span v-if="artist.albumSize != null">专辑 {{ artist.albumSize }}</span>
            </div>
          </div>
          <div class="artist-hero__actions">
            <button
              v-if="topSongs.data.length > 0"
              type="button"
              class="artist-btn artist-btn--primary"
              @click="playAll(topSongs.data)"
            >
              <CaretRightOutlined />
              播放热门
            </button>
          </div>
        </div>
      </header>

      <div class="artist-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="artist-tab"
          :class="{ 'artist-tab--on': activeTab === tab.key }"
          @click="selectTab(tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="artist-panel">
        <!-- 热门 -->
        <template v-if="activeTab === 'top'">
          <div v-if="topSongs.loading" class="artist-state artist-state--panel">
            <a-spin tip="加载热门歌曲中..." />
          </div>
          <div
            v-else-if="topSongs.error"
            class="artist-state artist-state--col artist-state--panel"
          >
            <a-empty :description="topSongs.error.message" />
            <a-button size="small" @click="retryTab">重试</a-button>
          </div>
          <a-empty
            v-else-if="topSongs.data.length === 0"
            description="暂无热门歌曲"
            class="artist-state artist-state--panel"
          />
          <div v-else class="artist-list">
            <div class="artist-list__bar">
              <span class="artist-list__count">{{ topSongs.data.length }} 首</span>
              <button
                type="button"
                class="artist-btn artist-btn--ghost"
                @click="playAll(topSongs.data)"
              >
                <CaretRightOutlined class="shrink-0" />
                播放全部
              </button>
            </div>
            <SongListHeader :sticky="false" class="shrink-0" />
            <VirtualSongList :songs="topSongs.data" @play="(s) => playFrom(s, topSongs.data)" />
          </div>
        </template>

        <!-- 全部歌曲 -->
        <template v-else-if="activeTab === 'songs'">
          <div v-if="songs.loading" class="artist-state artist-state--panel">
            <a-spin tip="加载歌曲中..." />
          </div>
          <div v-else-if="songs.error" class="artist-state artist-state--col artist-state--panel">
            <a-empty :description="songs.error.message" />
            <a-button size="small" @click="retryTab">重试</a-button>
          </div>
          <a-empty
            v-else-if="songs.data.length === 0"
            description="暂无歌曲"
            class="artist-state artist-state--panel"
          />
          <div v-else class="artist-list">
            <div class="artist-list__bar">
              <span class="artist-list__count">{{ songs.data.length }} 首</span>
              <button
                type="button"
                class="artist-btn artist-btn--ghost"
                @click="playAll(songs.data)"
              >
                <CaretRightOutlined class="shrink-0" />
                播放全部
              </button>
            </div>
            <SongListHeader :sticky="false" class="shrink-0" />
            <VirtualSongList :songs="songs.data" @play="(s) => playFrom(s, songs.data)" />
          </div>
        </template>

        <!-- 专辑 -->
        <template v-else>
          <div v-if="albums.loading" class="artist-state artist-state--panel">
            <a-spin tip="加载专辑中..." />
          </div>
          <div v-else-if="albums.error" class="artist-state artist-state--col artist-state--panel">
            <a-empty :description="albums.error.message" />
            <a-button size="small" @click="retryTab">重试</a-button>
          </div>
          <a-empty
            v-else-if="albums.data.length === 0"
            description="暂无专辑"
            class="artist-state artist-state--panel"
          />
          <div v-else class="artist-albums">
            <RouterLink
              v-for="alb in albums.data"
              :key="alb.id"
              :to="`/album/${alb.id}`"
              class="artist-album"
            >
              <span class="artist-album__cover">
                <img
                  v-if="alb.coverUrl"
                  :src="coverThumb(alb.coverUrl, 280)"
                  :alt="alb.name"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                />
                <span v-else class="artist-album__ph">无封面</span>
              </span>
              <span class="artist-album__name" :title="alb.name">{{ alb.name }}</span>
            </RouterLink>
          </div>
        </template>
      </div>
    </template>
  </section>
</template>

<style scoped lang="scss" src="./artist-page.scss"></style>
