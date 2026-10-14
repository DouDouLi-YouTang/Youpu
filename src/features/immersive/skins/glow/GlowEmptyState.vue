<script setup lang="ts">
import { motion } from 'motion-v'

import type { SkinEmptyState } from '../shared/empty-state'

/**
 * 「流光」的空态（没有行可排时显示什么）。
 *
 * ## 为什么文案与判定都不在本组件
 *
 * 显示哪一句话由 `shared/empty-state.ts` 决定 —— 那是「倾诉」「流光」「浮名」三个皮肤
 * **共用的口径**（歌词加载中 / 纯音乐 / 暂无歌词 / 等待音乐 / 歌名卡）。本项目用户
 * 2026-10-10 明确要求：歌明明在放时不能显示「等待音乐」，要显示歌名 + 歌手。
 * 本组件只负责把已经决定好的那一档画出来。
 *
 * ⚠️ 上游 Folia 的流光只有一句「等待音乐」，没有歌名卡 —— 这是**本项目刻意对齐的
 * 差异**（见上方口径）。字幕/歌词都从共享层来，本组件不自行判断。
 *
 * ## 为什么不用 `v-if` 分两段写歌名卡
 *
 * `SkinEmptyState` 是判别联合（`kind: 'song' | 'text'`），模板里按 `kind` 分叉即可：
 * 一个分支画两张 p（标题 / 歌手），另一分支画一句提示。写成两个顶层 `v-if` 会让
 * "两档互斥"这件事只存在于调用方的约定里。
 */
defineProps<{
  /** 已解析好的空态；`null` 表示有行可排，本组件不该被渲染 */
  state: SkinEmptyState
  /** 空态字号（clamp 字符串，由 `glow-adapter.resolveGlowEmptyFontSize` 拼好） */
  fontSize: string
}>()
</script>

<template>
  <motion.div
    class="glow-empty"
    :style="{ fontSize }"
    :initial="{ opacity: 0 }"
    :animate="{ opacity: 1 }"
    :exit="{ opacity: 0 }"
  >
    <template v-if="state.kind === 'song'">
      <p class="glow-empty-song-title">{{ state.title }}</p>
      <p v-if="state.artist" class="glow-empty-song-artist">{{ state.artist }}</p>
    </template>
    <p v-else class="glow-empty-text">{{ state.text }}</p>
  </motion.div>
</template>

<style scoped lang="scss" src="./glow-empty.scss"></style>
