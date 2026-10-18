<script setup lang="ts">
import {
  type SubtitleContentMode,
  useImmersiveSettingsStore
} from '@/features/immersive/immersive-settings.store'

/**
 * Folia 三主题的歌词页签。
 *
 * 这里只放各皮肤确有独立行为的项；字号、动画曲线等经典排版参数不硬套到
 * Folia 的固定布局上。
 */
const settings = useImmersiveSettingsStore()

const subtitleOptions = [
  { label: '罗马音+译文', value: 'both' as SubtitleContentMode },
  { label: '只译文', value: 'translation' as SubtitleContentMode },
  { label: '只罗马音', value: 'romanization' as SubtitleContentMode },
  { label: '隐藏', value: 'none' as SubtitleContentMode }
]
</script>

<template>
  <section class="settings-section">
    <div class="settings-group-title">歌词</div>
    <div class="setting-row">
      <label>副歌词</label>
      <a-segmented
        v-model:value="settings.folia.subtitleContentMode"
        :options="subtitleOptions"
        block
      />
      <span class="setting-note">控制倾诉、流光、浮名的罗马音与译文显示</span>
    </div>
    <div class="setting-row">
      <a-checkbox v-model:checked="settings.folia.subtitleBlur">副歌词模糊效果</a-checkbox>
      <span class="setting-note">关闭后辉光底与下一句预览保持清晰</span>
    </div>
  </section>
</template>

<style scoped lang="scss" src="./folia-settings.scss"></style>
