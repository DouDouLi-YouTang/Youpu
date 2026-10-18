<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CloseOutlined } from '@ant-design/icons-vue'

import AboutTab from '@/features/immersive/settings/AboutTab.vue'
import AppearanceTab from '@/features/immersive/settings/AppearanceTab.vue'
import BackgroundTab from '@/features/immersive/settings/BackgroundTab.vue'
import CoverTab from '@/features/immersive/settings/CoverTab.vue'
import FontTab from '@/features/immersive/settings/FontTab.vue'
import FoliaAppearanceTab from '@/features/immersive/settings/folia/FoliaAppearanceTab.vue'
import FoliaAboutTab from '@/features/immersive/settings/folia/FoliaAboutTab.vue'
import FoliaBackgroundTab from '@/features/immersive/settings/folia/FoliaBackgroundTab.vue'
import FoliaLyricsTab from '@/features/immersive/settings/folia/FoliaLyricsTab.vue'
import LyricTab from '@/features/immersive/settings/LyricTab.vue'
import type { SkinDefinition } from '@/features/immersive/skins/types'

/**
 * 沉浸层设置面板外壳。页签按当前皮肤的 `settingsKind` 切换：
 *  - 经典：6 个 tab（外观 / 封面 / 背景 / 歌词 / 字体 / 关于）；
 *  - Folia 三主题：外观 / 歌词 / 背景 / 关于，只编辑共享的 `folia` 设置。
 *
 * ⚠️ **面板主题切换不在本面板内**（2026-10-11 用户要求）：「歌词面板样式是在外部设置，
 * 直接在顶部控制栏里选歌词面板的主题」。所以这里既没有「样式」tab、也没有页内面板
 * 切换条 —— 切换入口只有沉浸页顶部那个悬浮按钮（SkinSwitcher.vue）。
 *
 * 本组件只负责：Transition + 悬浮小窗外壳 + 纵向 tab 列 + 内容区分发。
 * 外壳与 antd 控件覆盖样式见 ./settings/settings-panel.scss，多 tab 共用的行样式见
 * ./settings/settings-rows.scss（tab 子组件内部节点没有本组件的 data-v，故用 :deep() 穿透）。
 */

const props = defineProps<{
  visible: boolean
  kind: SkinDefinition['settingsKind']
}>()
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void }>()

function close(): void {
  emit('update:visible', false)
}

// ── tab 定义（顺序与文案对齐参考项目 settings-menu.html） ──
const CLASSIC_TABS = [
  { key: 'appearance', label: '外观' },
  { key: 'cover', label: '封面' },
  { key: 'background', label: '背景' },
  { key: 'lyric', label: '歌词' },
  { key: 'font', label: '字体' },
  { key: 'about', label: '关于' }
] as const
const FOLIA_TABS = [
  { key: 'appearance', label: '外观' },
  { key: 'lyric', label: '歌词' },
  { key: 'background', label: '背景' },
  { key: 'about', label: '关于' }
] as const
type TabKey = (typeof CLASSIC_TABS)[number]['key']
const tabs = computed(() => (props.kind === 'classic' ? CLASSIC_TABS : FOLIA_TABS))
const activeTab = ref<TabKey>('appearance')

// 切换主题时把页签收回合法集合，避免停留在 Folia 不存在的「封面」页签。
watch(
  () => props.kind,
  () => {
    if (!tabs.value.some((tab) => tab.key === activeTab.value)) activeTab.value = 'appearance'
  },
  { immediate: true }
)
</script>

<template>
  <Transition name="settings-slide">
    <aside v-if="visible" class="immersive-settings">
      <!-- 关闭按钮(浮动右上角,对齐参考无标题栏的精简布局) -->
      <button type="button" class="settings-close" aria-label="关闭设置" @click="close">
        <CloseOutlined />
      </button>

      <!-- 纵向 tab 列(对齐参考 .rnp-settings-menu-tabs) -->
      <nav class="settings-tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          class="settings-tab"
          :class="{ active: activeTab === t.key }"
          @click="activeTab = t.key"
        >
          {{ t.label }}
        </button>
      </nav>

      <!-- 内容区：每个 tab 一个组件，根节点 <section class="settings-section"> 由外壳样式命中 -->
      <div class="settings-body">
        <template v-if="kind === 'classic'">
          <AppearanceTab v-show="activeTab === 'appearance'" />
          <CoverTab v-show="activeTab === 'cover'" />
          <BackgroundTab v-show="activeTab === 'background'" />
          <LyricTab v-show="activeTab === 'lyric'" />
          <FontTab v-show="activeTab === 'font'" />
        </template>
        <template v-else>
          <FoliaAppearanceTab v-show="activeTab === 'appearance'" />
          <FoliaLyricsTab v-show="activeTab === 'lyric'" />
          <FoliaBackgroundTab v-show="activeTab === 'background'" />
        </template>
        <AboutTab v-if="kind === 'classic'" v-show="activeTab === 'about'" />
        <FoliaAboutTab v-else v-show="activeTab === 'about'" />
      </div>
    </aside>
  </Transition>
</template>

<style scoped lang="scss" src="./settings/settings-panel.scss"></style>
<style scoped lang="scss" src="./settings/settings-rows.scss"></style>
