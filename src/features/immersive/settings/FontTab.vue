<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import { FONT_PRESETS, commonFontOptions, type FontPreset } from './fonts/font-catalog'
import FontPresetList from './fonts/FontPresetList.vue'
import SettingsSlider from './SettingsSlider.vue'
import { loadSystemFonts } from './system-fonts'

const settings = useImmersiveSettingsStore()

// ── 字体:系统字体查询 + 多选回退链 + 6 预设(对齐参考 font-settings.js)──
const fontList = ref<string[]>([])
onMounted(async () => {
  fontList.value = await loadSystemFonts()
})
// 字体列表与预设目录抽到 fonts/font-catalog.ts，与 Folia 字体页共用。
const fontOptions = computed(() => commonFontOptions(fontList.value))

function applyPreset(preset: FontPreset): void {
  settings.customFontFamily = [...preset.fonts]
}
</script>

<template>
  <section class="settings-section">
    <div class="settings-group-title">字体</div>
    <SettingsSlider field="lyricFontWeight" label="字重" :min="100" :max="900" :step="100" />
    <div class="setting-row">
      <a-checkbox v-model:checked="settings.customFont">自定义字体</a-checkbox>
    </div>
    <div v-if="settings.customFont" class="setting-row">
      <label>选择字体</label>
      <a-select
        v-model:value="settings.customFontFamily"
        mode="tags"
        :options="fontOptions"
        show-search
        allow-clear
        :token-separators="[',']"
        placeholder="选择或输入字体名"
      />
      <span class="setting-note">某些字体可能不在列表中，需要手动输入</span>
      <span class="setting-note"
        >如果顺序在前的字体缺少某些字符，则会使用顺序在后的字体，依次顺延</span
      >
    </div>
    <div v-if="settings.customFont" class="setting-row">
      <label>字体预设</label>
      <FontPresetList :presets="FONT_PRESETS" :installed="fontList" @apply="applyPreset" />
    </div>
  </section>
</template>
