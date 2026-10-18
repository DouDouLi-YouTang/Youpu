<script setup lang="ts">
import { computed } from 'vue'

import {
  foliaBackgroundEntries,
  getFoliaBackgroundModeLabel
} from '@/features/immersive/backgrounds/folia/registry'
import {
  type FoliaBackgroundChoice,
  useImmersiveSettingsStore
} from '@/features/immersive/immersive-settings.store'
import SettingsSlider from '../SettingsSlider.vue'

/**
 * Folia 三主题的背景页签。
 *
 * `原生` 是各皮肤原本的招牌背景：倾诉几何、流光 Common、浮名手绘纸面。
 * 其余六项复用已经移植好的 Folia 背景注册表。透明度与模糊只作用于覆盖背景层，
 * 避免把歌词或 canvas 一起变淡。
 */
const settings = useImmersiveSettingsStore()

const backgroundOptions = computed<{ label: string; value: FoliaBackgroundChoice }[]>(() => {
  const entries = foliaBackgroundEntries()
  const byMode = new Map(entries.map((entry) => [entry.mode, entry]))
  // 固定顺序对齐背景注册表的中文/原始标签，避免 7 项按钮在 360px 面板里挤压。
  const order: FoliaBackgroundChoice[] = [
    'native',
    'common',
    'monet',
    'nomand',
    'latent',
    'url',
    'sora'
  ]
  return order.map((mode) => {
    if (mode === 'native') return { label: '原生', value: mode }
    const entry = byMode.get(mode)
    return {
      label: entry ? getFoliaBackgroundModeLabel(entry) : mode,
      value: mode
    }
  })
})

const usesOverlay = computed(() => settings.folia.backgroundMode !== 'native')
</script>

<template>
  <section class="settings-section">
    <div class="settings-group-title">背景</div>
    <div class="setting-row">
      <label>背景模式</label>
      <a-select
        v-model:value="settings.folia.backgroundMode"
        :options="backgroundOptions"
        class="folia-background-select"
      />
      <span class="setting-note">「原生」保留当前主题的原始背景</span>
    </div>
    <template v-if="usesOverlay">
      <SettingsSlider
        target="folia"
        field="backgroundOpacity"
        label="背景不透明度"
        :min="0"
        :max="100"
        :step="1"
        note="只影响背景层，不影响歌词与控制条"
      />
      <SettingsSlider
        target="folia"
        field="backgroundBlur"
        label="背景模糊"
        :min="0"
        :max="40"
        :step="1"
        note="只影响背景层；过高会降低动态背景细节"
      />
    </template>
  </section>
</template>

<style scoped lang="scss" src="./folia-settings.scss"></style>
