<script setup lang="ts">
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  CaretRightOutlined,
  CustomerServiceOutlined,
  DeleteOutlined,
  DownloadOutlined,
  HeartFilled,
  HeartOutlined,
  PauseOutlined,
  PlusOutlined,
  ShareAltOutlined
} from '@ant-design/icons-vue'

import { formatDuration } from '@/utils/format'
import type { Song } from '@/domain/song'
import { usePlayerStore } from '@/stores/player.store'
import { useDownloadStore } from '@/stores/download.store'
import { useSongListColumns, SONG_ROW_HEIGHT } from '@/features/song/use-song-list-columns'
import { useSongAddToPlaylist } from '@/features/song/use-song-add-to-playlist'

const props = withDefaults(
  defineProps<{
    song: Song
    index?: number
    /** 是否显示"从歌单删除"按钮(歌单详情页等场景)。 */
    removable?: boolean
    /**
     * 是否在歌名旁显示红心。红心歌单内全部已喜欢,默认隐藏更干净。
     * 右键菜单里的喜欢操作不受此影响。
     */
    showLikedIcon?: boolean
    /**
     * 入场动画延迟(ms)。虚拟列表按可见序号错开,避免整批同时弹出。
     */
    enterDelayMs?: number
    /** 是否播放入场动画;滚动回已见过的行传 false,避免反复闪。 */
    animateEnter?: boolean
  }>(),
  {
    removable: false,
    showLikedIcon: true,
    enterDelayMs: 0,
    animateEnter: true
  }
)

defineEmits<{
  play: [song: Song]
  remove: [song: Song]
}>()

const player = usePlayerStore()
const downloadStore = useDownloadStore()
const { showCover, buildGridClass } = useSongListColumns()
const {
  isLoggedIn,
  createdPlaylists,
  playlistsLoading,
  playlistLoadError,
  selectablePlaylists,
  submittingPlaylistId,
  playlistLabel,
  onMenuOpenChange,
  tryHandlePlaylistMenuKey
} = useSongAddToPlaylist(() => props.song)

const liked = computed(() => player.likedSongIds.includes(props.song.id))
const isCurrent = computed(() => player.currentItem?.song.id === props.song.id)
const isPlayingHere = computed(() => isCurrent.value && player.isPlaying)
/** 封面图加载失败后回退到占位图标,避免残留破损图标。 */
const coverFailed = ref(false)
const gridClass = computed(() => buildGridClass(props.removable))

async function toggleLike(): Promise<void> {
  await player.toggleLikeSong(props.song.id)
}

async function share(): Promise<void> {
  const url = `https://music.163.com/#/song?id=${props.song.id}`
  try {
    await navigator.clipboard.writeText(url)
    message.success('已复制歌曲链接')
  } catch {
    message.error('复制失败')
  }
}

async function download(): Promise<void> {
  await downloadStore.downloadSong(props.song)
}

function onMenuClick({ key }: { key: string | number }): void {
  const k = String(key)
  if (tryHandlePlaylistMenuKey(k)) return
  switch (k) {
    case 'like':
      void toggleLike()
      break
    case 'share':
      void share()
      break
    case 'download':
      void download()
      break
  }
}
</script>

