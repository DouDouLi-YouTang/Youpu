<script setup lang="ts">
/**
 * 无背景（`backgroundType = 'none'`）—— 不留任何图案。
 *
 * 伪装成「什么都没有」：只留两层可调的蒙版（`--bg-blur-for-none-bg-mask` 模糊 /
 * `--bg-dim-for-none-bg-mask` 暗化），默认值都是 0，即彻底透明。
 */
</script>

<template>
  <div class="rnp-background-none" />
</template>

<style scoped lang="scss" src="./none-background.scss"></style>
