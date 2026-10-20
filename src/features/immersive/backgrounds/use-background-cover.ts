import { computed } from 'vue'

import { usePlayerStore } from '@/stores/player.store'

/**
 * 三种「跟着封面走」的背景（模糊 / 渐变 / 流体）共用的当前封面 URL。
 *
 * ⚠️ 取的是**歌曲原始 `coverUrl`**，不是 `player.coverUrl` 那个 getter：
 * 后者会优先给 `muice-cover://` 本地缓存协议 URL，而这三个背景都要把 URL 交给
 * `loadCrossOriginImage` / CSS 背景图去用 —— 与改造前保持一致（不是漏改）。
 */
export function useBackgroundCoverUrl() {
  const player = usePlayerStore()
  return computed(() => player.currentItem?.song?.coverUrl ?? null)
}
