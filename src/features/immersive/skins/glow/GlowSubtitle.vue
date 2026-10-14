<script setup lang="ts">
import { computed } from 'vue'
import { AnimatePresence, motion } from 'motion-v'

import { colorWithAlpha } from '../shared/color-mix'
import {
  buildSubtitleGlowGradient,
  buildSubtitleTextShadow,
  type SubtitleTrack
} from '../shared/subtitle-tracks'

/**
 * 「流光」底部副字幕（罗马音 / 译文）。
 *
 * ## 为什么是独立组件
 *
 * AGENTS.md 的 400 行上限是一方面，更重要的是**职责边界**：副字幕与歌词舞台的
 * 生命周期不同 —— 舞台随行 key 重建，副字幕只跟着**当前行数据**变化。
 *
 * ## 为什么只要 `rows` / `preview` / `background` 三个 prop
 *
 * 轨道解析（哪一档、可读性门槛、去重）全部在 `shared/subtitle-tracks.ts` ——
 * 那是三个 Folia 系皮肤**共用**的口径，不能在这一层再判一次。
 * 「有副字幕就不显示预览」这条互斥也由调用方决定（`resolveUpcomingPreview` 的说明），
 * 所以本组件只关心"给我什么就画什么"。
 *
 * ## 辉光底与文字阴影
 *
 * 两者都从 `shared/subtitle-tracks` 的公式来（形状与透明度逐字对齐上游），
 * 底色取当前主题的 `background`。辉光底铺在一个**外扩的模糊层**上
 * （上游 `-inset-x-10 -inset-y-6 blur-2xl`），所以它比文字盒子大一圈 ——
 * 内联给渐变、样式表给尺寸与模糊，两边各管一件事。
 *
 * ## 字色与整层不透明度
 *
 * 两处**都不是**从正文继承来的，必须显式给：
 *  - 字色是主题的 `secondaryColor`（正文是 `primaryColor`，次级色更灰）；
 *    上游把 `color` 写在每一行上（`VisualizerSubtitleOverlay`），所以这里也写在每行上，
 *    整层的 `textShadow` 才是那个 `0 1px 2px rgba(bg, .24)`。
 *  - 整层不透明度是 `subtitleOverlayOpacity`，默认 **0.6**。
 *    漏掉它的观感差异很明显：字幕比上游"实"一档，在亮背景上会抢主舞台的注意力。
 */
const props = defineProps<{
  /** 已解析好的轨道（罗马音在前、译文在后；可能只有一条，也可能为空） */
  rows: readonly SubtitleTrack[]
  /** 没有副字幕时显示的「接下来几句」（已过可读性门槛）；有副字幕时应传空数组 */
  preview?: readonly string[]
  /** 主题底色（辉光底与文字阴影都从它派生） */
  background: string
  /** 副字幕字色（主题 `secondaryColor`，**不是**正文色；见文件头） */
  color: string
  /** 整层的不透明度（上游 `subtitleOverlayOpacity`，默认 0.6） */
  opacity: number
  /** 次级轨道的字号（clamp 字符串，已乘降档系数） */
  secondaryFontSize: string
  /** 预览行的字号（clamp 字符串） */
  upcomingFontSize: string
}>()

/** 辉光底的内联背景（形状在共享层，尺寸 / 模糊在样式表） */
const glowStyle = computed(() => ({
  background: buildSubtitleGlowGradient(props.background, colorWithAlpha)
}))

/** 文字阴影（极浅的 0.24 底色，见共享层的说明） */
const textShadow = computed(() => buildSubtitleTextShadow(props.background, colorWithAlpha))
</script>

<template>
  <!-- 外层：进出场由 AnimatePresence 驱动（当前行有副字幕 / 有预览时才存在） -->
  <AnimatePresence>
    <motion.div
      v-if="rows.length > 0 || (preview && preview.length > 0)"
      class="glow-subtitles"
      :style="{ textShadow, color }"
      :initial="{ opacity: 0, y: 20 }"
      :animate="{ opacity, y: 0 }"
      :exit="{ opacity: 0, y: 20 }"
      :transition="{
        opacity: { duration: 0.24, ease: 'easeOut' },
        y: { duration: 0.24, ease: 'easeOut' }
      }"
    >
      <!-- 辉光底：垫在文字后面的椭圆渐变，外扩 + 模糊见样式表 -->
      <div class="glow-subtitle-glow" aria-hidden="true" :style="glowStyle" />

      <div class="glow-subtitle-stack">
        <template v-if="rows.length > 0">
          <p
            v-for="(row, index) in rows"
            :key="row.role"
            class="glow-subtitle"
            :class="index > 0 ? 'is-secondary' : 'is-primary'"
            :style="index > 0 ? { fontSize: secondaryFontSize } : undefined"
          >
            {{ row.text }}
          </p>
        </template>

        <template v-else>
          <p
            v-for="(text, index) in preview"
            :key="index"
            class="glow-subtitle is-upcoming"
            :style="{ fontSize: upcomingFontSize }"
          >
            {{ text }}
          </p>
        </template>
      </div>
    </motion.div>
  </AnimatePresence>
</template>

<style scoped lang="scss" src="./glow-subtitle.scss"></style>
