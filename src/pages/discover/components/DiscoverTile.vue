<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { CaretRightOutlined } from '@ant-design/icons-vue'

import { getPlaylistDetail } from '@/services/api/endpoints/playlist.api'
import { usePlayerStore } from '@/stores/player.store'
import type { Song } from '@/domain/song'
import type { Playlist } from '@/domain/playlist'

const EXPANDED_W = 360
const EXPANDED_H = 202.5
const DEFAULT_H = 168
/** 与 CSS 收起过渡时长对齐,兜底降级。 */
const COLLAPSE_MS = 560
/** 悬停多久后才展开,避免快速划过触发多卡层级竞争。 */
const ENTER_DELAY = 400
/**
 * 模块级递增 z-index。
 * 快速在多张卡之间切换时,后 hover 的卡必须压过仍在收起的前一张;
 * 固定 z-index 会导致两张同层,按 DOM 顺序叠,后展开的会被挡住。
 */
let stackSeq = 50

const props = defineProps<{ playlist: Playlist; x: number; y: number; w: number }>()
const emit = defineEmits<{ open: [] }>()

const player = usePlayerStore()
const tracks = ref<Song[]>([])
const loading = ref(false)
const expanded = ref(false)
/** 贴右边缘时向左展开,避免撑出横向滚动条。 */
const expandLeft = ref(false)
/** 展开/收起全程保持抬升;收起动画结束后再降,避免被邻卡挡住。 */
const elevating = ref(false)
/** 本次抬升使用的 z-index(每次 enter 递增)。 */
const stackZ = ref(0)
/** 根元素引用,供延迟展开回调内读取父容器宽度。 */
const rootEl = ref<HTMLElement | null>(null)

const displayTracks = computed(() => tracks.value.slice(0, 6))

const rootStyle = computed(() => {
  const style: Record<string, string> = expanded.value
    ? {
        left: (expandLeft.value ? Math.max(0, props.x + props.w - EXPANDED_W) : props.x) + 'px',
        top: props.y - 4 + 'px',
        width: EXPANDED_W + 'px',
        height: EXPANDED_H + 'px'
      }
    : {
        left: props.x + 'px',
        top: props.y + 'px',
        width: props.w + 'px',
        height: DEFAULT_H + 'px'
      }
  if (elevating.value) style.zIndex = String(stackZ.value)
  return style
})

/** 模块级缓存:同一歌单详情只请求一次。 */
const detailCache = new Map<number, Song[]>()

let collapseTimer: ReturnType<typeof setTimeout> | null = null
let enterTimer: ReturnType<typeof setTimeout> | null = null

function clearCollapseTimer(): void {
  if (collapseTimer) {
    clearTimeout(collapseTimer)
    collapseTimer = null
  }
}

function clearEnterTimer(): void {
  if (enterTimer) {
    clearTimeout(enterTimer)
    enterTimer = null
  }
}

function endElevate(): void {
  elevating.value = false
  collapseTimer = null
}

function loadTracks(): void {
  const id = props.playlist.id
  if (detailCache.has(id)) {
    tracks.value = detailCache.get(id)!
    return
  }
  if (loading.value) return
  loading.value = true
  getPlaylistDetail(id)
    .then((p) => {
      tracks.value = p.tracks
      detailCache.set(id, p.tracks)
    })
    .catch(() => {
      tracks.value = []
    })
    .finally(() => {
      loading.value = false
    })
}

function expand(): void {
  enterTimer = null
  const el = rootEl.value
  const parent = el?.offsetParent as HTMLElement | null
  const parentW = parent?.clientWidth ?? Number.POSITIVE_INFINITY
  expandLeft.value = props.x + EXPANDED_W > parentW
  // 每次 hover 拿更高 z-index,压过仍在收起的前一张
  stackZ.value = ++stackSeq
  elevating.value = true
  expanded.value = true
  loadTracks()
}

function onEnter(): void {
  clearEnterTimer()
  clearCollapseTimer()
  // 悬停满 1s 才展开,避免快速划过触发竞争
  enterTimer = setTimeout(expand, ENTER_DELAY)
}

function onLeave(): void {
  clearEnterTimer()
  // 未展开且未抬升(纯延迟期)直接走,无需收起
  if (!expanded.value && !elevating.value) return
  expanded.value = false
  clearCollapseTimer()
  collapseTimer = setTimeout(endElevate, COLLAPSE_MS)
}

function onTransitionEnd(e: TransitionEvent): void {
  // 只认根节点 width 过渡结束;收起时立即降级(早于兜底定时器)
  if (e.target !== e.currentTarget || e.propertyName !== 'width') return
  if (!expanded.value) {
    clearCollapseTimer()
    endElevate()
  }
}

function play(index: number): void {
  if (tracks.value.length === 0) return
  player.playFromList(tracks.value, index, 'playlist', props.playlist.id)
}

function playAll(): void {
  if (tracks.value.length === 0) return
  player.playFromList(tracks.value, 0, 'playlist', props.playlist.id)
}

onBeforeUnmount(() => {
  clearEnterTimer()
  clearCollapseTimer()
})
</script>

