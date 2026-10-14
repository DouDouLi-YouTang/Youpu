/**
 * 「浮名」的**画布之外那一层**：底部副字幕、空态、以及它们要的 CSS 变量。
 *
 * ## 为什么单独一个 hook
 *
 * `SkinFume.vue` 的职责是"把画布、排版、字幕接起来"。这三件事的输入完全不同：
 *  - 画布：文章、背景场景、相机 —— 全是每帧被读的大对象；
 *  - 副字幕与空态：当前行、字号档、调色板 —— 只在换行 / 切主题时变。
 *
 * 挤在同一个文件里会让 `SkinFume.vue` 超过 AGENTS.md 的 400 行上限，也会让
 * "哪一段属于画布、哪一段属于 DOM"变得需要逐行读才知道。所以 DOM 那一层单独成篇。
 *
 * ## 行下标为什么用逐帧值
 *
 * `ctx.currentLineIndex()` 来自 4Hz 节流的 `player.currentTimeMs`，前奏结束的那一
 * 瞬间底栏会晚最多 250ms 才切到第一句。副字幕与空态都挂在行下标上，所以这里读
 * 共享的逐帧时钟（`useSkinActiveLine`，与「流光」同一套）。
 *
 * ⚠️ 画布侧**不读**它：文章的排版与打印进度全部由 `article` + 逐帧时间决定，
 * 行下标只喂给相机（那是"焦点落在哪一块"的提示），而那一路读节流值 —— 与上游一致。
 *
 * ## 空态与加载卡的优先级
 *
 * 浮名有「正在排版」这张卡，所以空态只在 `!isLayoutPending` 时显示 —— 否则切歌的
 * 瞬间会同时看到「纯音乐，请欣赏」与加载卡。上游的浮名干脆没有空态（没有行时只留
 * 背景 + 卡），本项目用户 2026-10-10 明确要求「歌在放就要显示歌名」，
 * 所以保留空态，只是让卡优先。
 */

import { computed, type ComputedRef, type Ref } from 'vue'

import { useLyricStore } from '@/stores/lyric.store'
import { usePlayerStore } from '@/stores/player.store'
import { colorWithAlpha } from '../shared/color-mix'
import { resolveSkinEmptyState, type SkinEmptyState } from '../shared/empty-state'
import { useSkinActiveLine } from '../shared/use-skin-active-line'
import type { SmoothClock } from '../shared/use-smooth-clock'
import {
  SECONDARY_TRACK_SIZE_FACTOR,
  SUBTITLE_OVERLAY_OPACITY,
  resolveSubtitleTracks,
  resolveUpcomingPreview,
  scaleSubtitleFontSize,
  type SubtitleTrack
} from '../shared/subtitle-tracks'
import {
  resolveFumeEmptyFontSize,
  resolveFumeSubtitleFontSize,
  resolveFumeUpcomingFontSize
} from './fume-adapter'
import type { SkinContext } from '../types'

/** 调色板里本层要用的四项（结构上等于 `useFoliaPalette().palette`） */
export interface FumeOverlayPalette {
  background: string
  primary: string
  secondary: string
}

export interface UseFumeOverlayOptions {
  ctx: SkinContext
  clock: SmoothClock
  /** 调色板（`useFoliaPalette()` 的 `palette`，一个只读的 ref） */
  palette: Readonly<Ref<FumeOverlayPalette>>
  /** 排版是否正在进行（`useFumeLayout` 的 `isLayoutPending`） */
  isLayoutPending: Ref<boolean>
}

export interface UseFumeOverlayResult {
  emptyState: ComputedRef<SkinEmptyState | null>
  subtitleRows: ComputedRef<SubtitleTrack[]>
  upcomingPreview: ComputedRef<string[]>
  secondarySubtitleFontSize: string
  upcomingFontSize: string
  emptyFontSize: string
  /** 交给 `SkinFume.vue` 的 `:style`（底距 / 空态色 / 加载卡配色） */
  overlayStyleVars: ComputedRef<Record<string, string>>
}

