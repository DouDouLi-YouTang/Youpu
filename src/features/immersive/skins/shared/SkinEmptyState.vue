<script setup lang="ts">
import { motion } from 'motion-v'

import type { SkinEmptyState } from './empty-state'

/**
 * 空态（没有行可排时显示什么）—— **全部 Folia 系皮肤共享**。
 *
 * ## 为什么文案与判定都不在本组件
 *
 * 显示哪一句话由 `shared/empty-state.ts` 决定 —— 那是「倾诉」「流光」「浮名」三个皮肤
 * **共用的口径**（歌词加载中 / 纯音乐 / 暂无歌词 / 等待音乐 / 歌名卡）。本项目用户
 * 2026-10-10 明确要求：歌明明在放时不能显示「等待音乐」，要显示歌名 + 歌手。
 * 本组件只负责把已经决定好的那一档画出来。
 *
 * ⚠️ 上游 Folia 的流光只有一句「等待音乐」，浮名干脆没有空态 —— 这是**本项目刻意对齐的
 * 差异**（见上方口径）。字幕/歌词都从共享层来，本组件不自行判断。
 *
 * ## 为什么不用 `v-if` 分两段写歌名卡
 *
 * `SkinEmptyState` 是判别联合（`kind: 'song' | 'text'`），模板里按 `kind` 分叉即可：
 * 一个分支画两张 p（标题 / 歌手），另一分支画一句提示。写成两个顶层 `v-if` 会让
 * "两档互斥"这件事只存在于调用方的约定里。
 *
 * ## 定位由宿主决定
 *
 * 本组件是 `position: absolute` 的一层，但**不写 inset**：由宿主的样式把它摆到舞台中央
 * （`.is-centered`）或别处。这样"放哪里"是皮肤的决定，"长什么样"是共享层的决定。
 */
defineProps<{
  /** 已解析好的空态；`null` 表示有行可排，本组件不该被渲染 */
  state: SkinEmptyState
  /** 空态字号（clamp 字符串，由各皮肤的适配层拼好） */
  fontSize: string
}>()
</script>

<template>
  <motion.div
    class="skin-empty"
    :style="{ fontSize }"
    :initial="{ opacity: 0 }"
    :animate="{ opacity: 1 }"
    :exit="{ opacity: 0 }"
  >
    <template v-if="state.kind === 'song'">
      <p class="skin-empty-song-title">{{ state.title }}</p>
      <p v-if="state.artist" class="skin-empty-song-artist">{{ state.artist }}</p>
    </template>
    <p v-else class="skin-empty-text">{{ state.text }}</p>
  </motion.div>
</template>

<style scoped lang="scss" src="./skin-empty.scss"></style>