<template>
  <!--
    单根节点 + 固定行高,配合 VirtualSongList。
    不用 a-list-item,避免 Ant 默认 flex/padding 把序号列顶歪。
  -->
  <div
    class="song-row group box-border w-full"
    :class="{
      'song-row--active': isCurrent,
      'song-row--enter': animateEnter
    }"
    :style="{
      height: `${SONG_ROW_HEIGHT}px`,
      '--song-enter-delay': `${Math.max(0, enterDelayMs)}ms`
    }"
  >
    <a-dropdown trigger="contextmenu" class="block h-full w-full">
      <div
        class="flex h-full w-full cursor-pointer items-center px-1.5"
        role="button"
        tabindex="0"
        @click="$emit('play', song)"
        @keydown.enter="$emit('play', song)"
        @keydown.space.prevent="$emit('play', song)"
      >
        <div
          :class="[
            'song-row__grid grid h-11 w-full items-center gap-3 rounded-xl px-2 text-sm transition-colors duration-150',
            gridClass
          ]"
        >
          <!-- 序号 / 播放态：固定方格 + 绝对居中，避免图标 baseline 偏移 -->
          <span class="song-row__index-cell relative flex h-10 w-full items-center justify-center">
            <span class="song-row__index-slot relative grid h-5 w-5 place-items-center">
              <span v-if="isPlayingHere" class="song-row__eq" aria-label="正在播放">
                <i /><i /><i />
              </span>
              <PauseOutlined
                v-else-if="isCurrent"
                class="!flex text-[13px] leading-none text-[var(--color-primary)]"
              />
              <template v-else>
                <CaretRightOutlined
                  class="song-row__play-icon absolute !flex text-[14px] leading-none text-text-primary opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                />
                <span
                  class="text-xs font-medium leading-none tabular-nums text-text-secondary transition-opacity duration-150 group-hover:opacity-0"
                >
                  {{ index !== undefined ? index + 1 : '' }}
                </span>
              </template>
            </span>
          </span>

          <!-- 封面 -->
          <span v-if="showCover" class="flex h-10 items-center justify-center">
            <span
              class="relative h-10 w-10 overflow-hidden rounded-lg bg-[var(--color-bg-elevated)] shadow-sm ring-1 ring-black/5"
            >
              <img
                v-if="song.coverUrl && !coverFailed"
                :src="song.coverUrl"
                :alt="song.name"
                loading="lazy"
                class="h-full w-full object-cover"
                referrerpolicy="no-referrer"
                @error="coverFailed = true"
              />
              <span v-else class="grid h-full w-full place-items-center text-text-secondary">
                <CustomerServiceOutlined />
              </span>
            </span>
          </span>

          <!-- 歌名 + 喜欢标记 -->
          <span class="flex min-w-0 items-center gap-2">
            <span
              class="truncate font-medium leading-none"
              :class="isCurrent ? 'text-[var(--color-primary)]' : 'text-text-primary'"
              :title="song.name"
            >
              {{ song.name }}
            </span>
            <HeartFilled
              v-if="showLikedIcon && liked"
              class="shrink-0 text-[11px] leading-none text-[#ff6b8a]"
              title="已喜欢"
            />
          </span>

          <!-- 歌手 -->
          <span
            class="truncate text-[13px] leading-none text-text-secondary"
            :title="song.artists.map((a) => a.name).join(', ')"
          >
            <template v-if="song.artists.length > 0">
              <span v-for="(artist, i) in song.artists" :key="artist.id">
                <RouterLink
                  :to="`/artist/${artist.id}`"
                  class="transition-colors hover:text-[var(--color-primary)]"
                  @click.stop
                  >{{ artist.name }}</RouterLink
                >{{ i < song.artists.length - 1 ? ' / ' : '' }}
              </span>
            </template>
            <template v-else>未知</template>
          </span>

          <!-- 时长 -->
          <span class="text-right text-xs leading-none tabular-nums text-text-secondary">
            {{ formatDuration(song.durationMs) }}
          </span>

          <!-- 删除 -->
          <div v-if="removable" class="flex h-10 items-center justify-end">
            <button
              type="button"
              title="从歌单删除"
              class="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-text-secondary opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
              @click.stop="$emit('remove', song)"
            >
              <DeleteOutlined class="!flex leading-none" />
            </button>
          </div>
        </div>
      </div>

      <template #overlay>
        <a-menu @click="onMenuClick" @open-change="onMenuOpenChange">
          <a-menu-item key="like">
            <template #icon>
              <HeartFilled v-if="liked" />
              <HeartOutlined v-else />
            </template>
            {{ liked ? '取消喜欢' : '喜欢' }}
          </a-menu-item>
          <a-sub-menu key="add-to-playlist" popup-class-name="song-row-playlist-submenu">
            <template #icon><PlusOutlined /></template>
            <template #title>添加到歌单</template>
            <!-- 未登录:占位提示,有效列表不展示 -->
            <a-menu-item v-if="!isLoggedIn" key="add-pl-login" disabled>需要登录</a-menu-item>
            <a-menu-item
              v-else-if="playlistsLoading && createdPlaylists.length === 0"
              key="add-pl-loading"
              disabled
            >
              <span class="inline-flex items-center gap-2">
                <a-spin size="small" />
                加载中…
              </span>
            </a-menu-item>
            <a-menu-item v-else-if="playlistLoadError" key="add-pl-error" disabled>
              加载失败
            </a-menu-item>
            <a-menu-item v-else-if="createdPlaylists.length === 0" key="add-pl-empty" disabled>
              暂无歌单
            </a-menu-item>
            <a-menu-item
              v-for="pl in selectablePlaylists"
              :key="`playlist-${pl.id}`"
              :disabled="submittingPlaylistId !== null"
            >
              <span class="inline-flex max-w-[200px] items-center gap-2">
                <span class="truncate">{{ playlistLabel(pl) }}</span>
                <a-spin v-if="submittingPlaylistId === pl.id" size="small" />
              </span>
            </a-menu-item>
          </a-sub-menu>
          <a-menu-item key="share">
            <template #icon><ShareAltOutlined /></template>
            分享
          </a-menu-item>
          <a-menu-item key="download">
            <template #icon><DownloadOutlined /></template>
            下载
          </a-menu-item>
        </a-menu>
      </template>
    </a-dropdown>
  </div>
</template>

<!-- package-0.1.21 拆分样式（song-row，scoped 部分）：.song-row* 全部由本组件模板渲染 -->
<style scoped lang="scss" src="./song-row.scss"></style>
<!-- body 挂载的加歌单二级菜单弹层无宿主 data-v，须非 scoped 全局引入 -->
<style lang="scss" src="./song-row.global.scss"></style>
