<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  BlockOutlined,
  BorderOutlined,
  CloseOutlined,
  MinusOutlined,
  SettingOutlined
} from '@ant-design/icons-vue'

import { useImmersivePlayer } from '@/features/immersive/use-immersive-player'
import {
  isWindowMaximized,
  minimizeWindow,
  onMaximizeChange,
  toggleMaximizeWindow
} from '@platform/electron/window'
import {
  LYRIC_TIMING_MAP,
  useImmersiveSettingsStore
} from '@/features/immersive/immersive-settings.store'
import { usePlayerStore } from '@/stores/player.store'
import { useLyricStore } from '@/stores/lyric.store'
import { useColorExtraction } from '@/features/immersive/use-color-extraction'
import ImmersiveBackground from '@/features/immersive/ImmersiveBackground.vue'
import ImmersiveControls from '@/features/immersive/ImmersiveControls.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import ImmersiveCover from '@/features/immersive/ImmersiveCover.vue'
import ImmersiveSettings from '@/features/immersive/ImmersiveSettings.vue'
import LyricContributors from '@/features/immersive/LyricContributors.vue'
import LyricLines from '@/features/lyric/LyricLines.vue'
import MiniSongInfo from '@/features/immersive/MiniSongInfo.vue'

// idle 由 ImmersiveControls 写入(鼠标静止时置 true),此处读取以让关闭按钮
// 跟随控制条一起隐藏/唤出 —— 见 use-immersive-player.ts 的共享 ref。
const { open, close, idle } = useImmersivePlayer()
const settings = useImmersiveSettingsStore()
// 迁移旧持久化的 customFontFamily(string → string[]),幂等
settings.normalizeFontFamily()
const player = usePlayerStore()
const lyric = useLyricStore()

// 演示模式提示:开启后仅显示几秒告知如何退出,然后自动淡出(不常驻顶部)。
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

// 设置面板显隐（由右上角设置按钮触发，ImmersiveSettings 双向绑定）
const settingsOpen = ref(false)
function toggleSettings(): void {
  settingsOpen.value = !settingsOpen.value
}

async function handleMinimize(): Promise<void> {
  await minimizeWindow().catch(() => undefined)
}

async function handleMaximize(): Promise<void> {
  await toggleMaximizeWindow().catch(() => undefined)
}

// 窗口最大化状态:驱动按钮图标在「最大化」与「还原」间切换
const isMaximized = ref(false)
const maximizeTitle = computed(() => (isMaximized.value ? '还原' : '最大化'))
let offMaximizeChange: (() => void) | null = null
async function syncMaximizeState(): Promise<void> {
  isMaximized.value = await isWindowMaximized().catch(() => false)
}

const song = computed(() => player.currentItem?.song ?? null)
const coverUrl = computed(() => song.value?.coverUrl ?? null)
const { accentVars } = useColorExtraction(coverUrl)

/** 无歌词时强制 cover-only:lyric-only 模式下无内容可显示,回退到全屏封面。 */
const effectiveDisplayMode = computed(() => {
  if (!lyric.loading && !lyric.hasLyric) return 'cover-only' as const
  return settings.displayMode
})

/** 应用全局歌词偏移后的歌词时间轴时间。正 offset 表示歌词提前显示。 */
const lyricDisplayTimeMs = computed(() => player.currentTimeMs + settings.lyricOffset)

/** 当前歌词行索引（含全局偏移 lyricOffset，-1 表示尚未到首行） */
const activeIndex = computed(() => {
  // lyric-stagger 开启时，当前行提前 200ms 切换（参考项目 onPlayProgress 的 scrollingDelay），
  // 让歌词提前滚动，配合行间错位延迟动画，视觉更流畅
  const staggerDelay = settings.lyricStagger ? 200 : 0
  const t = lyricDisplayTimeMs.value + staggerDelay
  const lines = lyric.lines
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeMs <= t) idx = i
    else break
  }
  return idx
})

// 沉浸层打开且当前有歌时懒加载歌词（store 内部去重）
watch(
  [open, () => song.value?.id],
  ([isOpen, id]) => {
    if (isOpen && id) void lyric.loadLyric(id)
  },
  { immediate: true }
)

function handleSeek(timeMs: number): void {
  // 正 offset 下,行首时间戳可能小于 offset,差值为负;audio 侧只对 currentTime 钳 0
  // 却会把负值先写进 currentTimeMs 快照。与 ImmersiveControls 的歌词行跳转一致钳 0。
  player.seek(Math.max(0, timeMs - settings.lyricOffset))
}

const lyricLinesRef = ref<InstanceType<typeof LyricLines> | null>(null)

