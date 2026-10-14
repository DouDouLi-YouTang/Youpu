/**
 * 行结束时间与「行是否还在屏幕上」的判定 —— 全部 Folia 系皮肤共享。
 *
 * ## 为什么要有这一层
 *
 * 「倾诉」「流光」「浮名」三个皮肤各自有一份 `resolveLineEndMs`，注释里都写着
 * 「与另外两个完全一致，刻意不另立一套口径」—— 三份**逐字相同**的实现本身就是
 * 口径漂移的温床：改一处忘了另两处，同一首歌在三个面板里的镜头节奏就会分叉。
 * 这个模块是那句话的**唯一出处**，三个适配层只做转发（各自的公开签名不变，
 * 免得动到各自的调用方与单测）。
 *
 * ## 优先级：真实行时长优先于「下一行起始」
 *
 * 上游 Folia 的行对象有 `endTime`，它有两个来源：
 *  - **YRC / TTML 这类带行时长的音源** → `startTime + duration`（真实结束）；
 *  - **只有起始时间戳的 LRC** → `下一行的起始`。
 *
 * 本项目改造前一律用「下一行起始」，对 LRC 没问题，对 YRC 却会**把行拉长**：
 * 若某行在 `12.0s` 就唱完了、下一行 `28.0s` 才开始（长间奏），一律用下一行起始
 * 就等于让这一行在屏幕上待满 16 秒 —— 于是舞台在整段间奏里一直停着上一句，
 * 而**上游会把它清空**（行下标回到 -1，副字幕回退到"最近唱完的那句"）。
 * 这正是「流光在间奏时不像官网演示」的根因之一。
 *
 * 所以本模块按上游的顺序取：**先看行自带的 `endTimeMs`，没有才用下一行起始**。
 *
 * ## 兜底链
 *
 * 1. `line.endTimeMs`（有效且晚于起点）；
 * 2. 下一行的起始（晚于本行起点）；
 * 3. 播放总时长（晚于本行起点）—— 末行用它，避免末行一直拖到曲末之后；
 * 4. 起点 + 5 秒 —— 时长未知、时间戳乱序等异常数据的最后退路。
 *
 * 第 4 条的 5 秒是上游 `draft.startTime + 5` 的原值。它**不是**「随便定的」：
 * 短于它会让末行在正常长度的句子上提前退场，长于它会让异常数据在舞台上挂太久。
 */

import type { LyricLine } from '@/domain/lyric'
import {
  buildLineRenderHints,
  getLineRenderEndTimeMs,
  type RenderHintLineLike
} from './render-hints'

/** 行结束时间无法推算时的兜底时长（上游 `draft.startTime + 5`） */
export const FALLBACK_LINE_DURATION_MS = 5000

/** 本模块需要的最小行形状（结构上兼容三个皮肤的 `Pick<LyricLine, …>`） */
export type LineEndTimeInput = Pick<LyricLine, 'timeMs'> & Pick<LyricLine, 'endTimeMs'>

/**
 * 推算一行什么时候结束（毫秒）。优先级见文件头 —— **不要**在调用方另立一套。
 */
export function resolveLineEndTimeMs(
  line: LineEndTimeInput,
  nextLine: Pick<LyricLine, 'timeMs'> | null | undefined,
  playerDurationMs: number
): number {
  const start = line.timeMs

  // ① 音源自己给了行时长 —— 这是最可信的（长间奏能正确缩短这一行）
  const ownEnd = line.endTimeMs
  if (Number.isFinite(ownEnd) && (ownEnd as number) > start) return ownEnd as number

  // ② LRC 只有起始时间戳：歌词行的时间戳天然就是上一行的结束
  if (nextLine && Number.isFinite(nextLine.timeMs) && nextLine.timeMs > start) {
    return nextLine.timeMs
  }

  // ③ 末行：覆盖到曲末（避免末行按 5 秒兜底而提前变暗）
  if (Number.isFinite(playerDurationMs) && playerDurationMs > start) {
    return playerDurationMs
  }

  // ④ 时长未知 / 时间戳乱序
  return start + FALLBACK_LINE_DURATION_MS
}

