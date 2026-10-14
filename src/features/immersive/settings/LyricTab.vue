<script setup lang="ts">
import { computed } from 'vue'

import {
  type ContributorDisplay,
  type KaraokeAnimation,
  type LyricAlignmentPct,
  type LyricTiming,
  type SubtitleContentMode,
  useImmersiveSettingsStore
} from '@/features/immersive/immersive-settings.store'
import { num } from './defaults'
import SettingsSlider from './SettingsSlider.vue'

const settings = useImmersiveSettingsStore()

// ── 选项组（label/value 对齐参考 settings-menu.html 的 select-group） ──
const karaokeOptions = [
  { label: '上浮', value: 'float' as KaraokeAnimation },
  { label: '滑动', value: 'slide' as KaraokeAnimation }
]
const alignmentPctOptions = [
  { label: '居上', value: 30 as LyricAlignmentPct },
  { label: '居中', value: 50 as LyricAlignmentPct }
]
const timingOptions = [
  { label: '平滑', value: 'smooth' as LyricTiming },
  { label: '急促', value: 'sharp' as LyricTiming },
  { label: '温和', value: 'lazy' as LyricTiming },
  { label: '缓出', value: 'easeout' as LyricTiming }
]
const contributorsOptions = [
  { label: '总是', value: 'show' as ContributorDisplay },
  { label: '鼠标移上', value: 'hover' as ContributorDisplay },
  { label: '隐藏', value: 'hide' as ContributorDisplay }
]
/**
 * 副字幕内容档位。顺序按「信息从多到少」排（两行 → 译文 → 罗马音 → 隐藏），
 * 与用户调这一项时的心理顺序一致；上游 `settings.subtitleContentMode` 的四个取值
 * 是同一套（见 `immersive-settings.model`）。
 */
const subtitleContentOptions = [
  { label: '罗马音+译文', value: 'both' as SubtitleContentMode },
  { label: '只译文', value: 'translation' as SubtitleContentMode },
  { label: '只罗马音', value: 'romanization' as SubtitleContentMode },
  { label: '隐藏', value: 'none' as SubtitleContentMode }
]

/**
 * 歌词全局偏移 ±100ms 步进(对齐参考 settings-menu.html:235-250 的 -/+ 按钮 +
 * main.js:554-579)。正 offset = 歌词提前显示(lyricDisplayTimeMs = currentTime + offset,
 * offset 正则歌词时钟快于音频)。
 */
function stepLyricOffset(delta: number): void {
  settings.lyricOffset = Math.max(-10000, Math.min(10000, settings.lyricOffset + delta))
}
/** 偏移状态提示文案(对齐参考:未设置 / 歌词提前 / 歌词滞后) */
const lyricOffsetTip = computed(() => {
  const v = settings.lyricOffset
  if (v === 0) return '未设置'
  return v > 0 ? '歌词提前' : '歌词滞后'
})

const lyricOffsetLabel = (v: number | number[]): string => `${(num(v) / 1000).toFixed(1)}s`

// 歌词旋转开启时，渐隐 / 缩放等平移动画行折叠；「曲率」滑块仅在旋转开启时显示
// （逐条对齐参考 settings-menu.scss:358-383 的 opacity/height 折叠规则）。
const isRotate = computed(() => settings.lyricRotate)
</script>

<template>
  <section class="settings-section">
    <div class="settings-group-title">歌词</div>
    <SettingsSlider field="lyricFontSize" label="字体大小" :min="16" :max="64" :step="1" />
    <SettingsSlider field="lyricRomajiSizeEm" label="罗马音" :min="0.3" :max="1.5" :step="0.05" />
    <SettingsSlider
      field="lyricTranslationSizeEm"
      label="翻译"
      :min="0.3"
      :max="1.5"
      :step="0.05"
    />
    <!--
      副字幕内容档位。**沉浸页通用项**（不是经典面板的外观项）：三个 Folia 系皮肤
      （倾诉 / 流光 / 浮名）都读它，所以放在这里虽然属于「经典」的设置面板，
      但它改的是「这一页的副字幕显示哪几档」，与背景 / 封面那类面板外观项不同。
    -->
    <div class="setting-row">
      <label>副字幕内容</label>
      <a-segmented
        v-model:value="settings.subtitleContentMode"
        :options="subtitleContentOptions"
        block
      />
    </div>
    <div v-show="!isRotate" class="setting-row">
      <a-checkbox v-model:checked="settings.lyricFade">歌词渐隐</a-checkbox>
    </div>
    <div class="setting-row">
      <a-checkbox v-model:checked="settings.lyricZoom">歌词缩放</a-checkbox>
    </div>
    <div class="setting-row">
      <a-checkbox v-model:checked="settings.lyricBlur">歌词模糊</a-checkbox>
    </div>
    <div class="setting-row">
      <a-checkbox v-model:checked="settings.lyricRotate">歌词旋转</a-checkbox>
    </div>
    <SettingsSlider v-show="isRotate" field="rotateCurvature" label="曲率" :min="10" :max="80" />
    <div class="setting-row">
      <label>逐字动画</label>
      <a-segmented v-model:value="settings.karaokeAnimation" :options="karaokeOptions" block />
    </div>
    <div class="setting-row">
      <label>当前歌词位置</label>
      <a-segmented
        v-model:value="settings.currentLyricAlignmentPercentage"
        :options="alignmentPctOptions"
        block
      />
    </div>
    <div class="setting-row">
      <a-checkbox v-model:checked="settings.lyricStagger">错位滚动动画</a-checkbox>
    </div>
    <div class="setting-row">
      <label>动画曲线</label>
      <a-segmented v-model:value="settings.lyricAnimationTiming" :options="timingOptions" block />
    </div>
    <div class="setting-row">
      <a-checkbox v-model:checked="settings.lyricGlow">长音发光动画</a-checkbox>
      <span class="setting-note">在句末长音单词播放时显示发光动画</span>
    </div>
    <SettingsSlider
      field="lyricOffset"
      label="全局偏移"
      :min="-10000"
      :max="10000"
      :step="100"
      :tip-formatter="lyricOffsetLabel"
    >
      <div class="lyric-offset-stepper">
        <button type="button" class="step-btn" @click="stepLyricOffset(-100)">−</button>
        <span class="setting-note">
          {{ lyricOffsetLabel(settings.lyricOffset) }} · {{ lyricOffsetTip }}
        </span>
        <button type="button" class="step-btn" @click="stepLyricOffset(100)">+</button>
      </div>
    </SettingsSlider>
    <div class="setting-row">
      <label>歌词贡献者显示</label>
      <a-segmented
        v-model:value="settings.lyricContributorsDisplay"
        :options="contributorsOptions"
        block
      />
    </div>
  </section>
</template>

<style scoped lang="scss" src="./lyric-tab.scss"></style>
