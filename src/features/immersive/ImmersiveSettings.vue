<script setup lang="ts">
import { ref } from 'vue'
import { CloseOutlined } from '@ant-design/icons-vue'

import AboutTab from '@/features/immersive/settings/AboutTab.vue'
import AppearanceTab from '@/features/immersive/settings/AppearanceTab.vue'
import BackgroundTab from '@/features/immersive/settings/BackgroundTab.vue'
import CoverTab from '@/features/immersive/settings/CoverTab.vue'
import FontTab from '@/features/immersive/settings/FontTab.vue'
import LyricTab from '@/features/immersive/settings/LyricTab.vue'
import SettingsSkin from '@/features/immersive/settings/SettingsSkin.vue'

/**
 * 沉浸层设置面板外壳 —— 7 个 tab（样式 / 外观 / 封面 / 背景 / 歌词 / 字体 / 关于），
 * 前 6 个严格对齐参考项目 settings-menu.html，「样式」是皮肤系统新增（放最前）。
 * 从右侧滑入，各 tab 内容已拆分为 ./settings/*.vue，
 * 所有控件双向绑定 immersive-settings store，即时生效（store 变更驱动 SkinShell
 * 的 rootClasses / rootStyleVars 重算）。
 *
 * 本组件只负责：Transition + 悬浮小窗外壳 + 纵向 tab 列 + 内容区分发。
 * 外壳与 antd 控件覆盖样式见 ./settings/settings-panel.scss，多 tab 共用的行样式见
 * ./settings/settings-rows.scss（tab 子组件内部节点没有本组件的 data-v，故用 :deep() 穿透）。
 */

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void }>()

function close(): void {
  emit('update:visible', false)
}

// ── tab 定义（「样式」为皮肤系统新增放最前，其余顺序与文案对齐参考项目 settings-menu.html） ──
const TABS = [
  { key: 'skin', label: '样式' },
  { key: 'appearance', label: '外观' },
  { key: 'cover', label: '封面' },
  { key: 'background', label: '背景' },
  { key: 'lyric', label: '歌词' },
  { key: 'font', label: '字体' },
  { key: 'about', label: '关于' }
] as const
type TabKey = (typeof TABS)[number]['key']
const activeTab = ref<TabKey>('appearance')
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
          v-for="t in TABS"
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
        <SettingsSkin v-show="activeTab === 'skin'" />
        <AppearanceTab v-show="activeTab === 'appearance'" />
        <CoverTab v-show="activeTab === 'cover'" />
        <BackgroundTab v-show="activeTab === 'background'" />
        <LyricTab v-show="activeTab === 'lyric'" />
        <FontTab v-show="activeTab === 'font'" />
        <AboutTab v-show="activeTab === 'about'" />
      </div>
    </aside>
  </Transition>
</template>

<style scoped lang="scss" src="./settings/settings-panel.scss"></style>
<style scoped lang="scss" src="./settings/settings-rows.scss"></style>
