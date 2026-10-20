<script setup lang="ts">
import { computed } from 'vue'

import type { FoliaTheme } from '../types'
import { colorWithAlpha } from './color'

/**
 * WebGL 降级兜底：主题底色渐变。
 *
 * 触发条件：`webgl2Unavailable` 已置位（paper 拿不到 webgl2 会 throw），或本次挂载失败。
 * 它必须**看起来像背景**而不是一块纯色：三个层次（底色 / 对角主色 / 角落强调色）与
 * shader 失败前的观感更接近，界面不会「突然塌成一片黑」。
 */
const props = defineProps<{ theme: FoliaTheme }>()

const style = computed(() => ({
  backgroundColor: props.theme.backgroundColor,
  backgroundImage: [
    `linear-gradient(135deg, ${colorWithAlpha(props.theme.accentColor, 0.55)}, ${colorWithAlpha(
      props.theme.backgroundColor,
      0.15
    )} 48%, ${colorWithAlpha(props.theme.primaryColor, 0.4)})`,
    `radial-gradient(circle at 22% 28%, ${colorWithAlpha(
      props.theme.secondaryColor,
      0.35
    )}, transparent 58%)`
  ].join(', ')
}))
</script>

<template>
  <div class="folia-fallback-gradient" :style="style" />
</template>

<style scoped>
.folia-fallback-gradient {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
</style>
