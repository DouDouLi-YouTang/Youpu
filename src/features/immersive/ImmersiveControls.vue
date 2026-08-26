<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  AudioMutedOutlined,
  DislikeOutlined,
  HeartFilled,
  HeartOutlined,
  SoundOutlined
} from '@ant-design/icons-vue'

import { usePlayerStore } from '@/stores/player.store'
import type { PlayableLevel } from '@/domain/player'
import { QUALITY_OPTIONS, qualityLabel } from '@/domain/quality'
import { useImmersivePlayer } from '@/features/immersive/use-immersive-player'
import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import { useLyricStore } from '@/stores/lyric.store'
import { formatDuration } from '@/utils/format'
import PlayQueuePanel from '@/features/player/PlayQueuePanel.vue'
import PlaybackModeIcon from '@/components/music/PlaybackModeIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'

/**
 * 沉浸层内嵌控制条 —— 视觉对齐参考项目 refined-control-bar.scss：
 * 36px 圆形主色按钮、播放键主色填充、贴底进度条、自动隐藏。
 *
 * 逻辑复用自 PlayerBar（seek 防抖拖拽、音量、模式、队列）。
 * 自动隐藏阈值 1.5s 对齐参考项目 main.js 的 IdleThreshold。
 *
 * 关闭按钮不在本组件内:由 ImmersivePlayer 右上角独立承载,但通过共享的 idle ref
 * 跟随控制条一起隐藏/唤出(鼠标静止隐藏、移动唤出);ESC 始终可退出沉浸层。
 */

const player = usePlayerStore()
const settings = useImmersiveSettingsStore()
const lyric = useLyricStore()

const VOLUME_WHEEL_STEP = 5
// idle 是模块级共享 ref(见 use-immersive-player.ts):本组件写入,
// ImmersivePlayer 的关闭按钮读取以跟随控制条一起隐藏/唤出。
const { open, idle } = useImmersivePlayer()

const song = computed(() => player.currentItem?.song ?? null)
const artistsText = computed(() =>
  song.value ? song.value.artists.map((a) => a.name).join(' / ') : ''
)

// 队列抽屉开关
const queueVisible = ref(false)

// ── 进度条：防抖拖拽（逻辑复用自 PlayerBar） ──
const seekValue = ref(0)
const isDragging = ref(false)
const totalTime = computed(() => player.durationMs || song.value?.durationMs || 0)
// a-slider 要求 (max - min) 是 step 的整数倍，否则告警；totalTime 通常是歌曲实际时长，不保证是 100 的倍数
const sliderMax = computed(() => Math.max(0, Math.ceil(totalTime.value / 100) * 100))

watch(
  () => player.currentTimeMs,
  (t) => {
    if (!isDragging.value) seekValue.value = t
  },
  { immediate: true }
)

function onSliderChange(value: number | number[]): void {
  const v = Array.isArray(value) ? value[0] : value
  seekValue.value = v
  isDragging.value = true
  // 拖动进度条期间保持控制条显示:antd slider onMouseMove 调 stopPropagation,
  // window mousemove 不触发,idle 计时不被重置会导致控制条淡出(同音量条)。
  resetIdle()
}

let sliderReleaseTimer: ReturnType<typeof setTimeout> | undefined
function onSliderAfterChange(value: number | number[]): void {
  const v = Array.isArray(value) ? value[0] : value
  seekValue.value = v
  player.seek(v)
  resetIdle()
  if (sliderReleaseTimer) clearTimeout(sliderReleaseTimer)
  sliderReleaseTimer = setTimeout(() => {
    isDragging.value = false
    sliderReleaseTimer = undefined
  }, 150)
}

// ── 音量 ──
const volumePct = computed(() => Math.round(player.volume * 100))
const volumePopup = ref(false)
// 悬停弹出用延迟隐藏:鼠标在按钮↔弹层之间瞬时越过(进度条/动画边缘)不立即收起,
// 回到弹层内即清除计时。对齐参考项目网易云原生音量条 hover 的延迟容忍行为。
let volumeHideTimer: ReturnType<typeof setTimeout> | undefined
// slider 直接绑 volumePct(computed get/set):拖动 set → setVolume → player.volume 同步更新 →
// volumePct 变 → get 返回新值。不用独立 ref + watch 回写,避免拖动中 watch 把
// volumeModel 回写成滞后/舍入值与 v-model 竞争,导致音量偶发跳 0。
const volumeModel = computed<number>({
  get: () => volumePct.value,
  set: (v) => {
    player.setVolume(v / 100)
    // 拖动/点击轨道期间持续保持弹层,避免 mouseleave 计时收起中断调节
    showVolumePopup()
    // 拖动音量期间保持控制条显示:antd slider 拖动用 setPointerCapture,
    // window mousemove 在捕获期可能不触发,导致 idle 计时不被重置、控制条淡出。
    resetIdle()
  }
})
function adjustVolumeByWheel(event: globalThis.WheelEvent): void {
  if (event.deltaY === 0) return
  event.preventDefault()
  event.stopPropagation()

  const delta = event.deltaY < 0 ? VOLUME_WHEEL_STEP : -VOLUME_WHEEL_STEP
  const nextPct = Math.max(0, Math.min(100, volumePct.value + delta))
  player.setVolume(nextPct / 100)
  showVolumePopup()
  resetIdle()
}
function showVolumePopup(): void {
  if (volumeHideTimer) {
    clearTimeout(volumeHideTimer)
    volumeHideTimer = undefined
  }
  volumePopup.value = true
}
function scheduleHideVolumePopup(): void {
  volumeHideTimer = setTimeout(() => {
    volumePopup.value = false
    volumeHideTimer = undefined
  }, 150)
}

// ── 音质(对齐参考 .brt 码率按钮)──
// 后端仅支持码率切换(player.setLevel);速度/音效/一起听/歌曲收藏均无后端,不补。
const levelOptions = QUALITY_OPTIONS
const levelLabel = computed(() => qualityLabel(player.level))
const levelPopupVisible = ref(false)
let levelHideTimer: ReturnType<typeof setTimeout> | undefined
function showLevelPopup(): void {
  if (levelHideTimer) {
    clearTimeout(levelHideTimer)
    levelHideTimer = undefined
  }
  levelPopupVisible.value = true
}
function scheduleHideLevelPopup(): void {
  levelHideTimer = setTimeout(() => {
    levelPopupVisible.value = false
    levelHideTimer = undefined
  }, 150)
}
function onLevelSelect(level: PlayableLevel): void {
  player.setLevel(level)
  levelPopupVisible.value = false
  resetIdle()
}

