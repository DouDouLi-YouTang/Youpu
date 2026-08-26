<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'

import SongListHeader from '@/components/music/SongListHeader.vue'
import VirtualSongList from '@/components/music/VirtualSongList.vue'
import { usePlayerStore } from '@/stores/player.store'
import { useSearchStore } from '@/stores/search.store'

const route = useRoute()
const searchStore = useSearchStore()
const playerStore = usePlayerStore()
const results = computed(() => searchStore.results)

watch(
  () => route.query.q,
  (keyword) => {
    if (typeof keyword === 'string' && keyword.trim()) {
      void searchStore.search(keyword)
    }
  },
  { immediate: true }
)

function handleRetry(): void {
  void searchStore.search(searchStore.keyword)
}

function handlePlay(song: (typeof searchStore.results)[number]): void {
  const index = searchStore.results.findIndex((item) => item.id === song.id)
  if (index < 0) return
  playerStore.playFromList(searchStore.results, index, 'search')
}

function loadMore(): void {
  void searchStore.loadMore()
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-4 px-4 py-4">
    <header class="shrink-0 text-center">
      <p class="text-xs text-text-secondary">搜索</p>
      <h2 class="mt-1 truncate text-2xl font-semibold tracking-tight text-text-primary">
        <template v-if="searchStore.keyword">“{{ searchStore.keyword }}”</template>
        <template v-else>在顶部搜索框输入关键词开始搜索</template>
      </h2>
    </header>

    <div v-if="searchStore.loading" class="flex flex-1 items-center justify-center">
      <a-spin tip="搜索中..." />
    </div>

    <div
      v-else-if="searchStore.error"
      class="flex flex-1 flex-col items-center justify-center gap-3"
    >
      <a-empty :description="searchStore.error.message" />
      <a-button size="small" @click="handleRetry">重试</a-button>
    </div>

    <a-empty
      v-else-if="results.length === 0 && searchStore.keyword === ''"
      description="输入关键词开始搜索"
      class="flex flex-1 items-center justify-center"
    />

    <a-empty
      v-else-if="results.length === 0"
      description="没有找到相关结果"
      class="flex flex-1 items-center justify-center"
    />

    <div v-else class="flex min-h-0 flex-1 flex-col">
      <SongListHeader :sticky="false" class="shrink-0" />
      <VirtualSongList :songs="results" @reach-end="loadMore" @play="handlePlay">
        <template #footer>
          <div v-if="searchStore.loadingMore" class="flex justify-center py-3">
            <a-spin size="small" />
          </div>
          <div
            v-else-if="!searchStore.hasMore && results.length > 0"
            class="py-3 text-center text-xs text-text-secondary"
          >
            已加载全部
          </div>
        </template>
      </VirtualSongList>
    </div>
  </section>
</template>
