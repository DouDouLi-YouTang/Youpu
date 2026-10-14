/**
 * 「流光」的当前行 —— 从逐帧时钟里取出行下标与行数据，并补上本项目缺的字段。
 *
 * ## 为什么行下标也要逐帧取
 *
 * 皮肤的 `ctx.currentLineIndex()` 来自 `player.currentTimeMs`（4Hz 节流），
 * 换行会晚最多 250ms。而「流光」的行容器出入场、逐词时序、副字幕**全部**挂在行下标上，
 * 晚 250ms 换行 = 上一行的退场动画与下一行的进场动画整体后移，与音频对不上。
 * 所以行下标改从共享逐帧时钟取（`useSmoothClock` 内部与时间同帧算出来）。
 *
 * ## 为什么结果要放进 ref（而不是逐帧读）
 *
 * 行下标**只在一首歌里变化几十次**，而模板结构（哪一行、哪些词）只在它变化时才该重建。
 * 逐帧读会让整棵歌词树每帧重渲染。所以这里只在下标真的变了的时候写 ref ——
 * 与 `use-glow-word-status` 是同一个模式。
 *
 * ## 补上的字段
 *
 * 本项目的 `LyricLine` 只有 `timeMs`（没有行结束时间、没有 `fullText`、没有 `isChorus`）：
 *  - `endMs`：按 `glow-adapter.resolveLineEndMs` 推算（下一行起始 → 播放总时长 → 5 秒兜底），
 *    与「倾诉」同一口径 —— 两个皮肤的行结束时间必须一致，否则同一首歌的
 *    `renderEndTime` 会不同，相机 / 拖尾的节奏跟着漂；
 *  - `fullText`：就是 `line.text`（本项目解析层已经把整行文本拼好）。
 */

import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'

import { useLyricStore } from '@/stores/lyric.store'
import { usePlayerStore } from '@/stores/player.store'
import type { SmoothClock } from '../shared/use-smooth-clock'
import { resolveLineEndMs } from './glow-adapter'
import type { LyricLine } from '@/domain/lyric'

/** 当前行的渲染输入（含本项目补上的行结束时间） */
export interface GlowLineSource {
  text: string
  /** 行起始（毫秒）—— 同时是逐词几何的**种子**（见 `core/word-layout`） */
  timeMs: number
  /** 行结束（毫秒，已按统一口径推算） */
  endMs: number
  /** 原始逐词时间戳（可能没有） */
  words: LyricLine['words']
  /** 下一行的起始时刻（毫秒）；没有下一行时为 `null` */
  nextLineStartMs: number | null
}

export interface GlowActiveLine {
  /** 当前行下标（-1 = 尚未到首行） */
  index: Ref<number>
  /** 当前行（没有可渲染的行时为 null） */
  line: ComputedRef<LyricLine | null>
  /** 当前行的渲染输入（没有行时为 null） */
  source: ComputedRef<GlowLineSource | null>
  /** 行身份（歌曲 + 行下标）：变化即换行，用作 DOM key */
  lineKey: ComputedRef<string>
}

export function useGlowActiveLine(clock: SmoothClock): GlowActiveLine {
  const lyric = useLyricStore()
  const player = usePlayerStore()

  const index = ref(-1)

  /** 只在行下标变化时写 ref（见文件头） */
  const unsubscribe = clock.onFrame(() => {
    const next = clock.currentLineIndex()
    if (next !== index.value) index.value = next
  })
  onBeforeUnmount(unsubscribe)

  const line = computed<LyricLine | null>(() =>
    index.value >= 0 ? (lyric.lines[index.value] ?? null) : null
  )

  const source = computed<GlowLineSource | null>(() => {
    const current = line.value
    if (!current) return null
    const next = lyric.lines[index.value + 1] ?? null
    return {
      text: current.text,
      timeMs: current.timeMs,
      endMs: resolveLineEndMs(current, next, player.durationMs),
      words: current.words,
      nextLineStartMs: next?.timeMs ?? null
    }
  })

  const lineKey = computed(() => `${lyric.songId ?? 'none'}:${index.value}`)

  return { index, line, source, lineKey }
}
