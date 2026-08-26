<script setup lang="ts">
import { ref } from 'vue'
import { CaretRightOutlined, HeartFilled, LoadingOutlined } from '@ant-design/icons-vue'

import { getMessage } from '@/app/message-holder'
import { getPlaylistDetail } from '@/services/api/endpoints/playlist.api'
import { usePlayerStore } from '@/stores/player.store'
import type { Playlist } from '@/domain/playlist'

const props = withDefaults(
  defineProps<{
    playlist: Playlist
    /** 是否为「我喜欢的音乐」歌单（specialType === 5）。 */
    liked?: boolean
    /** 副标题；不传则显示「N 首」。 */
    subtitle?: string
    /** 入场错开延迟(ms)。 */
    enterDelayMs?: number
  }>(),
  {
    liked: false,
    subtitle: undefined,
    enterDelayMs: 0
  }
)

const emit = defineEmits<{
  open: []
}>()

const player = usePlayerStore()
const playing = ref(false)

/** 悬浮播放钮：拉取歌单 tracks 后播放（点击不冒泡到「打开歌单」）。 */
async function handlePlay(event: MouseEvent): Promise<void> {
  event.stopPropagation()
  if (playing.value) return
  const id = props.playlist.id
  if (!id) return
  playing.value = true
  try {
    const detail = await getPlaylistDetail(id)
    if (detail.tracks.length === 0) {
      getMessage().warning('该歌单暂无歌曲')
      return
    }
    player.playFromList(detail.tracks, 0, 'playlist', id)
  } catch (error) {
    getMessage().error(error instanceof Error ? error.message : '播放失败，请稍后重试')
  } finally {
    playing.value = false
  }
}

function metaText(): string {
  if (props.subtitle) return props.subtitle
  return `${props.playlist.trackCount} 首`
}
</script>

<template>
  <button
    type="button"
    class="playlist-card playlist-card--enter group flex w-full appearance-none flex-col border-0 bg-transparent p-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]"
    :style="{ '--card-enter-delay': `${Math.max(0, enterDelayMs)}ms` }"
    :aria-label="`打开歌单 ${playlist.name}`"
    @click="emit('open')"
  >
    <!-- 封面 -->
    <span
      class="playlist-card__cover relative block aspect-square w-full overflow-hidden rounded-2xl bg-[var(--color-bg-elevated)] shadow-[0_8px_24px_rgba(0,0,0,0.18)] ring-1 ring-black/5 transition-[box-shadow,transform] duration-300 ease-out group-hover:-translate-y-0.5 group-hover:shadow-[0_16px_36px_rgba(0,0,0,0.28)]"
    >
      <img
        v-if="playlist.coverUrl"
        :src="playlist.coverUrl"
        :alt="playlist.name"
        class="block h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]"
        referrerpolicy="no-referrer"
        loading="lazy"
        draggable="false"
      />
      <span
        v-else
        class="grid h-full w-full place-items-center bg-[var(--color-control)] text-xs text-text-secondary"
      >
        无封面
      </span>

      <!-- 悬浮渐变 -->
      <span
        class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        aria-hidden="true"
      />

      <!-- 我喜欢角标 -->
      <span
        v-if="liked"
        class="absolute left-2.5 top-2.5 z-[1] inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-md ring-1 ring-white/15"
      >
        <HeartFilled class="text-[10px] text-[#ff6b8a]" />
        我喜欢
      </span>

      <!-- 悬浮播放钮：点击直接播放歌单，不冒泡打开歌单页 -->
      <span
        class="playlist-card__play absolute bottom-3 right-3 z-[1] grid h-10 w-10 place-items-center rounded-full bg-[var(--color-primary)] text-white shadow-[0_8px_20px_rgba(0,0,0,0.35)] transition-all duration-300 ease-out"
        title="播放"
        @click.stop="handlePlay"
      >
        <LoadingOutlined v-if="playing" class="text-base" />
        <CaretRightOutlined v-else class="ml-0.5 text-base" />
      </span>
    </span>

    <!-- 文案 -->
    <span class="mt-2.5 flex min-w-0 flex-col gap-0.5 px-0.5">
      <span
        class="line-clamp-2 text-[13px] font-medium leading-snug text-text-primary transition-colors duration-200 group-hover:text-[var(--color-primary)]"
        :title="playlist.name"
      >
        {{ playlist.name }}
      </span>
      <span class="truncate text-xs text-text-secondary">{{ metaText() }}</span>
    </span>
  </button>
</template>

<style lang="scss" scoped>
.playlist-card {
  cursor: pointer;

  &--enter {
    animation: playlist-card-in 0.38s cubic-bezier(0.22, 1, 0.36, 1) both;
    animation-delay: var(--card-enter-delay, 0ms);
  }

  @keyframes playlist-card-in {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.98);
    }

    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  &__play {
    /* 播放钮默认下沉隐藏，悬浮时弹起 */
    opacity: 0;
    transform: translateY(10px) scale(0.86);
  }

  &:hover {
    .playlist-card__play {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  &:focus-visible {
    .playlist-card__play {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  &:active {
    .playlist-card__cover {
      transform: translateY(0) scale(0.99);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    &--enter {
      animation: none;
    }

    &__cover {
      transition: none;

      img {
        transition: none;
      }
    }

    &__play {
      transition: none;
      opacity: 1;
      transform: none;
    }

    &:hover .playlist-card__cover {
      transform: none;
    }
  }
}

.playlist-card {
  cursor: pointer;

  &__play {
    opacity: 0;
    transform: translateY(10px) scale(0.86);
  }

  &:active {
    .playlist-card__cover {
      transform: translateY(0) scale(0.99);
    }
  }

  &:hover .playlist-card__play,
  &:focus-visible .playlist-card__play {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  @media (prefers-reduced-motion: reduce) {
    &__cover,
    &__cover img,
    &__play {
      transition: none;
    }
    &:hover .playlist-card__cover {
      transform: none;
    }
    &__play {
      opacity: 1;
      transform: none;
    }
  }
}

.playlist-card--enter {
  animation: playlist-card-in 0.38s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--card-enter-delay, 0ms);

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
}

@keyframes playlist-card-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