// lyricOffset 滑块 step=100ms,拖动中每次变化远低于 LyricLines 内部 800ms 的 seek
// 检测阈值,不会自行重建逐字快照 —— 当前行 per-word delay 仍按旧 offset 固化,
// 逐字高亮与新时间轴失配。显式通知重同步(flush:post 保证子组件已拿到新 currentTimeMs)。
watch(
  () => settings.lyricOffset,
  () => lyricLinesRef.value?.resyncKaraoke(),
  { flush: 'post' }
)
// 翻译/罗马音字号只以 CSS 变量注入(见 rootStyleVars),不是 LyricLines 的 prop,
// 字号变化改变行高但不触发其内部重排 watcher —— 显式重测行高并重排,
// 否则带翻译的行立即重叠/出现空隙,要等下一次切行才自愈(参考项目对应派发 recalc-lyrics)。
watch(
  [() => settings.lyricTranslationSizeEm, () => settings.lyricRomajiSizeEm],
  () => lyricLinesRef.value?.remeasure(),
  { flush: 'post' }
)

/**
 * 把全部可调参数以 CSS 变量形式注入到沉浸层根元素。子组件（背景、歌词、控制条）
 * 直接读取这些变量，无需通过 props 逐层传递 —— 与参考项目 bindSliderToCSSVariable
 * 把滑块值写到 document style 的做法等价，只是作用域收到沉浸层内部。
 */
const rootStyleVars = computed(() => {
  const s = settings
  return {
    '--bg-blur': `${s.bgBlur}px`,
    '--bg-dim': s.bgDim / 100,
    '--bg-dim-for-gradient-bg': s.bgDimForGradientBg / 100,
    '--bg-dim-for-fluid-bg': s.bgDimForFluidBg / 100,
    '--bg-blur-for-none-bg-mask': `${s.bgBlurForNoneBgMask}px`,
    '--bg-dim-for-none-bg-mask': s.bgDimForNoneBgMask / 100,
    '--lyric-font-size': `${s.lyricFontSize}px`,
    '--lyric-romaji-size-em': `${s.lyricRomajiSizeEm}em`,
    '--lyric-translation-size-em': `${s.lyricTranslationSizeEm}em`,
    '--rnp-lyric-original-weight': s.lyricFontWeight,
    '--lyric-timing-function': LYRIC_TIMING_MAP[s.lyricAnimationTiming]
  } as Record<string, string | number>
})

/**
 * root class 一一对应参考项目的 body class。参考项目写 document.body，是因为
 * 它要影响整个网易云页面；我们的沉浸层是独立全屏覆盖，所有可见内容都在内部，
 * 写到根元素更干净、不污染全局，关闭时随 v-if 自动消失，无需手动清理。
 */
const rootClasses = computed(() => ({
  [`display-mode-${effectiveDisplayMode.value}`]: true,
  [`rnp-bg-${settings.backgroundType}`]: true,
  'center-lyric': settings.centerLyric,
  'rnp-shadow': settings.textShadow,
  'rnp-text-glow': settings.textGlow,
  'rnp-bottom-progressbar': settings.bottomProgressbar,
  'lyric-fade': settings.lyricFade,
  'lyric-zoom': settings.lyricZoom,
  'lyric-blur': settings.lyricBlur,
  'lyric-rotate': settings.lyricRotate,
  'lyric-stagger': settings.lyricStagger,
  'lyric-glow': settings.lyricGlow,
  'rectangle-cover': settings.rectangleCover,
  'cover-blurry-shadow': settings.coverBlurryShadow,
  'gradient-bg-dynamic': settings.gradientBgDynamic,
  'static-fluid': settings.staticFluid,
  'rnp-presentation-mode': settings.presentationMode,
  'rnp-full-screen': isFullscreen.value,
  'rnp-idle': idle.value,
  'always-show-bottombar': settings.alwaysShowBottomBar,
  'auto-hide-mini-song-info': settings.autoHideMiniSongInfo,
  'custom-font': settings.customFont && settings.customFontFamily.length > 0,
  [`rnp-${settings.colorScheme}`]: true,
  [`accent-color-${settings.accentColorVariant}`]: true,
  // 贡献者显隐:show/hover/hide 三态,驱动 :deep(.rnp-contributors-inner) 显隐规则
  [`rnp-lyric-contributors-${settings.lyricContributorsDisplay}`]: true,
  [`lyric-timing-${settings.lyricAnimationTiming}`]: true
}))

// 自定义字体（参考项目 font-settings.js：注入到 body，我们注入到根元素）
// customFontFamily 是回退链数组,转 CSS font-family 列表('font1', 'font2')
const fontFamilyStyle = computed(() =>
  settings.customFont && settings.customFontFamily.length > 0
    ? { fontFamily: settings.customFontFamily.map((f) => `'${f}'`).join(', ') }
    : {}
)

// 全屏按钮 + 时钟（对齐参考项目 addFullScreenButton / rnp-full-screen-clock）
const isFullscreen = ref(false)
const fullscreenTitle = computed(() => (isFullscreen.value ? '退出全屏' : '全屏'))
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

function syncFullscreenState(): void {
  isFullscreen.value = Boolean(document.fullscreenElement)
}

async function toggleFullScreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      if (document.exitFullscreen) await document.exitFullscreen()
    } else {
      await document.documentElement.requestFullscreen()
    }
  } finally {
    syncFullscreenState()
  }
}

