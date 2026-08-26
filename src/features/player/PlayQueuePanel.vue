<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CloseOutlined, DeleteOutlined, SoundOutlined } from '@ant-design/icons-vue'

import type { QueueItem, QueueSource } from '@/domain/player'
import { usePlayerStore } from '@/stores/player.store'
import { formatDuration } from '@/utils/format'

/**
 * 播放队列「曲目甲板」：从底栏队列按钮上浮的浮层，不是侧边抽屉。
 * 设计：
 * - 顶部：下一站封面轨（横滑）——快速预览/跳转后续几首
 * - 主体：紧凑列表，点击即切歌，悬停显示删除
 * - 遮罩点击 / Esc 关闭
 */
const visible = defineModel<boolean>('visible', { default: false })

const player = usePlayerStore()
const panelRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

const queue = computed(() => player.queue)
const currentIndex = computed(() => player.currentIndex)
const queueCount = computed(() => queue.value.length)
const canClear = computed(() => queueCount.value > 0)

/** 封面轨：当前 + 后续（最多 16），视觉快切 */
const deckItems = computed(() => {
  const list = queue.value
  if (list.length === 0) return [] as { item: QueueItem; index: number }[]
  const start = Math.max(0, currentIndex.value)
  const slice = list.slice(start, start + 16)
  return slice.map((item, i) => ({ item, index: start + i }))
})

const remainingCount = computed(() => {
  if (currentIndex.value < 0) return queueCount.value
  return Math.max(0, queueCount.value - currentIndex.value - 1)
})

function handlePlay(index: number): void {
  player.playAt(index)
}

function handleRemove(index: number): void {
  player.removeFromQueue(index)
}

function handleClear(): void {
  player.clearQueue()
  visible.value = false
}

function close(): void {
  visible.value = false
}

function sourceLabel(source: QueueSource): string {
  switch (source) {
    case 'search':
      return '搜索'
    case 'playlist':
      return '歌单'
    case 'album':
      return '专辑'
    case 'artist':
      return '歌手'
    case 'daily':
      return '每日'
    case 'fm':
      return 'FM'
    case 'download':
      return '本地'
    case 'song':
    case 'manual':
      return '手动'
    default:
      return '队列'
  }
}

function artistsText(item: QueueItem): string {
  const names = item.song.artists.map((a) => a.name).filter(Boolean)
  return names.length > 0 ? names.join(' / ') : '未知歌手'
}

