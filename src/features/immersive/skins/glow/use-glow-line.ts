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

import { usePlayerStore } from '@/stores/player.store'
import { createLineRenderEndTimeCache, resolveLineEndTimeMs } from '../shared/line-timing'
import { resolveRecentCompletedIndex } from '../shared/use-skin-active-line'
import type { SmoothClock } from '../shared/use-smooth-clock'
import { useSkinActiveLine } from '../shared/use-skin-active-line'
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
  /**
   * 最近一句**已经唱完**的行（上游 `getRecentCompletedLine`）。
   *
   * 只在当前行下标为 -1（前奏 / 间奏 / 尾奏）时有值，用于副字幕回退 ——
   * 见 `shared/use-skin-active-line.resolveRecentCompletedIndex` 的说明。
   */
  recentCompletedLine: Ref<LyricLine | null>
  /**
   * 本皮肤实际使用的行源：store 原始行 + 长空窗里补出的插曲行。
   *
   * 调用方（`SkinGlow.vue`）要用它算「下一句预览」—— 用 store 的原始行会让预览
   * 跳过插曲行，与主舞台看到的不一致。
   */
  lines: ComputedRef<LyricLine[]>
}

/**
 * @param clock 逐帧时钟（已按 `lines` 建好，见 `SkinGlow.vue` 的接线顺序）
 * @param lines 行源（含插曲行）。**必须与喂给时钟的是同一个**，见 `GlowActiveLine.lines`
 */
export function useGlowActiveLine(
  clock: SmoothClock,
  lines: ComputedRef<LyricLine[]>
): GlowActiveLine {
  const player = usePlayerStore()

  /**
   * 行下标与当前行从共享层来（「流光」与「浮名」是同一套口径）。
   * 本文件只补**流光特有的**那部分：行结束时间与下一行起点（见文件头）。
   */
  const { index, line, lineKey } = useSkinActiveLine(clock, lines)

  const source = computed<GlowLineSource | null>(() => {
    const current = line.value
    if (!current) return null
    const next = lines.value[index.value + 1] ?? null
    return {
      text: current.text,
      timeMs: current.timeMs,
      endMs: resolveLineEndTimeMs(current, next, player.durationMs),
      words: current.words,
      nextLineStartMs: next?.timeMs ?? null
    }
  })

  /**
   * 「最近一句唱完的行」。
   *
   * ⚠️ **必须逐帧从时钟算**，不能写成 computed：
   *  - 上游的判据是 `currentTime > getLineEndTime(line)`，时间源是逐帧的；
   *  - computed 只能追踪响应式值，而 `clock.time()` 是普通函数 —— 写进 computed
   *    的结果是"只在行下标变化时算一次"，间奏里时间推进根本不会触发重算，
   *    表现就是回退的那一句永远不更新（且不会报错）。
   *
   * 与行下标一样，只在结果真的变了时才写 ref —— 逐帧写 ref 会让整棵字幕树每帧重建。
   *
   * 判据里的行结束时间取 `renderEndTime`（含出场补白），与上游
   * `getRecentCompletedLine({ getLineEndTime: getLineRenderEndTime })` 同口径。
   */
  const renderEndTimes = createLineRenderEndTimeCache()
  const recentCompletedLine = ref<LyricLine | null>(null)

  const unsubscribeRecent = clock.onFrame(() => {
    const nextIndex = resolveRecentCompletedIndex(
      lines.value,
      index.value,
      clock.time(),
      renderEndTimes(lines.value, player.durationMs)
    )
    const next = nextIndex >= 0 ? (lines.value[nextIndex] ?? null) : null
    if (next !== recentCompletedLine.value) recentCompletedLine.value = next
  })
  onBeforeUnmount(unsubscribeRecent)

  return { index, line, source, lineKey, recentCompletedLine, lines }
}
