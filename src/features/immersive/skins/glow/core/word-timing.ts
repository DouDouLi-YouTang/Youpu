/**
 * 「流光」的**逐词时序** —— 三态机的判定、每个词 active 到什么时候、以及整行容器
 * 出入场的动画档位。移植自 Folia `components/visualizer/glowWordTiming.ts`。
 *
 * ## 这一层解决什么
 *
 * 「流光」的每个词各自走 `waiting -> active -> passed`，三个状态的**切换时刻**不是
 * 词自己的起止时间那么简单：
 *  - 词会**提前** `lookahead` 进入 active（让它先亮起来等声音，而不是等音到了才亮）；
 *  - active 的**结束**时刻取决于这一行是 normal / fast / instant 哪一档 —— 快速行里
 *    词太短，若严格按词尾结束，辉光还没起来就灭了。
 *
 * 所以原实现把这些推导集中在一个 "render profile" 上。本文件是那份 profile 的
 * **消费侧**：给定 profile 与词，回答「现在是哪个状态」。
 *
 * ## 单位
 *
 * 全部**毫秒**（本项目契约）。Folia 那一层是秒，换算在适配层（`glow-adapter.ts`）。
 *
 * ⚠️ 这里**刻意不 import** `shared/render-hints.ts`：本文件只依赖"已经被算好的
 * profile"（那几个数），不关心它们是怎么来的。于是这一层可以在没有歌词管线、
 * 没有 DOM 的纯 node 环境里单测。
 */

/** 词在什么时候该亮（Folia `WordRevealMode`） */
export type WordRevealMode = 'normal' | 'fast' | 'instant'

/** 整行出入场的动画档位（Folia `LineTransitionMode`） */
export type LineTransitionMode = 'normal' | 'fast' | 'none'

/**
 * 逐词时序的输入（对齐 Folia `GlowWordRenderProfile`，单位换成毫秒）。
 *
 * 这几个字段都由 `shared/render-hints.ts` 从行数据推出来 —— 本文件不做那个推导。
 */
export interface GlowWordTimingProfile {
  /** 词的提前亮起量（毫秒）：instant 30 / fast 80 / normal 150 */
  wordLookaheadMs: number
  /** 这一行最晚该被留在屏幕上的时刻（毫秒，绝对时间） */
  lineRenderEndTimeMs: number
  /** 词的亮起档位 */
  wordRevealMode: WordRevealMode
  /** 整行出入场档位 */
  lineTransitionMode: LineTransitionMode
}

/** 词的三态 */
export type GlowWordStatus = 'waiting' | 'active' | 'passed'

/**
 * 词「亮起」的提前量（毫秒）—— 对齐 Folia `resolveGlowWordRenderProfile` 里的三元式。
 *
 * 快速行提前得多一些（80ms）、极短行反而更少（30ms）：
 * instant 档的词本来就只有几十毫秒，提前 150ms 会让整行还没唱就全亮着。
 */
export function resolveWordLookaheadMs(mode: WordRevealMode): number {
  if (mode === 'instant') return 30
  if (mode === 'fast') return 80
  return 150
}

/**
 * 判定一个词此刻处于哪个状态（Folia `GlowWord.tsx` 的 `useMotionValueEvent` 内层）。
 *
 * ⚠️ **三个边界都是原样，不要"顺手统一"**：
 *  1. 下界是 `>=`：`t` 正好等于 `start - lookahead` 就算 active（不是 waiting）；
 *  2. 上界是 `<=`：`t` 正好等于 `activeEndTime` 仍是 active（不是 passed）；
 *  3. 只有 `t > activeEndTime` 才转 passed。
 *
 * 判序也是原样：**先判 active**，再判 passed，剩下才是 waiting —— 写成三段对称的
 * if/else 只要边界符号错一个，词就会在一个采样点上闪回 waiting。
 *
 * @param currentTimeMs 当前时钟（毫秒）
 * @param wordStartMs   词的起始时刻
 * @param activeEndMs   词的 active 结束时刻（见 `resolveActiveEndMs`）
 * @param lookaheadMs   提前量（见 `resolveWordLookaheadMs`）
 */
export function resolveWordStatus(
  currentTimeMs: number,
  wordStartMs: number,
  activeEndMs: number,
  lookaheadMs: number
): GlowWordStatus {
  if (currentTimeMs >= wordStartMs - lookaheadMs && currentTimeMs <= activeEndMs) return 'active'
  if (currentTimeMs > activeEndMs) return 'passed'
  return 'waiting'
}