export function useFumeOverlay(options: UseFumeOverlayOptions): UseFumeOverlayResult {
  const lyric = useLyricStore()
  const player = usePlayerStore()

  const activeLine = useSkinActiveLine(options.clock)

  const emptyState = computed(() =>
    resolveSkinEmptyState({
      loading: lyric.loading,
      isPureMusic: lyric.isPureMusic,
      hasLyric: lyric.hasLyric,
      hasItem: Boolean(player.currentItem),
      songTitle: options.ctx.songTitle(),
      songArtist: options.ctx.songArtist(),
      hasCurrentLine: activeLine.index.value >= 0
    })
  )

  /**
   * 副字幕轨道（罗马音在前、译文在后；可读性门槛与去重在共享层）。
   * 档位固定 `'both'`：浮名没有设置面板，与「流光」同一取舍。
   */
  const subtitleRows = computed(() => resolveSubtitleTracks(activeLine.line.value, 'both'))

  /**
   * 「下一句」预览。**当前行有可读副字幕就不显示预览**（上游语义）。
   * 行源取自 store 原始行数组的下两行 —— 用逐帧行下标，否则预览会晚最多 250ms。
   */
  const upcomingPreview = computed(() => {
    if (subtitleRows.value.length > 0) return []
    const index = activeLine.index.value
    if (index < 0) return []
    return resolveUpcomingPreview(lyric.lines.slice(index + 1, index + 3))
  })

  /** 副字幕字号（浮名自己的档位，倍率固定 1）—— 次级轨道在它基础上再降一档 */
  const subtitleFontSize = resolveFumeSubtitleFontSize()
  const secondarySubtitleFontSize = scaleSubtitleFontSize(
    subtitleFontSize,
    SECONDARY_TRACK_SIZE_FACTOR
  )
  const upcomingFontSize = resolveFumeUpcomingFontSize()
  /** 空态字号（与「流光」同值，见适配层说明） */
  const emptyFontSize = resolveFumeEmptyFontSize()

  /**
   * 交给皮肤根的 CSS 变量。
   *
   * 加载卡的五处颜色**逐字对齐上游的内联 style**：卡面用底色（不透明）、
   * 描边用次要色 24%、投影用底色 52%、图标用主色 78%、三根骨架条分别是
   * 主色 32% / 22% 与次要色 20%。在亮色主题下这套系数自然给出"白卡 + 灰条"，
   * 不需要另开一套。
   */
  const overlayStyleVars = computed<Record<string, string>>(() => {
    const palette = options.palette.value
    return {
      /**
       * 副字幕的底距：与「流光」同一个基线（Folia 的 32px + 控制条净空 80px = 112px，
       * 本项目控制条高 90px，故取它再加 22px 净空）。变量名归共享组件所有
       * （`shared/SkinSubtitle.vue` 读 `--skin-subtitle-bottom`）。
       */
      '--skin-subtitle-bottom': 'calc(var(--bottombar-height, 90px) + 22px)',
      /** 空态字色（共享组件读 `--skin-empty-color`） */
      '--skin-empty-color': palette.secondary,
      '--fume-pending-bg': palette.background,
      '--fume-pending-border': colorWithAlpha(palette.secondary, 0.24),
      '--fume-pending-glow': colorWithAlpha(palette.background, 0.52),
      '--fume-pending-icon': colorWithAlpha(palette.primary, 0.78),
      '--fume-pending-bar-first': colorWithAlpha(palette.primary, 0.32),
      '--fume-pending-bar-second': colorWithAlpha(palette.primary, 0.22),
      '--fume-pending-bar-third': colorWithAlpha(palette.secondary, 0.2)
    }
  })

  return {
    emptyState,
    subtitleRows,
    upcomingPreview,
    secondarySubtitleFontSize,
    upcomingFontSize,
    emptyFontSize,
    overlayStyleVars
  }
}

/** 副字幕整层的不透明度（上游 `subtitleOverlayOpacity` 默认 0.6）—— 转发给模板 */
export const FUME_SUBTITLE_OVERLAY_OPACITY = SUBTITLE_OVERLAY_OPACITY
