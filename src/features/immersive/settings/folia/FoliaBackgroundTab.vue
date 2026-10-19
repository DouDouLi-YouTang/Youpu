<script setup lang="ts">
import { computed } from 'vue'

import {
  foliaBackgroundEntries,
  getFoliaBackgroundModeLabel
} from '@/features/immersive/backgrounds/folia/registry'
import {
  FOLIA_SKIN_LABELS,
  resolveFoliaSkinId,
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
const skin = computed(() => resolveFoliaSkinId(settings.skin))
const skinLabel = computed(() => FOLIA_SKIN_LABELS[skin.value])

const backgroundMode = computed<FoliaBackgroundChoice>({
  get: () => settings.folia.backgroundModes[skin.value],
  set: (mode) => {
    settings.folia.backgroundModes = {
      ...settings.folia.backgroundModes,
      [skin.value]: mode
    }
  }
})

const backgroundOptions = computed<{ label: string; value: FoliaBackgroundChoice }[]>(() => {
  const entries = foliaBackgroundEntries()
  const byMode = new Map(entries.map((entry) => [entry.mode, entry]))
  // 本项目没有 Embed 的候选内容入口，因此不展示 `url`。FoliaBackground 在
  // config.url 为空时会整块不渲染，只留下空背景；把它列为可选项等于提供一个
  // 必然白屏的按钮。其余模式按注册表顺序展示。
  const nativeLabel =
    skin.value === 'tilt'
      ? '原生（几何）'
      : skin.value === 'glow'
        ? '原生（Common）'
        : '原生（手绘纸面）'
  const order: FoliaBackgroundChoice[] = [
    'native',
    'transparent',
    'common',
    'monet',
    'nomand',
    'latent',
    'sora'
  ]
  return order
    .filter((mode) => !(skin.value === 'glow' && mode === 'common'))
    .map((mode) => {
      if (mode === 'native') return { label: nativeLabel, value: mode }
      if (mode === 'transparent') return { label: '透明（仅主题底色）', value: mode }
      const entry = byMode.get(mode)
      return {
        label: entry ? getFoliaBackgroundModeLabel(entry) : mode,
        value: mode
      }
    })
})

const usesOverlay = computed(
  () => backgroundMode.value !== 'native' && backgroundMode.value !== 'transparent'
)
</script>

<template>
  <section class="settings-section">
    <div class="settings-group-title">背景</div>
    <div class="setting-row">
      <span class="setting-note">正在编辑：{{ skinLabel }}</span>
      <span class="setting-note">三套主题分别保存背景；不透明度与模糊度共享</span>
      <span v-if="skin === 'glow'" class="setting-note">
        流光原生背景就是 Common，重复选项已合并
      </span>
    </div>
    <div class="setting-row">
      <label>背景模式</label>
      <a-select
        v-model:value="backgroundMode"
        :options="backgroundOptions"
        class="folia-background-select"
      />
      <span class="setting-note">当前：{{ skinLabel }}。切换主题后会自动切到该主题的配置</span>
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