// ── 倍速（生产包左侧封面信息后悬停展开）──
const rateOptions = [0.5, 0.75, 1, 1.25, 1.5]
const rateLabel = computed(() => {
  const rate = Math.min(1.5, Math.max(0.5, player.playbackRate))
  return `${Number.isInteger(rate) ? rate.toFixed(1) : String(rate)}x`
})
const rateModel = ref(Math.min(1.5, Math.max(0.5, player.playbackRate)))
watch(
  () => player.playbackRate,
  (rate) => {
    rateModel.value = Math.min(1.5, Math.max(0.5, rate))
  }
)
const ratePopupVisible = ref(false)
let rateHideTimer: ReturnType<typeof setTimeout> | undefined
function showRatePopup(): void {
  if (rateHideTimer) {
    clearTimeout(rateHideTimer)
    rateHideTimer = undefined
  }
  ratePopupVisible.value = true
}
function scheduleHideRatePopup(): void {
  rateHideTimer = setTimeout(() => {
    ratePopupVisible.value = false
    rateHideTimer = undefined
  }, 150)
}
function onRateSlider(value: number | number[]): void {
  const rate = Array.isArray(value) ? value[0] : value
  rateModel.value = rate
  player.setPlaybackRate(rate)
}
function onRateSelect(rate: number): void {
  player.setPlaybackRate(rate)
  rateModel.value = rate
  ratePopupVisible.value = false
  resetIdle()
}

// ── 播放模式 ──
// 模式图标走 PlaybackModeIcon 共享组件(与 PlayerBar 一致),单曲循环用自带"1"的
// repeat-one 图标替代 a-badge。
const modeLabel = computed(() => {
  switch (player.mode) {
    case 'sequence':
      return '顺序播放'
    case 'repeat-all':
      return '列表循环'
    case 'repeat-one':
      return '单曲循环'
    case 'shuffle':
      return '随机播放'
    case 'heart':
      return '心动模式'
    default:
      return '顺序播放'
  }
})
function toggleMode(): void {
  player.toggleMode()
}

// ── 时间指示器:剩余/总时长可点击切换(对齐参考 refined-control-bar.js:34-85)──
// remain 模式显示 -剩余,total 模式显示已播;点击切换并持久化到 settings.timeIndicator。
const timeMode = computed(() => settings.timeIndicator)
const remainingMs = computed(() => Math.max(0, totalTime.value - seekValue.value))
function toggleTimeMode(): void {
  settings.timeIndicator = settings.timeIndicator === 'remain' ? 'total' : 'remain'
}

const formatMs = (value: number | number[]): string => {
  const v = Array.isArray(value) ? value[0] : value
  return formatDuration(v)
}

// 开启自定义歌词预览时关闭 AntD 默认 tooltip，避免悬停进度条时出现双重预览。
const progressSliderTooltip = computed(() =>
  settings.enableProgressbarPreview ? { open: false } : undefined
)

// ── 进度条悬停预览（对齐参考项目 progressbar-preview）──
const previewVisible = ref(false)
const previewTimeMs = ref(0)
const previewLyricTimeMs = computed(() => previewTimeMs.value + settings.lyricOffset)
const previewX = ref(0)
const previewY = ref(0)
const previewLineIndex = computed(() => {
  const lines = lyric.lines
  if (lines.length === 0) return -1
  let idx = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeMs <= previewLyricTimeMs.value) idx = i
    else break
  }
  return idx
})
const previewLine = computed(() => lyric.lines[previewLineIndex.value] ?? null)
const previewLineStartTimeMs = computed(() => {
  const line = previewLine.value
  if (!line) return 0
  return Math.max(0, line.timeMs - settings.lyricOffset)
})
const previewSubProgress = computed(() => {
  const line = previewLine.value
  if (!line) return 0
  const nextLine = lyric.lines[previewLineIndex.value + 1]
  const duration = nextLine
    ? nextLine.timeMs - line.timeMs
    : totalTime.value - previewLineStartTimeMs.value
  if (duration <= 0) return 0
  return Math.max(0, Math.min(100, ((previewLyricTimeMs.value - line.timeMs) / duration) * 100))
})
const previewStyle = computed(() => ({
  left: `${previewX.value}px`,
  top: `${previewY.value}px`
}))
const canShowProgressPreview = computed(
  () =>
    settings.enableProgressbarPreview &&
    Boolean(song.value) &&
    totalTime.value > 0 &&
    !lyric.isPureMusic &&
    lyric.lines.length > 0
)
const showProgressPreview = computed(
  () => canShowProgressPreview.value && previewVisible.value && Boolean(previewLine.value)
)

function updateProgressPreview(e: globalThis.MouseEvent, el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  previewTimeMs.value = totalTime.value * percent
  previewX.value = Math.max(12, Math.min(window.innerWidth - 12, e.clientX))
  previewY.value = rect.top - 8
}

function onProgressPreviewEnter(e: globalThis.MouseEvent): void {
  if (!canShowProgressPreview.value) return
  const el = e.currentTarget as HTMLElement
  previewVisible.value = true
  updateProgressPreview(e, el)
}
function onProgressPreviewMove(e: globalThis.MouseEvent): void {
  if (!previewVisible.value || !canShowProgressPreview.value) return
  const el = e.currentTarget as HTMLElement
  updateProgressPreview(e, el)
}
function onProgressPreviewLeave(): void {
  previewVisible.value = false
}

function karaokePreviewWordStyle(timeMs: number, durationMs: number): Record<string, string> {
  const percent = Math.max(
    0,
    Math.min(1, (previewLyricTimeMs.value - timeMs) / Math.max(durationMs, 1))
  )
  return { WebkitMaskPosition: `${100 * (1 - percent)}%` }
}

