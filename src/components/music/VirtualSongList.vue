<script setup lang="ts">
import { computed, ref, watch, nextTick, shallowRef } from 'vue'

import SongRow from '@/components/music/SongRow.vue'
import { useVirtualList } from '@/composables/useVirtualList'
import { SONG_ROW_HEIGHT } from '@/features/song/use-song-list-columns'
import type { Song } from '@/domain/song'

const props = withDefaults(
  defineProps<{
    songs: Song[]
    removable?: boolean
    /** 是否显示歌名旁红心图标,红心歌单传 false。 */
    showLikedIcon?: boolean
    /** 触底加载(搜索分页等)。 */
    onReachEnd?: () => void
  }>(),
  {
    removable: false,
    showLikedIcon: true
  }
)

const emit = defineEmits<{
  play: [song: Song]
  remove: [song: Song]
}>()

const containerRef = ref<HTMLElement | null>(null)
const count = computed(() => props.songs.length)

const { range, onScroll, measure } = useVirtualList({
  count,
  itemHeight: SONG_ROW_HEIGHT,
  overscan: 10,
  containerRef
})

/** 已播放过入场动画的 songId;换列表时清空。 */
const animatedIds = shallowRef(new Set<number>())

const listIdentity = computed(() => {
  const list = props.songs
  if (list.length === 0) return 'empty'
  return `${list[0]?.id}-${list.length}-${list[list.length - 1]?.id}`
})

watch(listIdentity, () => {
  animatedIds.value = new Set()
})

const visibleSongs = computed(() => {
  const list = props.songs
  const { start, end } = range.value
  const seen = animatedIds.value
  const out: { song: Song; index: number; enterDelayMs: number; animate: boolean }[] = []
  let freshRank = 0
  for (let i = start; i < end; i++) {
    const song = list[i]
    if (!song) continue
    const isNew = !seen.has(song.id)
    const enterDelayMs = isNew ? Math.min(freshRank, 12) * 45 : 0
    if (isNew) freshRank += 1
    out.push({ song, index: i, enterDelayMs, animate: isNew })
  }
  return out
})

// 可见行渲染后延迟记为已动画,避免刚挂上就去掉 --enter 打断动画
let markTimer: ReturnType<typeof setTimeout> | null = null
watch(
  visibleSongs,
  (rows) => {
    if (markTimer) clearTimeout(markTimer)
    markTimer = setTimeout(() => {
      const next = new Set(animatedIds.value)
      let changed = false
      for (const row of rows) {
        if (!next.has(row.song.id)) {
          next.add(row.song.id)
          changed = true
        }
      }
      if (changed) animatedIds.value = next
      markTimer = null
    }, 520)
  },
  { flush: 'post' }
)

function handleScroll(e: Event): void {
  onScroll()
  if (!props.onReachEnd) return
  const el = e.target as HTMLElement
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) {
    props.onReachEnd()
  }
}

watch(
  () => props.songs.length,
  async () => {
    await nextTick()
    measure()
  }
)
</script>

<template>
  <div
    ref="containerRef"
    class="virtual-song-list min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
    @scroll.passive="handleScroll"
  >
    <!--
      用 padding-top 做虚拟偏移,不用 transform 父级,
      否则子行的 translateY 入场动画会被冲掉/看不见。
    -->
    <div class="w-full" :style="{ height: `${range.totalHeight}px` }">
      <div :style="{ paddingTop: `${range.offsetY}px` }">
        <SongRow
          v-for="{ song, index, enterDelayMs, animate } in visibleSongs"
          :key="`${song.id}-${index}`"
          :song="song"
          :index="index"
          :removable="removable"
          :show-liked-icon="showLikedIcon"
          :enter-delay-ms="enterDelayMs"
          :animate-enter="animate"
          @play="emit('play', $event)"
          @remove="emit('remove', $event)"
        />
      </div>
    </div>
    <slot name="footer" />
  </div>
</template>
