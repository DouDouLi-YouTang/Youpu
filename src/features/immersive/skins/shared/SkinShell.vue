<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { SettingOutlined } from '@ant-design/icons-vue'

import AppTooltip from '@/components/common/AppTooltip.vue'
import ImmersiveControls from '@/features/immersive/ImmersiveControls.vue'
import ImmersiveSettings from '@/features/immersive/ImmersiveSettings.vue'
import { resetIdle } from '@/features/immersive/controls/use-controls-idle'
import { useIdleHoldWhile } from '@/features/immersive/controls/use-idle-hold'
import {
  isEditableShortcutTarget,
  resolvePlayerShortcut,
  resolveSeekTarget,
  resolveVolumeTarget,
  type PlayerShortcut
} from '@/features/immersive/controls/player-shortcuts'
import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import { useActiveSkin } from '@/features/immersive/skins/registry'
import { useAudioBands } from '@/features/immersive/use-audio-bands'
import { useFpsMeter } from '@/features/immersive/use-fps-meter'
import { useImmersivePanels } from '@/features/immersive/use-immersive-panels'
import { useImmersivePlayer } from '@/features/immersive/use-immersive-player'
import { usePlayerStore } from '@/stores/player.store'
import { useSkinContext } from '@/features/immersive/use-skin-context'
import SkinChromeButtons from './SkinChromeButtons.vue'
import SkinSwitcher from './SkinSwitcher.vue'
import { useBackdrop } from './use-backdrop'

/**
 * 皮肤外壳 —— 根 `<section class="immersive-root">` 与全部「窗口 chrome」：
 * 顶部拖拽带、窗口按钮（见 SkinChromeButtons）、全屏时钟、演示模式提示、
 * 控制栏第一排的皮肤切换按钮、设置按钮、ESC 分层关闭。
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
// 方向键快捷键（←/→ 进度、↑/↓ 音量）读写的就是播放器 store
const player = usePlayerStore()

// 频谱：本组件只在沉浸页打开时存在 —— setup 里 start 即「打开时启动」，
// 卸载时 useAudioBands() 注册的 onBeforeUnmount 自动 stop（订阅归零即停 rAF）。
useAudioBands().start()

/**
 * 左上角帧率显示（Folia 设置的 `folia.showFps`）。
 *
 * 统计的是沉浸页**实际出帧**（rAF），不是某个皮肤自己的绘制循环 —— 背景、歌词、
 * 控制条的合成开销都算在里面。开关关闭时本 hook 不建 rAF 循环。
 */
const fps = useFpsMeter(computed(() => settings.folia.showFps))

// 皮肤：上下文（store 状态的统一视图）+ 当前皮肤（settings.skin，无效值回退默认）
const ctx = useSkinContext()
const activeSkin = useActiveSkin()

/**
 * 四套皮肤都有设置入口；具体显示哪个版本的面板由 `settingsKind` 决定
 * （经典六页签 / Folia 三主题共用页签，见 skins/types.ts），不要在这里硬判 id。
 */
const hasPanelSettings = computed(() => activeSkin.value.hasSettings)

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

// 设置面板显隐（由右上角设置按钮触发，ImmersiveSettings 双向绑定）。
// 与面板主题列表（SkinSwitcher）**互斥**：两个弹层落点重叠，同时开着会互相盖住 ——
// 状态收在 use-immersive-panels 的单一槽位里，写入即抢占。
const panels = useImmersivePanels()
const settingsOpen = computed({
  get: () => panels.isOpen('settings').value,
  set: (visible: boolean) => {
    if (visible) panels.open('settings')
    else panels.close('settings')
  }
})
// 切到没有设置入口的皮肤（未来新增皮肤可能如此）时把面板收起来，
// 避免用户既没有按钮可关、看到的又是上一套设置。
watch(hasPanelSettings, (has) => {
  if (!has) settingsOpen.value = false
})
function toggleSettings(): void {
  panels.toggle('settings')
}
// 弹层开着时不自动隐藏：设置面板/面板主题列表里的按钮就在顶部那一排，控制条一隐，
// 「关闭设置」「切换面板」按钮会跟着 `.immersive-close-hidden` 一起消失。
useIdleHoldWhile(() => panels.anyOpen.value)

function handleToggleFullScreen(): void {
  void toggleFullScreen()
}

