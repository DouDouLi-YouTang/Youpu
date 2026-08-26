<script setup lang="ts">
import { computed } from 'vue'

import type { LyricContributors } from '@/domain/lyric'

/**
 * 歌词贡献者 —— 移植参考项目 lyrics.js:1202-1280 的 Contributors/Artist/Contributor。
 *
 * 作为歌词列表末项随当前行滚动(对齐参考项目 lyrics.js:754 把 <Contributors> 渲染在
 * 歌词 v-for 之后,共享 transforms)。transform/filter/opacity 由 LyricLines 通过
 * contributors 具名 slot 注入的 inline style 驱动(见 LyricLines contributorsStyle);
 * 显隐由 lyricContributorsDisplay(show/hover/hide) 控制(规则在 ImmersivePlayer.vue
 * 的 :deep 样式里)。艺人/用户跳转链接暂做纯文本(本项目暂无艺人/用户详情路由)。
 */
const props = defineProps<{ contributors: LyricContributors }>()

/** 是否有任意可渲染内容(无内容则整块不渲染) */
const hasContent = computed(() => {
  const c = props.contributors
  return (
    c.roles.length > 0 ||
    Boolean(c.original) ||
    Boolean(c.translation) ||
    Boolean(c.lyricSource?.name)
  )
})

/** 翻译贡献者/歌词来源:user 可能是 {name,userid} 或 {name?} */
function userName(user: { name?: string } | { name: string; userid: number } | undefined): string {
  return user?.name ?? ''
}
</script>

<template>
  <div v-if="hasContent" class="rnp-contributors">
    <div class="rnp-contributors-inner">
      <div
        v-for="(role, i) in contributors.roles"
        :key="`role-${i}`"
        class="rnp-contributors__row rnp-contributors__row--role"
      >
        <span>{{ role.roleName }}:</span>
        <span class="rnp-contributors__artist-list">
          <template v-for="(artist, j) in role.artistMetaList" :key="j">
            <span>{{ artist.artistName }}</span
            ><span v-if="j < role.artistMetaList.length - 1">,&nbsp;</span>
          </template>
        </span>
      </div>
      <div
        v-if="contributors.original"
        class="rnp-contributors__row rnp-contributors__row--lyric-credit"
      >
        <span>歌词贡献者:</span>
        <span class="rnp-contributors__user">{{ userName(contributors.original) }}</span>
      </div>
      <div
        v-if="contributors.translation"
        class="rnp-contributors__row rnp-contributors__row--lyric-credit"
      >
        <span>翻译贡献者:</span>
        <span class="rnp-contributors__user">{{ userName(contributors.translation) }}</span>
      </div>
      <div
        v-if="contributors.lyricSource?.name"
        class="rnp-contributors__row rnp-contributors__row--lyric-credit"
      >
        <span>歌词来源:</span>
        <span class="rnp-contributors__user">{{ contributors.lyricSource.name }}</span>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.rnp-contributors {
  /* 定位对齐参考项目 lyrics.scss:361-399 —— 与歌词行同机制:position:absolute 无
   left/top/right/bottom,靠 LyricLines 注入的 inline transform translateY(top) 定位,
   随当前行滚动(作为歌词列表末项)。transition 同歌词行,接受 inline delay/duration 覆盖。 */
  position: absolute;
  transform-origin: left center;
  transition:
    transform 0.5s var(--lyric-timing-function, cubic-bezier(0.18, 0.77, 0.58, 0.99)),
    opacity 0.5s ease,
    filter 0.5s ease;
  will-change: transform, filter;
  max-width: 100%;
  pointer-events: none;

  &:hover {
    filter: none !important;
  }

  &__row {
    display: flex;
    align-items: baseline;
    max-width: 100%;
    font-size: max(0.6em, min(15px, 1em));
    line-height: 1.6;

    > span {
      &:first-child {
        flex-shrink: 0;
        margin-right: 0.5em;
        white-space: nowrap;
        opacity: 0.4;
      }
    }
  }

  &__user {
    opacity: 0.4;
    transition: opacity 0.2s ease;

    &:hover {
      opacity: 0.6;
    }
  }

  &__artist-list {
    opacity: 0.4;
    transition: opacity 0.2s ease;

    &:hover {
      opacity: 0.6;
    }
  }

  // 以下为原 package-0.1.21 拆分内容合并追加：与上方同名选择器同特异性，靠源码序在后生效
  // 定位无 top/left/right/bottom，由 LyricLines 注入的 inline transform translateY 驱动滚动
  &__row {
    display: flex;
    align-items: baseline;
    max-width: 100%;
    font-size: max(0.6em, min(15px, 1em));
    line-height: 1.6;

    > span {
      &:first-child {
        flex-shrink: 0;
        margin-right: 0.5em;
        white-space: nowrap;
        opacity: 0.4;
      }
    }
  }
}

.rnp-contributors-inner {
  transition: opacity 0.35s ease;
  opacity: 0.5;
  pointer-events: auto;

  &:hover {
    opacity: 1 !important;
    filter: none !important;
  }
}
</style>