function handleToggleFullScreen(): void {
  void toggleFullScreen()
}

function leaveFullscreenIfOwned(): void {
  if (!document.fullscreenElement || !document.exitFullscreen) return
  void document.exitFullscreen().finally(syncFullscreenState)
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
      void syncMaximizeState()
      offMaximizeChange = onMaximizeChange((m) => {
        isMaximized.value = m
      })
    } else {
      window.removeEventListener('keydown', onKeydown)
      document.removeEventListener('fullscreenchange', syncFullscreenState)
      leaveFullscreenIfOwned()
      stopClock()
      offMaximizeChange?.()
      offMaximizeChange = null
    }
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('fullscreenchange', syncFullscreenState)
  stopClock()
  if (presentationHintTimer) clearTimeout(presentationHintTimer)
  offMaximizeChange?.()
  offMaximizeChange = null
})
</script>

<template>
  <Transition name="immersive-slide">
    <section
      v-if="open"
      class="immersive-root"
      :class="rootClasses"
      :style="[rootStyleVars, accentVars, fontFamilyStyle]"
    >
      <!-- 顶部 32px 窗口拖拽带（覆盖被隐藏的 TitleBar，保持窗口可移动） -->
      <div class="immersive-drag-region" />

      <!-- 背景层 -->
      <ImmersiveBackground />

      <!-- 仅歌词模式顶部迷你歌曲信息：参考项目 mini-song-info，随 idle 自动隐藏 -->
      <MiniSongInfo />

      <!-- 内容层：左封面 / 右歌词。displayMode 控制各区域显隐 -->
      <div class="immersive-content">
        <div
          v-show="effectiveDisplayMode !== 'lyric-only'"
          class="immersive-cover-slot"
          :class="[`cover-halign-${settings.coverHAlign}`, `cover-valign-${settings.coverVAlign}`]"
        >
          <ImmersiveCover />
        </div>

        <!-- 歌词区 -->
        <div v-show="effectiveDisplayMode !== 'cover-only'" class="immersive-lyric">
          <LyricLines
            ref="lyricLinesRef"
            :lines="lyric.lines"
            :active-index="activeIndex"
            :font-size="settings.lyricFontSize"
            :alignment-percentage="settings.currentLyricAlignmentPercentage"
            :enable-zoom="settings.lyricZoom"
            :enable-blur="settings.lyricBlur"
            :enable-fade="settings.lyricFade"
            :enable-stagger="settings.lyricStagger"
            :enable-rotate="settings.lyricRotate"
            :rotate-curvature="settings.rotateCurvature"
            :karaoke-animation="settings.karaokeAnimation"
            :current-time-ms="lyricDisplayTimeMs"
            :enable-lyric-glow="settings.lyricGlow"
            :is-playing="player.isPlaying"
            @seek="handleSeek"
          >
            <!-- 歌词贡献者:作为歌词列表末项随当前行滚动(对齐参考项目 lyrics.js:754)。
                 LyricLines 通过 contributors 具名 slot 提供 transform style,此处填充组件。
                 显隐仍由 rnp-lyric-contributors-* class 控制(见下方 :deep 样式)。 -->
            <template #contributors="{ ctx }">
              <LyricContributors
                :contributors="lyric.contributors"
                :style="ctx.contributorsStyle"
              />
            </template>
          </LyricLines>
        </div>
      </div>

      <!-- 关闭按钮:跟随控制条 idle 一起隐藏,鼠标移动唤出;ESC 始终可退(见 onKeydown) -->
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

      <!-- 参考项目全屏按钮：鼠标移动/底栏常显时出现，全屏后左移并显示时钟 -->
      <AppTooltip :title="fullscreenTitle">
        <button
          type="button"
          class="rnp-full-screen-button"
          :aria-label="fullscreenTitle"
          @click="handleToggleFullScreen"
        />
      </AppTooltip>
      <!-- 设置按钮(对齐参考 .rnp-settings:控制条外,沉浸页右上角独立 fixed;
           非全屏 right:20 top:65、全屏 right:25 top:25,跟随 idle 显隐) -->
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
      <div v-if="isFullscreen" class="rnp-full-screen-clock">{{ currentClock }}</div>

      <!-- 演示模式退出提示：开启后仅显示几秒告知如何退出,然后淡出 -->
      <Transition name="hint-fade">
        <div v-if="presentationHintVisible" class="immersive-presentation-hint">
          演示模式 · 移动鼠标显示控制条,点击设置按钮退出
        </div>
      </Transition>

      <!-- 控制条（ImmersiveControls：播放/进度/音量/模式/队列/设置 + 自动隐藏） -->
      <ImmersiveControls />

      <!-- 设置面板（8-tab，从右滑入） -->
      <ImmersiveSettings v-model:visible="settingsOpen" />
    </section>
  </Transition>
</template>

<style scoped lang="scss" src="./immersive-shell.scss"></style>