/**
 * 把一行转成 `render-hints` 能消费的形状。
 *
 * 行结束时间必须走 {@link resolveLineEndTimeMs}（见文件头），逐词结束时间由
 * `timeMs + durationMs` 换算 —— `LyricWord` 只有**相对**时长，而 render-hints
 * 要的是绝对时刻。换算只在这里发生一次，调用方不要各自算一遍。
 */
export function toRenderHintLine(
  line: LyricLine,
  nextLine: LyricLine | null | undefined,
  playerDurationMs: number
): RenderHintLineLike {
  const startTimeMs = line.timeMs
  const endTimeMs = resolveLineEndTimeMs(line, nextLine, playerDurationMs)
  const words = line.words?.map((word) => ({
    endTimeMs: word.timeMs + (Number.isFinite(word.durationMs) ? word.durationMs : 0)
  }))

  return { startTimeMs, endTimeMs, words }
}

/**
 * 整首歌的「行可以留在屏幕上的最晚时刻」数组（毫秒）。
 *
 * 给逐帧的行下标判定用：下标必须在**退场动画播完之后**才跳到 -1 / 下一行，
 * 否则上一行的 exit 会被下一行抢掉，两行在视觉上叠在一起。所以这里用的是
 * `renderEndTime`（含出场补白）而不是原始 `endTime`。
 *
 * ⚠️ 调用方负责**不要每帧重算**：这个数组只随行数组与播放时长变化
 * （见 `shared/use-smooth-clock` 的 computed 用法）。
 */
export function buildLineRenderEndTimes(
  lines: readonly LyricLine[],
  playerDurationMs: number
): number[] {
  return lines.map((line, index) =>
    getLineRenderEndTimeMs(toRenderHintLine(line, lines[index + 1] ?? null, playerDurationMs))
  )
}

/** 单行的 `renderEndTime`（毫秒）—— 上面那个数组的单项版本，供非逐帧调用方使用 */
export function resolveLineRenderEndTimeMs(
  line: LyricLine,
  nextLine: LyricLine | null | undefined,
  playerDurationMs: number
): number {
  return getLineRenderEndTimeMs(toRenderHintLine(line, nextLine, playerDurationMs))
}

/** 供需要完整提示对象的调用方使用（例如浮名的快照层） */
export function buildLineHints(
  line: LyricLine,
  nextLine: LyricLine | null | undefined,
  playerDurationMs: number
) {
  return buildLineRenderHints(toRenderHintLine(line, nextLine, playerDurationMs))
}

/**
 * 「行数组 → 逐行 renderEndTime」的引用级缓存。
 *
 * ## 为什么需要缓存，而不是每次直接算
 *
 * 有两类消费方都会反复问同一份行数组的 renderEndTime：
 *  - **逐帧**的行下标判定（`shared/use-smooth-clock`）—— 每帧一次，绝不能每帧重算整首；
 *  - **换行时**的副字幕回退（`glow/use-glow-line`）—— 每帧要判断"最近唱完的是哪句"。
 *
 * 两者的失效条件完全相同：**行数组换了一份，或播放时长变了**。而 store 的行数组是
 * 整份替换的（`loadLyric` 直接赋值），所以比引用就够了，不必比内容。
 *
 * ⚠️ 每次调用 `createLineRenderEndTimeCache()` 得到**独立**的一份缓存 ——
 * 不同皮肤 / 不同时钟各持一份，互不干扰（共享一份会在两个皮肤同时活着时互相冲掉）。
 */
export function createLineRenderEndTimeCache(): (
  lines: readonly LyricLine[],
  playerDurationMs: number
) => readonly number[] {
  let cachedLines: readonly LyricLine[] | null = null
  let cachedDurationMs = Number.NaN
  let cached: readonly number[] = []

  return (lines, playerDurationMs) => {
    if (
      cachedLines !== lines ||
      cachedDurationMs !== playerDurationMs ||
      cached.length !== lines.length
    ) {
      cached = buildLineRenderEndTimes(lines, playerDurationMs)
      cachedLines = lines
      cachedDurationMs = playerDurationMs
    }
    return cached
  }
}