// ── 自动隐藏：对齐参考项目 main.js:1014-1049 IdleThreshold=1.5s ──
// 三件套 idleTimer/debounceTime/debounceTimer:防 mousemove 与 mouseout(离窗)交错闪烁。
const IDLE_THRESHOLD = 1500
// 离窗后强制 idle 的防抖下限(对齐参考 setIdle 的 325ms):距上次唤醒不足 325ms 则延后,
// 防"移动唤出→立刻移出窗口"造成的闪现。
const MOUSEOUT_DEBOUNCE_MS = 325
let idleTimer: number | null = null
let debounceTimer: number | null = null
let debounceTime = 0

function clearIdleTimer(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}
function clearDebounceTimer(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

// 对齐参考 main.js:1028-1035:仅从 idle→active 的边沿记录 debounceTime(供离窗防抖用),
// 无论如何都重启 1.5s 计时;计时到点 idle=true 并清掉离窗 debounce(防重复)。
function resetIdle(): void {
  if (idle.value) {
    idle.value = false
    debounceTime = Date.now()
  }
  clearDebounceTimer()
  clearIdleTimer()
  // 演示模式:即使「不自动隐藏底栏」也启动 idle(鼠标静止时隐藏控制条,移动唤出),
  // 否则用户进入演示模式后控制条常显/常隐都无法退出。对齐参考 experimental.scss
  // presentation-mode 不隐藏自身控制条、仍走 idle 的语义。
  if (settings.alwaysShowBottomBar && !settings.presentationMode) return
  idleTimer = window.setTimeout(() => {
    idle.value = true
    clearDebounceTimer()
  }, IDLE_THRESHOLD)
}

// 对齐参考 main.js:1036-1049:鼠标离开窗口(mouseout relatedTarget===null)后,
// 至少距上次唤醒 325ms 才强制 idle;距上次唤醒>325ms 则立即(0ms)。
function setIdle(): void {
  clearDebounceTimer()
  const delay = Math.max(debounceTime + MOUSEOUT_DEBOUNCE_MS - Date.now(), 0)
  debounceTimer = window.setTimeout(() => {
    clearIdleTimer()
    idle.value = true
  }, delay)
}

// 悬停底栏唤出:鼠标在控制条区域(底部 bottombar-height)时置 bottombarHover,
// 对齐参考 body.bottombar-hover(main.js:244-251 mouseenter #main-player)。
// 用坐标判断因控制条 pointer-events:none(让进度条可点),无法靠 mouseenter。
const bottombarHover = ref(false)
const BOTTOMBAR_HEIGHT = 90

function onWindowMouseMove(e: globalThis.MouseEvent): void {
  resetIdle()
  bottombarHover.value = e.clientY > window.innerHeight - BOTTOMBAR_HEIGHT
}

function onWindowMouseOut(e: globalThis.MouseEvent): void {
  // relatedTarget===null:鼠标离开整个窗口(Electron renderer 同样触发)
  if (e.relatedTarget === null) {
    bottombarHover.value = false
    setIdle()
  }
}

// 滚动唤出:用户主动滚动(歌词/页面)重置 idle。对齐参考 mq-playing-scroll 守卫
// (参考靠宿主 class,本项目无宿主,故自接 wheel)。
function onWindowWheel(): void {
  resetIdle()
}

// 沉浸层打开时挂载 idle 监听，关闭即卸载（ImmersiveControls 随 v-if open 渲染）
watch(
  open,
  (isOpen) => {
    if (isOpen) {
      window.addEventListener('mousemove', onWindowMouseMove)
      document.addEventListener('mouseout', onWindowMouseOut)
      window.addEventListener('wheel', onWindowWheel, { passive: true })
      resetIdle()
    } else {
      window.removeEventListener('mousemove', onWindowMouseMove)
      document.removeEventListener('mouseout', onWindowMouseOut)
      window.removeEventListener('wheel', onWindowWheel)
      clearIdleTimer()
      clearDebounceTimer()
      idle.value = false
      bottombarHover.value = false
    }
  },
  { immediate: true }
)
// 演示模式切换时重置 idle:进入即开始隐藏计时,退出即恢复常显/隐藏
watch(
  () => settings.presentationMode,
  () => resetIdle()
)
onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onWindowMouseMove)
  document.removeEventListener('mouseout', onWindowMouseOut)
  window.removeEventListener('wheel', onWindowWheel)
  clearIdleTimer()
  clearDebounceTimer()
  if (volumeHideTimer) clearTimeout(volumeHideTimer)
  if (levelHideTimer) clearTimeout(levelHideTimer)
  if (rateHideTimer) clearTimeout(rateHideTimer)
  if (sliderReleaseTimer) clearTimeout(sliderReleaseTimer)
})

/**
 * 显隐策略(对齐参考项目 main.js + material-you-compatibility.scss + experimental.scss):
 * - presentationMode:控制条走 idle(鼠标静止隐藏,移动唤出),保证用户能退出演示模式;
 *   参考项目 presentation-mode 只隐藏网易云原生 UI,不隐藏自身控制条。
 * - bottombarHover:idle 时悬停底栏区域唤出(对齐参考 body.bottombar-hover)。
 * - 默认 idle:整条 translateY 下滑出视口(对齐参考 material-you-compatibility.scss:57,
 *   非 opacity 淡出),transition transform .3s ease。
 */
const hidden = computed(() => {
  if (settings.presentationMode) return idle.value
  return idle.value && !settings.alwaysShowBottomBar && !bottombarHover.value
})
const idleClass = computed(() => {
  if (!hidden.value) return ''
  // presentationMode 走纯淡出;默认走下滑
  if (settings.presentationMode) return 'is-idle-fade'
  return 'is-idle'
})
</script>

