<script setup lang="ts">
import { computed } from 'vue'

import {
  type ColorScheme,
  type FoliaColorScheme,
  useImmersiveSettingsStore
} from '@/features/immersive/immersive-settings.store'

/**
 * Folia 三主题共用的外观页签。
 *
 * 明暗与字体配色方案分开：前者控制整页外壳（控制条、设置面板、背景明暗），
 * 后者控制歌词与背景的四色来源。默认「跟随歌曲」保留逐歌主题。
 */
const settings = useImmersiveSettingsStore()

/**
 * 逐词关键词着色只有流光与浮名真正消费。倾诉的逐字脉冲由自己的适配层
 * 决定颜色，不读 `wordColors`；在它的设置里展示这个开关会形成一个无效选项。
 */
const supportsWordColoring = computed(() => settings.skin === 'glow' || settings.skin === 'fume')

const colorSchemeOptions = [
  { label: '夜间', value: 'dark' as ColorScheme },
  { label: '白天', value: 'light' as ColorScheme },
  { label: '跟随系统', value: 'auto' as ColorScheme }
]
const colorModeOptions = [
  { label: '跟随歌曲', value: 'song' as FoliaColorScheme },
  { label: '日光', value: 'daylight' as FoliaColorScheme },
  { label: '午夜', value: 'midnight' as FoliaColorScheme },
  { label: '单色', value: 'mono' as FoliaColorScheme }
]
</script>

<template>
  <section class="settings-section">
    <div class="settings-group-title">外观</div>
    <div class="setting-row">
      <label>明暗模式</label>
      <a-segmented v-model:value="settings.folia.colorScheme" :options="colorSchemeOptions" block />
      <span class="setting-note">控制控制条、设置面板与歌词的整体明暗</span>
    </div>
    <div class="setting-row">
      <label>字体配色方案</label>
      <a-segmented v-model:value="settings.folia.colorMode" :options="colorModeOptions" block />
      <span class="setting-note">「跟随歌曲」会从当前封面生成每首歌独立配色</span>
    </div>
    <div v-if="supportsWordColoring" class="setting-row">
      <a-checkbox v-model:checked="settings.folia.wordColoring">逐词关键词着色</a-checkbox>
      <span class="setting-note">关闭后，所有歌词使用同一套正文 / 高亮配色</span>
    </div>
  </section>
</template>

<style scoped lang="scss" src="./folia-settings.scss"></style>
