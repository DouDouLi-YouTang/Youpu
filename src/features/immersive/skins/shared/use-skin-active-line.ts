/**
 * 「当前行」—— 从**逐帧时钟**里取出行下标与行数据。全部 Folia 系皮肤共享。
 *
 * ## 为什么行下标也要逐帧取
 *
 * 皮肤的 `ctx.currentLineIndex()` 来自 `player.currentTimeMs`（4Hz 节流），
 * 换行会晚最多 250ms。而流光/浮名的行容器出入场、逐词时序、副字幕**全部**挂在
 * 行下标上，晚 250ms 换行 = 上一行的退场与下一行的进场整体后移，与音频对不上。
 * 所以行下标改从共享逐帧时钟取（`useSmoothClock` 内部与时间同帧算出来）。
 *
 * ## 为什么结果要放进 ref（而不是逐帧读）
 *
 * 行下标**只在一首歌里变化几十次**，而模板结构（哪一行、哪些词）只在它变化时才该
 * 重建。逐帧读会让整棵歌词树每帧重渲染。所以这里只在下标真的变了的时候写 ref ——
 * 与 `use-glow-word-status` 是同一个模式。
 *
 * ⚠️ 本模块**只**回答「现在轮到哪一行」，不掺任何面板特有的口径：
 * 行结束时间、渲染提示、逐词几何都属于各皮肤自己的适配层。
 */

import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'

import { useLyricStore } from '@/stores/lyric.store'
import type { LyricLine } from '@/domain/lyric'
import type { SmoothClock } from './use-smooth-clock'

export interface SkinActiveLine {
  /** 当前行下标（-1 = 尚未到首行） */
  index: Ref<number>
  /** 当前行（没有可渲染的行时为 null） */
  line: ComputedRef<LyricLine | null>
  /** 行身份（歌曲 + 行下标）：变化即换行，用作 DOM key */
  lineKey: ComputedRef<string>
}

export function useSkinActiveLine(clock: SmoothClock): SkinActiveLine {
  const lyric = useLyricStore()

  const index = ref(-1)

  /** 只在行下标变化时写 ref（见文件头） */
  const unsubscribe = clock.onFrame(() => {
    const next = clock.currentLineIndex()
    if (next !== index.value) index.value = next
  })
  onBeforeUnmount(unsubscribe)

  const line = computed<LyricLine | null>(() => lyric.lines[index.value] ?? null)

  const lineKey = computed(() => `${lyric.songId ?? 'none'}:${index.value}`)

  return { index, line, lineKey }
}
