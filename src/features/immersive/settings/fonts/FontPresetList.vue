<script setup lang="ts">
import { downloadFont } from '@/platform/electron/font'
import { hasPresetFont, type FontPreset } from './font-catalog'

/** 预设列表只负责展示与下载；应用行为由使用它的页面决定。 */
const props = defineProps<{
  presets: readonly FontPreset[]
  installed: readonly string[]
}>()

const emit = defineEmits<{
  (e: 'apply', preset: FontPreset): void
}>()

function isInstalled(preset: FontPreset): boolean {
  return hasPresetFont(preset, props.installed)
}

async function downloadPreset(preset: FontPreset): Promise<void> {
  if (!preset.url) return
  await downloadFont(preset.url)
}
</script>

<template>
  <div class="font-preset-list">
    <div v-for="preset in presets" :key="preset.name" class="font-preset">
      <span class="font-preset-label">{{ preset.name }}</span>
      <button
        v-if="isInstalled(preset)"
        type="button"
        class="font-preset-btn"
        @click="emit('apply', preset)"
      >
        应用
      </button>
      <button
        v-else-if="preset.url"
        type="button"
        class="font-preset-btn"
        aria-label="下载字体"
        @click="downloadPreset(preset)"
      >
        下载
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss" src="../font-tab.scss"></style>
