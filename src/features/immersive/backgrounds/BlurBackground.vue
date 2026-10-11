<script setup lang="ts">
import { computed } from 'vue'

import { useBackgroundCoverUrl } from './use-background-cover'

/**
 * 模糊背景（`backgroundType = 'blur'`）—— 把当前封面铺满并重度模糊。
 *
 * 只在被选中时挂载（父组件按 backgroundType 六选一），所以没有「当前类型是不是我」
 * 的判断：挂载即生效。封面变化时换图，`background-image` 有 1.5s 过渡。
 * 无封面时 `background-image: none`，不会残留上一首的模糊底。
 */
const coverUrl = useBackgroundCoverUrl()

const blurStyle = computed(() => ({
  backgroundImage: coverUrl.value ? `url("${coverUrl.value}")` : 'none'
}))
</script>

<template>
  <div class="rnp-background-blur" :style="blurStyle" />
</template>

<style scoped lang="scss" src="./blur-background.scss"></style>
