<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CaretRightOutlined, LoadingOutlined } from '@ant-design/icons-vue'

import { getMessage } from '@/app/message-holder'
import { getPlaylistDetail } from '@/services/api/endpoints/playlist.api'
import { usePlayerStore } from '@/stores/player.store'
import { useRankStore } from '@/stores/rank.store'
import type { RankItem } from '@/domain/rank'

const router = useRouter()
const rankStore = useRankStore()
const player = usePlayerStore()
const playingId = ref<number | null>(null)

const groupedItems = computed<Map<number, RankItem[]>>(() => {
  const map = new Map<number, RankItem[]>()
  for (const item of rankStore.items) {
    const list = map.get(item.groupId)
    if (list) list.push(item)
    else map.set(item.groupId, [item])
  }
  return map
})

const totalCount = computed(() => rankStore.items.length)

function handleCardClick(item: RankItem): void {
  void router.push(`/playlist/${item.id}`)
}

/** 悬浮播放钮：拉取榜单 tracks 后播放（点击不冒泡到「打开榜单」）。 */
async function handlePlay(item: RankItem): Promise<void> {
  if (playingId.value != null) return
  playingId.value = item.id
  try {
    const detail = await getPlaylistDetail(item.id)
    if (detail.tracks.length === 0) {
      getMessage().warning('该榜单暂无歌曲')
      return
    }
    player.playFromList(detail.tracks, 0, 'playlist', item.id)
  } catch (error) {
    getMessage().error(error instanceof Error ? error.message : '播放失败，请稍后重试')
  } finally {
    playingId.value = null
  }
}

function handleRetry(): void {
  rankStore.loaded = false
  void rankStore.loadRankList()
}

function coverThumb(url?: string, size = 300): string | undefined {
  if (!url) return undefined
  if (url.includes('param=')) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}param=${size}y${size}`
}

onMounted(() => {
  void rankStore.loadRankList()
})
</script>

<template>
  <section class="rank-page">
    <header class="rank-page__header">
      <h2 class="rank-page__title">排行榜</h2>
      <p class="rank-page__description">
        <template v-if="totalCount > 0">共 {{ totalCount }} 个榜单</template>
        <template v-else>网易云官方与全球媒体榜单</template>
      </p>
    </header>

    <div v-if="rankStore.loading" class="rank-state">
      <a-spin tip="加载排行榜中..." />
    </div>
    <div v-else-if="rankStore.error" class="rank-state rank-state--column">
      <a-empty :description="rankStore.error.message" />
      <a-button size="small" @click="handleRetry">重试</a-button>
    </div>
    <div v-else-if="rankStore.items.length === 0" class="rank-state">
      <a-empty description="暂无排行榜数据" />
    </div>
    <div v-else class="rank-page__body">
      <section
        v-for="(group, gIndex) in rankStore.groups"
        :key="group.id"
        class="rank-group"
        :style="{ '--g': gIndex }"
      >
        <header class="rank-group__header">
          <h3 class="rank-group__title">{{ group.name }}</h3>
          <span class="rank-group__count"
            >{{ groupedItems.get(group.id)?.length ?? 0 }} 个榜单</span
          >
        </header>
        <div class="rank-group__grid">
          <button
            v-for="(item, idx) in groupedItems.get(group.id)"
            :key="item.id"
            type="button"
            class="rank-card"
            :style="{ '--i': idx }"
            @click="handleCardClick(item)"
          >
            <img
              v-if="item.coverUrl"
              class="rank-card__cover"
              :src="coverThumb(item.coverUrl, 300) ?? ''"
              :alt="item.name"
              loading="lazy"
              referrerpolicy="no-referrer"
            />
            <span v-else class="rank-card__cover rank-card__cover--placeholder" aria-hidden="true"
              >榜</span
            >
            <span class="rank-card__overlay">
              <span class="rank-card__name" :title="item.name">{{ item.name }}</span>
              <span v-if="item.updateFrequency" class="rank-card__freq">{{
                item.updateFrequency
              }}</span>
            </span>
            <span class="rank-card__play" title="播放" @click.stop="handlePlay(item)">
              <LoadingOutlined v-if="playingId === item.id" />
              <CaretRightOutlined v-else />
            </span>
          </button>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped lang="scss">
.rank-page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;

  &__header {
    flex-shrink: 0;
    padding: 24px 24px 12px;
  }

  &__title {
    margin: 0;
    color: var(--color-text-primary);
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  &__description {
    margin: 6px 0 0;
    color: var(--color-text-muted);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }

  &__body {
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 4px 24px 40px;
  }
}

.rank-state {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 240px;

  &--column {
    flex-direction: column;
    gap: 12px;
  }
}

@keyframes rankGroupIn {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.rank-group {
  margin-bottom: 32px;
  animation: rankGroupIn 0.5s ease backwards;
  animation-delay: calc(var(--g, 0) * 70ms);

  &__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 0 4px 14px;
  }

  &__title {
    margin: 0;
    color: var(--color-text-primary);
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  &__count {
    color: var(--color-text-muted);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 18px;
  }
}

@keyframes rankCardIn {
  from {
    opacity: 0;
    transform: translateY(18px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.rank-card {
  position: relative;
  display: block;
  aspect-ratio: 1;
  padding: 0;
  border: 0;
  border-radius: 14px;
  overflow: hidden;
  background: var(--color-control);
  text-align: left;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
  animation: rankCardIn 0.55s cubic-bezier(0.22, 1, 0.36, 1) backwards;
  animation-delay: calc(var(--i, 0) * 45ms);
  transition:
    transform 0.3s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.3s ease;

  &:hover {
    transform: translateY(-5px);
    box-shadow:
      0 16px 30px rgba(0, 0, 0, 0.4),
      0 0 0 1px color-mix(in srgb, var(--color-primary) 35%, transparent);
  }

  &:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 2px var(--color-bg-primary),
      0 0 0 4px var(--color-primary);
  }

  &__cover {
    position: absolute;
    inset: 0;
    z-index: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scale(1.02);
    transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1);
  }

  &__cover--placeholder {
    display: grid;
    place-items: center;
    color: var(--color-text-muted);
    font-size: 20px;
    font-weight: 700;
    background: var(--color-control);
  }

  &:hover &__cover,
  &:focus-visible &__cover {
    transform: scale(1.09);
  }

  &__overlay {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 4px;
    padding: 12px;
    background: linear-gradient(
      to top,
      rgba(0, 0, 0, 0.85) 0%,
      rgba(0, 0, 0, 0.38) 45%,
      transparent 75%
    );
    pointer-events: none;
  }

  &__name {
    overflow: hidden;
    color: $color-white;
    font-size: 14.5px;
    font-weight: 650;
    line-height: 1.25;
    letter-spacing: -0.01em;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__freq {
    color: color-mix(in srgb, var(--color-primary) 78%, white);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
  }

  &__play {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 2;
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border-radius: 50%;
    background: var(--color-primary);
    color: $color-white;
    font-size: 13px;
    box-shadow: 0 6px 16px color-mix(in srgb, var(--color-primary) 45%, transparent);
    opacity: 0;
    transform: scale(0.8) translateY(-6px);
    transition:
      opacity 0.25s ease,
      transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
  }

  &:hover &__play,
  &:focus-visible &__play {
    opacity: 1;
    transform: scale(1) translateY(0);
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    transition: none;

    &__cover,
    &__play {
      transition: none;
    }

    &:hover {
      transform: none;
    }

    &:hover &__cover {
      transform: scale(1.02);
    }

    &:hover &__play {
      transform: none;
    }
  }
}
</style>