<template>
  <!-- 进度条:固定贴底细条(对齐参考 .m-player .prg:81-136)。默认贴在控制条上方
       bottom:calc(bottombar-height-6px)、手柄可见;bottomProgressbar 开启则贴窗口最底 0、手柄隐藏。 -->
  <div
    v-if="!settings.presentationMode"
    class="immersive-progressbar"
    :class="{
      'at-very-bottom': settings.bottomProgressbar,
      'is-idle': hidden && !settings.bottomProgressbar,
      'is-idle-fade': hidden && settings.bottomProgressbar
    }"
    @mouseenter="onProgressPreviewEnter"
    @mousemove="onProgressPreviewMove"
    @mouseleave="onProgressPreviewLeave"
  >
    <a-slider
      :value="seekValue"
      :min="0"
      :max="sliderMax"
      :step="100"
      :disabled="!song"
      :tip-formatter="formatMs"
      :tooltip="progressSliderTooltip"
      aria-label="播放进度"
      @change="onSliderChange"
      @after-change="onSliderAfterChange"
    />
  </div>

  <div class="progressbar-preview" :class="{ visible: showProgressPreview }" :style="previewStyle">
    <div v-if="previewLine" class="progressbar-preview-number">
      {{ previewLineIndex + 1 }} / {{ lyric.lines.length }}
    </div>
    <div v-if="previewLine?.words?.length" class="progressbar-preview-line-karaoke">
      <span
        v-for="(word, index) in previewLine.words"
        :key="index"
        class="progressbar-preview-line-karaoke-word"
        :class="{
          current:
            previewLyricTimeMs >= word.timeMs &&
            previewLyricTimeMs <= word.timeMs + word.durationMs,
          upcoming: previewLyricTimeMs < word.timeMs
        }"
        :style="karaokePreviewWordStyle(word.timeMs, word.durationMs)"
      >
        {{ word.word }}
      </span>
    </div>
    <div v-else class="progressbar-preview-line-original">
      {{ previewLine?.text || '♪' }}
    </div>
    <div v-if="previewLine?.translation" class="progressbar-preview-line-translated">
      {{ previewLine.translation }}
    </div>
    <div class="progressbar-preview-subprogressbar">
      <div
        class="progressbar-preview-subprogressbar-inner"
        :style="{ width: `${previewSubProgress}%` }"
      />
    </div>
    <div class="progressbar-preview-line-time">
      <span>{{ formatDuration(previewLineStartTimeMs) }}</span>
      <span>{{ formatDuration(previewTimeMs) }}</span>
    </div>
  </div>

  <div class="immersive-controls" :class="idleClass">
    <!-- 左：封面缩略 + 曲名 -->
    <div class="immersive-controls-left">
      <a-avatar
        :src="song?.coverUrl || undefined"
        :size="56"
        shape="square"
        class="!rounded-[10px] !text-[10px]"
      >
        无封面
      </a-avatar>
      <div class="min-w-0">
        <p class="truncate text-sm font-medium">{{ song?.name ?? '未播放' }}</p>
        <p class="truncate text-xs opacity-60">{{ artistsText || '—' }}</p>
      </div>
      <div
        class="rnp-level rnp-level--left"
        @mouseenter="showRatePopup"
        @mouseleave="scheduleHideRatePopup"
      >
        <button type="button" class="rnp-ctrl-btn rnp-level-btn" aria-label="切换播放倍速">
          {{ rateLabel }}
        </button>
        <div
          class="level-popup rate-popup level-popup--center"
          :class="{ shown: ratePopupVisible }"
        >
          <div class="rate-popup__value">{{ rateLabel }}</div>
          <div class="rate-popup__slider">
            <a-slider
              :value="rateModel"
              :min="0.5"
              :max="1.5"
              :step="0.05"
              :tooltip="{ open: false }"
              aria-label="播放倍速"
              @change="onRateSlider"
            />
          </div>
          <div class="rate-popup__presets">
            <button
              v-for="rate in rateOptions"
              :key="rate"
              type="button"
              class="level-popup-item"
              :class="{ active: Math.abs(player.playbackRate - rate) < 1e-3 }"
              @click="onRateSelect(rate)"
            >
              {{ rate }}x
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 中：控件(进度条已移至独立贴底层,对齐参考控制条内无内嵌进度条) -->
    <div class="immersive-controls-center">
      <div class="immersive-controls-buttons">
        <AppTooltip title="上一首">
          <button
            v-if="!player.fmMode && player.mode !== 'heart'"
            type="button"
            class="rnp-ctrl-btn"
            aria-label="上一首"
            :disabled="!song"
            @click="player.previous()"
          >
            <svg class="rnp-mask-icon rnp-icon-prev" aria-hidden="true"></svg>
          </button>
        </AppTooltip>
        <button
          type="button"
          class="rnp-ctrl-btn rnp-ctrl-play play-toggle"
          :class="player.isPlaying ? 'play-toggle-pause' : 'play-toggle-play'"
          :aria-label="player.isPlaying ? '暂停' : '播放'"
          :disabled="player.state === 'loading'"
          @click="player.togglePlay()"
        >
          <!-- 双 svg + clip-path 在 play/pause 间变形(对齐参考 .btnp:188-261) -->
          <svg class="play-toggle-svg play-toggle-svg-first" aria-hidden="true"></svg>
          <svg class="play-toggle-svg play-toggle-svg-last" aria-hidden="true"></svg>
        </button>
        <AppTooltip title="下一首">
          <button
            type="button"
            class="rnp-ctrl-btn"
            aria-label="下一首"
            :disabled="!song"
            @click="player.next()"
          >
            <svg class="rnp-mask-icon rnp-icon-next" aria-hidden="true"></svg>
          </button>
        </AppTooltip>
        <AppTooltip :title="modeLabel">
          <button
            v-if="!player.fmMode"
            type="button"
            class="rnp-ctrl-btn rnp-mode-btn"
            :aria-label="modeLabel"
            :disabled="!song"
            @click="toggleMode"
          >
            <!-- 模式图标:单色 mask SVG(对齐参考 .type:162-187 实心填充)。
                 单曲循环用 repeat-one 自带"1",替代 antd a-badge(参考无角标圆点)。
                 图标统一走 PlaybackModeIcon 共享组件,与 PlayerBar 一致。 -->
            <PlaybackModeIcon :mode="player.mode" />
          </button>
        </AppTooltip>
        <AppTooltip :title="player.isCurrentLiked ? '取消喜欢' : '喜欢'">
          <button
            type="button"
            class="rnp-ctrl-btn"
            :class="{ 'rnp-ctrl-liked': player.isCurrentLiked }"
            :aria-label="player.isCurrentLiked ? '取消喜欢' : '喜欢'"
            :disabled="!song"
            @click="player.toggleLike()"
          >
            <HeartFilled v-if="player.isCurrentLiked" />
            <HeartOutlined v-else />
          </button>
        </AppTooltip>
        <!-- FM 垃圾桶:把当前歌扔进垃圾桶并拉下一首,影响后续 FM 推荐。仅 FM 模式显示。 -->
        <AppTooltip title="不感兴趣">
          <button
            v-if="player.fmMode || player.mode === 'heart'"
            type="button"
            class="rnp-ctrl-btn"
            aria-label="不感兴趣"
            :disabled="!song"
            @click="player.dislikeCurrentFm()"
          >
            <DislikeOutlined />
          </button>
        </AppTooltip>
      </div>
    </div>

    <!-- 右：时间指示器 + 音量 + 队列 + 设置 -->
    <div class="immersive-controls-right">
      <button
        type="button"
        class="rnp-time-indicator"
        :aria-label="
          timeMode === 'remain' ? '剩余时长(点击切换为已播)' : '已播时长(点击切换为剩余)'
        "
        @click="toggleTimeMode"
      >
        <span v-if="timeMode === 'remain'">-{{ formatDuration(remainingMs) }}</span>
        <span v-else>{{ formatDuration(seekValue) }}</span>
      </button>
      <div
        class="immersive-volume"
        @mouseenter="showVolumePopup"
        @mouseleave="scheduleHideVolumePopup"
      >
        <button
          type="button"
          class="rnp-ctrl-btn"
          :aria-label="player.muted ? '取消静音' : '静音'"
          @click="player.toggleMute()"
          @wheel="adjustVolumeByWheel"
        >
          <AudioMutedOutlined v-if="player.muted || player.volume === 0" />
          <SoundOutlined v-else />
        </button>
        <!-- 音量悬停弹出竖向滑块(对齐参考 .prg-spk:491-548:36×120 圆角弹层 + 竖向 8px 轨/18px 手柄) -->
        <div class="volume-popup" :class="{ shown: volumePopup }">
          <a-slider
            v-model:value="volumeModel"
            vertical
            :min="0"
            :max="100"
            :tooltip="{ open: false }"
            aria-label="音量"
          />
        </div>
      </div>
      <div class="rnp-level" @mouseenter="showLevelPopup" @mouseleave="scheduleHideLevelPopup">
        <button type="button" class="rnp-ctrl-btn rnp-level-btn" aria-label="切换音质">
          {{ levelLabel }}
        </button>
        <div class="level-popup" :class="{ shown: levelPopupVisible }">
          <button
            v-for="opt in levelOptions"
            :key="opt.value"
            type="button"
            class="level-popup-item"
            :class="{ active: opt.value === player.level }"
            @click="onLevelSelect(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
      <AppTooltip title="播放队列">
        <button
          v-if="!player.fmMode"
          type="button"
          class="rnp-ctrl-btn"
          data-queue-trigger
          aria-label="播放队列"
          @click="queueVisible = !queueVisible"
        >
          <svg class="rnp-mask-icon rnp-icon-queue" aria-hidden="true"></svg>
        </button>
      </AppTooltip>
    </div>
  </div>

  <PlayQueuePanel v-model:visible="queueVisible" />
