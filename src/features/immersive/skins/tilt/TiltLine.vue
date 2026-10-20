<script setup lang="ts">
import { computed } from 'vue'

import { SHORT_LAST_SEGMENT_SCALE } from './tilt-adapter'
import type { TiltCharModel, TiltSegmentModel, TiltLineModel } from './use-tilt-timing'

/**
 * 「倾诉」当前行的渲染层：**段 = 一行**（整段居中），**字素 = 一个 span**。
 *
 * 为什么按字素铺 span：逐字淡入 / 脉冲是每个字独立的时间轴，只能各自一个元素。
 * 行内用 flex（而不是 inline-block 排列）有两个好处：
 *  1. span 之间的模板空白是「只有空白的文本节点」，在 flex 容器里不渲染 —— 不会多出字距；
 *  2. 字间距照常由 letter-spacing 继承进来，逐字的 span 宽度与 pretext 的测量口径一致。
 *
 * 组件不含任何时间逻辑：所有延迟/时长都由 use-tilt-timing 算好，这里只把它们写成 CSS 变量。
 */
const props = defineProps<{
  model: TiltLineModel
  paused: boolean
  /** 当前主题实际要用的字体栈（与排版测量同源） */
  fontFamily: string
  /** 普通段字重（与排版测量同源） */
  plainWeight: number
  /** 倾斜段字重（与排版测量同源） */
  tiltWeight: number
}>()
const emit = defineEmits<{ seek: [] }>()

/** 主歌词自己的字体与字重；设置在根节点，逐段通过继承 / CSS 变量读取。 */
const lineStyle = computed<Record<string, string>>(() => ({
  fontFamily: props.fontFamily,
  '--tilt-plain-font-weight': String(props.plainWeight),
  '--tilt-tilt-font-weight': String(props.tiltWeight)
}))

/** 逐字动画参数 → CSS 变量（关键帧在 tilt-line.scss，名字与这里的变量一一对应） */
function charStyle(char: TiltCharModel): Record<string, string> {
  return {
    '--tilt-fade-delay': `${char.fadeDelayMs}ms`,
    '--tilt-pulse-delay': `${char.pulseDelayMs}ms`,
    '--tilt-pulse-dur': `${char.pulseDurationMs}ms`,
    '--tilt-wave': `${char.wavePx}px`,
    '--tilt-peak': `${char.peak}`
  }
}

/** 末段过短的补偿是整段放大（笔记 §2.4） */
function rowStyle(segment: TiltSegmentModel): Record<string, string> | undefined {
  return segment.isShortLast ? { '--tilt-row-scale': `${SHORT_LAST_SEGMENT_SCALE}` } : undefined
}
</script>

<template>
  <div class="tilt-line" :class="{ 'is-paused': paused }" :style="lineStyle">
    <button
      v-for="segment in model.segments"
      :key="segment.key"
      type="button"
      class="tilt-row"
      :class="{ 'is-tilt': segment.isTilt }"
      :style="rowStyle(segment)"
      @click="emit('seek')"
    >
      <span
        v-for="(char, index) in segment.chars"
        :key="index"
        class="tilt-char"
        :style="charStyle(char)"
        v-text="char.char"
      />
    </button>
  </div>
</template>

<style scoped lang="scss" src="./tilt-line.scss"></style>