/**
 * 词的 active 结束时刻（Folia `getGlowWordActiveEndTime`）。
 *
 * 三档的语义（原样）：
 *  - `instant`：整行一起亮，直到整行退场 —— 词自己的时间戳在这档里不可信（太短）；
 *  - `fast`：词的结束时间与「至少亮 120ms」取大，再被整行的退场时刻封顶 ——
 *    既保证看得见，又不会活过这一行；
 *  - `normal`：就用词的结束时间。
 */
export function resolveActiveEndMs(
  wordStartMs: number,
  wordEndMs: number,
  profile: Pick<GlowWordTimingProfile, 'wordRevealMode' | 'lineRenderEndTimeMs'>
): number {
  if (profile.wordRevealMode === 'instant') return profile.lineRenderEndTimeMs
  if (profile.wordRevealMode === 'fast') {
    return Math.min(profile.lineRenderEndTimeMs, Math.max(wordEndMs, wordStartMs + 120))
  }
  return wordEndMs
}

/**
 * 词的显示时长（Folia `getGlowWordDisplayDuration`）—— **正文层颜色过渡**用的时长，
 * 不是容器的动画时长。
 *
 * 之所以要有下限（instant 80 / fast 120 / normal 100ms）：上游给某些词的
 * `endTime` 与 `startTime` 几乎相等，颜色过渡的 duration 会趋近 0，
 * 视觉上就是颜色硬跳到高亮色（没有渐变），在快速换行的段落里非常刺眼。
 */
export function resolveDisplayDurationMs(
  wordStartMs: number,
  wordEndMs: number,
  profile: Pick<GlowWordTimingProfile, 'wordRevealMode' | 'lineRenderEndTimeMs'>
): number {
  const activeEndMs = resolveActiveEndMs(wordStartMs, wordEndMs, profile)
  const floorMs =
    profile.wordRevealMode === 'instant' ? 80 : profile.wordRevealMode === 'fast' ? 120 : 100
  return Math.max(activeEndMs - wordStartMs, floorMs)
}

/** 整行容器的出入场参数（motion-v 的 initial / animate / exit，单位已换成毫秒） */
export interface GlowLineContainerMotion {
  initial: Record<string, string | number>
  animate: Record<string, unknown>
  exit: Record<string, unknown>
}

/**
 * 整行容器的出入场动画（Folia `getGlowWordLineContainerMotion`）。
 *
 * ⚠️ 三档的 `animate` 都带 `transitionEnd: { filter: 'none' }`。
 * 这**不是**可选优化：动画结束后若还挂着 `blur(0px)`，整个歌词行会一直保留一个
 * 模糊的合成层，长时间停留时持续吃 GPU —— 原实现专门注释说明过这一点。
 * 摘掉 filter 才是"没有模糊"。
 *
 * 时间字段叫 `durationMs`（本项目毫秒契约）；交给 motion-v 时由适配层换成秒。
 */
export function resolveLineContainerMotion(mode: LineTransitionMode): GlowLineContainerMotion {
  if (mode === 'none') {
    return {
      initial: { opacity: 1, scale: 1, filter: 'blur(0px)' },
      animate: { opacity: 1, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } },
      exit: {
        opacity: 0,
        scale: 1.02,
        filter: 'blur(6px)',
        transition: { durationMs: 120, ease: 'easeOut' }
      }
    }
  }

  if (mode === 'fast') {
    return {
      initial: { opacity: 0.35, scale: 0.96, filter: 'blur(4px)' },
      animate: {
        opacity: 1,
        scale: 1,
        filter: 'blur(0px)',
        transition: { durationMs: 160, ease: 'easeOut' },
        transitionEnd: { filter: 'none' }
      },
      exit: {
        opacity: 0,
        scale: 1.04,
        filter: 'blur(10px)',
        transition: { durationMs: 160, ease: 'easeInOut' }
      }
    }
  }

  // normal：animate 没有显式 duration（Folia 让 framer 用默认时长）
  return {
    initial: { opacity: 0, scale: 0.9, filter: 'blur(10px)' },
    animate: { opacity: 1, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } },
    exit: { opacity: 0, scale: 1.1, filter: 'blur(20px)', transition: { durationMs: 300 } }
  }
}