</template>

<style scoped lang="scss">
.immersive-controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  /* z-index 5:控制条在歌词层(2)与进度条(1)之上。音量/音质弹层在本控制条 stacking
       context 内,随控制条(5)高于进度条(1),不被进度条遮挡 —— 这是进度条 z-index 须低于
       控制条的关键原因(否则弹层重叠段被进度条截获 hover)。
       pointer-events:auto:控制条空白挡住下层歌词,避免点击控制条区域(含模式按钮切换、
       气泡显示位、列空白)穿透到歌词行触发 @seek 跳转;交互元素本就 auto。 */
  z-index: 5;
  pointer-events: auto;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(360px, 600px) minmax(220px, 1fr);
  align-items: center;
  gap: 1rem;
  height: 90px;
  padding: 0 1.5rem;
  /* 对齐参考 material-you-compatibility.scss:51 transition: transform .3s ease, opacity .3s ease */
  transition:
    transform 0.3s ease,
    opacity 0.3s ease;
  will-change: transform, opacity;
  &.is-idle {
    transform: translateY(calc(var(--bottombar-height, 90px) - 5px));
    pointer-events: none;
    .rnp-time-indicator {
      opacity: 0;
    }
  }
  &.is-idle-fade {
    opacity: 0;
    pointer-events: none;
  }
  :deep(.ant-slider-rail) {
    background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.18);
  }
  :deep(.ant-slider-track),
  :deep(.ant-slider:hover .ant-slider-track) {
    background: var(--rnp-accent-color, var(--color-primary));
  }
  :deep(.ant-slider-handle) {
    border-color: var(--rnp-accent-color, var(--color-primary));
  }
  :deep(.ant-slider-handle::after),
  :deep(.ant-slider-handle:hover::after),
  :deep(.ant-slider-handle:focus::after) {
    background: var(--rnp-accent-color, var(--color-primary));
    box-shadow: 0 0 0 2px var(--rnp-accent-color, var(--color-primary));
  }
}
/* 默认 idle:整条下滑出视口(对齐参考 material-you-compatibility.scss:57
   translateY(calc(var(--bottombar-height) - 5px))——控制条高 90,下滑 85px 几乎沉出底部,
   留 5px 余量)。控制条无背景,下滑后不可见;pointer-events:none 不挡下层。 */

/* presentationMode:纯 opacity 淡出(对齐参考 experimental.scss:45-54),
   不下滑,保留布局。 */

/* idle 细粒度(对齐参考 material-you-compatibility.scss:57-74 + styles.scss:670-709):
   非 bottom-progressbar 的 is-idle,整条下滑出视口;时间指示器跟随整条下滑并淡出
   (不再反向上移)。右侧音量/音质/队列与播放按钮一起跟随整条下滑消失,不再单独
   opacity 淡出 —— 用户反馈「直接消失」违和,改为跟随面板下滑消失更自然。 */

