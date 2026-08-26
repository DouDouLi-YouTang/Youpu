<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { CaretRightOutlined, HeartFilled } from '@ant-design/icons-vue'

import PlaylistCard from '@/components/music/PlaylistCard.vue'
import type { Playlist } from '@/domain/playlist'
import { useAuthStore } from '@/stores/auth.store'
import { useLibraryStore } from '@/stores/library.store'

const router = useRouter()
const auth = useAuthStore()
const libraryStore = useLibraryStore()

const playlists = computed(() => libraryStore.myPlaylists)
const uid = computed(() => auth.userId)

const likedPlaylist = computed(() => playlists.value.find((p) => p.specialType === 5) ?? null)

const createdPlaylists = computed(() => {
  const me = uid.value
  return playlists.value.filter(
    (p) => p.specialType !== 5 && (me == null || p.creator.userId === me)
  )
})

const collectedPlaylists = computed(() => {
  const me = uid.value
  if (me == null) return []
  return playlists.value.filter((p) => p.specialType !== 5 && p.creator.userId !== me)
})

const totalCount = computed(() => playlists.value.length)

function open(id: number): void {
  void router.push('/playlist/' + id)
}

function subtitleFor(pl: Playlist, kind: 'created' | 'collected'): string {
  if (kind === 'collected' && pl.creator?.nickname) {
    return `${pl.trackCount} 首 · ${pl.creator.nickname}`
  }
  return `${pl.trackCount} 首`
}

onMounted(() => {
  void libraryStore.loadMyPlaylists()
})
</script>

<template>
  <section class="library-page flex h-full min-h-0 flex-col gap-5 px-5 py-5">
    <header class="flex shrink-0 items-end justify-between gap-3">
      <div>
        <h2 class="text-2xl font-semibold tracking-tight text-text-primary">我的音乐</h2>
        <p class="mt-1 text-sm text-text-secondary">
          我创建和收藏的歌单
          <span v-if="totalCount > 0" class="text-[var(--color-text-muted)]">
            · {{ totalCount }} 个
          </span>
        </p>
      </div>
    </header>

    <div v-if="libraryStore.error" class="flex flex-1 flex-col items-center justify-center gap-3">
      <a-empty :description="libraryStore.error.message" />
      <a-button size="small" @click="libraryStore.loadMyPlaylists(true)">重试</a-button>
    </div>

    <div
      v-else-if="libraryStore.loading && playlists.length === 0"
      class="flex flex-1 items-center justify-center"
    >
      <a-spin tip="加载歌单中…" />
    </div>

    <div v-else-if="playlists.length === 0" class="flex flex-1 items-center justify-center">
      <a-empty description="还没有歌单" />
    </div>

    <div v-else class="library-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
      <!-- 红心歌单大卡 -->
      <div v-if="likedPlaylist" class="mb-8">
        <button
          type="button"
          class="liked-hero group relative flex w-full max-w-xl appearance-none overflow-hidden rounded-3xl border-0 p-0 text-left shadow-[0_12px_40px_rgba(0,0,0,0.22)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          :aria-label="`打开歌单 ${likedPlaylist.name}`"
          @click="open(likedPlaylist.id)"
        >
          <span class="relative block h-36 w-36 shrink-0 sm:h-40 sm:w-40">
            <img
              v-if="likedPlaylist.coverUrl"
              :src="likedPlaylist.coverUrl"
              :alt="likedPlaylist.name"
              class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              referrerpolicy="no-referrer"
              loading="lazy"
            />
            <span
              v-else
              class="grid h-full w-full place-items-center bg-[var(--color-control)] text-sm text-text-secondary"
            >
              <HeartFilled class="text-2xl text-[#ff6b8a]" />
            </span>
          </span>
          <span
            class="liked-hero__body relative z-[1] flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-5 py-4 pr-16"
          >
            <span
              class="inline-flex w-fit items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/90 ring-1 ring-white/15 backdrop-blur-sm"
            >
              <HeartFilled class="text-[10px] text-[#ff6b8a]" />
              红心歌单
            </span>
            <span class="truncate text-xl font-semibold tracking-tight text-white sm:text-2xl">
              {{ likedPlaylist.name }}
            </span>
            <span class="text-sm text-white/70">{{ likedPlaylist.trackCount }} 首歌曲</span>
          </span>
          <span
            class="liked-hero__play absolute bottom-4 right-4 z-[1] grid h-11 w-11 place-items-center rounded-full bg-white text-[var(--color-primary)] shadow-lg transition-transform duration-200 group-hover:scale-105"
            aria-hidden="true"
          >
            <CaretRightOutlined class="ml-0.5 text-lg" />
          </span>
        </button>
      </div>

      <!-- 创建的歌单 -->
      <section v-if="createdPlaylists.length > 0" class="mb-8">
        <div class="mb-3 flex items-baseline justify-between gap-2">
          <h3 class="text-base font-semibold text-text-primary">创建的歌单</h3>
          <span class="text-xs text-text-secondary">{{ createdPlaylists.length }} 个</span>
        </div>
        <div class="library-grid">
          <PlaylistCard
            v-for="(pl, index) in createdPlaylists"
            :key="pl.id"
            :playlist="pl"
            :subtitle="subtitleFor(pl, 'created')"
            :enter-delay-ms="Math.min(index, 12) * 36"
            @open="open(pl.id)"
          />
        </div>
      </section>

      <!-- 收藏的歌单 -->
      <section v-if="collectedPlaylists.length > 0" class="mb-4">
        <div class="mb-3 flex items-baseline justify-between gap-2">
          <h3 class="text-base font-semibold text-text-primary">收藏的歌单</h3>
          <span class="text-xs text-text-secondary">{{ collectedPlaylists.length }} 个</span>
        </div>
        <div class="library-grid">
          <PlaylistCard
            v-for="(pl, index) in collectedPlaylists"
            :key="pl.id"
            :playlist="pl"
            :subtitle="subtitleFor(pl, 'collected')"
            :enter-delay-ms="Math.min(index, 12) * 36"
            @open="open(pl.id)"
          />
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped lang="scss">
.library-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 1.25rem 1rem;
}

// 红心大卡：用封面取色感的暗底 + 主题色晕染
.liked-hero {
  background: radial-gradient(
    120% 140% at 0% 50%,
    color-mix(in srgb, var(--color-primary) 55%, #1a1018) 0%,
    color-mix(in srgb, var(--color-primary) 18%, #14161a) 48%,
    #121418 100%
  );
  transition:
    transform 0.25s ease,
    box-shadow 0.25s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
  }

  &:active {
    transform: translateY(0);
  }

  @media (prefers-reduced-motion: reduce) {
    &,
    img {
      transition: none;
    }

    &:hover {
      transform: none;
    }
  }
}
</style>
