/**
 * 「流光」的**逐字素时间戳** —— 把「一个词」切成一串带时间的字素。
 *
 * 移植自 Folia `utils/lyrics/graphemeTiming.ts` 的 `buildWordGraphemeTimings`
 * （`splitLyricGraphemes` + `buildEvenGraphemeTimings` 那两段；同文件里的
 * `buildLineGraphemeTimeline` 是给"整行一次性绘制"的渲染器用的，逐词渲染用不到）。
 *
 * ## 谁在用
 *
 * 流光的辉光层是**逐字素**画的：一个词里的每个字各自有一个 `motion.span`，
 * 各自按自己的时间区间走一次「亮起 → 淡出」的扫描，于是多字词的辉光看起来是
 * **从左到右扫过去**的，而不是整词一起闪。这套时间戳就是那次扫描的输入。
 *
 * ## 单位
 *
 * 全部**毫秒**（本项目契约）。Folia 那一层是秒，换算在适配层完成。
 *
 * ## 为什么这里没有音节（syllables）分支
 *
 * Folia 的 `Word` 带可选的 `syllables`，有的话按音节各自均分、再在音节内部均分。
 * 本项目的 `LyricWord` **没有**这个字段（解析层不产出音节，见 `@/domain/lyric`），
 * 所以那条分支在这里是永远走不到的代码 —— 搬过来只会多一份永远没人测的实现。
 * 将来若解析层补上音节，再在这一层加分支即可，调用方一行不用改。
 */

import { segmentGraphemes } from '../../shared/graphemes'
import type { DisplayWord } from './cjk-layout'

/** 一个字素及其时间区间（毫秒） */
export interface GraphemeTiming {
  /** 字素文本（emoji / 组合字符可能由多个码点组成） */
  char: string
  /** 该字素开始亮起的时刻（毫秒） */
  startTimeMs: number
  /** 该字素结束的时刻（毫秒，闭区间 —— 与三态机的 `<=` 判定同口径） */
  endTimeMs: number
  /** 该字素属于第几个词（整行时间轴用；逐词渲染时通常不传） */
  wordIndex?: number
}

/**
 * 把一个词的 `[startTime, endTime]` **均分**给它的每个字素。
 *
 * 均分而不是按字宽加权：Folia 原样如此。歌词的逐字时间戳本来就来自解析器
 * （词级），词内没有更细的信息，均分是"最不假设"的退化方案。
 *
 * ⚠️ 三个必须保持的边界（原样）：
 *  1. 时长为负（上游数据乱序）时钳成 0 —— 不产生倒着走的时间轴；
 *  2. **最后一个字素的结束时刻取词的 `endTime` 本身**，不是 `start + 单位时长 × 个数`：
 *     浮点累加会让末字比词早结束一丁点（0.0000001 级别），三态机的 `<=` 边界
 *     就会在一个采样点上判定不一致；
 *  3. 空串返回空数组（调用方按"整词一个 span"降级，见 GlowWord）。
 */
export function buildWordGraphemeTimings(
  word: Pick<DisplayWord, 'text' | 'startTime' | 'endTime'>,
  wordIndex?: number
): GraphemeTiming[] {
  const graphemes = segmentGraphemes(word.text)
  if (graphemes.length === 0) return []

  const durationMs = Math.max(word.endTime - word.startTime, 0)
  const unitDurationMs = durationMs / graphemes.length
  const hasWordIndex = typeof wordIndex === 'number'

  return graphemes.map((grapheme, index) => {
    const timing: GraphemeTiming = {
      char: grapheme.text,
      startTimeMs: word.startTime + unitDurationMs * index,
      endTimeMs:
        index === graphemes.length - 1
          ? word.endTime
          : word.startTime + unitDurationMs * (index + 1)
    }
    if (hasWordIndex) timing.wordIndex = wordIndex
    return timing
  })
}
