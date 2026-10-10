<script setup lang="ts">
import { computed, ref, watch } from 'vue'

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
 * 「倾诉」(tilt) 皮肤 —— Folia 式**全屏歌词**面板（与「经典」皮肤并列的款式）。
 *
 * 这是一个独立面板，不是经典布局的换色版：Folia 的预览图里歌词是**一条占满窗口的
 * 居中舞台**（`VisualizerTilt` 的 `w-full h-[70vh] flex items-center justify-center`），
 * 没有封面列、没有侧边留白。因此这里：
 *  - 歌词区自成一套（`.tilt-lyric`，满宽满高居中），**不复用**经典皮肤的 `.immersive-lyric`
 *    —— 那个类名会被外壳的 `.display-mode-lyric-only` 规则加上给滚动列表用的内边距；
 *  - 封面只在「仅封面」模式出现（此时整屏让给封面），其余模式完全不渲染封面；
 *  - 底部补一条译文（Folia 的副字幕层）。
 *
 * 与外壳的边界沿用 C1 约定：外壳管窗口 chrome 与 rootClasses/rootStyleVars，
 * 本组件只负责内容层（背景 / 迷你歌曲信息 / 封面槽 / 歌词区）。唯一保留同名的内容层
 * class 是 `.immersive-cover-slot`（「仅封面」模式要复用外壳的整屏与水平居中微调规则）。
 *
 * 歌词块**不复用** LyricLines：布局逻辑完全不同（一行切成 1–4 段 + 倾斜段 + 逐字脉冲），
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

/**
 * 底部副字幕行（Folia 的副字幕层）。
 *
 * 与经典皮肤的口径对齐：罗马音在前、译文在后，两者都有时两行都给（Folia 的 'both' 档
 * 也是这个顺序，且缺哪个就少一行、绝不出现空占位）；有些音源两个字段填同一串
 * （例如本身就是拉丁字母的歌词），此时只显示一次。
 *
 * 两者的字号各不相同（设置面板「歌词」tab 里罗马音 / 译文各有一个滑块），所以分别给出
 * 文案与字号倍率。
 */
const subtitleRows = computed<{ text: string; kind: 'romaji' | 'translation' }[]>(() => {
  const line = currentLine.value
  if (!line) return []
  const romaji = line.romaji?.trim() ?? ''
  const translation = line.translation?.trim() ?? ''
  const rows: { text: string; kind: 'romaji' | 'translation' }[] = []
  if (romaji) rows.push({ text: romaji, kind: 'romaji' })
  if (translation && translation !== romaji) rows.push({ text: translation, kind: 'translation' })
  return rows
})

const fontScale = computed(() => resolveFontScale(settings.lyricFontSize))

/**
 * 副字幕行的字号倍率 = 用户歌词字号倍率 × 该行的 em 设置。
 *
 * 基数是本皮肤自己的 clamp 字号（Folia 的 `resolveSubtitleFontSizes` 口径），em 倍率取自
 * 设置面板那两个滑块 —— 滑块语义与经典皮肤一致（「这一段相对本面板正文有多大」），
 * 但**绝对 px 两款皮肤本就不同**：经典皮肤的译文是正文的 1 倍（32px 即 32px），
 * 本皮肤是 Folia 的副字幕档（正文约 90px 时译文约 20px）。这是设计如此，不是缺陷。
 */
const subtitleStyle = computed<Record<string, string>>(() => ({
  '--tilt-sub-romaji-em': String(settings.lyricRomajiSizeEm),
  '--tilt-sub-translation-em': String(settings.lyricTranslationSizeEm),
  '--tilt-sub-scale': String(fontScale.value)
}))
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
const { model, epoch, resync, resyncNow } = useTiltTiming({
  time: () => props.ctx.currentTime(),
  lineKey: () => lineKey.value,
  resyncKey: () => settings.lyricOffset,
  source,
  segments: () => layout.value?.segments ?? null,
  fontPx: () => layout.value?.fontPx ?? 0
})

// 「仅封面」模式会把歌词区整块 v-if 掉，回来时 TiltLine 是**新挂载**的元素，
// CSS 动画从零重播；而快照里的延迟还是离开那一刻算的 → 整行相位滞后「离开的时长」，
// 已唱完的字会再浮现一遍，直到下一次切行/seek 才自愈。
// 这里在歌词区重新可见时立刻重取当前时间，把相位拉回正确位置。
watch(
  () => effectiveDisplayMode.value !== 'cover-only',
  (lyricVisible) => {
    if (lyricVisible) resyncNow()
  }
)

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

  <!-- 内容层：全屏歌词；只有「仅封面」模式（或无歌词时的兜底）才让位给封面 -->
  <div class="immersive-content">
    <div
      v-if="effectiveDisplayMode === 'cover-only'"
      class="immersive-cover-slot"
      :class="[`cover-halign-${settings.coverHAlign}`, `cover-valign-${settings.coverVAlign}`]"
    >
      <ImmersiveCover />
    </div>

    <div v-else class="tilt-lyric">
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

      <!-- 底部副字幕（罗马音 / 译文）：对齐 Folia 副字幕层与经典皮肤的两行口径 -->
      <div v-if="subtitleRows.length" class="tilt-subtitles" :style="subtitleStyle">
        <p
          v-for="row in subtitleRows"
          :key="row.kind"
          class="tilt-subtitle"
          :class="`is-${row.kind}`"
        >
          {{ row.text }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss" src="./tilt.scss"></style>
