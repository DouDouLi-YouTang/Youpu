import { getNextIndex, getPreviousIndex, type QueueTraversalState } from './playback-mode'

/**
 * 后台播放器切歌决策(纯函数,主进程 bg-session 调用,镜像渲染层 player store
 * 的 next()/previous()/handleEnded() 语义)。
 *
 * 决策只回答“接下来做什么”,不做网络请求、不碰音频 —— 具体“怎么播”由
 * electron/main/bg-session.ts 执行,便于单测覆盖全部模式分支。
 */

/** ended=自然播完;next/prev=用户/托盘/媒体键手动切歌。 */
export type BgAdvanceTrigger = 'ended' | 'next' | 'prev'

export type BgAdvanceDecision =
  | { kind: 'stop' }
  | { kind: 'play'; index: number }
  /** 私人 FM:拉一首新推荐替换队列(镜像 playNextFm)。 */
  | { kind: 'fm' }
  /** 心动模式:本次推荐列表播完,以当前歌为种子拉下一批(镜像 startIntelligence)。 */
  | { kind: 'heart' }

export interface BgAdvanceInput {
  fmMode: boolean
  traversal: QueueTraversalState
}

export function decideBgAdvance(
  input: BgAdvanceInput,
  trigger: BgAdvanceTrigger
): BgAdvanceDecision {
  const { fmMode, traversal } = input

  // 上一首:FM/普通队列一致,按索引回退(后台会话不维护 history,等价于
  // 渲染层 history 为空时的 getPreviousIndex 回退路径)。
  if (trigger === 'prev') {
    const prev = getPreviousIndex(traversal)
    return prev == null ? { kind: 'stop' } : { kind: 'play', index: prev }
  }

  // FM:下一首/播完都拉新推荐(镜像 player.next()/handleEnded() 的 playNextFm)。
  if (fmMode) return { kind: 'fm' }

  // 心动:先推进本次推荐列表,播完拉下一批(repeat 语义与 sequence 相同)。
  // 普通模式:advance=false 的差异只在 repeat-one(auto 重播当前)。
  const next = getNextIndex(traversal, trigger === 'ended')
  if (next == null) {
    return traversal.mode === 'heart' ? { kind: 'heart' } : { kind: 'stop' }
  }
  return { kind: 'play', index: next }
}
