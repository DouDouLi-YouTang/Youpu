<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'

import { resolvedThemeMode } from '@/app/providers/theme-provider'
import { useCommentsPanel } from '@/features/comments/use-comments-panel'
import { useMiniMode } from '@/features/player/use-mini-mode'
import CommentsView from '@/features/comments/CommentsView.vue'
import ImmersivePlayer from '@/features/immersive/ImmersivePlayer.vue'
import MiniPlayerBar from './MiniPlayerBar.vue'
import PlayerBar from './PlayerBar.vue'
import SidebarNav from './SidebarNav.vue'
import TitleBar from './TitleBar.vue'

/**
 * 打包版 0.1.21 布局：
 * - 迷你模式：仅 MiniPlayerBar
 * - 正常模式：合并顶栏 TitleBar(60px，含搜索/设置) + 侧栏 + 内容 + 底栏 PlayerBar
 * 不再单独挂载 TopBar。
 */

const { isMiniMode, init } = useMiniMode()
const route = useRoute()
const { close: closeComments } = useCommentsPanel()

watch(
  () => route.fullPath,
  () => closeComments()
)

let unsubMini: (() => void) | null = null
onMounted(() => {
  unsubMini = init()
})
onUnmounted(() => {
  unsubMini?.()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <div v-show="isMiniMode" class="h-full w-full">
      <MiniPlayerBar />
    </div>

    <div v-show="!isMiniMode" class="flex h-full min-h-0 flex-col">
      <div class="h-[60px] flex-shrink-0">
        <TitleBar />
      </div>
      <a-layout class="min-h-0 flex-1 text-text-primary">
        <a-layout-sider
          :width="220"
          :collapsible="false"
          :trigger="null"
          :theme="resolvedThemeMode"
          class="border-r border-border !bg-[var(--color-bg-secondary)]"
        >
          <SidebarNav />
        </a-layout-sider>

        <a-layout>
          <a-layout-content class="relative min-h-0 overflow-hidden !p-0">
            <RouterView v-slot="{ Component, route: viewRoute }">
              <Transition name="page-fade" mode="out-in">
                <component :is="Component" :key="viewRoute.path" />
              </Transition>
            </RouterView>
            <CommentsView />
          </a-layout-content>
        </a-layout>
      </a-layout>
      <a-layout-footer class="!h-[88px] flex-shrink-0 !p-0">
        <PlayerBar />
      </a-layout-footer>

      <ImmersivePlayer />
    </div>
  </div>
</template>

<style scoped lang="scss">
// 路由切换淡入淡出：进出共享同一 transition，enter/leave 方向相反
$page-fade-duration: 0.18s;
$page-fade-ease: ease;
$page-fade-offset: 6px;

.page-fade {
  &-enter-active,
  &-leave-active {
    transition:
      opacity $page-fade-duration $page-fade-ease,
      transform $page-fade-duration $page-fade-ease;
  }

  &-enter-from {
    opacity: 0;
    transform: translateY($page-fade-offset);
  }

  &-leave-to {
    opacity: 0;
    transform: translateY(-$page-fade-offset);
  }
}
</style>