/* 按钮：对齐参考项目 refined-control-bar 的 36px 圆形 + 主色填充 hover */
.rnp-ctrl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 9999px;
  background: transparent;
  color: var(
    --rnp-accent-color-shade-1,
    var(--rnp-accent-color-shade-2, var(--color-text-primary))
  );
  cursor: pointer;
  transition:
    background 0.25s ease,
    transform 0.25s ease,
    opacity 0.3s ease;
  /* AntD Outlined 图标是 fill:currentColor,设 color 即单色填充(对齐参考 svg fill accent)。
     尺寸 20px 与 mask 图标的 mask-size:20px 图形一致,避免音量喇叭比其他图标大。
     mask 图标容器由 .rnp-mask-icon 覆盖为 24px(图形仍 20px),此处不受影响。 */
  :deep(svg),
  svg {
    width: 20px;
    height: 20px;
  }
  /* 单色 mask 图标:空 svg + background:currentColor + -webkit-mask 切形,替换 AntD 线框,
     对齐参考 .list/.spk 的 Material 实心 mask 风格(refined-control-bar.scss:300-337)。
     currentColor 继承 .rnp-ctrl-btn 的 accent 色,图标随沉浸色变化。
     单曲循环 repeat-one 图标自带"1",替代 antd a-badge(参考 .type 无角标圆点)。 */
  .rnp-mask-icon {
    width: 24px;
    height: 24px;
    background-color: currentColor;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-size: 20px 20px;
    mask-size: 20px 20px;
    fill: none;
    /* 让点击穿透到父 button,避免 svg 拦截首次点击 */
    pointer-events: none;
  }
  &:hover:not(:disabled) {
    background: rgba(
      var(--rnp-accent-color-shade-1-rgb, var(--rnp-accent-color-shade-2-rgb, 255, 255, 255)),
      0.1
    );
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  /* 已喜欢按钮:主色填充 */
  &.rnp-ctrl-liked {
    color: var(--rnp-accent-color, var(--color-primary));
  }
  &.rnp-ctrl-liked:hover:not(:disabled) {
    color: var(--rnp-accent-color, var(--color-primary));
  }
  &:active:not(:disabled) {
    transform: scale(0.92);
  }
  &.active {
    background: rgba(
      var(--rnp-accent-color-shade-1-rgb, var(--rnp-accent-color-shade-2-rgb, 255, 255, 255)),
      0.15
    );
  }
}
.rnp-icon-prev {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 6h2v12H6zm3.5 6 8.5 6V6z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 6h2v12H6zm3.5 6 8.5 6V6z'/%3E%3C/svg%3E");
}
.rnp-icon-next {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z'/%3E%3C/svg%3E");
}
/* 播放模式图标(repeat/sequence/repeat-one/shuffle)已抽到 PlaybackModeIcon 共享组件,
   此处仅保留 prev/next/queue 的 mask。 */
.rnp-icon-queue {
  -webkit-mask-image: url("data:image/svg+xml,%0A%3Csvg xmlns='http://www.w3.org/2000/svg' height='20' width='20'%3E%3Cpath d='M13 15q-1.042 0-1.771-.729-.729-.729-.729-1.771 0-1.042.729-1.771Q11.958 10 13 10q.271 0 .521.052t.479.156V4h4v1.5h-2.5v7q0 1.042-.729 1.771Q14.042 15 13 15ZM3 11.5V10h6v1.5Zm0-3V7h9v1.5Zm0-3V4h9v1.5Z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%0A%3Csvg xmlns='http://www.w3.org/2000/svg' height='20' width='20'%3E%3Cpath d='M13 15q-1.042 0-1.771-.729-.729-.729-.729-1.771 0-1.042.729-1.771Q11.958 10 13 10q.271 0 .521.052t.479.156V4h4v1.5h-2.5v7q0 1.042-.729 1.771Q14.042 15 13 15ZM3 11.5V10h6v1.5Zm0-3V7h9v1.5Zm0-3V4h9v1.5Z'/%3E%3C/svg%3E");
  -webkit-mask-position-y: 65%;
  mask-position-y: 65%;
}

/* 模式按钮:切换后短暂弹出当前模式名(对齐参考 .u-result tooltip:371-383 圆角气泡 +
   accent 配色),给点击反馈,避免用户看不出当前模式。 */
.rnp-mode-btn {
  position: relative;
}

/* 播放/暂停按钮:clip-path 双 svg 变形(对齐参考 refined-control-bar.scss:188-261 .btnp)。
   ::before = accent 主色圆(hover scale1.1);两个 svg 各占左右半,用 background 填 accent-on-primary
   + clip-path polygon 切出 play(三角)/pause(两竖)形,play↔pause 间 .2s 变形;::after = 三角播放符
   (play 态 opacity1,delay0.2s)。 */
.rnp-ctrl-play {
  &.play-toggle {
    position: relative;
    background: transparent;
    color: transparent;
    overflow: hidden;
    &::before {
      content: '';
      position: absolute;
      inset: 0;
      background: var(--rnp-accent-color, var(--color-primary));
      border-radius: 100px;
      transition: transform 0.25s ease;
    }
    &:hover:not(:disabled)::before {
      transform: scale(1.1);
    }
    .play-toggle-svg {
      position: absolute;
      top: 0;
      width: 50%;
      height: 100%;
      margin: 0;
      display: block;
      background: var(--rnp-accent-color-on-primary, $color-white);
      fill: transparent;
      transition: clip-path 0.2s ease;
      will-change: clip-path;
    }
    .play-toggle-svg-first {
      left: 0;
    }
    .play-toggle-svg-last {
      left: 50%;
    }
    &.play-toggle-pause {
      .play-toggle-svg-first {
        clip-path: polygon(72% 30%, 86% 30%, 86% 70%, 72% 70%);
      }
      .play-toggle-svg-last {
        clip-path: polygon(14% 30%, 28% 30%, 28% 70%, 14% 70%);
      }
    }
    &.play-toggle-play {
      .play-toggle-svg-first {
        clip-path: polygon(76% 30%, 100% 37.5%, 100% 63.75%, 76% 72%);
      }
      .play-toggle-svg-last {
        clip-path: polygon(0% 37.5%, 40% 50%, 40% 50%, 0% 63.75%);
      }
    }
    &::after {
      content: '';
      position: absolute;
      inset: 0;
      background: var(--rnp-accent-color-on-primary, $color-white);
      clip-path: polygon(38% 30%, 70% 50%, 38% 72%);
      opacity: 0;
    }
    &.play-toggle-play::after {
      transition-property: opacity;
      transition-duration: 0s;
      transition-delay: 0.2s;
      opacity: 1;
    }
  }
}

/* 三列 pointer-events:none:列空白穿透到父控制条(已 auto)由其接收,挡住下层歌词;
   交互元素(按钮组/音量/时间)显式 auto 恢复可点。进度条 z-index 1 在控制条(5)之下,
   控制条透明且 90px 以上不覆盖进度条,进度条上半段仍可点。 */
