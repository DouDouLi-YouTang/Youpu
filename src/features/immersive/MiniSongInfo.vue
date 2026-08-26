<script setup lang="ts">
import { computed } from 'vue'

import { usePlayerStore } from '@/stores/player.store'

/**
 * 仅歌词模式顶部迷你歌曲信息 —— 对齐参考项目 mini-song-info.js/scss。
 * 在 lyric-only 模式下显示当前封面、歌名、歌手；autoHideMiniSongInfo 开启时由父级 idle class 隐藏。
 */
const player = usePlayerStore()

const song = computed(() => player.currentItem?.song ?? null)
const coverUrl = computed(() => song.value?.coverUrl ?? null)
const artistsText = computed(() =>
  song.value ? song.value.artists.map((artist) => artist.name).join(' / ') : ''
)
</script>

<template>
  <div class="rnp-mini-song-info">
    <div class="rnp-mini-song-info__cover">
      <img v-if="coverUrl" :src="coverUrl" :alt="song?.album.name ?? ''" draggable="false" />
      <div v-else class="rnp-mini-song-info__cover-placeholder">无封面</div>
    </div>
    <div class="rnp-mini-song-info__text">
      <div class="rnp-mini-song-info__title">{{ song?.name ?? '未播放' }}</div>
      <div class="rnp-mini-song-info__artist">{{ artistsText || '—' }}</div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.rnp-mini-song-info {
  position: fixed;
  top: 8px;
  left: 50vw;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 20px;
  max-width: calc(100vw - 600px);
  height: 55px;
  color: var(--rnp-accent-color-shade-2, var(--color-text-primary));
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%);
  transition: opacity 0.3s ease;

  &__cover {
    position: relative;
    flex: 0 0 auto;
    width: 46px;
    height: 46px;
    overflow: hidden;
    border-radius: 8px;
    box-shadow:
      0 5px 5px rgba(0, 0, 0, 0.05),
      0 0 10px rgba(0, 0, 0, 0.06);

    &::after {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(var(--rnp-accent-color-rgb, 170, 170, 170), 0.1);
      pointer-events: none;
    }

    img {
      display: block;
      object-fit: cover;
    }

    img {
      width: 100%;
      height: 100%;
    }
  }

  &__cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.08);
    font-size: 10px;
    opacity: 0.7;
  }

  &__text {
    min-width: 0;
    overflow: hidden;
    line-height: 1.5;
  }

  &__title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 18px;
    font-weight: 600;
  }

  &__artist {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 15px;
    opacity: 0.6;
  }

  // 以下为原 package-0.1.21 拆分内容合并追加：与上方同名选择器同特异性，靠源码序在后生效
  &__cover {
    position: relative;
    flex: 0 0 auto;
    width: 46px;
    height: 46px;
    overflow: hidden;
    border-radius: 8px;
    box-shadow:
      0 5px 5px rgba(0, 0, 0, 0.05),
      0 0 10px rgba(0, 0, 0, 0.06);

    &::after {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(var(--rnp-accent-color-rgb, 170, 170, 170), 0.1);
      pointer-events: none;
    }

    img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
    }
  }

  &__cover-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.08);
    font-size: 10px;
    opacity: 0.7;
    width: 100%;
    height: 100%;
  }

  &__title {
    font-size: 18px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__artist {
    font-size: 15px;
    opacity: 0.6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
