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
 */

import {
  buildLineRenderHints,
  resolveWordLookaheadMs,
  type RenderHintLineLike
} from '../shared/render-hints'
import type { GlowWordTimingProfile } from './core/word-timing'

/**
 * 从一行算出逐词时序 profile。
 *
 * 输入契约（`RenderHintLineLike`）：毫秒制、`words` 只需要 `endTimeMs`
 * （用来让「颜色拖尾」在**最后一个字唱完**之后才开始算，而不是行 `endTime` 之后）。
 * 本项目的行结束时间是适配层推算出来的（`glow-adapter.resolveLineEndMs`），
 * 这里不再自行推算 —— 两个皮肤的结束时间必须来自同一个来源。
 */
export function resolveGlowRenderProfile(line: RenderHintLineLike): GlowWordTimingProfile {
  const hints = buildLineRenderHints(line)
  return {
    wordLookaheadMs: resolveWordLookaheadMs(hints.wordRevealMode),
    lineRenderEndTimeMs: hints.renderEndTimeMs,
    wordRevealMode: hints.wordRevealMode,
    lineTransitionMode: hints.lineTransitionMode
  }
}
