<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { BlockOutlined, BorderOutlined, CloseOutlined, MinusOutlined } from '@ant-design/icons-vue'

import AppTooltip from '@/components/common/AppTooltip.vue'
import { useImmersivePlayer } from '@/features/immersive/use-immersive-player'
import {
  isWindowMaximized,
  minimizeWindow,
  onMaximizeChange,
  toggleMaximizeWindow
} from '@platform/electron/window'

/**
 * 窗口 chrome 按钮：关闭 / 最小化 / 最大化 / 全屏。
 * 从 SkinShell 拆出以免其超 400 行（AGENTS.md）。样式仍在沉浸外壳样式表
 * （immersive-shell.scss）里 —— 那些规则挂在根 section 的状态 class 下，
 * 用 :deep() 命中的就是本组件的按钮。
 *
 * 全屏状态由外壳（use-backdrop）持有并作为 prop 传入；按钮只上报切换意图。
 */
const props = defineProps<{ isFullscreen: boolean }>()
const emit = defineEmits<{ (e: 'toggle-fullscreen'): void }>()

// idle 由 ImmersiveControls 写入(鼠标静止时置 true),此处读取以让关闭按钮
// 跟随控制条一起隐藏/唤出 —— 见 use-immersive-player.ts 的共享 ref。
const { close, idle } = useImmersivePlayer()

async function handleMinimize(): Promise<void> {
  await minimizeWindow().catch(() => undefined)
}

async function handleMaximize(): Promise<void> {
  await toggleMaximizeWindow().catch(() => undefined)
}

function handleToggleFullScreen(): void {
  emit('toggle-fullscreen')
}

// 窗口最大化状态:驱动按钮图标在「最大化」与「还原」间切换
const isMaximized = ref(false)
const maximizeTitle = computed(() => (isMaximized.value ? '还原' : '最大化'))
const fullscreenTitle = computed(() => (props.isFullscreen ? '退出全屏' : '全屏'))
let offMaximizeChange: (() => void) | null = null
async function syncMaximizeState(): Promise<void> {
  isMaximized.value = await isWindowMaximized().catch(() => false)
}

// 本组件在沉浸页打开期间才存在(Mount/Unmount = 原 watch(open) 的注册/注销时机)
onMounted(() => {
  void syncMaximizeState()
  offMaximizeChange = onMaximizeChange((m) => {
    isMaximized.value = m
  })
})
onBeforeUnmount(() => {
  offMaximizeChange?.()
  offMaximizeChange = null
})
</script>

<template>
  <!-- 关闭按钮:跟随控制条 idle 一起隐藏,鼠标移动唤出;ESC 始终可退(见 SkinShell) -->
  <AppTooltip title="退出沉浸播放">
    <button
      type="button"
      class="immersive-close"
      :class="{ 'immersive-close-hidden': idle }"
      aria-label="退出沉浸播放"
      @click="close"
    >
      <CloseOutlined />
    </button>
  </AppTooltip>

  <!-- 最小化窗口按钮:沉浸页无需退出即可最小化整个窗口,跟随 idle 显隐 -->
  <AppTooltip v-if="!isFullscreen" title="最小化">
    <button
      type="button"
      class="immersive-minimize"
      :class="{ 'immersive-close-hidden': idle }"
      aria-label="最小化"
      @click="handleMinimize"
    >
      <MinusOutlined />
    </button>
  </AppTooltip>

  <!-- 最大化窗口按钮:切换窗口最大化/还原,图标随状态切换,跟随 idle 显隐 -->
  <AppTooltip v-if="!isFullscreen" :title="maximizeTitle">
    <button
      type="button"
      class="immersive-maximize"
      :class="{ 'immersive-close-hidden': idle }"
      :aria-label="maximizeTitle"
      @click="handleMaximize"
    >
      <BlockOutlined v-if="isMaximized" />
      <BorderOutlined v-else />
    </button>
  </AppTooltip>

  <!-- 参考项目全屏按钮：鼠标移动/底栏常显时出现，全屏后切换为收起图标 -->
  <AppTooltip :title="fullscreenTitle">
    <button
      type="button"
      class="rnp-full-screen-button"
      :aria-label="fullscreenTitle"
      @click="handleToggleFullScreen"
    />
  </AppTooltip>
</template>
