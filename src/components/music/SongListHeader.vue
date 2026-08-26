<script setup lang="ts">
import { computed } from 'vue'

import { useSongListColumns } from '@/features/song/use-song-list-columns'

const props = withDefaults(
  defineProps<{
    /** 是否预留末尾删除列（与 SongRow.removable 对齐）。 */
    removable?: boolean
    /** sticky 吸顶（详情页滚动列表用）。 */
    sticky?: boolean
  }>(),
  {
    removable: false,
    sticky: true
  }
)

const { showCover, buildGridClass } = useSongListColumns()
const gridClass = computed(() => buildGridClass(props.removable))
</script>

<template>
  <div
    :class="[
      'song-list-header grid h-10 items-center gap-3 px-3.5 text-[11px] font-medium tracking-wide text-text-secondary',
      sticky
        ? 'sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]/90 backdrop-blur-md'
        : 'border-b border-[var(--color-border)]/70',
      gridClass
    ]"
  >
    <span class="text-center">#</span>
    <span v-if="showCover" aria-hidden="true"></span>
    <span>歌曲</span>
    <span>歌手</span>
    <span class="text-right">时长</span>
    <span v-if="removable" aria-hidden="true"></span>
  </div>
</template>
