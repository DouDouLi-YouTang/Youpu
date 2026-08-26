<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { CaretRightOutlined, HistoryOutlined } from '@ant-design/icons-vue'
import { Modal } from 'ant-design-vue'

import SongListHeader from '@/components/music/SongListHeader.vue'
import VirtualSongList from '@/components/music/VirtualSongList.vue'
import { useCoverColor } from '@/composables/useCoverColor'
import { useAuthStore } from '@/stores/auth.store'
import { usePlaybackHistoryStore } from '@/stores/playback-history.store'
import { usePlayerStore } from '@/stores/player.store'
import type { Song } from '@/domain/song'

const historyStore = usePlaybackHistoryStore()
const playerStore = usePlayerStore()
const authStore = useAuthStore()

const songs = computed(() => historyStore.items)
const isGuest = computed(() => !authStore.isLoggedIn)

const firstCover = computed(() => {
  for (const s of songs.value) {
    if (s.coverUrl) return s.coverUrl
  }
  return undefined
})

const heroColor = useCoverColor(firstCover)
const heroBackground = computed(() => {
  const rgb = heroColor.value
  if (!rgb) return 'var(--color-primary)'
  return `rgb(${rgb})`
})

function handlePlay(song: Song): void {
  const list = songs.value
  const index = list.findIndex((s) => s.id === song.id)
  if (index < 0) return
  playerStore.playFromList(list, index, 'history')
}

function playAll(): void {
  if (songs.value.length === 0) return
  playerStore.playFromList(songs.value, 0, 'history')
}

function handleClear(): void {
  Modal.confirm({
    title: '清空播放历史',
    content: '确定清空全部最近播放记录吗？此操作不可撤销。',
    okText: '清空',
    okType: 'danger',
    cancelText: '取消',
    centered: true,
    onOk: () => historyStore.clear()
  })
}

onMounted(() => {
  historyStore.load()
})
</script>

<template>
  <section class="history-page">
    <header class="history-hero">
      <div
        class="history-hero__visual"
        aria-hidden="true"
        :style="{ background: heroBackground }"
      ></div>
      <div class="history-hero__body">
        <div class="history-hero__icon">
          <HistoryOutlined />
        </div>
        <div class="min-w-0 flex-1">
          <h1 class="history-hero__title">最近播放</h1>
          <p class="history-hero__desc">
            <template v-if="isGuest">游客模式 · 登录后可按账号保存历史</template>
            <template v-else-if="songs.length > 0">共 {{ songs.length }} 首</template>
            <template v-else>还没有播放记录</template>
          </p>
        </div>
        <div class="history-hero__actions">
          <button
            v-if="songs.length > 0"
            type="button"
            class="history-btn history-btn--primary"
            @click="playAll"
          >
            <CaretRightOutlined />
            播放全部
          </button>
          <button
            v-if="songs.length > 0"
            type="button"
            class="history-btn history-btn--ghost"
            @click="handleClear"
          >
            清空
          </button>
        </div>
      </div>
    </header>

    <div class="history-body">
      <template v-if="songs.length > 0">
        <SongListHeader :sticky="false" class="shrink-0" />
        <VirtualSongList :songs="songs" @play="handlePlay" />
      </template>
      <div v-else class="history-empty">
        <a-empty description="播放歌曲后会出现在这里" />
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.history-page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.history-hero {
  position: relative;
  isolation: isolate;
  flex-shrink: 0;
  overflow: hidden;
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border);

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

  &__body {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &__icon {
    display: grid;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    place-items: center;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.16);
    color: $color-white;
    font-size: 20px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.24);
    backdrop-filter: blur(10px);
  }

  &__title {
    margin: 0;
    color: $color-white;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.2;
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
  }

  &__desc {
    margin: 2px 0 0;
    color: rgba(255, 255, 255, 0.85);
    font-size: 11.5px;
  }

  &__actions {
    display: flex;
    flex-shrink: 0;
    gap: 6px;
  }
}

.history-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition:
    filter 0.15s ease,
    background-color 0.15s ease,
    transform 0.1s ease;

  &--primary {
    background: $color-white;
    color: #111;

    &:hover {
      filter: brightness(0.95);
    }
  }

  &--ghost {
    background: rgba(255, 255, 255, 0.16);
    color: rgba(255, 255, 255, 0.9);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.24);
    backdrop-filter: blur(10px);

    &:hover {
      background: rgba(255, 255, 255, 0.26);
    }
  }

  &:active {
    transform: scale(0.97);
  }
}

.history-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 8px 12px 16px;
}

.history-empty {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 240px;
}
</style>

<style scoped lang="scss" src="./history-page.scss"></style>