// 演示模式提示：开启后仅显示几秒告知如何退出，然后自动淡出(不常驻顶部)。
const presentationHintVisible = ref(false)
let presentationHintTimer: ReturnType<typeof setTimeout> | null = null
watch(
  // 演示模式属于沉浸页通用项（不是面板外观），倾诉也跟随
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

// ESC 关闭 + 方向键快捷键：沉浸层打开时注册全局监听，关闭即移除。
function onKeydown(e: globalThis.KeyboardEvent): void {
  if (!open.value) return

  if (e.key === 'Escape') {
    e.preventDefault()
    // ESC 分层关闭：先收顶部的弹层（设置面板 / 面板主题列表，两个互斥、至多一个开着），
    // 再按才退全屏，最后才退出沉浸层。
    if (panels.anyOpen.value) panels.closeAll()
    else if (isFullscreen.value) leaveFullscreenIfOwned()
    else close()
    return
  }

  // 键盘操作也算「用户在动」：唤出控制条，否则按方向键时画面毫无反馈
  //（鼠标静止 1.5s 后控制条已隐没、光标也已隐藏）。
  const shortcut = resolvePlayerShortcut(e.key)
  if (!shortcut || isEditableShortcutTarget(e.target)) return

  e.preventDefault()
  applyPlayerShortcut(shortcut)
  resetIdle()
}

/**
 * 方向键的落点。两个动作都走 store 的公开接口（`seek` / `setVolume`），
 * 不直接碰音频控制器 —— 拖动进度条、点音量滑块走的是同一条路径，
 * 失焦恢复、静音取消这些副作用因此完全一致。
 */
function applyPlayerShortcut(shortcut: PlayerShortcut): void {
  if (shortcut === 'seek-back' || shortcut === 'seek-forward') {
    const target = resolveSeekTarget(
      player.currentTimeMs,
      player.durationMs,
      shortcut === 'seek-forward' ? 'forward' : 'back'
    )
    if (target !== player.currentTimeMs) player.seek(target)
    return
  }
  const next = resolveVolumeTarget(player.volume, shortcut === 'volume-up' ? 'up' : 'down')
  if (next !== player.volume) player.setVolume(next)
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
  // 本外壳随沉浸层一起卸载（ImmersivePlayer 用 v-if="open" 挂载）：弹层状态是
  // 模块级单例，不在这里清掉的话，下次打开沉浸页会带着上次的弹层一起出现。
  panels.closeAll()
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

    <!-- 悬浮皮肤切换按钮（控制栏第一排，紧挨设置按钮左侧；跟随 idle 显隐，演示模式隐藏） -->
    <SkinSwitcher :has-settings="hasPanelSettings" />

    <!-- 设置按钮(对齐参考 .rnp-settings:控制条外,沉浸页右上角独立 fixed;
         非全屏 right:140、全屏 right:52,跟随 idle 显隐)。
         ⚠️ 只在当前皮肤有设置入口时渲染；没有入口时切换按钮自动占住这一格
         （见 SkinSwitcher 的 right 覆写）。 -->
    <AppTooltip v-if="hasPanelSettings" :title="settingsOpen ? '关闭设置' : '打开设置'">
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

    <!--
      帧率显示（Folia 设置的 `folia.showFps`）：左上角。
      位置与全屏时钟同一行；非全屏时时钟不渲染，它独占左上角。
      不吃鼠标事件、不随 idle 隐藏 —— 它是排查工具，用户开它就是要一直看。
    -->
    <div v-if="settings.folia.showFps" class="rnp-fps-meter" aria-hidden="true">{{ fps }} FPS</div>

    <!-- 演示模式退出提示：开启后仅显示几秒告知如何退出,然后淡出 -->
    <Transition name="hint-fade">
      <div v-if="presentationHintVisible" class="immersive-presentation-hint">
        演示模式 · 移动鼠标显示控制条,点击设置按钮退出
      </div>
    </Transition>

    <!-- 控制条（ImmersiveControls：播放/进度/音量/模式/队列/设置 + 自动隐藏）。共享层,不属于皮肤 -->
    <ImmersiveControls />

    <!-- 设置面板（从右滑入）。共享层，不属于皮肤；内部按 settingsKind 切换页签 -->
    <ImmersiveSettings v-model:visible="settingsOpen" :kind="activeSkin.settingsKind" />
  </section>
</template>

<style scoped lang="scss" src="../../immersive-shell.scss"></style>