function thumbUrl(url?: string): string | undefined {
  if (!url) return undefined
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}param=96y96`
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && visible.value) {
    e.preventDefault()
    close()
  }
}

function onDocPointer(e: MouseEvent): void {
  if (!visible.value) return
  const t = e.target as Node | null
  if (!t) return
  // 点在面板或触发按钮内不关
  if (panelRef.value?.contains(t)) return
  const btn = (t as HTMLElement).closest?.('[data-queue-trigger]')
  if (btn) return
  close()
}

watch(visible, async (open) => {
  if (!open) return
  await nextTick()
  // 打开后滚到当前曲
  const el = listRef.value?.querySelector('[data-current="1"]') as HTMLElement | null
  el?.scrollIntoView({ block: 'nearest' })
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('mousedown', onDocPointer, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousedown', onDocPointer, true)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="queue-deck">
      <div v-if="visible" ref="panelRef" class="queue-deck" role="dialog" aria-label="播放队列">
        <!-- 顶栏 -->
        <header class="queue-deck__head">
          <div class="min-w-0">
            <h3 class="queue-deck__title">播放队列</h3>
            <p class="queue-deck__sub">
              <template v-if="queueCount > 0">
                {{ queueCount }} 首 · 还剩 {{ remainingCount }} 首
              </template>
              <template v-else>队列空空，点歌后会出现在这里</template>
            </p>
          </div>
          <div class="queue-deck__head-actions">
            <button v-if="canClear" type="button" class="queue-deck__ghost" @click="handleClear">
              清空
            </button>
            <button type="button" class="queue-deck__close" aria-label="关闭" @click="close">
              <CloseOutlined />
            </button>
          </div>
        </header>

        <!-- 下一站：封面轨 -->
        <div v-if="deckItems.length > 0" class="queue-deck__rail-wrap">
          <div class="queue-deck__rail-label">下一站</div>
          <div class="queue-deck__rail">
            <button
              v-for="{ item, index } in deckItems"
              :key="`deck-${item.uid}`"
              type="button"
              class="queue-deck__tile"
              :class="{ 'queue-deck__tile--now': index === currentIndex }"
              :title="item.song.name"
              @click="handlePlay(index)"
            >
              <img
                v-if="thumbUrl(item.song.coverUrl)"
                :src="thumbUrl(item.song.coverUrl)"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
                class="queue-deck__tile-img"
              />
              <span v-else class="queue-deck__tile-placeholder">♪</span>
              <span v-if="index === currentIndex" class="queue-deck__tile-live">
                <SoundOutlined />
              </span>
              <span class="queue-deck__tile-name">{{ item.song.name }}</span>
            </button>
          </div>
        </div>

        <!-- 列表 -->
        <div ref="listRef" class="queue-deck__list">
          <div v-if="queueCount === 0" class="queue-deck__empty">还没有待播歌曲</div>
          <button
            v-for="(item, index) in queue"
            :key="item.uid"
            type="button"
            class="queue-deck__row"
            :class="{ 'queue-deck__row--now': index === currentIndex }"
            :data-current="index === currentIndex ? '1' : undefined"
            @click="handlePlay(index)"
          >
            <span class="queue-deck__index">
              <SoundOutlined v-if="index === currentIndex" />
              <template v-else>{{ index + 1 }}</template>
            </span>
            <span class="queue-deck__cover">
              <img
                v-if="thumbUrl(item.song.coverUrl)"
                :src="thumbUrl(item.song.coverUrl)"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
              />
              <span v-else>♪</span>
            </span>
            <span class="queue-deck__meta">
              <span class="queue-deck__name">{{ item.song.name }}</span>
              <span class="queue-deck__artist">
                {{ artistsText(item) }}
                <span class="queue-deck__source">· {{ sourceLabel(item.source) }}</span>
              </span>
            </span>
            <span class="queue-deck__duration">{{
              formatDuration(item.song.durationMs || 0)
            }}</span>
            <span
              class="queue-deck__remove"
              role="button"
              tabindex="0"
              :aria-label="`移除 ${item.song.name}`"
              @click.stop="handleRemove(index)"
              @keydown.enter.stop="handleRemove(index)"
            >
              <DeleteOutlined />
            </span>
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.queue-deck {
  position: fixed;
  right: 16px;
  bottom: 100px;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  width: min(380px, calc(100vw - 32px));
  max-height: min(62vh, 560px);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-border) 90%, transparent);
  border-radius: 18px;
  background: linear-gradient(
    165deg,
    color-mix(in srgb, var(--color-primary) 8%, var(--color-bg-elevated)) 0%,
    var(--color-bg-elevated) 42%
  );
  box-shadow:
    0 18px 50px rgba(0, 0, 0, 0.28),
    0 0 0 1px color-mix(in srgb, var(--color-border) 40%, transparent);
  backdrop-filter: blur(18px) saturate(1.15);

  &__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-shrink: 0;
    padding: 14px 14px 10px;
  }

  &__title {
    margin: 0;
    color: var(--color-text-primary);
    font-size: 15px;
    font-weight: 750;
    letter-spacing: -0.02em;
  }

  &__sub {
    margin: 3px 0 0;
    color: var(--color-text-muted);
    font-size: 11.5px;
  }

  &__head-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  &__ghost {
    height: 28px;
    padding: 0 10px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 12px;
    cursor: pointer;

    &:hover {
      background: var(--color-control);
      color: $color-danger;
    }
  }

  &__close {
    display: grid;
    width: 30px;
    height: 30px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;

    &:hover {
      background: var(--color-control);
      color: var(--color-text-primary);
    }
  }

  &__rail-wrap {
    /* —— 封面轨 —— */
    flex-shrink: 0;
    padding: 0 0 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
  }

  &__rail-label {
    padding: 0 14px 8px;
    color: var(--color-text-muted);
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  &__rail {
    display: flex;
    gap: 10px;
    padding: 0 14px 2px;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  &__tile {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    width: 72px;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;

    &--now .queue-deck__tile-name {
      color: var(--color-primary);
      font-weight: 600;
    }
  }

  &__tile-placeholder {
    display: grid;
    place-items: center;
    background: var(--color-control);
    color: var(--color-text-muted);
    font-size: 18px;
  }

  &__tile-live {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    border-radius: 50%;
    background: var(--color-primary);
    color: $color-white;
    font-size: 11px;
  }

  &__tile-name {
    display: block;
    margin-top: 6px;
    overflow: hidden;
    color: var(--color-text-secondary);
    font-size: 11px;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__list {
    /* —— 列表 —— */
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 6px 8px 10px;
  }

  &__empty {
    padding: 36px 12px;
    color: var(--color-text-muted);
    font-size: 13px;
    text-align: center;
  }

  &__row {
    display: grid;
    grid-template-columns: 28px 40px minmax(0, 1fr) auto 28px;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 6px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.12s ease;

    &:hover {
      background: color-mix(in srgb, var(--color-control) 88%, transparent);
    }

    &--now {
      background: color-mix(in srgb, var(--color-primary) 12%, transparent);

      .queue-deck__index {
        color: var(--color-primary);
      }

      .queue-deck__name {
        color: var(--color-primary);
      }
    }
  }

  &__index {
    display: grid;
    place-items: center;
    color: var(--color-text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  &__cover {
    width: 40px;
    height: 40px;
    overflow: hidden;
    border-radius: 8px;
    background: var(--color-control);

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    span {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      color: var(--color-text-muted);
      font-size: 12px;
    }
  }

  &__meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__name {
    overflow: hidden;
    color: var(--color-text-primary);
    font-size: 13px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__artist {
    overflow: hidden;
    color: var(--color-text-muted);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__source {
    opacity: 0.85;
  }

  &__duration {
    color: var(--color-text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  &__remove {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border-radius: 8px;
    color: var(--color-text-muted);
    opacity: 0;
    transition:
      opacity 0.12s ease,
      background-color 0.12s ease,
      color 0.12s ease;

    &:hover {
      background: color-mix(in srgb, $color-danger 12%, transparent);
      color: $color-danger;
    }
  }

  &__tile-img {
    display: block;
    width: 72px;
    height: 72px;
    border-radius: 12px;
    object-fit: cover;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
    transition: transform 0.18s ease;
  }

  &__tile-placeholder {
    display: grid;
    place-items: center;
    width: 72px;
    height: 72px;
    border-radius: 12px;
    object-fit: cover;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
    transition: transform 0.18s ease;
  }

  &__tile:hover .queue-deck__tile-img {
    transform: translateY(-2px) scale(1.03);
  }

  &__tile:hover .queue-deck__tile-placeholder {
    transform: translateY(-2px) scale(1.03);
  }

  &__tile--now .queue-deck__tile-img {
    box-shadow:
      0 0 0 2px var(--color-primary),
      0 8px 18px color-mix(in srgb, var(--color-primary) 35%, transparent);
  }

  &__tile--now .queue-deck__tile-placeholder {
    box-shadow:
      0 0 0 2px var(--color-primary),
      0 8px 18px color-mix(in srgb, var(--color-primary) 35%, transparent);
  }

  &__row:hover .queue-deck__remove {
    opacity: 1;
  }

  &__row:focus-within .queue-deck__remove {
    opacity: 1;
  }
}

.queue-deck-enter-active {
  /* 入场：从底栏上浮 */
  transition:
    opacity 0.2s ease,
    transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);

  @media (prefers-reduced-motion: reduce) {
    transition: opacity 0.15s ease;
  }
}

.queue-deck-leave-active {
  /* 入场：从底栏上浮 */
  transition:
    opacity 0.2s ease,
    transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);

  @media (prefers-reduced-motion: reduce) {
    transition: opacity 0.15s ease;
  }
}

.queue-deck-enter-from {
  opacity: 0;
  transform: translateY(16px) scale(0.98);

  @media (prefers-reduced-motion: reduce) {
    transform: none;
  }
}

.queue-deck-leave-to {
  opacity: 0;
  transform: translateY(16px) scale(0.98);

  @media (prefers-reduced-motion: reduce) {
    transform: none;
  }
}
</style>

<!-- package-0.1.21 拆分族（queue-deck）：追加在上方旧块之后，同特异性下 cascade 后者赢，压住旧内联 -->
<style scoped lang="scss" src="./queue-deck.scss"></style>
