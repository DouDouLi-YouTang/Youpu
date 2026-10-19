<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createFoliaFontSettingsDefaults,
  sanitizeFoliaFontFamilies,
  sanitizeFoliaFontWeight,
  type FoliaFontSettings
} from '@/features/immersive/folia-font-settings'
import {
  FOLIA_SKIN_LABELS,
  resolveFoliaSkinId,
  useImmersiveSettingsStore,
  type FoliaSkinId
} from '@/features/immersive/immersive-settings.store'
import { FONT_PRESETS, commonFontOptions, type FontPreset } from '../fonts/font-catalog'
import FontPresetList from '../fonts/FontPresetList.vue'
import FontWeightControl from '../fonts/FontWeightControl.vue'
import { loadSystemFonts } from '../system-fonts'

/**
 * Folia 三主题的字体页签。
 *
 * 字体链与字重按当前主题分别保存；经典主题的 `customFont` / `customFontFamily`
 * 不参与这里。字体只作用于主题主歌词，副歌词、空态与加载卡保持各自内置层级。
 */
const settings = useImmersiveSettingsStore()
const fontList = ref<string[]>([])

onMounted(async () => {
  fontList.value = await loadSystemFonts()
})

const skin = computed(() => resolveFoliaSkinId(settings.skin))
const skinLabel = computed(() => FOLIA_SKIN_LABELS[skin.value])
const fontOptions = computed(() => commonFontOptions(fontList.value))

const currentFonts = computed<FoliaFontSettings>(() => {
  return settings.folia.fonts?.[skin.value] ?? createFoliaFontSettingsDefaults()
})

function updateFonts(patch: Partial<FoliaFontSettings>): void {
  const next: Record<FoliaSkinId, FoliaFontSettings> = {
    ...settings.folia.fonts,
    [skin.value]: { ...currentFonts.value, ...patch }
  }
  settings.folia.fonts = next
}

const customFont = computed({
  get: () => currentFonts.value.custom,
  set: (value: boolean) => updateFonts({ custom: value })
})

const fontFamilies = computed({
  get: () => currentFonts.value.families,
  set: (value: string[]) => updateFonts({ families: sanitizeFoliaFontFamilies(value) })
})

const fontWeight = computed<number | null>({
  get: () => currentFonts.value.weight,
  set: (value: number | null) => updateFonts({ weight: sanitizeFoliaFontWeight(value) })
})

const defaultWeight = computed(() => {
  if (skin.value === 'glow') return 700
  if (skin.value === 'fume') return 640
  return 400
})

const weightHint = computed(() => {
  if (skin.value === 'tilt') return '跟随主题时：正文 400，倾斜段 300'
  if (skin.value === 'glow') return '跟随主题时：700'
  return '跟随主题时：正文 640，hero 780'
})

function applyPreset(preset: FontPreset): void {
  updateFonts({
    custom: true,
    families: sanitizeFoliaFontFamilies([...preset.fonts])
  })
}

function resetFonts(): void {
  updateFonts(createFoliaFontSettingsDefaults())
}
</script>

<template>
  <section class="settings-section">
    <div class="settings-group-title">字体</div>
    <div class="setting-row">
      <span class="setting-note">正在编辑：{{ skinLabel }}</span>
      <span class="setting-note">三套主题分别保存字体链与字重；只影响当前主题主歌词</span>
    </div>
    <div class="setting-row">
      <a-checkbox v-model:checked="customFont">自定义字体</a-checkbox>
      <span class="setting-note">关闭时使用主题内置字体</span>
    </div>
    <div v-if="customFont" class="setting-row">
      <label>字体链</label>
      <a-select
        v-model:value="fontFamilies"
        mode="tags"
        :options="fontOptions"
        :token-separators="[',']"
        show-search
        allow-clear
        class="folia-font-select"
        placeholder="选择或输入字体名"
      />
      <span class="setting-note">按顺序回退；不在列表中的字体可直接输入</span>
      <span class="setting-note">前面的字体缺少字符时，会依次使用后面的字体</span>
    </div>
    <div class="setting-row">
      <label>字体预设</label>
      <FontPresetList :presets="FONT_PRESETS" :installed="fontList" @apply="applyPreset" />
      <span class="setting-note">应用预设会自动开启自定义字体</span>
    </div>
    <FontWeightControl
      v-model="fontWeight"
      label="字重"
      :default-weight="defaultWeight"
      :note="weightHint"
    />
    <div class="setting-row">
      <button type="button" class="folia-font-reset" @click="resetFonts">
        恢复当前主题默认字体
      </button>
    </div>
  </section>
</template>

<style scoped lang="scss" src="./folia-font-tab.scss"></style>
