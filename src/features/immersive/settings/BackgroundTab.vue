<script setup lang="ts">
import { computed } from 'vue'

import {
  type BackgroundType,
  useImmersiveSettingsStore
} from '@/features/immersive/immersive-settings.store'
import SettingsSlider from './SettingsSlider.vue'

const settings = useImmersiveSettingsStore()

const backgroundTypeOptions = [
  { label: '流体', value: 'fluid' as BackgroundType },
  { label: '模糊', value: 'blur' as BackgroundType },
  { label: '渐变', value: 'gradient' as BackgroundType },
  { label: '几何', value: 'geometric' as BackgroundType },
  { label: '纯色', value: 'solid' as BackgroundType },
  { label: '无', value: 'none' as BackgroundType }
]
const fluidFramerateMarks: Record<number, string> = { 0: '5', 1: '10', 2: '30', 3: '60', 4: '∞' }
const fluidBlurMarks: Record<number, string> = { 5: '32', 6: '64', 7: '128' }

// ── 条件显隐（逐条对齐参考 settings-menu.scss:358-383 的 opacity/height 折叠规则）──
// 参考项目把不适用的设置行折叠隐藏，避免用户在无效上下文勾选导致「开了没效果」的困惑。
const isFluid = computed(() => settings.backgroundType === 'fluid')
const isBlur = computed(() => settings.backgroundType === 'blur')
const isGradient = computed(() => settings.backgroundType === 'gradient')
const isNoneBg = computed(() => settings.backgroundType === 'none')
</script>

<template>
  <section class="settings-section">
    <div class="settings-group-title">背景</div>
    <div class="setting-row">
      <label>类型</label>
      <a-segmented v-model:value="settings.backgroundType" :options="backgroundTypeOptions" block />
    </div>
    <div v-show="isFluid" class="setting-row">
      <a-checkbox v-model:checked="settings.staticFluid">静态流体</a-checkbox>
      <span class="setting-note">减少流体背景的性能开销</span>
    </div>
    <SettingsSlider
      v-show="isFluid"
      field="fluidMaxFramerate"
      label="流体帧率上限"
      :min="0"
      :max="4"
      :step="1"
      :marks="fluidFramerateMarks"
      note="仅在动态流体开启时生效"
    />
    <SettingsSlider
      v-show="isFluid"
      field="fluidBlur"
      label="流体模糊度"
      :min="5"
      :max="7"
      :step="1"
      :marks="fluidBlurMarks"
      note="仅在流体开启时生效"
    />
    <div v-show="isGradient" class="setting-row">
      <a-checkbox v-model:checked="settings.gradientBgDynamic">动态渐变</a-checkbox>
    </div>
    <SettingsSlider v-show="isBlur" field="bgBlur" label="模糊" :min="0" :max="128" />
    <SettingsSlider v-show="isBlur" field="bgDim" label="暗化" :min="0" :max="100" />
    <SettingsSlider
      v-show="isGradient"
      field="bgDimForGradientBg"
      label="暗化（渐变背景）"
      :min="0"
      :max="100"
    />
    <SettingsSlider
      v-show="isFluid"
      field="bgDimForFluidBg"
      label="暗化（流体背景）"
      :min="0"
      :max="90"
    />
    <SettingsSlider
      v-show="isNoneBg"
      field="bgBlurForNoneBgMask"
      label="遮罩模糊（无背景）"
      :min="0"
      :max="100"
    />
    <SettingsSlider
      v-show="isNoneBg"
      field="bgDimForNoneBgMask"
      label="遮罩暗化（无背景）"
      :min="0"
      :max="90"
    />
  </section>
</template>

<style scoped lang="scss" src="./background-tab.scss"></style>
