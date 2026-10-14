<script setup lang="ts">
import type { SubtitleTrack } from '../shared/subtitle-tracks'

/**
 * 「流光」底部副字幕（罗马音 / 译文）。
 *
 * ## 为什么是独立组件而不是塞进 `SkinGlow.vue` 的模板
 *
 * AGENTS.md 的 400 行上限是一方面，更重要的是**职责边界**：副字幕与歌词舞台的
 * 生命周期完全不同 —— 舞台随行 key 重建，副字幕只跟着**当前行数据**变化。
 * 混在一个模板里，换行时的 diff 会把两者一起带上。
 *
 * ## 为什么只要一个 `rows` prop
 *
 * 轨道解析（哪一档、可读性门槛、去重）全部在 `shared/subtitle-tracks.ts` ——
 * 那是三个 Folia 系皮肤**共用**的口径，不能在这一层再判一次。本组件只负责
 * 「把已经决定好的行画出来」，所以它没有 mode / 行对象 / 语言开关这些入参。
 *
 * ## 两行的降档
 *
 * 首行（罗马音）是"跟着唱的那个"，第二行（译文）是注解，故第二行按
 * `SECONDARY_TRACK_*` 降一档（小 12%、不透明度 0.82）。降档值本身也取自共享层，
 * 保证与「浮名」的副字幕是同一套相对关系。
 */
defineProps<{
  /** 已解析好的轨道（罗马音在前、译文在后；可能只有一条，也可能为空） */
  rows: readonly SubtitleTrack[]
}>()
</script>

<template>
  <div v-if="rows.length" class="glow-subtitles">
    <p
      v-for="(row, index) in rows"
      :key="row.role"
      class="glow-subtitle"
      :class="index > 0 ? 'is-secondary' : 'is-primary'"
    >
      {{ row.text }}
    </p>
  </div>
</template>

<style scoped lang="scss" src="./glow-subtitle.scss"></style>
