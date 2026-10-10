import { computed } from 'vue'

import { useLyricStore } from '@/stores/lyric.store'
import { usePlayerStore } from '@/stores/player.store'
import { useImmersiveSettingsStore } from './immersive-settings.store'
import { useTransport } from './skins/shared/use-transport'
import { audioBands } from './use-audio-bands'
import type { SkinContext } from './skins/types'

/**
 * 皮肤上下文 —— 把 store 状态统一喂给皮肤（**所有皮肤共用**，不许各自抄一份）。
 * 全部是 getter：在模板/computed 里调用即建立响应式依赖，在 rAF 里逐帧调用读最新值。
 */

/**
 * 无歌词时强制 cover-only：lyric-only 模式下无内容可显示，回退到全屏封面。
 * 外壳（rootClasses 的 display-mode-* class）与经典皮肤（v-show）共用同一份判断。
 */
export function useEffectiveDisplayMode() {
  const settings = useImmersiveSettingsStore()
  const lyric = useLyricStore()
  return computed(() =>
    !lyric.loading && !lyric.hasLyric ? ('cover-only' as const) : settings.displayMode
  )
}

/** 当前歌词行索引（-1 = 尚未到首行）。含全局偏移与 stagger 提前量，与改造前同式。 */
export function useActiveLyricIndex() {
  const settings = useImmersiveSettingsStore()
  const player = usePlayerStore()
  const lyric = useLyricStore()
  return computed(() => {
    // lyric-stagger 开启时，当前行提前 200ms 切换（参考项目 onPlayProgress 的 scrollingDelay），
    // 让歌词提前滚动，配合行间错位延迟动画，视觉更流畅
    const staggerDelay = settings.lyricStagger ? 200 : 0
    const t = player.currentTimeMs + settings.lyricOffset + staggerDelay
    const lines = lyric.lines
    let idx = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].timeMs <= t) idx = i
      else break
    }
    return idx
  })
}

/** 创建皮肤上下文。SkinShell 调用一次并下发给皮肤组件（C1 起所有皮肤共用）。 */
export function useSkinContext(): SkinContext {
  const player = usePlayerStore()
  const settings = useImmersiveSettingsStore()
  const transport = useTransport()
  const activeLineIndex = useActiveLyricIndex()

  const song = computed(() => player.currentItem?.song ?? null)
  const songArtist = computed(() =>
    song.value ? song.value.artists.map((artist) => artist.name).join(' / ') : null
  )

  return {
    /** 毫秒，且已含全局偏移 lyricOffset（可直接喂给 LyricLines 的 :current-time-ms） */
    currentTime: (): number => player.currentTimeMs + settings.lyricOffset,
    currentLineIndex: (): number => activeLineIndex.value,
    isPlaying: (): boolean => player.isPlaying,
    bands: () => audioBands.value,
    coverUrl: (): string | null => song.value?.coverUrl ?? null,
    songTitle: (): string | null => song.value?.name ?? null,
    songArtist: (): string | null => songArtist.value,
    songAlbum: (): string | null => song.value?.album?.name ?? null,
    seekLyric: (lineTimeMs: number): void => transport.seekLyric(lineTimeMs)
  }
}
