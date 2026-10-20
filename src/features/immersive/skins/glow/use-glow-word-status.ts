/**
 * 「流光」的单词语义状态 —— `waiting -> active -> passed` 三态机。
 *
 * ## 为什么单独一个 hook，而不是写在 `GlowWord.vue` 里
 *
 * 三态判定的**边界符号**是这个面板最容易写错的地方（`>= 下界`、`<= 上界`、
 * 只有 `> 上界` 才算 passed），而它同时被「正文层」「辉光层」「涟漪层」三处读。
 * 判定公式本体在 `core/word-timing.ts`（纯函数、有单测），这里只负责**把它接到
 * 逐帧时钟上**。
 *
 * ## 关键约束：只在状态真的变化时更新（不要每帧写 ref）
 *
 * Folia 用 `useMotionValueEvent(currentTime, 'change', ...)` 订阅，只有状态变化才
 * `setState`。本项目同样：`useSmoothClock()` 每帧产出新时间，但**状态 ref 只在跨过
 * 某条边界的那一帧才写**。若逐帧写，Vue 会每帧重渲染整个词（含两层文字 + 逐字素
 * span 列表），60fps 下就是持续把 VDOM 丢给 diff —— 而这套面板一行有十几个词。
 *
 * 逐帧驱动因此收敛在**一个** rAF 里（共享时钟），本 hook 只做区间判定。
 */

import { onBeforeUnmount, ref, type Ref } from 'vue'

import type { SmoothClock } from '../shared/use-smooth-clock'
import {
  resolveWordStatus,
  type GlowWordStatus,
  type GlowWordTimingProfile
} from './core/word-timing'

/** 一个词的三态判定输入（都是毫秒） */
export interface GlowWordStatusInput {
  /** 词的起始时刻 */
  startTimeMs: number
  /** 词 active 的结束时刻（由 `core/word-timing.resolveActiveEndMs` 算好） */
  activeEndTimeMs: number
}

/**
 * 订阅共享时钟，返回这个词当前的状态。
 *
 * ⚠️ 逐帧回调里读的是 `clockRef.time()`（即时读取，不建立响应式依赖），
 * 判定的**结果**才写进 ref —— 这是「每帧读、只在变化时写」的那一半。
 */
export function useGlowWordStatus(
  clock: SmoothClock,
  word: GlowWordStatusInput,
  profile: Pick<GlowWordTimingProfile, 'wordLookaheadMs'>
): Ref<GlowWordStatus> {
  const status = ref<GlowWordStatus>('waiting')

  function update(): void {
    const next = resolveWordStatus(
      clock.time(),
      word.startTimeMs,
      word.activeEndTimeMs,
      profile.wordLookaheadMs
    )
    if (next !== status.value) status.value = next
  }

  // 订阅共享时钟（整屏只有一条 rAF，见 `SmoothClock.onFrame` 的说明）
  const unsubscribe = clock.onFrame(update)
  onBeforeUnmount(unsubscribe)

  return status
}
