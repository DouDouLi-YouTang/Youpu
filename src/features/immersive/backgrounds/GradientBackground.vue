<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useImmersiveSettingsStore } from '../immersive-settings.store'
import { getGradientFromPalette } from '../color-utils'
import { getDominantRgbPalette } from '../image-color'
import { readCachedGradient, writeCachedGradient } from './gradient-cache'
import { useBackgroundCoverUrl } from './use-background-cover'

/**
 * 渐变背景（`backgroundType = 'gradient'`）—— 从封面取色盘，排成 -45deg 线性渐变。
 *
 * 取色是异步的，期间先显示默认灰白渐变；算好后换成封面配色。
 * 结果经 `gradient-cache` 跨组件实例留存 —— 切走再切回不会闪一次默认渐变。
 */
const settings = useImmersiveSettingsStore()
const coverUrl = useBackgroundCoverUrl()

const DEFAULT_GRADIENT = 'linear-gradient(-45deg, #666, #fff)'
const gradient = ref<string>(DEFAULT_GRADIENT)
const gradientStyle = computed(() => ({ backgroundImage: gradient.value }))

// 竞态防护令牌:watcher 每次触发自增,慢的取色恢复后令牌不匹配则丢弃,
// 防止快速切歌时上一首封面的渐变覆盖当前封面
let gradientToken = 0

watch(
  coverUrl,
  async (url) => {
    const token = ++gradientToken
    if (!url) {
      // 无封面时回退默认渐变,避免残留上一首的配色
      gradient.value = DEFAULT_GRADIENT
      return
    }
    // 命中缓存直接上色（切回本类型时不会先闪一下默认渐变）
    const cached = readCachedGradient(url)
    if (cached !== null) {
      gradient.value = cached
      return
    }
    const palette = await getDominantRgbPalette(url, 8)
    if (token !== gradientToken) return
    if (palette && palette.length > 0) {
      gradient.value = getGradientFromPalette(palette)
      writeCachedGradient(url, gradient.value)
    }
  },
  { immediate: true }
)
</script>

<template>
  <div
    class="rnp-background-gradient"
    :class="{ 'gradient-bg-dynamic': settings.gradientBgDynamic }"
    :style="gradientStyle"
  />
</template>

<style scoped lang="scss" src="./gradient-background.scss"></style>
