/**
 * 「流光」的 motion-v variants —— 三层结构各自的动画目标与过渡。
 * 移植自 Folia `components/visualizer/glowWordVariants.ts` 与 `wordGlow.ts`。
 *
 * ## 为什么参数走 `custom` 而不是写成常量对象
 *
 * 同一个 variants 对象被**整行所有词**共用（一次构建，十几个词引用同一份），
 * 而每个词的位移 / 缩放 / 颜色 / 时长都不同。所以把「词自己的参数」当 `custom` 传进去，
 * 变体写成 `(custom) => target` 的函数式形式 —— 这是 framer / motion-v 的官方机制
 * （`resolveVariantValue` 见到函数就 `variant(custom)`）。这样既避免了每词一份
 * variants 对象（N 倍分配），也避免了把词参数编进变体字符串里。
 *
 * ## 三层结构（与 `GlowWord.vue` 的 DOM 一一对应）
 *
 *  - `buildGlowLayoutVariants` —— 容器层：位移 / 缩放 / 旋转；
 *  - `glowBodyVariants`        —— 正文层：颜色 / 模糊；
 *  - `wordGlowVariants`        —— 辉光层：逐字素的双层光晕。
 *
 * ## 时间单位
 *
 * 本项目契约是毫秒，而 motion-v 的 `duration` 是**秒**。换算只在 `MS_PER_SECOND`
 * 一处发生（每个 `duration` 都过它），不要在变体里散落 `/ 1000`。
 *
 * ## 三处不能改的细节（原样保留，改一个就与 Folia 不一致）
 *
 * 1. **waiting 的 x/y 不是配置值**：`x + sin(y)*100` 与 `y + cos(x)*50` ——
 *    拿 `y` 当 sin 的入参（弧度）、`x` 当 cos 的入参。这是「从远处飘进来」的起点。
 * 2. **active 的 scale 有 `NaN` 兜底**（1.5）：`config.scale` 一旦是 NaN 会让元素
 *    整个消失；留一条兜底比"相信上游"便宜。
 * 3. **passed 的 rotate 用独立的 5 秒线性过渡**，而 scale/x/y/opacity 用 0.5 秒 ——
 *    于是词归位之后还会**慢慢继续转** 5 秒，这是「余韵」的来源。
 */

import type { VariantType } from 'motion-v'

import { colorWithAlpha } from '../shared/color-mix'
import {
  GLOW_RADII,
  SWEEP_DURATION_FACTOR,
  buildGlowKeyframes,
  buildGlowKeyframesQuantized,
  dropShadowAt
} from './core/word-glow'
import {
  ACTIVE_SCALE_MULTIPLIER,
  resolvePassedOpacity,
  resolveWaitingPose,
  type AnimationIntensity,
  type GlowWordConfig
} from './core/word-layout'
import type { LineTransitionMode, WordRevealMode } from './core/word-timing'

/** 毫秒转秒。motion-v 的 `duration` 是秒，本项目契约是毫秒，换算只在这一处 */
const MS_PER_SECOND = 1000

/**
 * 变体表。
 *
 * ⚠️ **不要**用 `Variants`（它来自 `framer-motion/dom`）：那份类型里的 `Variant`
 * 允许 `TargetResolver` 的三参数签名，与 `motion-v` 自己 `Options['variants']`
 * 声明的 `(custom: T) => VariantType` **不兼容**，传进 `<motion.xxx :variants>` 会报
 * 「Target signature provides too few arguments」。`motion-v` 的组件只认它自己那套
 * `VariantType`，所以这里按它的实际签名自己声明。
 *
 * `transitionEnd` 是**运行时支持但类型漏声明**的一项：`motion-v` 的
 * `state/utils.mjs#resolveVariant` 会把 `transitionEnd` 从变体里摘出来摊平进目标值
 * （正是"动画结束后把 filter 落回 none"依赖的行为），但 `VariantType` 里没写这个键。
 * 与其在模板里到处 `as any`，不如在类型上补一次。
 */
export type MotionTarget = VariantType & {
  transitionEnd?: Record<string, string | number>
}

export type MotionVariants<TCustom> = Record<
  string,
  MotionTarget | ((custom: TCustom) => MotionTarget)
>

/** 容器层 `custom`：词自己的几何配置 + 强度（passed 的不透明度按强度分档） */
export interface GlowLayoutCustom {
  config: GlowWordConfig
  intensity: AnimationIntensity
}

/** 正文层 / 辉光层 `custom`：颜色、时长与揭示档位 */
export interface GlowBodyCustom {
  activeColor: string
  baseColor: string
  /** 正文层颜色过渡的时长（毫秒，见 `core/word-timing.resolveDisplayDurationMs`） */
  durationMs: number
  wordRevealMode: WordRevealMode
}

/** 辉光层 `custom`：在正文层之上再加逐字素的位置信息 */
export interface GlowGraphemeCustom extends GlowBodyCustom {
  /** 字素在词内的下标 */
  index: number
  /** 词的字素总数（`> 1` 才走逐字素扫描，否则整词持续辉光） */
  total: number
  /** 字素自己的起止时刻（毫秒） */
  charStartTimeMs: number
  charEndTimeMs: number
  /** 词的起始时刻（毫秒）—— 算字素相对词的延迟 */
  wordStartTimeMs: number
}

