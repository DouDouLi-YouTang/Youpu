<script setup lang="ts">
import { computed } from 'vue'
import { AnimatePresence, motion } from 'motion-v'

import type { SmoothClock } from '../shared/use-smooth-clock'
import { buildWordGraphemeTimings, type GraphemeTiming } from './core/grapheme-timing'
import type { DisplayWord } from './core/cjk-layout'
import type { AnimationIntensity, GlowWordConfig } from './core/word-layout'
import {
  resolveActiveEndMs,
  resolveDisplayDurationMs,
  type GlowWordTimingProfile
} from './core/word-timing'
import {
  buildGlowLayoutVariants,
  glowBodyVariants,
  wordGlowVariants,
  type GlowBodyCustom,
  type GlowGraphemeCustom,
  type GlowLayoutCustom
} from './glow-variants'
import { useGlowWordStatus } from './use-glow-word-status'

/**
 * 「流光」的**单个词** —— 三态机 + 三层结构（辉光层 / 正文层 / 涟漪层）。
 * 移植自 Folia `components/visualizer/GlowWord.tsx`。
 *
 * ## 三层为什么这样叠
 *
 * ```
 * <div>                                  容器层：位移 / 缩放 / 旋转（variants）
 *   <span absolute inset-0 aria-hidden>  辉光层：透明字 + 双层 text-shadow（逐字素）
 *   <span relative z-10>                 正文层：真正被读的字（颜色 / 模糊）
 *   <AnimatePresence>…</AnimatePresence>  涟漪层：仅合唱行
 * </div>
 * ```
 *
 * 辉光压在正文**下面**且字色透明，所以高亮可以开得很大而不改变正文笔画粗细
 * （`word-glow.ts` 文件头解释了为什么单层光晕给不出这种衰减）。
 *
 * ## 三态机只在这里持有
 *
 * `waiting -> active -> passed` 的判定在 `core/word-timing.resolveWordStatus`（纯函数、
 * 有单测），驱动它的 rAF 在 `use-glow-word-status`。本组件只负责把状态喂给三层：
 * 状态不变就**不重渲染**，这是上游专门注释强调的一点。
 *
 * ## 本项目的两处适配
 *
 *  - **时间源**：Folia 的 `currentTime` 是逐帧 MotionValue；本项目 `player.currentTimeMs`
 *    被节流到 4Hz，所以改从共享的逐帧时钟读（见 `shared/use-smooth-clock.ts`）。
 *  - **`isChorus`**：本项目的 `LyricLine` 没有这个字段（解析层不产出），
 *    所以涟漪层恒不渲染。**刻意不猜**：猜错会在本该安静的行上凭空冒出涟漪。
 *    将来解析层补上字段时，把这里换成真实值即可，模板一行不用改。
 */

const props = defineProps<{
  /** 显示词（文本 + 起止时刻，毫秒） */
  word: DisplayWord
  /** 逐词几何（由 `core/word-layout` 按行种子算好，整行生命周期内不变） */
  config: GlowWordConfig
  /** 行渲染档位（由 `glow-profile` 从共享 render-hints 推出） */
  profile: GlowWordTimingProfile
  /** 逐帧时钟（共享，整行一个） */
  clock: SmoothClock
  intensity: AnimationIntensity
  enableWordRotation: boolean
  /** 主行字号（clamp 字符串，由 `glow-adapter.resolveGlowFontSize` 拼好） */
  fontSize: string
  /** 未唱到 / 唱过时的字色 */
  baseColor: string
  /** 正在唱时的字色（`shared/word-coloring.resolveWordColor` 的结果） */
  activeColor: string
  /** 是否合唱行（本项目恒为 false，见文件头） */
  isChorus: boolean
}>()

/** 词的 active 结束时刻（`instant` 档会拉到整行退场，见 core 的三档说明） */
const activeEndTimeMs = computed(() =>
  resolveActiveEndMs(props.word.startTime, props.word.endTime, props.profile)
)