.immersive-controls-left,
.immersive-controls-center,
.immersive-controls-right {
  pointer-events: none;
}
.immersive-controls-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  /* 左下角封面缩略:防 flex 压缩变形(对齐 ImmersiveCover .rnp-cover flex-shrink:0);
     img object-fit:cover 防非正方封面被拉伸。 */
  :deep(.ant-avatar) {
    flex-shrink: 0;
  }
  :deep(.ant-avatar img) {
    object-fit: cover;
  }
}
.immersive-controls-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}
.immersive-controls-buttons {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.immersive-controls-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}
.immersive-controls-buttons,
.immersive-volume,
.rnp-level,
.rnp-time-indicator,
.rnp-ctrl-btn {
  pointer-events: auto;
}
.immersive-volume {
  position: relative;
  display: flex;
  align-items: center;
}
/* 音量悬停弹出竖向滑块(对齐参考 refined-control-bar.scss:491-548 .prg-spk):
   36×120 圆角弹层,blur(36px),从底部 scaleY 展开;.shown 时显示。 */
.volume-popup {
  position: absolute;
  right: 0;
  bottom: calc(50% + 18px);
  z-index: 7;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 120px;
  padding: 10px 0;
  border-radius: 100px;
  background: rgba(0, 0, 0, 0.08);
  backdrop-filter: blur(36px);
  -webkit-backdrop-filter: blur(36px);
  opacity: 0;
  pointer-events: none;
  transform: scaleY(0.3);
  transform-origin: bottom;
  transition:
    opacity 0.2s ease-out,
    transform 0.2s ease-out;
  &.shown {
    opacity: 1;
    pointer-events: auto;
    transform: scaleY(1);
  }
  /* 竖向滑块:8px 轨 + 18px 圆手柄 accent 描边(对齐参考 .wrap 8px / .ctrl 18px) */
  :deep(.ant-slider) {
    margin: 0;
    padding: 0;
    height: 100%;
  }
  /* 竖向滑块:rail/track 统一 left:50%+translateX(-50%) 居中于 slider 中线
     (同进度条理由:slider padding:0 后需显式居中)。
     handle 水平居中用 left:50%+margin-left:-9px,**不可**覆盖 transform——
     AntD vertical handle 的 inline transform:translateY(+50%) 负责沿轨道垂直定位
     (Handle.js),覆盖会让圆点脱离音量值位置。 */
  :deep(.ant-slider-rail) {
    left: 50%;
    transform: translateX(-50%);
    width: 8px;
    border-radius: 100px;
    background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.18);
  }
  :deep(.ant-slider-track) {
    left: 50%;
    transform: translateX(-50%);
    width: 8px;
    border-radius: 100px;
    background: var(--rnp-accent-color, var(--color-primary));
  }
  :deep(.ant-slider-handle) {
    left: 50% !important;
    margin-left: -9px !important;
    width: 18px;
    height: 18px;
    border: 2px solid var(--rnp-accent-color, var(--color-primary));
    border-radius: 50%;
    background: var(--rnp-accent-color-shade-2, #666);
    box-shadow: none;
  }
  :deep(.ant-slider-handle::after) {
    display: none !important;
  }
}

/* 音质按钮 + 弹出列表(对齐参考 .brt 码率按钮,弹出风格同 .volume-popup) */
.rnp-level {
  position: relative;
  display: flex;
  align-items: center;
}
.rnp-level-btn {
  /* 完整音质名(标准/极高/无损/Hi-Res)放不进 36px 圆形,改为自适应宽度胶囊,
       高度 32 略小于图标按钮 36,与右侧按钮组中心对齐(父级 align-items:center)。 */
  width: auto;
  min-width: 36px;
  height: 32px;
  padding: 0 12px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.level-popup {
  position: absolute;
  right: 0;
  bottom: calc(50% + 18px);
  z-index: 7;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.08);
  backdrop-filter: blur(36px);
  -webkit-backdrop-filter: blur(36px);
  opacity: 0;
  pointer-events: none;
  transform: translateY(8px);
  transition:
    opacity 0.2s ease-out,
    transform 0.2s ease-out;
  &.shown {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }
}

.level-popup-item {
  min-width: 56px;
  padding: 4px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--rnp-accent-color-shade-2, var(--color-text-primary));
  font-size: 12px;
  text-align: center;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.2s ease;
  &:hover {
    background: rgba(var(--rnp-accent-color-rgb, 170, 170, 170), 0.1);
  }
  &.active {
    color: var(--rnp-accent-color, var(--color-primary));
    background: rgba(var(--rnp-accent-color-rgb, 170, 170, 170), 0.12);
  }
}

/* Ant Design Slider 不会自动读取沉浸页提取出的主题色。
   这里统一把控制条内的进度条与音量条染成 --rnp-accent-color，避免继续显示全局绿色。 */

/* 进度条悬停预览：对齐参考 progressbar-preview 的歌词+子进度结构 */
.progressbar-preview {
  position: fixed;
  z-index: 8;
  width: min(360px, calc(100vw - 24px));
  padding: 12px 14px 10px;
  border-radius: 16px;
  background: rgba(var(--rnp-accent-color-bg-rgb, 20, 20, 20), 0.72);
  color: var(--rnp-accent-color-shade-2, var(--color-text-primary));
  backdrop-filter: blur(28px) saturate(1.25);
  -webkit-backdrop-filter: blur(28px) saturate(1.25);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22);
  pointer-events: none;
  transform: translate(-50%, -100%);
  opacity: 0;
  transition:
    opacity 0.18s ease,
    left 0.1s ease,
    top 0.1s ease;
  &.visible {
    opacity: 1;
  }
}

.progressbar-preview-number {
  margin-bottom: 5px;
  font-size: 12px;
  opacity: 0.55;
}
.progressbar-preview-line-original,
.progressbar-preview-line-karaoke {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}
.progressbar-preview-line-translated {
  margin-top: 3px;
  font-size: 13px;
  line-height: 1.4;
  opacity: 0.65;
}
.progressbar-preview-line-karaoke-word {
  display: inline-block;
  color: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.45);
  -webkit-mask-image: linear-gradient(90deg, $color-black 0 50%, rgba(0, 0, 0, 0.35) 50% 100%);
  -webkit-mask-size: 200% 100%;
  -webkit-mask-repeat: no-repeat;
  &.current,
  &:not(.upcoming) {
    color: var(--rnp-accent-color-shade-2, var(--color-text-primary));
  }
}
.progressbar-preview-subprogressbar {
  height: 3px;
  margin-top: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.14);
}
.progressbar-preview-subprogressbar-inner {
  height: 100%;
  border-radius: inherit;
  background: var(--rnp-accent-color, var(--color-primary));
}
.progressbar-preview-line-time {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 11px;
  opacity: 0.45;
}

