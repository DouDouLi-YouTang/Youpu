<script setup lang="ts">
import { computed } from 'vue'

import {
  type AccentColorVariant,
  type ColorScheme,
  type DisplayMode,
  useImmersiveSettingsStore
} from '@/features/immersive/immersive-settings.store'

const settings = useImmersiveSettingsStore()

// ── 选项组（label/value 对齐参考 settings-menu.html 的 select-group） ──
const displayModeOptions = [
  { label: '全部', value: 'all' as DisplayMode },
  { label: '仅歌词', value: 'lyric-only' as DisplayMode },
  { label: '仅封面', value: 'cover-only' as DisplayMode }
]
const colorSchemeOptions = [
  { label: '暗色', value: 'dark' as ColorScheme },
  { label: '亮色', value: 'light' as ColorScheme },
  { label: '系统', value: 'auto' as ColorScheme }
]
const accentColorOptions = [
  { label: '关', value: 'off' as AccentColorVariant },
  { label: '鲜艳', value: 'primary' as AccentColorVariant },
  { label: '柔和', value: 'secondary' as AccentColorVariant },
  { label: '偏色', value: 'tertiary' as AccentColorVariant }
]

// ── 条件显隐（逐条对齐参考 settings-menu.scss:358-383 的 opacity/height 折叠规则）──
// 参考项目把不适用的设置行折叠隐藏，避免用户在无效上下文勾选导致「开了没效果」的困惑。
const isLyricOnly = computed(() => settings.displayMode === 'lyric-only')
</script>

<template>
  <section class="settings-section">
    <div class="settings-group-title">外观</div>
    <div class="setting-row">
      <label>显示</label>
      <a-segmented v-model:value="settings.displayMode" :options="displayModeOptions" block />
    </div>
    <div v-show="isLyricOnly" class="setting-row">
      <a-checkbox v-model:checked="settings.centerLyric">歌词居中</a-checkbox>
      <span class="setting-note">仅在「仅歌词」模式下生效</span>
    </div>
    <div v-show="isLyricOnly" class="setting-row">
      <a-checkbox v-model:checked="settings.autoHideMiniSongInfo">
        自动隐藏迷你歌曲信息
      </a-checkbox>
    </div>
    <div class="setting-row">
      <label>颜色模式</label>
      <a-segmented v-model:value="settings.colorScheme" :options="colorSchemeOptions" block />
    </div>
    <div class="setting-row">
      <label>沉浸主题色</label>
      <a-segmented
        v-model:value="settings.accentColorVariant"
        :options="accentColorOptions"
        block
      />
    </div>
    <div class="setting-row">
      <a-checkbox v-model:checked="settings.textShadow">文字阴影</a-checkbox>
    </div>
    <div class="setting-row">
      <a-checkbox v-model:checked="settings.textGlow">文字辉光</a-checkbox>
    </div>
    <div class="setting-row">
      <a-checkbox v-model:checked="settings.alwaysShowBottomBar">不自动隐藏底栏</a-checkbox>
    </div>
    <div class="setting-row">
      <a-checkbox v-model:checked="settings.bottomProgressbar">进度条贴底</a-checkbox>
    </div>
    <div class="setting-row">
      <a-checkbox v-model:checked="settings.enableProgressbarPreview">进度条悬停预览</a-checkbox>
      <span class="setting-note">鼠标悬停在进度条上时显示对应歌词</span>
    </div>
    <div class="setting-row">
      <a-checkbox v-model:checked="settings.presentationMode">演示模式</a-checkbox>
      <span class="setting-note">隐藏一切多余元素</span>
    </div>
  </section>
</template>

<style scoped lang="scss" src="./appearance-tab.scss"></style>
