<script setup lang="ts">
/**
 * 纯色背景（`backgroundType = 'solid'`）—— 把专辑提取的遮罩底色铺满。
 *
 * 没有任何状态：颜色由 CSS 变量 `--rnp-accent-color-bg`（use-color-extraction
 * 按封面提取后写到沉浸层根元素）给出，换歌时靠 `transition` 平滑过渡。
 */
</script>

<template>
  <div class="rnp-background-solid" />
</template>

<style scoped lang="scss" src="./solid-background.scss"></style>
