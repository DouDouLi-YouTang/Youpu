<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadFont } from '@/platform/electron/font'
import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import SettingsSlider from './SettingsSlider.vue'
import { loadSystemFonts } from './system-fonts'

const settings = useImmersiveSettingsStore()

// ── 字体:系统字体查询 + 多选回退链 + 6 预设(对齐参考 font-settings.js)──
const fontList = ref<string[]>([])
onMounted(async () => {
  fontList.value = await loadSystemFonts()
})
// 下拉只列常用字体(白名单 ∩ 已装),避免系统几百个符号/装饰字体淹没选择。
// fontList 仍保留全集供 hasFont 判断预设是否已装;用户仍可手动输入白名单外字体(mode="tags")。
const COMMON_FONTS = [
  'Microsoft YaHei UI',
  'Microsoft YaHei',
  '微软雅黑',
  'Microsoft JhengHei UI',
  'Microsoft JhengHei',
  '微软正黑',
  'SimSun',
  'NSimSun',
  '宋体',
  'SimHei',
  '黑体',
  'KaiTi',
  '楷体',
  'FangSong',
  '仿宋',
  'DengXian',
  '等线',
  'Segoe UI Variable',
  'Segoe UI',
  'Arial',
  'Arial Black',
  'Calibri',
  'Calibri Light',
  'Cambria',
  'Candara',
  'Corbel',
  'Constantia',
  'Comic Sans MS',
  'Consolas',
  'Courier New',
  'Georgia',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'Source Han Sans SC',
  'Source Han Sans CN',
  '思源黑体',
  'Source Han Serif SC',
  'Source Han Serif CN',
  '思源宋体',
  'MiSans Medium',
  'MiSans',
  'PingFang SC',
  '苹方 常规'
]
const fontOptions = computed(() => {
  const installed = new Set(fontList.value)
  return COMMON_FONTS.filter((f) => installed.has(f)).map((f) => ({ label: f, value: f }))
})

/** 6 个字体预设(对齐参考 font-settings.js FontPreset):已装则"应用",未装则"下载" */
const FONT_PRESETS = [
  {
    name: 'MiSans',
    fonts: ['MiSans Medium', 'MiSans'],
    url: 'https://cdn.cnbj1.fds.api.mi-img.com/vipmlmodel/font/MiSans/MiSans.zip'
  },
  {
    name: '思源黑体',
    fonts: [
      'Source Han Sans SC VF',
      'Source Han Sans CN',
      'Noto Sans',
      '思源黑体',
      'Source Han Sans VF',
      'Source Han Sans'
    ],
    url: 'https://github.com/adobe-fonts/source-han-sans/raw/release/Variable/OTF/SourceHanSansSC-VF.otf'
  },
  {
    name: '思源宋体',
    fonts: [
      'Source Han Serif SC VF',
      'Source Han Serif CN',
      'Noto Serif',
      '思源宋体',
      'Source Han Serif VF',
      'Source Han Serif'
    ],
    url: 'https://github.com/adobe-fonts/source-han-serif/raw/release/Variable/OTF/SourceHanSerifSC-VF.otf'
  },
  {
    name: '苹方',
    fonts: ['PingFang SC', '苹方 常规'],
    url: 'https://github.com/ShmilyHTT/PingFang/archive/refs/heads/master.zip'
  },
  { name: '微软雅黑', fonts: ['Microsoft YaHei UI', 'Microsoft YaHei'], url: '' },
  { name: '微软正黑', fonts: ['Microsoft JhengHei UI', 'Microsoft JhengHei'], url: '' }
] as const

function hasFont(preset: (typeof FONT_PRESETS)[number]): boolean {
  return preset.fonts.some((f) => fontList.value.includes(f))
}
function applyPreset(preset: (typeof FONT_PRESETS)[number]): void {
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
      <div v-for="preset in FONT_PRESETS" :key="preset.name" class="font-preset">
        <span class="font-preset-label">{{ preset.name }}</span>
        <button
          v-if="hasFont(preset)"
          type="button"
          class="font-preset-btn"
          @click="applyPreset(preset)"
        >
          应用
        </button>
        <button
          v-else-if="preset.url"
          type="button"
          class="font-preset-btn"
          aria-label="下载字体"
          @click="downloadFont(preset.url)"
        >
          下载
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss" src="./font-tab.scss"></style>
