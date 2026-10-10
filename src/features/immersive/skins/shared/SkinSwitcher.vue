<script setup lang="ts">
import { computed, ref } from 'vue'
import { SkinOutlined } from '@ant-design/icons-vue'

import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import { getSkin, skins } from '@/features/immersive/skins/registry'
import { useImmersivePlayer } from '@/features/immersive/use-immersive-player'
import type { SkinId } from '@/features/immersive/skins/types'

/**
 * 沉浸页悬浮皮肤切换条（切换入口 ①）—— 歌词区右上角的胶囊，点击展开面板列表，
 * 选择即切并自动收起。跟随 idle 显隐（与关闭按钮一致，共用 immersive-close-hidden），
 * 演示模式下隐藏。另一个入口是设置面板「样式」tab（settings/SettingsSkin.vue），
 * 两者都写 settings.applySkin，因此天然同步。
 */
const settings = useImmersiveSettingsStore()
const { idle } = useImmersivePlayer()

const expanded = ref(false)

// 高亮当前生效皮肤：持久化值无效时与外壳一致地回退到默认皮肤
const activeId = computed(() => getSkin(settings.skin).id)

function toggleExpanded(): void {
  expanded.value = !expanded.value
}

function select(id: SkinId): void {
  settings.applySkin(id)
  expanded.value = false
}
</script>

<template>
  <div
    v-if="!settings.presentationMode"
    class="skin-switcher"
    :class="{ 'immersive-close-hidden': idle }"
  >
    <button
      type="button"
      class="skin-switcher-trigger"
      :class="{ expanded }"
      :aria-label="expanded ? '收起皮肤列表' : '切换皮肤'"
      :aria-expanded="expanded"
      @click="toggleExpanded"
    >
      <SkinOutlined />
    </button>

    <Transition name="skin-switcher-fade">
      <div v-if="expanded" class="skin-switcher-panel">
        <button
          v-for="s in skins"
          :key="s.id"
          type="button"
          class="skin-switcher-item"
          :class="{ active: s.id === activeId }"
          @click="select(s.id)"
        >
          <span class="skin-switcher-item-name">{{ s.name }}</span>
          <span class="skin-switcher-item-desc">{{ s.desc }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.skin-switcher {
  position: fixed;
  // 关/最小化/最大化/设置四个按钮占据 top:8 起的 36px 一行，切换条落在其下方空白区
  top: 56px;
  right: 20px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  -webkit-app-region: no-drag;
  transition: opacity 0.3s ease;
}

.skin-switcher-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 9999px;
  background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.1);
  color: var(--rnp-accent-color-shade-2, var(--color-text-primary));
  font-size: 15px;
  cursor: pointer;
  transition:
    background 0.2s ease,
    opacity 0.2s ease,
    transform 0.2s ease;

  &:hover,
  &.expanded {
    background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.2);
  }
}

.skin-switcher-panel {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 168px;
  padding: 6px;
  border-radius: 12px;
  background: rgba(var(--rnp-accent-color-bg-rgb, 20, 20, 20), 0.78);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.skin-switcher-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--rnp-accent-color-shade-2, var(--color-text-primary));
  text-align: left;
  cursor: pointer;
  transition: background 0.2s ease;

  &:hover {
    background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.1);
  }

  &.active {
    background: var(--rnp-accent-color, var(--color-primary));
    color: var(--rnp-accent-color-on-primary, #fff);
  }
}

.skin-switcher-item-name {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
}

.skin-switcher-item-desc {
  font-size: 11px;
  line-height: 1.3;
  opacity: 0.7;
}

.skin-switcher-fade-enter-active,
.skin-switcher-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.skin-switcher-fade-enter-from,
.skin-switcher-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
