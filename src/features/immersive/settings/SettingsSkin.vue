<script setup lang="ts">
import { computed } from 'vue'

import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import { getSkin, skins } from '@/features/immersive/skins/registry'
import type { SkinId } from '@/features/immersive/skins/types'

/**
 * 「样式」tab —— 皮肤切换入口 ②（另一个是沉浸页悬浮切换条 SkinSwitcher.vue）。
 * 卡片网格：缩略图（纯 CSS 示意图）+ 中文名 + 一句话描述，点击即时生效。
 * 两处入口都写 settings.applySkin，因此天然同步、并随 store 持久化。
 */
const settings = useImmersiveSettingsStore()

// 高亮当前生效皮肤：持久化值无效时与外壳一致地回退到默认皮肤
const activeId = computed(() => getSkin(settings.skin).id)

function select(id: SkinId): void {
  settings.applySkin(id)
}
</script>

<template>
  <section class="settings-section">
    <div class="settings-group-title">样式</div>
    <span class="setting-note banner">切换歌词面板的布局皮肤，立即生效并自动记住。</span>

    <div class="skin-grid">
      <button
        v-for="s in skins"
        :key="s.id"
        type="button"
        class="skin-card"
        :class="{ active: s.id === activeId }"
        @click="select(s.id)"
      >
        <!-- 缩略图为纯 CSS 示意图（皮肤未提供图片资源）；未识别的 id 落到基础样式 -->
        <span class="skin-card-thumb" :class="`skin-card-thumb--${s.id}`" aria-hidden="true">
          <i class="skin-card-thumb-cover" />
          <span class="skin-card-thumb-lines"><i /><i /><i /></span>
        </span>
        <span class="skin-card-name">{{ s.name }}</span>
        <span class="skin-card-desc">{{ s.desc }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped lang="scss" src="./skin-tab.scss"></style>
