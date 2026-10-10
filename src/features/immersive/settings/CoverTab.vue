<script setup lang="ts">
import {
  type CoverHAlign,
  type CoverVAlign,
  type SongInfoAlign,
  useImmersiveSettingsStore
} from '@/features/immersive/immersive-settings.store'
import SettingsSlider from './SettingsSlider.vue'

const settings = useImmersiveSettingsStore()

// ── 选项组（label/value 对齐参考 settings-menu.html 的 select-group） ──
const coverHAlignOptions = [
  { label: '居左', value: 'left' as CoverHAlign },
  { label: '居中', value: 'center' as CoverHAlign }
]
const coverVAlignOptions = [
  { label: '居下', value: 'bottom' as CoverVAlign },
  { label: '居中', value: 'middle' as CoverVAlign }
]
// 歌曲信息文字对齐:本应用新增(参考项目无),独立于封面块水平对齐
const songInfoAlignOptions = [
  { label: '居左', value: 'left' as SongInfoAlign },
  { label: '居中', value: 'center' as SongInfoAlign }
]

const albumSizeMarks: Record<number, string> = { 200: '200', 400: '400', 600: '600', 800: '800' }
</script>

<template>
  <section class="settings-section">
    <div class="settings-group-title">封面</div>
    <div class="setting-row">
      <label>封面水平对齐</label>
      <a-segmented v-model:value="settings.coverHAlign" :options="coverHAlignOptions" block />
    </div>
    <div class="setting-row">
      <label>封面垂直对齐</label>
      <a-segmented v-model:value="settings.coverVAlign" :options="coverVAlignOptions" block />
    </div>
    <div class="setting-row">
      <label>歌曲信息对齐</label>
      <a-segmented v-model:value="settings.songInfoAlign" :options="songInfoAlignOptions" block />
      <span class="setting-note">歌名/歌手/专辑文字本身的水平对齐</span>
    </div>
    <div class="setting-row">
      <a-checkbox v-model:checked="settings.rectangleCover">方形专辑封面</a-checkbox>
    </div>
    <SettingsSlider
      field="albumSize"
      label="专辑封面清晰度"
      :min="200"
      :max="800"
      :step="200"
      :marks="albumSizeMarks"
      note="可能带来更慢的加载速度"
    />
    <div class="setting-row">
      <a-checkbox v-model:checked="settings.coverBlurryShadow">封面弥散阴影</a-checkbox>
    </div>
  </section>
</template>

<style scoped lang="scss" src="./cover-tab.scss"></style>