<template>
  <button
    ref="rootEl"
    type="button"
    class="discover-tile absolute appearance-none overflow-hidden rounded-[14px] border-0 p-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
    :class="{ 'is-expanded': expanded }"
    :style="rootStyle"
    @click="emit('open')"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @transitionend="onTransitionEnd"
  >
    <!-- 封面:默认铺满,展开时收缩到左侧 -->
    <div class="discover-tile__cover">
      <img
        v-if="playlist.coverUrl"
        :src="playlist.coverUrl"
        :alt="playlist.name"
        class="h-full w-full object-cover"
        referrerpolicy="no-referrer"
        loading="lazy"
        draggable="false"
      />
      <div
        v-else
        class="grid h-full w-full place-items-center bg-gradient-to-br from-[var(--color-control)] to-[var(--color-bg-elevated)] text-sm text-text-muted"
      >
        无封面
      </div>
    </div>

    <!-- 默认底部信息(收起态) -->
    <div class="discover-tile__meta">
      <p
        class="line-clamp-1 text-[13px] font-semibold leading-tight text-white drop-shadow"
        :title="playlist.name"
      >
        {{ playlist.name }}
      </p>
      <p class="mt-0.5 text-[11px] leading-tight text-white/70">{{ playlist.trackCount }} 首</p>
    </div>

    <!-- 展开面板:右侧歌曲 + 顶部播放全部,背景为封面高斯模糊 -->
    <div class="discover-tile__panel" @click.stop>
      <img
        v-if="playlist.coverUrl"
        :src="playlist.coverUrl"
        class="discover-tile__panel-bg"
        referrerpolicy="no-referrer"
        draggable="false"
        aria-hidden="true"
      />
      <div class="discover-tile__panel-inner">
        <div class="discover-tile__panel-head">
          <p
            class="min-w-0 flex-1 truncate text-[12px] font-semibold text-white"
            :title="playlist.name"
          >
            {{ playlist.name }}
          </p>
          <div
            role="button"
            tabindex="0"
            class="discover-tile__play-all"
            title="播放全部"
            :aria-disabled="tracks.length === 0"
            @click.stop="playAll"
            @keydown.enter.stop.prevent="playAll"
          >
            <CaretRightOutlined class="text-[12px]" />
            <span>播放</span>
          </div>
        </div>

        <p v-if="loading" class="px-2.5 text-[11px] text-white/55">加载中…</p>
        <p v-else-if="displayTracks.length === 0" class="px-2.5 text-[11px] text-white/55">
          暂无歌曲
        </p>
        <div v-else class="discover-tile__tracks">
          <div
            v-for="(song, i) in displayTracks"
            :key="song.id"
            role="button"
            tabindex="0"
            class="discover-tile__track"
            :title="song.name"
            @click.stop="play(i)"
            @keydown.enter.stop.prevent="play(i)"
          >
            <span class="w-3 shrink-0 text-white/40">{{ i + 1 }}</span>
            <span class="truncate">{{ song.name }}</span>
          </div>
        </div>
      </div>
    </div>
  </button>
</template>

<style lang="scss" scoped>
/* 默认 120×168 竖卡;展开为 360×202.5 (16:9) 横卡。
 * 尺寸/位置/阴影过渡常驻——GSAP 入场只用 transform/opacity/visibility,
 * 不碰这些属性,故无冲突;也避免 class 与尺寸同帧切换导致 transition 失灵。
 * 上浮用 top 偏移而非 transform,把 transform 完全留给 GSAP。 */
.discover-tile {
  z-index: 10;
  cursor: pointer;
  background: var(--color-bg-elevated);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  transition:
    left 0.55s cubic-bezier(0.22, 1, 0.36, 1),
    top 0.55s cubic-bezier(0.22, 1, 0.36, 1),
    width 0.55s cubic-bezier(0.22, 1, 0.36, 1),
    height 0.55s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.55s cubic-bezier(0.22, 1, 0.36, 1);

  &__cover {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    transition:
      inset 0.55s cubic-bezier(0.22, 1, 0.36, 1),
      width 0.55s cubic-bezier(0.22, 1, 0.36, 1);

    img {
      transition: transform 0.7s ease-out;
    }
  }

  &__meta {
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 2.5rem 0.625rem 0.625rem;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.35), transparent);
    pointer-events: none;
    opacity: 1;
    transition: opacity 0.35s ease;
  }

  &__panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 140px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    /* 无封面时的兜底底色 */
    background: var(--color-bg-primary);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.4s ease 0.12s;
  }

  /* 封面高斯模糊背景:放大+压暗,保证边缘不透、文字可读 */
  &__panel-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: blur(22px) brightness(0.5);
    transform: scale(1.18);
    pointer-events: none;
  }

  &__panel-inner {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }

  &__panel-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.55rem 0.35rem 0.65rem;
  }

  &__play-all {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.15rem;
    height: 1.5rem;
    padding: 0 0.55rem 0 0.4rem;
    border-radius: 999px;
    background: var(--color-primary);
    color: $color-white;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    transition:
      filter 0.15s,
      transform 0.15s;

    &:hover {
      filter: brightness(1.1);
    }

    &:active {
      transform: scale(0.96);
    }

    &[aria-disabled='true'] {
      opacity: 0.45;
      pointer-events: none;
    }
  }

  &__tracks {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 1px;
    padding: 0 0.35rem 0.45rem;
    overflow: hidden;
  }

  &__track {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
    padding: 0.22rem 0.35rem;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.82);
    font-size: 11px;
    line-height: 1.25;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;

    &:hover {
      background: color-mix(in srgb, var(--color-primary) 18%, transparent);
      color: $color-white;
    }
  }

  &.is-expanded {
    box-shadow: 0 22px 48px rgba(0, 0, 0, 0.55);

    .discover-tile__cover {
      inset: 0 auto 0 0;
      width: 140px;

      img {
        transform: scale(1.04);
      }
    }

    .discover-tile__meta {
      opacity: 0;
    }

    .discover-tile__panel {
      opacity: 1;
      pointer-events: auto;
    }
  }
}
</style>
