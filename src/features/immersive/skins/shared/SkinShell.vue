<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { SettingOutlined } from '@ant-design/icons-vue'

import AppTooltip from '@/components/common/AppTooltip.vue'
import ImmersiveControls from '@/features/immersive/ImmersiveControls.vue'
import ImmersiveSettings from '@/features/immersive/ImmersiveSettings.vue'
import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import { useActiveSkin } from '@/features/immersive/skins/registry'
import { useAudioBands } from '@/features/immersive/use-audio-bands'
import { useImmersivePlayer } from '@/features/immersive/use-immersive-player'
import { useSkinContext } from '@/features/immersive/use-skin-context'
import SkinChromeButtons from './SkinChromeButtons.vue'
import SkinSwitcher from './SkinSwitcher.vue'
import { useBackdrop } from './use-backdrop'

/**
 * 皮肤外壳 —— 根 `<section class="immersive-root">` 与全部「窗口 chrome」：
 * 顶部拖拽带、窗口按钮（见 SkinChromeButtons）、全屏时钟、演示模式提示、
 * 悬浮皮肤切换条、设置按钮、ESC 分层关闭。
 *
 * 皮肤外的共享层 `ImmersiveControls`（控制条）与 `ImmersiveSettings`（设置面板）
 * **保持在本组件内**，任何皮肤都不接管它们；皮肤只负责「内容层」（背景 / 迷你歌曲
 * 信息 / 封面槽 + 歌词区）。本组件由 ImmersivePlayer 以 `v-if="open"` 挂载，
 * 因此这里的挂载/卸载时机 = 沉浸页的打开/关闭时机。
 */
/** 专辑主色变量由常驻挂载的 ImmersivePlayer 计算（它同时驱动全局主题色，不能只在本组件内跑） */
defineProps<{ accentVars: Record<string, string> }>()

const { open, close } = useImmersivePlayer()
const settings = useImmersiveSettingsStore()

// 频谱：本组件只在沉浸页打开时存在 —— setup 里 start 即「打开时启动」，
// 卸载时 useAudioBands() 注册的 onBeforeUnmount 自动 stop（订阅归零即停 rAF）。
useAudioBands().start()

// 皮肤：上下文（store 状态的统一视图）+ 当前皮肤（settings.skin，无效值回退默认）
const ctx = useSkinContext()
const activeSkin = useActiveSkin()

// 背景/根节点渲染参数：rootClasses / rootStyleVars / 字体 / 全屏状态
const {
  rootClasses,
  rootStyleVars,
  fontFamilyStyle,
  isFullscreen,
  syncFullscreenState,
  toggleFullScreen,
  leaveFullscreenIfOwned
} = useBackdrop()

// 设置面板显隐（由右上角设置按钮触发，ImmersiveSettings 双向绑定）
const settingsOpen = ref(false)
function toggleSettings(): void {
  settingsOpen.value = !settingsOpen.value
}

function handleToggleFullScreen(): void {
  void toggleFullScreen()
}

// 演示模式提示：开启后仅显示几秒告知如何退出，然后自动淡出(不常驻顶部)。
const presentationHintVisible = ref(false)
let presentationHintTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => settings.presentationMode,
  (on) => {
    if (!on) return
    presentationHintVisible.value = true
    if (presentationHintTimer) clearTimeout(presentationHintTimer)
    presentationHintTimer = setTimeout(() => {
      presentationHintVisible.value = false
      presentationHintTimer = null
    }, 4000)
  },
  { immediate: true }
)

// 全屏时钟（对齐参考项目 rnp-full-screen-clock）
const currentClock = ref('00:00')
let clockTimer: number | null = null

function updateClock(): void {
  const now = new Date()
  const hours = `${now.getHours()}`.padStart(2, '0')
  const minutes = `${now.getMinutes()}`.padStart(2, '0')
  currentClock.value = `${hours}:${minutes}`
}