/** 容器层：位移 / 缩放 / 旋转（Folia `buildGlowWordLayoutVariants`） */
export function buildGlowLayoutVariants(
  intensity: AnimationIntensity,
  enableWordRotation: boolean
): MotionVariants<GlowLayoutCustom> {
  return {
    waiting: ({ config }: GlowLayoutCustom) => {
      const pose = resolveWaitingPose(config, enableWordRotation)
      return { ...pose, transition: { duration: 0.4 } }
    },
    active: ({ config }: GlowLayoutCustom) => ({
      opacity: 1,
      // NaN 兜底见文件头第 2 条
      scale: Number.isNaN(config.scale) ? 1.5 : config.scale * ACTIVE_SCALE_MULTIPLIER,
      x: config.x,
      y: config.y,
      rotate: config.rotate,
      transition: {
        type: 'spring' as const,
        stiffness: 200,
        damping: 20,
        opacity: { duration: 0.1 }
      }
    }),
    passed: ({ config }: GlowLayoutCustom) => ({
      opacity: resolvePassedOpacity(intensity),
      scale: config.scale || 1,
      x: config.x,
      y: config.y,
      // 独立 5 秒线性过渡，见文件头第 3 条
      rotate: config.rotate + config.passedRotate,
      transition: {
        duration: 0.5,
        rotate: { duration: 5, ease: 'linear' as const }
      }
    })
  }
}

/** 正文层：颜色 + 模糊（Folia `glowWordBodyVariants`） */
export const glowBodyVariants: MotionVariants<GlowBodyCustom> = {
  waiting: ({ baseColor }: GlowBodyCustom) => ({
    color: baseColor,
    filter: 'blur(10px)',
    transition: { duration: 0.4 }
  }),
  active: ({ activeColor, durationMs, wordRevealMode }: GlowBodyCustom) => ({
    color: activeColor,
    filter: 'none',
    transition: {
      color: { duration: durationMs / MS_PER_SECOND || 0.2, ease: 'linear' as const },
      filter: {
        type: 'tween' as const,
        duration: wordRevealMode === 'instant' ? 0.08 : wordRevealMode === 'fast' ? 0.12 : 0.2
      }
    },
    // 动画结束后摘掉 filter：留着 blur(0px) 会一直保留一个模糊合成层
    transitionEnd: { filter: 'none' }
  }),
  passed: ({ baseColor, wordRevealMode }: GlowBodyCustom) => ({
    color: baseColor,
    filter: 'blur(0px)',
    transition: {
      color: {
        duration: wordRevealMode === 'instant' ? 0.12 : wordRevealMode === 'fast' ? 0.24 : 0.8,
        ease: 'easeInOut' as const
      },
      filter: {
        duration: wordRevealMode === 'instant' ? 0.12 : wordRevealMode === 'fast' ? 0.2 : 0.5
      }
    },
    transitionEnd: { filter: 'none' }
  })
}

/**
 * 当前是否走 drop-shadow 降级形态。
 *
 * 形态在**每次词转 active 时**解析一次（与原实现一致）：开关翻转后从下一个词开始生效，
 * 已经在跑的那一次脉冲不换形态 —— 换形态会让同一层上的关键帧类型从 text-shadow
 * 变成 filter，视觉上就是「光晕闪一下」。
 */
let quantizedForm = false

/** 由渲染层在挂载时同步一次（来源：`shared/glow-blur-quantize.isGlowBlurQuantized`） */
export function setGlowQuantizedForm(enabled: boolean): void {
  quantizedForm = enabled
}

/** 辉光层的「等待」目标：两种形态都要把上一次的残留清干净 */
function buildGlowWaiting(quantized: boolean): MotionTarget {
  if (quantized) {
    // opacity / filter 也要复位：开关从"关"翻到"开"时，之前的词可能还挂着 text-shadow 形态
    return {
      color: 'transparent',
      opacity: 0,
      filter: 'none',
      textShadow: 'none',
      transition: { duration: 0 }
    }
  }
  return {
    color: 'transparent',
    textShadow: 'none',
    opacity: 1,
    filter: 'none',
    transition: { duration: 0 }
  }
}

/**
 * 辉光层：逐字素的双层光晕（Folia `wordGlowVariants`）。
 *
 * 四条分支（顺序即优先级，不要重排）：
 *  1. `instant` —— 极短行：半径更小、整行一起亮；
 *  2. `fast` —— 快速行：介于两者之间；
 *  3. `total > 1` —— 多字素词：**逐字素扫描**，每个字素按自己的时间区间亮起再淡出；
 *  4. 其余 —— 单字素 / 整词：一次亮起后**保持到本词结束**。
 *
 * `peaks` 是强度序列：`0` 表示完全无光晕（关键帧写 `none`），`1` 表示满强度双层光晕。
 * 前三条都是「起 → 峰 → 灭」，只有第 4 条是「起 → 保持」——
 * 这正是「单字持续发光、多字扫过去」的来源。
 */
