/**
 * 「流光」的**行渲染档位** —— 把共享层 `render-hints` 的行提示整理成
 * `core/word-timing` 直接消费的 profile（Folia `resolveGlowWordRenderProfile`）。
 *
 * 为什么中间要有一层：`core/word-timing.ts` 是**纯消费侧**（只认
 * {@link GlowWordTimingProfile} 那四个数，刻意不 import 行数据模块），
 * 而档位本身来自共享层（「流光」与「浮名」必须用同一张档位表 —— 见
 * `shared/render-hints.ts` 的档位表说明）。两个平级皮肤只在这一层各自组装。
 *
 * ## 与 Folia 的一处结构差异
 *
 * 上游的 profile 里还带着 `renderHints` 原始对象（它的其它模块继续读）。
 * 「流光」的下游一个字段都不用，所以这里**不再回传**它 —— 留着只会多一条
 * 「到底该读 profile.xxx 还是 profile.renderHints.xxx」的歧义。
 *
 * ## 为什么入参收窄成「行源的结构子集」而不是通用的 `RenderHintLineLike`
 *
 * `RenderHintLineLike` 要的是**毫秒制的** `startTimeMs` / `endTimeMs` / `words[].endTimeMs`，
 * 而本项目的 `LyricLine` 是 `timeMs` + `words[].timeMs/durationMs`（适配层已经在
 * `GlowLineSource` 里把它们换算好了）。若这里收通用形状，每个调用方都得自己拼一次
 * （且很容易漏掉 `endMs` 而误用 `line.timeMs`），所以直接收 `GlowLineSource`。
 *
 * 但**不收整个 `GlowLineSource`**：这个函数一个字段都不用 `text` / `nextLineStartMs`，
 * 收全量会让单测被迫构造无关字段，也会让"哪些字段才是时序输入"变得不明确。
 * `Pick` 出的三个时间字段就是完整契约。
 */

import {
  buildLineRenderHints,
  resolveWordLookaheadMs,
  type RenderHintWordLike
} from '../shared/render-hints'
import type { GlowWordTimingProfile } from './core/word-timing'
import type { LyricWord } from '@/domain/lyric'

/** 本函数需要的三个时间字段（刻意不含 `text` / `nextLineStartMs`，见文件头） */
export type GlowProfileLine = {
  /** 行起始（毫秒） */
  timeMs: number
  /** 行结束（毫秒，已按统一口径推算） */
  endMs: number
  /** 原始逐词时间戳（可能没有） */
  words: readonly LyricWord[] | undefined
}

/**
 * 把行源的逐词时间戳换成共享层要的形状。
 *
 * `LyricWord` 只有 `timeMs` + `durationMs`，而拖尾窗口要的是**绝对结束时刻**。
 * 换算在这里做一次（`timeMs + durationMs`），不要散到调用方 —— 这就是适配层的职责。
 */
function toHintWords(words: GlowProfileLine['words']): RenderHintWordLike[] {
  if (!words || words.length === 0) return []
  return words.map((word) => ({
    endTimeMs: word.timeMs + (Number.isFinite(word.durationMs) ? word.durationMs : 0)
  }))
}

/**
 * 从一行算出逐词时序 profile。
 *
 * 输入契约（`RenderHintLineLike`）：毫秒制、`words` 只需要 `endTimeMs`
 * （用来让「颜色拖尾」在**最后一个字唱完**之后才开始算，而不是行 `endTime` 之后）。
 * 本项目的行结束时间是适配层推算出来的（`glow-adapter.resolveLineEndMs`），
 * 这里不再自行推算 —— 两个皮肤的结束时间必须来自同一个来源。
 */
export function resolveGlowRenderProfile(line: GlowProfileLine): GlowWordTimingProfile {
  const hints = buildLineRenderHints({
    startTimeMs: line.timeMs,
    endTimeMs: line.endMs,
    words: toHintWords(line.words)
  })
  return {
    wordLookaheadMs: resolveWordLookaheadMs(hints.wordRevealMode),
    lineRenderEndTimeMs: hints.renderEndTimeMs,
    wordRevealMode: hints.wordRevealMode,
    lineTransitionMode: hints.lineTransitionMode
  }
}
