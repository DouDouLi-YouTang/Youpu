/**
 * 「浮名」的主题、排版与画布派生状态。
 *
 * `SkinFume.vue` 只负责把画面装配起来；本文件承接其中可以独立描述的一段：
 * 当前歌曲的四色与逐词配色、内置衬线字体、整首歌的 `FumeLine[]`、文章排版、
 * 手绘背景场景与总览镜头。
 *
 * 这些都是「一段时间内不变」的数据，全部用 `computed` / `shallowRef` 暴露，
 * 不把含 `Map` 的文章包成深层响应式代理。
 */

import { computed, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue'

import { useLyricStore } from '@/stores/lyric.store'
import { usePlayerStore } from '@/stores/player.store'
import { useImmersiveSettingsStore } from '../../immersive-settings.store'
import { resolveFoliaSkinId } from '../../immersive-settings.model'
import { FOLIA_SERIF_FAMILY, useFoliaSerifReady } from '../shared/folia-font'
import { attachInterludeLines } from '../shared/interlude-lines'
import { getLineRenderEndTimeMs } from '../shared/render-hints'
import { useFoliaPalette } from '../shared/use-folia-palette'
import { useSmoothClock, type SkinAudioBands } from '../shared/use-smooth-clock'
import { toFoliaScale } from '../../backgrounds/folia/shared/audio-bands'
import { resolveArticleOverviewCamera } from './core/camera'
import type { FumeAudioLevels, FumeTheme } from './core/fume-types'
import type { FumeLayoutThemeKey } from './core/layout-key'
import {
  buildFumeFontKey,
  resolveFumeFontSelection,
  type FumeFontSelection
} from './fume-font-settings'
import {
  FUME_HERO_SCALE,
  FUME_LYRICS_FONT_SCALE,
  resolveFumeBackgroundSeed,
  toFumeLines
} from './fume-adapter'
import { clearSegmentMeasureCache } from './measure/text-measure'
import { buildFumeBackgroundScene } from './render/background'
import { useFumeLayout } from './use-fume-layout'
import type { SkinContext } from '../types'
import { useFoliaBackgroundWorld } from './use-folia-background-world'

export interface UseFumeThemeOptions {
  ctx: SkinContext
}

export interface UseFumeThemeResult {
  palette: ReturnType<typeof useFoliaPalette>['palette']
  isDaylight: ReturnType<typeof useFoliaPalette>['isDaylight']
  wordColors: ReturnType<typeof useFoliaPalette>['wordColors']
  lines: ComputedRef<ReturnType<typeof attachInterludeLines>>
  clock: ReturnType<typeof useSmoothClock>
  theme: ComputedRef<FumeTheme>
  stageSize: Ref<{ width: number; height: number }>
  context: Ref<CanvasRenderingContext2D | null>
  canvas: Ref<HTMLCanvasElement | null>
  isPlaying: ComputedRef<boolean>
  article: ReturnType<typeof useFumeLayout>['article']
  isLayoutPending: ReturnType<typeof useFumeLayout>['isLayoutPending']
  isViewportRefreshPending: ReturnType<typeof useFumeLayout>['isViewportRefreshPending']
  backgroundScene: ComputedRef<ReturnType<typeof buildFumeBackgroundScene> | null>
  backgroundWorld: ReturnType<typeof useFoliaBackgroundWorld>
  overviewCamera: ComputedRef<ReturnType<typeof resolveArticleOverviewCamera> | null>
  overviewStartTimeMs: ComputedRef<number>
  stageStyle: ComputedRef<Record<string, string>>
  toAudioLevels: (bands: SkinAudioBands) => FumeAudioLevels
}

/**
 * 创建浮名的主题与画布派生状态。
 *
 * 必须在 `SkinFume.vue` 的 setup 中调用：内部会注册字体 watch、排版调度与
 * 逐帧时钟。返回值全部是稳定引用，模板与绘制层直接消费。
 */
export function useFumeTheme({ ctx }: UseFumeThemeOptions): UseFumeThemeResult {
  const player = usePlayerStore()
  const lyric = useLyricStore()
  const settings = useImmersiveSettingsStore()

  const { palette, isDaylight, wordColors } = useFoliaPalette({
    coverUrl: computed(() => ctx.coverUrl()),
    songId: computed(() => player.currentItem?.song.id ?? null),
    lyricLines: computed(() => lyric.lines.map((line) => ({ text: line.text })))
  })

  const lines = computed(() => attachInterludeLines(lyric.lines, player.durationMs))
  const clock = useSmoothClock({ lines })

  const { fontState } = useFoliaSerifReady()

  /**
   * 浮名自己的字体设置。
   *
   * 不按 `settings.skin` 动态取槽位：异步皮肤切换时旧组件可能短暂存活，
   * 若跟着当前 skin 读，会把新主题的字体配置串到旧画布上。缺档位时回退主题默认，
   * 兼容迁移前状态。
   */
  const fontSettings = computed(() => settings.folia.fonts?.fume ?? null)
  const fontSelection = computed<FumeFontSelection>(() =>
    resolveFumeFontSelection(fontSettings.value)
  )
  /**
   * 字体文件状态、自定义字体链和字重共用同一个响应式键。
   *
   * 这个 watch 必须先清测量缓存，再让下面的 `useFumeLayout` watch 触发重排；
   * `flush: 'sync'` 保证两者在同一次响应式更新里按注册顺序执行。
   */
  const fontKey = computed(() => buildFumeFontKey(fontState.value, fontSelection.value))
  watch(fontKey, clearSegmentMeasureCache, { immediate: true, flush: 'sync' })

  const theme = computed<FumeTheme>(() => ({
    name: isDaylight.value ? 'daylight' : 'midnight',
    primaryColor: palette.value.primary,
    accentColor: palette.value.accent,
    secondaryColor: palette.value.secondary,
    fontStyle: 'serif',
    fontFamilyStack: fontSelection.value.fontFamilyStack,
    fontWeight: fontSelection.value.fontWeight,
    animationIntensity: 'normal',
    wordColors: wordColors.value
  }))

  const layoutTheme = computed<FumeLayoutThemeKey>(() => ({
    name: theme.value.name,
    fontStyle: theme.value.fontStyle,
    fontFamily: theme.value.fontFamily,
    fontFamilyStack: theme.value.fontFamilyStack,
    fontWeight: theme.value.fontWeight
  }))

  const stageSize = ref({ width: 0, height: 0 })
  const context = shallowRef<CanvasRenderingContext2D | null>(null)
  const canvas = shallowRef<HTMLCanvasElement | null>(null)
  const isPlaying = computed(() => player.state === 'playing')
  const fumeLines = computed(() => toFumeLines(lines.value, player.durationMs))

  const { article, isLayoutPending, isViewportRefreshPending } = useFumeLayout({
    lines: fumeLines,
    viewport: stageSize,
    layoutTheme,
    lyricsFontScale: computed(() => FUME_LYRICS_FONT_SCALE),
    heroScale: computed(() => FUME_HERO_SCALE),
    fontKey
  })

  const backgroundWorld = useFoliaBackgroundWorld({
    article,
    viewport: stageSize
  })

  const backgroundScene = computed(() => {
    if (settings.folia.backgroundModes[resolveFoliaSkinId(settings.skin)] !== 'native') return null
    return buildFumeBackgroundScene({
      viewport: stageSize.value,
      world: article.value
        ? { width: article.value.width, height: article.value.height }
        : {
            width: Math.max(stageSize.value.width * 1.8, stageSize.value.width),
            height: Math.max(stageSize.value.height * 1.8, stageSize.value.height)
          },
      paperBounds: article.value?.paperBounds,
      seed: resolveFumeBackgroundSeed(undefined, theme.value.name)
    })
  })

  const overviewCamera = computed(() =>
    article.value ? resolveArticleOverviewCamera(article.value, stageSize.value) : null
  )

  const overviewStartTimeMs = computed(() => {
    const current = article.value
    if (!current) return Number.POSITIVE_INFINITY
    for (let index = current.chronologicalBlocks.length - 1; index >= 0; index -= 1) {
      const block = current.chronologicalBlocks[index]
      if (block.line.fullText.trim().length === 0) continue
      return (
        block.line.startTimeMs +
        Math.max(getLineRenderEndTimeMs(block.line) - block.line.startTimeMs, 0) * 0.5
      )
    }
    return Number.POSITIVE_INFINITY
  })

  const stageStyle = computed<Record<string, string>>(() => ({
    backgroundColor:
      settings.folia.backgroundModes[resolveFoliaSkinId(settings.skin)] === 'native'
        ? palette.value.background
        : 'transparent',
    fontFamily: `"${FOLIA_SERIF_FAMILY}", serif`
  }))

  function toAudioLevels(bands: SkinAudioBands): FumeAudioLevels {
    return {
      bass: toFoliaScale(bands.bass),
      lowMid: toFoliaScale(bands.lowMid),
      mid: toFoliaScale(bands.mid),
      vocal: toFoliaScale(bands.vocal),
      treble: toFoliaScale(bands.treble),
      power: toFoliaScale(bands.power)
    }
  }

  return {
    palette,
    isDaylight,
    wordColors,
    lines,
    clock,
    theme,
    stageSize,
    context,
    canvas,
    isPlaying,
    article,
    isLayoutPending,
    isViewportRefreshPending,
    backgroundScene,
    backgroundWorld,
    overviewCamera,
    overviewStartTimeMs,
    stageStyle,
    toAudioLevels
  }
}
