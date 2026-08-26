<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import PlaylistCard from '@/components/music/PlaylistCard.vue'
import { useCoverColor } from '@/composables/useCoverColor'
import { useUserStore } from '@/stores/user.store'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const activeTab = ref<'created' | 'subscribed'>('created')

const user = computed(() => userStore.user)

const heroColor = useCoverColor(() => user.value?.avatarUrl)
const heroBackground = computed(() => {
  const rgb = heroColor.value
  if (!rgb) return 'var(--color-primary)'
  return `rgb(${rgb})`
})

const createdPlaylists = computed(() =>
  userStore.playlists.filter((pl) => pl.creator.userId === user.value?.userId)
)

const subscribedPlaylists = computed(() =>
  userStore.playlists.filter((pl) => pl.creator.userId !== user.value?.userId)
)

const activeList = computed(() =>
  activeTab.value === 'created' ? createdPlaylists.value : subscribedPlaylists.value
)

function parseUid(): number {
  const raw = route.params.id
  const value = Array.isArray(raw) ? raw[0] : raw
  const uid = Number(value)
  return Number.isFinite(uid) ? uid : 0
}

function handleRetryUser(): void {
  const uid = parseUid()
  if (uid > 0) void userStore.loadUserDetail(uid)
}

function handleRetryPlaylists(): void {
  const uid = parseUid()
  if (uid > 0) void userStore.loadUserPlaylists(uid)
}

function openPlaylist(id: number): void {
  void router.push('/playlist/' + id)
}

function isLiked(specialType?: number): boolean {
  return specialType === 5
}

onMounted(() => {
  const uid = parseUid()
  if (uid > 0) {
    void userStore.loadUserDetail(uid)
    void userStore.loadUserPlaylists(uid)
  }
})

onUnmounted(() => {
  userStore.clear()
})
</script>

<template>
  <section class="user-page flex h-full min-h-0 flex-col">
    <div v-if="userStore.loading" class="flex flex-1 items-center justify-center">
      <a-spin tip="加载用户信息中..." />
    </div>
    <div v-else-if="userStore.error" class="flex flex-1 flex-col items-center justify-center gap-3">
      <a-empty :description="userStore.error.message" />
      <a-button size="small" @click="handleRetryUser">重试</a-button>
    </div>
    <template v-else-if="user">
      <header class="user-hero relative isolate shrink-0 overflow-hidden px-5 py-3">
        <div
          class="user-hero__visual pointer-events-none"
          aria-hidden="true"
          :style="{ background: heroBackground }"
        ></div>
        <div class="relative z-10 flex items-center gap-3.5">
          <div
            class="user-hero__avatar h-14 w-14 shrink-0 overflow-hidden rounded-full bg-[rgba(255,255,255,0.18)] ring-2 ring-white/25"
          >
            <img
              v-if="user.avatarUrl"
              :src="user.avatarUrl"
              :alt="user.nickname"
              class="h-full w-full object-cover"
              referrerpolicy="no-referrer"
            />
            <div
              v-else
              class="grid h-full w-full place-items-center text-xl font-semibold text-white"
            >
              {{ user.nickname.charAt(0).toUpperCase() }}
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <h1 class="user-hero__name truncate text-white">
              {{ user.nickname }}
            </h1>
            <div
              class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-white/80"
            >
              <span>创建 {{ createdPlaylists.length }} 个歌单</span>
              <span>收藏 {{ subscribedPlaylists.length }} 个</span>
            </div>
          </div>
        </div>
      </header>

      <div class="flex min-h-0 flex-1 flex-col px-4 pt-3 sm:px-5">
        <div class="user-tabs shrink-0">
          <button
            type="button"
            class="user-tab"
            :class="{ 'user-tab--active': activeTab === 'created' }"
            @click="activeTab = 'created'"
          >
            创建的歌单
            <span class="user-tab__count">{{ createdPlaylists.length }}</span>
          </button>
          <button
            type="button"
            class="user-tab"
            :class="{ 'user-tab--active': activeTab === 'subscribed' }"
            @click="activeTab = 'subscribed'"
          >
            收藏的歌单
            <span class="user-tab__count">{{ subscribedPlaylists.length }}</span>
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-6 pt-4">
          <div
            v-if="userStore.playlistsError"
            class="flex flex-col items-center justify-center gap-3 py-12"
          >
            <a-empty :description="userStore.playlistsError.message" />
            <a-button size="small" @click="handleRetryPlaylists">重试</a-button>
          </div>
          <div
            v-else-if="userStore.playlistsLoading && activeList.length === 0"
            class="flex justify-center py-16"
          >
            <a-spin tip="加载歌单中…" />
          </div>
          <a-empty
            v-else-if="activeList.length === 0"
            :description="activeTab === 'created' ? '还没有创建歌单' : '还没有收藏歌单'"
            class="py-16"
          />
          <div v-else class="user-grid">
            <PlaylistCard
              v-for="(item, index) in activeList"
              :key="item.id"
              :playlist="item"
              :liked="isLiked(item.specialType)"
              :subtitle="`${item.trackCount} 首`"
              :enter-delay-ms="Math.min(index, 12) * 36"
              @open="openPlaylist(item.id)"
            />
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped lang="scss">
.user-hero {
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

  &__name {
    margin: 0;
    font-size: 17px;
    font-weight: 780;
    letter-spacing: -0.02em;
    line-height: 1.2;
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
  }
}

.user-tabs {
  display: flex;
  gap: 6px;
  padding: 4px;
  border-radius: 14px;
  background: var(--color-control);
  width: fit-content;
  max-width: 100%;
}

.user-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 11px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;

  &:hover {
    color: var(--color-text-primary);
  }

  &__count {
    min-width: 1.25rem;
    padding: 0 5px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-border) 70%, transparent);
    color: var(--color-text-secondary);
    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
    text-align: center;
  }

  &--active {
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);

    .user-tab__count {
      background: color-mix(in srgb, var(--color-primary) 16%, transparent);
      color: var(--color-primary);
    }
  }
}

.user-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 1.25rem 1rem;
}
</style>