export const wordGlowVariants: MotionVariants<GlowGraphemeCustom> = {
  waiting: () => buildGlowWaiting(quantizedForm),
  active: (custom: GlowGraphemeCustom) => {
    const { activeColor, durationMs, wordRevealMode } = custom
    const durationSeconds = durationMs / MS_PER_SECOND
    const quantized = quantizedForm

    const buildFrames = (inner: number, outer: number, peaks: readonly number[]): MotionTarget =>
      quantized
        ? { ...buildGlowKeyframesQuantized(activeColor, inner, outer, peaks, colorWithAlpha) }
        : { ...buildGlowKeyframes(activeColor, inner, outer, peaks) }

    if (wordRevealMode === 'instant') {
      const { inner, outer } = GLOW_RADII.instant
      return {
        ...buildFrames(inner, outer, [0, 1, 0]),
        transition: {
          duration: Math.min(durationSeconds || 0.08, 0.12),
          times: [0, 0.35, 1],
          ease: 'easeOut' as const
        }
      }
    }

    if (wordRevealMode === 'fast') {
      const { inner, outer } = GLOW_RADII.fast
      return {
        ...buildFrames(inner, outer, [0, 1, 0]),
        transition: {
          duration: Math.min(Math.max(durationSeconds || 0.12, 0.12), 0.2),
          times: [0, 0.4, 1],
          ease: 'easeInOut' as const
        }
      }
    }

    const { index, total, charStartTimeMs, charEndTimeMs, wordStartTimeMs } = custom
    if (total > 1) {
      // 逐字素扫描：时长与延迟都取自字素自己的时间区间，缺时间戳时退回均分
      const singleDurationSeconds = durationSeconds / total
      const hasCharTiming =
        Number.isFinite(charStartTimeMs) &&
        Number.isFinite(charEndTimeMs) &&
        Number.isFinite(wordStartTimeMs)
      const charDurationSeconds = hasCharTiming
        ? Math.max((charEndTimeMs - charStartTimeMs) / MS_PER_SECOND, 0.001)
        : singleDurationSeconds
      const charDelaySeconds = hasCharTiming
        ? Math.max(0, (charStartTimeMs - wordStartTimeMs) / MS_PER_SECOND)
        : singleDurationSeconds * index

      const { inner, outer } = GLOW_RADII.sweep
      return {
        ...buildFrames(inner, outer, [0, 1, 0]),
        transition: {
          duration: charDurationSeconds * SWEEP_DURATION_FACTOR,
          times: [0, 0.3, 1],
          delay: charDelaySeconds,
          ease: 'easeInOut' as const
        }
      }
    }

    // 单字素 / 整词：亮起后保持到本词结束（末帧仍是满强度）
    const { inner, outer } = GLOW_RADII.sustained
    return {
      ...buildFrames(inner, outer, [0, 1, 1]),
      transition: {
        duration: durationSeconds || 0.1,
        times: [0, 0.9, 1],
        ease: 'easeInOut' as const
      }
    }
  },
  passed: ({ activeColor, wordRevealMode }: GlowGraphemeCustom) => {
    const transition = {
      duration: wordRevealMode === 'instant' ? 0.12 : wordRevealMode === 'fast' ? 0.22 : 0.9,
      ease: 'easeOut' as const
    }
    if (!quantizedForm) {
      return { color: 'transparent', textShadow: 'none', transition }
    }
    // 降级形态必须**重述颜色**：motion 会把新变体没写的键立刻复位到 initial（waiting）
    // 的值，而 transparent 的字形投不出影子 —— 光晕会在最亮的一刻突然消失而不是淡出。
    return {
      color: activeColor,
      opacity: 0,
      // 半径归零：光晕随 alpha 一起缩回去（原实现就是 dropShadowAt(color, 0, 0)）
      filter: dropShadowAt(activeColor, 0, 0, colorWithAlpha),
      transition
    }
  }
}

/** 行容器的出入场参数（把 `core/word-timing` 的毫秒档位换成 motion-v 的秒） */
export function resolveContainerMotionSeconds(mode: LineTransitionMode): {
  initial: MotionTarget
  animate: MotionTarget
  exit: MotionTarget
} {
  if (mode === 'none') {
    return {
      initial: { opacity: 1, scale: 1, filter: 'blur(0px)' },
      animate: { opacity: 1, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } },
      exit: {
        opacity: 0,
        scale: 1.02,
        filter: 'blur(6px)',
        transition: { duration: 0.12, ease: 'easeOut' as const }
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
        transition: { duration: 0.16, ease: 'easeOut' as const },
        transitionEnd: { filter: 'none' }
      },
      exit: {
        opacity: 0,
        scale: 1.04,
        filter: 'blur(10px)',
        transition: { duration: 0.16, ease: 'easeInOut' as const }
      }
    }
  }

  // normal：animate 不写 duration（交给 motion 的默认时长），与上游一致
  return {
    initial: { opacity: 0, scale: 0.9, filter: 'blur(10px)' },
    animate: { opacity: 1, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } },
    exit: { opacity: 0, scale: 1.1, filter: 'blur(20px)', transition: { duration: 0.3 } }
  }
}
