<script setup lang="ts">
import { computed, ref } from 'vue'

import ImmersiveBackground from '@/features/immersive/ImmersiveBackground.vue'
import ImmersiveCover from '@/features/immersive/ImmersiveCover.vue'
import MiniSongInfo from '@/features/immersive/MiniSongInfo.vue'
import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import { useEffectiveDisplayMode } from '@/features/immersive/use-skin-context'
import { useLyricStore } from '@/stores/lyric.store'
import { usePlayerStore } from '@/stores/player.store'
import type { SkinContext } from '../types'
import TiltLine from './TiltLine.vue'
import {
  CHAR_FADE_DURATION_MS,
  resolveFontScale,
  resolveLineEndMs,
  type TiltLineSource
} from './tilt-adapter'
import { useTiltLayout } from './use-tilt-layout'
import { useTiltTiming } from './use-tilt-timing'

/**
 * 「倾诉」(tilt) 皮肤 —— Folia 风格的一行式歌词排版（与「经典」皮肤并列的款式）。
 *
 * 与外壳的边界沿用 C1 约定：外壳管窗口 chrome 与 rootClasses/rootStyleVars，
 * 本组件只负责内容层（背景 / 迷你歌曲信息 / 封面槽 / 歌词区）。
 * 内容层三个 class 名与经典皮肤一致，外壳 immersive-shell.scss 里挂在 `.immersive-root`
 * 上的 display-mode-* / cover-halign-* 规则才能继续命中（详见 tilt.scss 顶部注释）。
 *
 * 歌词区**不复用** LyricLines：布局逻辑完全不同（一行切成 1–4 段 + 倾斜段 + 逐字脉冲），
 * 因此对齐的是它的行为约定：点击行 seek、暂停定格、切行/seek/改偏移重建逐字时间轴。
 */
const props = defineProps<{ ctx: SkinContext }>()

const settings = useImmersiveSettingsStore()
const lyric = useLyricStore()
const player = usePlayerStore()
const effectiveDisplayMode = useEffectiveDisplayMode()

/** 当前行下标（-1 = 尚未到首行）；文本/逐字时间戳从 lyric store 取（契约只给下标） */
const currentIndex = computed(() => props.ctx.currentLineIndex())
const currentLine = computed(() =>
  currentIndex.value >= 0 ? (lyric.lines[currentIndex.value] ?? null) : null
)

/** 行输入：结束时间按笔记 §8.1.1 推算（下一行 / 播放时长 / 固定 5 秒） */
const source = computed<TiltLineSource | null>(() => {
  const line = currentLine.value
  if (!line) return null
  const next = lyric.lines[currentIndex.value + 1] ?? null
  return {
    text: line.text,
    timeMs: line.timeMs,
    endMs: resolveLineEndMs(line, next, player.durationMs),
    words: line.words
  }
})

/** 行身份：切歌或切行都算新的一行（重建逐字时间轴） */
const lineKey = computed(() => `${lyric.songId ?? 'none'}:${currentIndex.value}`)

const fontScale = computed(() => resolveFontScale(settings.lyricFontSize))
/** 自定义字体的可响应标识：字体族是从 DOM 读的，靠它告诉测量层「字体变了，要重测」 */
const fontKey = computed(() =>
  settings.customFont && settings.customFontFamily.length > 0
    ? settings.customFontFamily.join('|')
    : '默认字体'
)

const panelRef = ref<HTMLElement | null>(null)
const { layout } = useTiltLayout({ source, fontScale, fontKey, panel: panelRef })

// lyricOffset 变化会让 ctx.currentTime() 整体平移（滑块 step=100ms，低于 seek 判定阈值），
// 故把它作为显式的重同步键 —— 与经典皮肤调 LyricLines.resyncKaraoke() 是同一件事。
const { model, epoch, resync } = useTiltTiming({
  time: () => props.ctx.currentTime(),
  lineKey: () => lineKey.value,
  resyncKey: () => settings.lyricOffset,
  source,
  segments: () => layout.value?.segments ?? null,
  fontPx: () => layout.value?.fontPx ?? 0
})

/** 暂停时定格：交给 CSS 的 animation-play-state: paused（见 tilt-line.scss） */
const paused = computed(() => !props.ctx.isPlaying())

/** 舞台 CSS 变量：字号由布局算好（clamp × 用户倍率 × 溢出缩放），淡入时长取自适配层常量 */
const stageStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = { '--tilt-fade-dur': `${CHAR_FADE_DURATION_MS}ms` }
  const fontPx = layout.value?.fontPx
  // 测量完成前不写字号，让 SCSS 里的 clamp 兜底值顶着，避免先用 0px 排一次
  if (fontPx && fontPx > 0) style['--tilt-font-size'] = `${fontPx}px`
  return style
})

/** 无行可排时的中文占位（笔记 §8.5：加载中 / 纯音乐 / 无歌词 / 等待音乐要分开） */
const placeholder = computed(() => {
  if (lyric.loading) return '歌词加载中…'
  if (lyric.isPureMusic) return '纯音乐，请欣赏'
  if (!lyric.hasLyric) return '暂无歌词'
  if (!player.currentItem) return '等待音乐'
  if (currentIndex.value < 0) return '等待音乐'
  return ''
})

function handleSeek(): void {
  const line = currentLine.value
  if (!line) return
  // seekLyric 由壳层扣掉 lyricOffset（见 shared/use-transport.ts），此处不要再减
  props.ctx.seekLyric(line.timeMs)
  // 行内 seek 的时间跳变可能小于 SEEK_JUMP_MS，显式请求重同步（下一次时间更新时生效）
  resync()
}
</script>

<template>
  <!-- 背景层 -->
  <ImmersiveBackground />

  <!-- 仅歌词模式顶部迷你歌曲信息 -->
  <MiniSongInfo />

  <!-- 内容层：左封面 / 右歌词（displayMode 控制显隐，与经典皮肤同构） -->
  <div class="immersive-content">
    <div
      v-show="effectiveDisplayMode !== 'lyric-only'"
      class="immersive-cover-slot"
      :class="[`cover-halign-${settings.coverHAlign}`, `cover-valign-${settings.coverVAlign}`]"
    >
      <ImmersiveCover />
    </div>

    <div v-show="effectiveDisplayMode !== 'cover-only'" class="immersive-lyric">
      <div class="tilt-stage">
        <div ref="panelRef" class="tilt-stage-inner" :style="stageStyle">
          <p v-if="placeholder" class="tilt-placeholder">{{ placeholder }}</p>
          <TiltLine
            v-else-if="model"
            :key="epoch"
            :model="model"
            :paused="paused"
            @seek="handleSeek"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss" src="./tilt.scss"></style>