/** 正文层颜色过渡的时长（毫秒）——**不是**容器动画的时长 */
const displayDurationMs = computed(() =>
  resolveDisplayDurationMs(props.word.startTime, props.word.endTime, props.profile)
)

const status = useGlowWordStatus(
  props.clock,
  { startTimeMs: props.word.startTime, activeEndTimeMs: activeEndTimeMs.value },
  props.profile
)

/** 字素时间戳：整词一个 span 还是逐字素扫描，由它的长度决定（见 `wordGlowVariants`） */
const graphemes = computed<GraphemeTiming[]>(() =>
  buildWordGraphemeTimings({
    text: props.word.text,
    startTime: props.word.startTime,
    endTime: props.word.endTime
  })
)

/** 整行共用的容器层 variants（`custom` 才带每个词自己的几何） */
const layoutVariants = computed(() =>
  buildGlowLayoutVariants(props.intensity, props.enableWordRotation)
)

const layoutCustom = computed<GlowLayoutCustom>(() => ({
  config: props.config,
  intensity: props.intensity
}))

const bodyCustom = computed<GlowBodyCustom>(() => ({
  activeColor: props.activeColor,
  baseColor: props.baseColor,
  durationMs: displayDurationMs.value,
  wordRevealMode: props.profile.wordRevealMode
}))

/** 逐字素的 `custom`：在正文层参数上补位置信息 */
function graphemeCustom(timing: GraphemeTiming, index: number): GlowGraphemeCustom {
  return {
    ...bodyCustom.value,
    index,
    total: graphemes.value.length,
    charStartTimeMs: timing.startTimeMs,
    charEndTimeMs: timing.endTimeMs,
    wordStartTimeMs: props.word.startTime
  }
}

/**
 * 涟漪的终末缩放 —— 上游是 `useMemo(() => 1.5 + Math.random() * 2, [])`，
 * **每个词都不一样、每次挂载重掷**。这是整个流光里唯一一处非确定性，照原样保留。
 */
const rippleScale = 1.5 + Math.random() * 2

const layoutStyle = computed(() => ({
  marginRight: props.config.marginRight,
  alignSelf: props.config.alignSelf
}))
</script>

<template>
  <motion.div
    :custom="layoutCustom"
    :variants="layoutVariants"
    initial="waiting"
    :animate="status"
    class="glow-word"
    :style="{ ...layoutStyle, fontSize }"
  >
    <!-- 辉光层：字色透明，只出双层光晕；压在正文下面，所以不影响可读性 -->
    <span class="glow-word-glow" aria-hidden="true">
      <template v-if="graphemes.length > 1">
        <motion.span
          v-for="(timing, index) in graphemes"
          :key="index"
          :custom="graphemeCustom(timing, index)"
          :variants="wordGlowVariants"
        >
          {{ timing.char }}
        </motion.span>
      </template>
      <motion.span v-else :custom="bodyCustom" :variants="wordGlowVariants">
        {{ word.text }}
      </motion.span>
    </span>

    <!-- 正文层：真正被读的字（颜色与模糊都在这一层） -->
    <motion.span class="glow-word-body" :custom="bodyCustom" :variants="glowBodyVariants">
      {{ word.text }}
    </motion.span>

    <!-- 涟漪层：仅合唱行（本项目恒不渲染，见文件头） -->
    <AnimatePresence>
      <motion.span
        v-if="isChorus && status === 'active'"
        key="ripple"
        class="glow-word-ripple"
        :style="{ borderColor: activeColor }"
        :initial="{ scale: 0.2, opacity: 0.8 }"
        :animate="{ scale: rippleScale, opacity: 0 }"
        :exit="{ opacity: 0 }"
        :transition="{ duration: 0.5, ease: 'easeOut' }"
      />
    </AnimatePresence>
  </motion.div>
</template>

<style scoped lang="scss" src="./glow-word.scss"></style>