function startClock(): void {
  updateClock()
  if (clockTimer !== null) return
  clockTimer = window.setInterval(updateClock, 1000)
}

function stopClock(): void {
  if (clockTimer === null) return
  window.clearInterval(clockTimer)
  clockTimer = null
}

// ESC 关闭：沉浸层打开时注册全局监听，关闭即移除。
function onKeydown(e: globalThis.KeyboardEvent): void {
  if (e.key === 'Escape' && open.value) {
    e.preventDefault()
    // ESC 分层关闭：设置面板打开时先关面板，再按才退出沉浸层
    if (settingsOpen.value) settingsOpen.value = false
    else if (isFullscreen.value) leaveFullscreenIfOwned()
    else close()
  }
}
watch(
  open,
  (isOpen) => {
    if (isOpen) {
      window.addEventListener('keydown', onKeydown)
      document.addEventListener('fullscreenchange', syncFullscreenState)
      syncFullscreenState()
      startClock()
    } else {
      window.removeEventListener('keydown', onKeydown)
      document.removeEventListener('fullscreenchange', syncFullscreenState)
      leaveFullscreenIfOwned()
      stopClock()
    }
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('fullscreenchange', syncFullscreenState)
  stopClock()
  if (presentationHintTimer) clearTimeout(presentationHintTimer)
})
</script>

<template>
  <section
    class="immersive-root"
    :class="rootClasses"
    :style="[rootStyleVars, accentVars, fontFamilyStyle]"
  >
    <!-- 顶部 32px 窗口拖拽带（覆盖被隐藏的 TitleBar，保持窗口可移动） -->
    <div class="immersive-drag-region" />

    <!-- 皮肤：背景层 + 仅歌词模式的迷你歌曲信息 + 内容层（封面槽 / 歌词区）。
         皮肤根节点是 fragment，DOM 结构与改造前逐节点一致。 -->
    <component :is="activeSkin.component" :ctx="ctx" />

    <!-- 窗口按钮：关闭 / 最小化 / 最大化 / 全屏（跟随 idle 显隐） -->
    <SkinChromeButtons :is-fullscreen="isFullscreen" @toggle-fullscreen="handleToggleFullScreen" />

    <!-- 悬浮皮肤切换条（歌词区右上角；跟随 idle 显隐，演示模式隐藏） -->
    <SkinSwitcher />

    <!-- 设置按钮(对齐参考 .rnp-settings:控制条外,沉浸页右上角独立 fixed;
         非全屏 right:140、全屏 right:52,跟随 idle 显隐) -->
    <AppTooltip :title="settingsOpen ? '关闭设置' : '打开设置'">
      <button
        type="button"
        class="rnp-settings-button"
        :class="{ active: settingsOpen }"
        :aria-label="settingsOpen ? '关闭设置' : '打开设置'"
        @click="toggleSettings"
      >
        <SettingOutlined />
      </button>
    </AppTooltip>

    <!-- 参考项目全屏时钟：全屏后出现在左上角 -->
    <div v-if="isFullscreen" class="rnp-full-screen-clock">{{ currentClock }}</div>

    <!-- 演示模式退出提示：开启后仅显示几秒告知如何退出,然后淡出 -->
    <Transition name="hint-fade">
      <div v-if="presentationHintVisible" class="immersive-presentation-hint">
        演示模式 · 移动鼠标显示控制条,点击设置按钮退出
      </div>
    </Transition>

    <!-- 控制条（ImmersiveControls：播放/进度/音量/模式/队列/设置 + 自动隐藏）。共享层,不属于皮肤 -->
    <ImmersiveControls />

    <!-- 设置面板（6+1 tab，从右滑入）。共享层,不属于皮肤 -->
    <ImmersiveSettings v-model:visible="settingsOpen" />
  </section>
</template>

<style scoped lang="scss" src="../../immersive-shell.scss"></style>
