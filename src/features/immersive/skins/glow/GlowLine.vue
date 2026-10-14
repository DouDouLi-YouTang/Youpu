<script setup lang="ts">
import { computed } from 'vue'
import { motion } from 'motion-v'

import type { DisplayWord } from './core/cjk-layout'
import type { AnimationIntensity, GlowLineConfig, GlowWordConfig } from './core/word-layout'
import type { GlowWordTimingProfile } from './core/word-timing'
import { buildGlowLayoutVariants, resolveContainerMotionSeconds } from './glow-variants'
import type { SmoothClock } from '../shared/use-smooth-clock'
import { resolveWordColor, type WordColorEntry } from '../shared/word-coloring'
import GlowWord from './GlowWord.vue'

/**
 * 「流光」的**一整行** —— 整行出入场 + flex 排版 + 逐词列表。
 * 移植自 Folia `components/visualizer/classic/Visualizer.tsx:346-375`。
 *
 * ## 为什么行容器要自己播出入场（而不是由父级控制）
 *
 * 上游把 `initial / animate / exit` 直接写在行容器上，由外层 `AnimatePresence` 驱动。
 * 本项目保持同一分工：本组件**只声明目标**（三档由 `resolveContainerMotionSeconds`
 * 给出），`exit` 由 `<SkinGlow>` 的 `AnimatePresence` 触发 —— 组件自己不清楚
 * "什么时候退场"，那是父级和 Vue 的卸载语义说了算。
 *
 * ⚠️ **呼吸浮动不在这里**：它属于「舞台」（跨行常驻、无限循环），本组件随行卸载，
 * 放在这里会让浮动每次换行都从 y=0 重跳。见 `SkinGlow.vue` 的 `.glow-stage-float`。
 *
 * ## 逐词为什么是子组件而不是本组件里的 v-for
 *
 * 每个词有自己的三态机（`waiting -> active -> passed`）与**逐帧状态判定**。若把它们
 * 放在本组件里，任何一个词跨过时间边界都会让本组件重渲染 → 整行十几个词全部进 diff。
 * 拆成 `GlowWord` 后，状态 ref 住在词自己内部，跨边界只重渲染那**一个**词
 * （这正是上游在 `GlowWord.tsx` 注释里强调的点）。
 *
 * ⚠️ **本组件不含任何时间逻辑**：`points`（逐词几何）与 `profile`（行档位）都由
 * 调用方算好。逐帧的时间只出现在 `GlowWord` 内部的三个状态判定里。
 */

const props = defineProps<{
  /** 整行的容器档位（justify / align / perspective） */
  lineConfig: GlowLineConfig
  /** 逐词几何，与 `words` 下标一一对应（由 `buildWordLayout` 产出） */
  wordConfigs: readonly GlowWordConfig[]
  /** 显示词（文本 + 起止时刻，毫秒） */
  words: readonly DisplayWord[]
  /** 行渲染档位（逐词时序 + 行过渡档），由 `resolveGlowRenderProfile` 推出 */
  profile: GlowWordTimingProfile
  /** 逐帧时钟：整行共享一条 rAF（见 shared/use-smooth-clock） */
  clock: SmoothClock
  intensity: AnimationIntensity
  enableWordRotation: boolean
  /** 主行字号（clamp 字符串，已含倍率） */
  fontSize: string
  /** 未唱 / 唱过的字色 */
  baseColor: string
  /** 正在唱的字色（**未命中关键词**时的回退色） */
  activeColor: string
  /**
   * 逐词配色（关键词着色）。
   *
   * 上游在逐词 map 里对每个词调一次 `resolveWordColor(word.text, theme.wordColors,
   * theme.accentColor)`（`classic/Visualizer.tsx:325`），所以「正在唱的字」颜色
   * **不是整行同一个**：命中关键词的词用它自己的颜色，其余回退到 `accentColor`。
   * 本组件因此不再把 `activeColor` 直接下传，而是逐词解析（见 `wordActiveColor`）。
   *
   * 为空数组时所有词都回退到 `activeColor`，与加这个功能之前的表现完全一致。
   */
  wordColors?: readonly WordColorEntry[]
  /** 是否合唱行（副歌行，来自 `/song/chorus`；见 `GlowWord.vue` 文件头） */
  isChorus: boolean
}>()

/**
 * 行容器的出入场参数：把行过渡档位换成 motion-v 的秒制目标。
 *
 * 换算函数在 `glow-variants.resolveContainerMotionSeconds`（**唯一**一处毫秒→秒），
 * 本组件不再自己拼时长 —— 否则「三档各多久」会有第二处答案。
 */
const containerMotion = computed(() =>
  resolveContainerMotionSeconds(props.profile.lineTransitionMode)
)

/**
 * 容器层 variants：**整行构建一次**，所有词共用同一个对象。
 *
 * 上游就是这么做的（`Visualizer.tsx` 里 `useMemo` 出来、当 prop 传给每个 `GlowWord`）。
 * 若让每个词各自构建，一行十几个词就是十几份等价对象 —— 变体函数里读的
 * 「这个词自己的几何」本来就走 `custom`，不存在"每个词需要不同 variants"这回事。
 */
const layoutVariants = computed(() =>
  buildGlowLayoutVariants(props.intensity, props.enableWordRotation)
)

/**
 * 每个词自己的「正在唱」颜色。
 *
 * 逐词解析是**上游的原样分工**：关键词着色只改颜色，不参与逐字 timing、
 * 行状态或副歌效果（见官网文档的「关键词着色」一节）。放在这里而不是
 * `GlowWord` 内部，是因为一行只需解析一次 —— 逐词组件内部再算一遍
 * 就是同一件事有两个答案，且会让每个词各自订阅 `wordColors`。
 */
const wordActiveColors = computed(() =>
  props.words.map((word) => resolveWordColor(word.text, props.wordColors, props.activeColor))
)
</script>

<template>
  <motion.div
    class="glow-line"
    :class="[lineConfig.justifyContent, lineConfig.alignItems]"
    :style="{ perspective: `${lineConfig.perspective}px` }"
    :initial="containerMotion.initial"
    :animate="containerMotion.animate"
    :exit="containerMotion.exit"
  >
    <GlowWord
      v-for="(word, index) in words"
      :key="wordConfigs[index]?.id ?? `${index}`"
      :word="word"
      :config="wordConfigs[index]"
      :profile="profile"
      :clock="clock"
      :intensity="intensity"
      :layout-variants="layoutVariants"
      :font-size="fontSize"
      :base-color="baseColor"
      :active-color="wordActiveColors[index] ?? activeColor"
      :is-chorus="isChorus"
    />
  </motion.div>
</template>

<style scoped lang="scss" src="./glow-line.scss"></style>
