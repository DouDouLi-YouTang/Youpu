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

/**
 * 取「最近一句唱完的行」的**下标** —— 上游 `getRecentCompletedLine`
 * （`components/visualizer/runtime.ts`）。
 *
 * ## 为什么需要它
 *
 * 上游的副字幕取值是 `[activeLine, recentCompletedLine]` 里找**第一个**有可读轨道的行
 * （`VisualizerSubtitleOverlay.resolveVisualizerSubtitleOverlayContent`）。
 * 也就是说：当当前行没有译文 / 罗马音时，底栏**继续显示上一句的**，而不是空掉。
 *
 * 只有当前行下标为 -1（前奏 / 间奏 / 尾奏这类没有行匹配的时段）上游才去找上一句 ——
 * 这不是"每行结束后都回退"，语义边界照抄，别扩大。
 *
 * ⚠️ 判据是 `currentTime > getLineEndTime(line)`，`getLineEndTime` 传的是
 * **renderEndTime**（含出场补白），不是原始 endTime —— 见 `shared/line-timing`。
 * 用原始 endTime 会让上一句在它自己的退场动画还没播完时就出现，与主舞台错位。
 *
 * ## 为什么返回下标而不是行对象
 *
 * 上游返回 `Line` 对象（React 侧用 `useMemo` 缓存，靠引用比较决定要不要重渲染）。
 * 本项目的调用方要在**逐帧**回调里判断"结果变没变"——比对象引用在行数组被整份替换后
 * 会误判成"变了"（其实还是同一行），比下标则天然稳定。需要行对象的调用方自己取一次即可。
 */
export function resolveRecentCompletedIndex(
  lines: readonly LyricLine[],
  currentLineIndex: number,
  currentTimeMs: number,
  lineRenderEndTimes: readonly number[]
): number {
  if (currentLineIndex !== -1 || lines.length === 0) return -1

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (currentTimeMs > (lineRenderEndTimes[index] ?? Number.NEGATIVE_INFINITY)) return index
  }
  return -1
}

/**
 * @param clock 逐帧时钟（行下标与时间同帧）
 * @param linesOverride 行源覆盖。**不传 = 用 store 的原始行**；传了就完全用它的
 *   （「流光」要传补过插曲行的那一份，见 `shared/interlude-lines`）。
 *   之所以是"覆盖"而不是"再叠一层"：插曲行必须与真行在**同一个数组**里，
 *   否则下标会在两套数组之间对不上号。
 */
export function useSkinActiveLine(
  clock: SmoothClock,
  linesOverride?: Ref<readonly LyricLine[]>
): SkinActiveLine {
  const lyric = useLyricStore()

  const index = ref(-1)

  /** 行源：覆盖优先，否则退回 store（两条路都是响应式的） */
  const lines = computed<readonly LyricLine[]>(() => linesOverride?.value ?? lyric.lines)

  /**
   * 只在行下标变化时写 ref（见文件头）。
   *
   * 下标来自 `clock.currentLineIndex()` —— 它按「行是否还在屏幕上」判定：
   * 行结束（含出场补白）之后、下一行开始之前，下标回到 -1。
   * 上游就是这个语义（`findLatestActiveLineIndex` 的 `time <= renderEndTime` 分支），
   * 于是长间奏时舞台会清空、副字幕回退到上一句 —— 不是「一直停在上一个下标」。
   */
  const unsubscribe = clock.onFrame(() => {
    const next = clock.currentLineIndex()
    if (next !== index.value) index.value = next
  })
  onBeforeUnmount(unsubscribe)

  const line = computed<LyricLine | null>(() => lines.value[index.value] ?? null)

  const lineKey = computed(() => `${lyric.songId ?? 'none'}:${index.value}`)

  return { index, line, lineKey }
}