/* 进度条:固定贴底细条(对齐参考 refined-control-bar.scss:81-136 .m-player .prg)。
   默认贴控制条上方 bottom:calc(bottombar-height-6px)、track 4px/hover8px、手柄可见;
   .at-very-bottom(bottomProgressbar 开启)贴窗口最底 0、手柄隐藏(对齐 rnp-bottom-progressbar)。 */
.immersive-progressbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(var(--bottombar-height, 90px) - 6px);
  /* z-index 1:低于歌词层(2)与控制条(5)。.immersive-content 已设 pointer-events:none,
       不再拦截鼠标;歌词行(.rnp-lyrics-line,pointer-events:auto)在 z-index:2 优先拦截
       底部歌词行的 @click 跳转,进度条在无歌词行处可正常 hover/拖动。
       仍低于控制条(5):音量/音质弹层在控制条 stacking context 内须整体高于进度条,
       否则弹层与进度条重叠段被进度条截获 hover。 */
  z-index: 1;
  height: 28px;
  padding: 2px 0;
  transition:
    bottom 0.2s ease,
    transform 0.3s ease,
    opacity 0.3s ease;
  will-change: transform, opacity;
  &.at-very-bottom {
    bottom: 0;
    padding: 0;
  }
  &.is-idle {
    transform: translateY(calc(var(--bottombar-height, 90px) - 6px));
    pointer-events: none;
  }
  &.is-idle-fade {
    opacity: 0;
    pointer-events: none;
  }
  /* idle 随控制条一起隐藏(进度条是独立 fixed 元素,不在 .immersive-controls 内):
     默认(贴控制条上方)随控制条 translateY 下滑(对齐参考 .prg 在 #main-player 内随之下滑);
     bottomProgressbar(贴窗口最底)走 opacity 淡出(对齐参考 rnp-bottom-progressbar 不下滑)。 */

  :deep(.ant-slider) {
    margin: 0;
    padding: 0;
    height: 100%;
  }
  /* rail/track 统一 top:50%+translateY(-50%) 居中于 slider 中线:
     AntD 默认靠 slider 的 paddingBlock:railSize 撑出 rail 静态位置,但本进度条
     slider padding:0 + height:100%(填满 8px 容器),故需显式居中,否则 rail 顶到 top:0、
     handle 落在 50%,两者错位(参考 ant-design-vue 4.2.6 slider/style/index.js rail 无 top、
     handle insetBlockStart=(railSize*3-handleSize)/2)。 */
  :deep(.ant-slider-rail) {
    top: 50%;
    transform: translateY(-50%);
    height: 4px;
    border-radius: 0;
    background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.1);
  }
  :deep(.ant-slider-track),
  :deep(.ant-slider:hover .ant-slider-track) {
    top: 50%;
    transform: translateY(-50%);
    height: 4px;
    border-radius: 0;
    background: var(--rnp-accent-color, var(--color-primary));
  }
  /* hover:track 展开到 8px(对齐参考 .prg:hover track/has height:8px) */
  &:hover :deep(.ant-slider-rail),
  &:hover :deep(.ant-slider-track),
  &:hover :deep(.ant-slider:hover .ant-slider-track) {
    height: 8px;
  }
  /* 手柄:20px 圆 + accent 描边(对齐参考 .ctrl::before 20×20 border accent)。
     默认可见;.at-very-bottom 隐藏(参考 rnp-bottom-progressbar 手柄隐藏)。
     AntD handle 的可见圆点是 ::after 伪元素(默认白底),这里 display:none 去掉它,
     改由 handle 自身(border-radius:50% + accent 描边 + shade-2 内填)显示,避免白方块。 */
  :deep(.ant-slider-handle) {
    top: 50% !important;
    margin-top: 0 !important;
    transform: translate(-50%, -50%) !important;
    width: 20px;
    height: 20px;
    border: 2px solid var(--rnp-accent-color, var(--color-primary));
    border-radius: 50%;
    background: var(--rnp-accent-color-shade-2, #666);
    box-shadow: none;
    transition: opacity 0.2s ease;
  }
  :deep(.ant-slider-handle::after) {
    display: none !important;
  }
  /* 手柄隐藏:at-very-bottom(手动贴底)与 is-idle(默认模式鼠标不动自动贴底)一致处理 */
  &.at-very-bottom :deep(.ant-slider-handle),
  &.is-idle :deep(.ant-slider-handle) {
    opacity: 0;
    pointer-events: none;
  }
  /* at-very-bottom(手动贴底)与 is-idle(默认模式 idle 贴底):rail/track 贴容器底 */
  &.at-very-bottom :deep(.ant-slider-rail),
  &.at-very-bottom :deep(.ant-slider-track),
  &.at-very-bottom :deep(.ant-slider:hover .ant-slider-track),
  &.is-idle :deep(.ant-slider-rail),
  &.is-idle :deep(.ant-slider-track),
  &.is-idle :deep(.ant-slider:hover .ant-slider-track) {
    top: auto;
    bottom: 0;
    transform: none;
  }
}

/* 时间指示器:右侧,剩余/总时长可点击切换(对齐参考 #rnp-time-indicator:143-160) */
.rnp-time-indicator {
  min-width: 56px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rnp-accent-color-shade-2, var(--color-text-primary));
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.5;
  cursor: pointer;
  transition:
    opacity 0.2s ease,
    transform 0.3s ease;
  &:hover {
    opacity: 0.85;
  }
}
</style>

<!-- 与上方内联 scoped 块特异性相同，源顺序决定层叠，需置于其后 -->
<style scoped lang="scss" src="./immersive-controls.package.scss"></style>
<!-- 含 .rnp-cover* 等由兄弟组件 ImmersiveCover 渲染的选择器，scoped 选不中，需非 scoped -->
<style lang="scss" src="./immersive-controls.global.scss"></style>
