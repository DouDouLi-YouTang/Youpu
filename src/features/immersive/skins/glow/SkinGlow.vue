<script setup lang="ts">
import { computed, ref } from 'vue'
import { AnimatePresence, motion } from 'motion-v'

import { useLyricStore } from '@/stores/lyric.store'
import { usePlayerStore } from '@/stores/player.store'
import { buildFoliaFontStack, createFoliaFontSettingsDefaults } from '../../folia-font-settings'
import { useImmersiveSettingsStore } from '../../immersive-settings.store'
import { resolveSkinEmptyState } from '../shared/empty-state'
import { FOLIA_SERIF_FAMILY, useFoliaSerifReady } from '../shared/folia-font'
import { isGlowBlurQuantized } from '../shared/glow-blur-quantize'
import { attachInterludeLines } from '../shared/interlude-lines'
import SkinEmptyState from '../shared/SkinEmptyState.vue'
import SkinSubtitle from '../shared/SkinSubtitle.vue'
import { useFoliaPalette } from '../shared/use-folia-palette'
import { useSubtitleBottom } from '../shared/use-subtitle-bottom'
import { useSmoothClock } from '../shared/use-smooth-clock'
import {
  resolveSubtitleFontSizes,
  resolveSubtitleTracks,
  resolveSubtitlePreview,
  SUBTITLE_OVERLAY_OPACITY
} from '../shared/subtitle-tracks'
import type { SkinContext } from '../types'
import { buildLineFloat } from './core/word-layout'
import {
  GLOW_BREATHING_FLOAT_MULTIPLIER,
  GLOW_ENABLE_WORD_ROTATION,
  GLOW_FONT_WEIGHT,
  GLOW_INTENSITY,
  GLOW_LINE_MAX_WIDTH_REM,
  GLOW_LINE_MIN_HEIGHT_PX,
  GLOW_STAGE_HEIGHT_VH,
  resolveGlowEmptyFontSize,
  resolveGlowFontSize,
  resolveDisplayWords
} from './glow-adapter'
import FoliaSkinBackground from '../shared/FoliaSkinBackground.vue'
import GlowBackground from './GlowBackground.vue'
import GlowLine from './GlowLine.vue'
import { resolveGlowRenderProfile } from './glow-profile'
import { setGlowQuantizedForm } from './glow-variants'
import { useGlowActiveLine } from './use-glow-line'
import { useGlowLayout } from './use-glow-layout'
import { useGlowViewport } from './use-glow-viewport'

/**
 * 「流光」(glow) 皮肤 —— Folia `classic` 面板的 Vue 重写。
 *
 * ## 一句话结构
 *
 * 一个占 70vh 的居中舞台：舞台上有**一行**歌词（`GlowLine`），每个词自己散落、
 * 自己亮、唱完慢慢转；底栏是罗马音 / 译文副字幕（共享的 `SkinSubtitle`）。背景是 Folia
 * 自带的 `common` 模式（`GlowBackground`，见那边的说明）。
 *
 * ## 设置
 *
 * 使用 Folia 三主题共享的 `settings.folia`：明暗、配色方案、副歌词档位、
 * 背景模式、逐词着色。字号 / 动画强度 / 词间距等排版参数仍然来自
 * `glow-adapter.ts` 的 `GLOW_*` 常量，不套用经典面板的排版滑杆。
 *
 * **跟随的沉浸页通用项**：专辑主色、底栏四项、演示模式、歌词偏移。
 *
 * ## 时间源：为什么不用 `ctx.currentTime()`
 *
 * `player.currentTimeMs` 被 `THROTTLE_MS = 250` 节流（4Hz）。流光的逐词高亮、
 * 行出入场、光晕脉冲**全部**挂在时间上，4Hz 下每个词都会晚最多 250ms 才亮 ——
 * 逐词高亮与音频直接错位，是这个面板最不能接受的偏差。
 * 所以改用 `shared/use-smooth-clock`：一条 rAF 外推 + 相位收敛，
 * 所有词订阅同一个时钟（`onFrame`），状态翻转天然同帧。
 *
 * ## 行下标：也从逐帧时钟取
 *
 * 理由同上，换行晚 250ms = 上一行的退场与下一行的进场整体后移。行下标通过
 * `useGlowActiveLine` 从时钟里取（只在真的变行时写 ref，不逐帧重渲染）。
 */

const props = defineProps<{ ctx: SkinContext }>()

const lyric = useLyricStore()
const player = usePlayerStore()
const settings = useImmersiveSettingsStore()

/**
 * 面板配色 —— 逐歌主题（从封面推出来，每首歌不同；口径见 `shared/use-folia-palette`）。
 *
 * 三个输入全部来自当前播放的歌：
 *  - `coverUrl`：主题的颜色来源；
 *  - `songId`：主题种子（决定随机色相，保证同一首歌颜色稳定）；
 *  - `lyricLines`：只用于挑**关键词**（逐词配色，见下）。
 */
const { palette, isDaylight, wordColors } = useFoliaPalette({
  coverUrl: computed(() => props.ctx.coverUrl()),
  songId: computed(() => player.currentItem?.song.id ?? null),
  // 只给整行文本：候选词的切分口径收在 keyword-colors 里
  // （⚠️ 别把 `line.words` 传进去 —— 那是按字符切的，见那边的说明）
  lyricLines: computed(() => lyric.lines.map((line) => ({ text: line.text })))
})
/** 内置衬线字体的就绪信号：变化即重测词宽（见 use-glow-layout） */
const { fontState } = useFoliaSerifReady()

/** 流光自己的字体设置；缺档位时回退默认，旧存档不会让画面白屏。 */
const fontSettings = computed(() => settings.folia.fonts?.glow ?? createFoliaFontSettingsDefaults())
/** 自定义族优先，内置衬线族兜底；最终字符串同时喂给 CSS 与 canvas 测量。 */
const glowFontFamily = computed(() =>
  buildFoliaFontStack(
    fontSettings.value.custom ? fontSettings.value.families : [],
    [FOLIA_SERIF_FAMILY],
    'serif'
  )
)
/** 有效字重：未自定义时跟随流光主题的 700；字体开关不覆盖字重。 */
const glowFontWeight = computed(() => fontSettings.value.weight ?? GLOW_FONT_WEIGHT)
/** 字体就绪 / 字体链 / 字重任一变都要重算逐词几何。 */
const glowFontKey = computed(
  () => `${fontState.value}|${glowFontFamily.value}|${glowFontWeight.value}`
)

/**
 * 逐帧时钟（整屏一条 rAF）。
 *
 * ⚠️ 行源要在时钟**之前**建出来，再注入给时钟与 `useGlowActiveLine` ——
 * 三方必须用同一个数组（含插曲行的那一份），否则下标会指向不同的行。
 * 见 `use-glow-line` 的 `lines`。
 */
const lines = computed(() => attachInterludeLines(lyric.lines, player.durationMs))
const clock = useSmoothClock({ lines })
/** 当前行（下标 + 行数据 + 补上的 endMs），逐帧从时钟取 */
const activeLine = useGlowActiveLine(clock, lines)

/** 舞台元素：测量层从它读字体栈（族名继承自这里，逐词不覆盖） */
const stageRef = ref<HTMLElement | null>(null)
/** 视口尺寸：宽度是逐词几何的输入（见 use-glow-layout），高度目前无 JS 消费方 */
const { viewportWidth } = useGlowViewport()

/**
 * 当前行的显示词。**没有逐词数据时退化成"整行一个词"**（见 `resolveDisplayWords`），
 * 所以这里不用为空 —— 只有行本身不存在时才是空数组。
 */
const displayWords = computed(() =>
  activeLine.source.value
    ? resolveDisplayWords(
        activeLine.source.value.text,
        activeLine.source.value.words,
        activeLine.source.value.timeMs,
        activeLine.source.value.endMs
      )
    : []
)

/** 行渲染档位（逐词时序 + 行过渡档），由共享 render-hints 推出 */
const profile = computed(() =>
  activeLine.source.value ? resolveGlowRenderProfile(activeLine.source.value) : null
)

/**
 * 逐词几何。依赖换行 / 视口宽度 / 字体就绪 —— **不依赖播放时间**
 * （几何是一行生命周期内的常量，见 use-glow-layout 文件头）。
 */
const { layout } = useGlowLayout({
  words: displayWords,
  lineStartMs: () => activeLine.source.value?.timeMs ?? 0,
  fontKey: glowFontKey,
  fontFamily: glowFontFamily,
  fontWeight: glowFontWeight,
  stage: stageRef,
  viewportWidth
})

/** 整行呼吸浮动（倍率固定 1）：幅度与周期按强度档，见 core/word-layout.buildLineFloat */
const lineFloat = computed(() => buildLineFloat(GLOW_INTENSITY, GLOW_BREATHING_FLOAT_MULTIPLIER))

/** 主行字号（倍率固定 1 的 clamp 字符串） */
const fontSize = resolveGlowFontSize()
/** 空态字号 */
const emptyFontSize = resolveGlowEmptyFontSize()

/**
 * 空态：没有行可排时显示什么。判定与外观全部在共享层
 * （`shared/empty-state.ts` 判档、`shared/SkinEmptyState.vue` 出图）。
 *
 * ⚠️ `hasCurrentLine` 传的是**逐帧时钟算出来的**行下标，不是 store 的节流值 ——
 * 否则前奏结束的那一瞬间空态会多留最多 250ms。
 */
const emptyState = computed(() =>
  resolveSkinEmptyState({
    loading: lyric.loading,
    isPureMusic: lyric.isPureMusic,
    hasLyric: lyric.hasLyric,
    hasItem: Boolean(player.currentItem),
    songTitle: props.ctx.songTitle(),
    songArtist: props.ctx.songArtist(),
    hasCurrentLine: activeLine.index.value >= 0
  })
)

/**
 * 底部副字幕轨道（罗马音在前、译文在后；可读性门槛与去重在共享层）。
 *
 * 档位取自 Folia 共享设置 `settings.folia.subtitleContentMode`（默认 `'both'` =
 * 罗马音在前、译文在后），由「歌词」页签控制。
 *
 * ⚠️ **当前行没有可读副字幕时回退到"最近一句唱完的行"**（上游
 * `resolveVisualizerSubtitleOverlayContent` 的 `[activeLine, recentCompletedLine]`
 * 里取第一个有轨道的）。这是「前奏 / 间奏时底栏该显示什么」的答案：
 * 上游保持上一句的译文，本项目改造前会直接空掉 —— 长间奏里底栏整段消失，
 * 与官网演示明显不同。回退只发生在**当前行下标为 -1** 时（见共享层说明），
 * 不是"每行结束后都拿上一句顶上"。
 */
const subtitleRows = computed(() => {
  const rows = resolveSubtitleTracks(activeLine.line.value, settings.folia.subtitleContentMode)
  if (rows.length > 0) return rows
  return resolveSubtitleTracks(
    activeLine.recentCompletedLine.value,
    settings.folia.subtitleContentMode
  )
})

/**
 * 「下一句」预览。
 *
 * 上游语义：**当前行有可读副字幕就不显示预览**，没有才显示接下来的两行
 * （见 `shared/subtitle-tracks.resolveUpcomingPreview` 的说明）。
 * 行源取 `activeLine.lines`（含插曲行的那一份，与主舞台同源）的下两行 ——
 * 用 `activeLine.index`（逐帧时钟算出来的）而不是 store 的节流下标，
 * 否则预览会比主舞台晚最多 250ms 切换。
 */
const upcomingPreview = computed(() => {
  if (subtitleRows.value.length > 0) return []
  const index = activeLine.index.value
  if (index < 0) return []
  return resolveSubtitlePreview(
    activeLine.lines.value.slice(index + 1, index + 3),
    settings.folia.subtitleContentMode
  )
})

/** 副字幕字号（倍率固定 1）：副字幕基准档 + 预览档（次级降档在组件内做） */
const subtitleFontSizes = resolveSubtitleFontSizes(1)

/**
 * 辉光形态（`text-shadow` 还是降级的 `drop-shadow`）。
 *
 * 形态在**每次词转 active 时**由 variants 解析一次（见 `glow-variants` 的说明），
 * 所以这里只需在挂载时同步一次 `detectLinux()` 的结果 —— 不需要 watch：
 * 平台在会话内不会变。
 *
 * ⚠️ `glow-variants` 里那个模块级开关**默认是 false**，必须在这里显式同步一次。
 * 漏了这一步的表现是：Linux 上依旧走 `text-shadow` 路径，字形缓存照样泄漏
 * （降级开关形同不存在，且没有任何报错）。
 */
setGlowQuantizedForm(isGlowBlurQuantized())

/**
 * 舞台 CSS 变量：把 JS 侧的常量交给样式表，避免同一个数字写两处。
 * （`--glow-line-max-width` 等由 `glow.scss` 消费。）
 */
const stageStyle = computed<Record<string, string>>(() => ({
  '--glow-line-max-width': `${GLOW_LINE_MAX_WIDTH_REM}rem`,
  '--glow-line-min-height': `${GLOW_LINE_MIN_HEIGHT_PX}px`,
  '--glow-stage-height': `${GLOW_STAGE_HEIGHT_VH}vh`,
  // 空态字色：变量名归共享组件所有（`shared/SkinEmptyState.vue` 读它）
  '--skin-empty-color': palette.value.secondary
}))

/**
 * 副字幕底距（跟随控制条显隐；上游口径见 `shared/use-subtitle-bottom`）。
 *
 * ⚠️ 挂在**内容层**而不是舞台：舞台只有 70vh，锚点会跟着它走。
 * 变量名归共享组件所有（`shared/SkinSubtitle.vue` 读它）。
 */
const { bottomPx: subtitleBottomPx } = useSubtitleBottom()

/** 点行跳转（对齐「倾诉」：点当前行 → seek 到行首） */
function handleSeek(): void {
  const source = activeLine.source.value
  if (!source) return
  // seekLyric 由壳层扣掉 lyricOffset（见 shared/use-transport），此处不要再减
  props.ctx.seekLyric(source.timeMs)
}
</script>

<template>
  <!-- 背景层：原生 common / 用户选择的 Folia 背景 -->
  <FoliaSkinBackground
    :cover-url="ctx.coverUrl()"
    :palette="palette"
    :is-daylight="isDaylight"
    :paused="!ctx.isPlaying()"
    :clock="clock"
  >
    <GlowBackground
      :cover-url="ctx.coverUrl()"
      :palette="palette"
      :is-daylight="isDaylight"
      :paused="!ctx.isPlaying()"
      :clock="clock"
    />
  </FoliaSkinBackground>

  <!-- 内容层：整屏歌词舞台。底距由 JS 逐帧插值后注入（见 use-subtitle-bottom） -->
  <div
    class="immersive-content"
    :style="{ '--skin-subtitle-bottom': `${Math.round(subtitleBottomPx)}px` }"
  >
    <div ref="stageRef" class="glow-stage" :style="stageStyle">
      <!-- 呼吸浮动层：**跨行常驻**（见 GlowLine.vue 文件头），无限循环 -->
      <motion.div
        class="glow-stage-float"
        :animate="
          lineFloat
            ? {
                y: [0, -lineFloat.distance, 0, lineFloat.distance * 0.45, 0],
                scale: [1, 1 + 0.01 * lineFloat.multiplier, 1, 1 - 0.005 * lineFloat.multiplier, 1]
              }
            : undefined
        "
        :transition="
          lineFloat
            ? { duration: lineFloat.duration, repeat: Infinity, ease: 'easeInOut' }
            : undefined
        "
      >
        <!-- 行切换：AnimatePresence 让旧行先播 exit 再卸载（mode=popLayout 与上游一致） -->
        <AnimatePresence mode="popLayout">
          <GlowLine
            v-if="layout && profile"
            :key="activeLine.lineKey.value"
            :line-config="layout.line"
            :word-configs="layout.words"
            :words="displayWords"
            :profile="profile"
            :clock="clock"
            :intensity="GLOW_INTENSITY"
            :enable-word-rotation="GLOW_ENABLE_WORD_ROTATION"
            :font-size="fontSize"
            :font-family="glowFontFamily"
            :font-weight="glowFontWeight"
            :base-color="palette.primary"
            :active-color="palette.accent"
            :word-colors="wordColors"
            :is-chorus="activeLine.line.value?.isChorus === true"
          />

          <!-- 空态：没有行可排（或用同样的 key 占位，保证两态之间有过渡） -->
          <SkinEmptyState
            v-else-if="emptyState"
            key="glow-empty"
            :state="emptyState"
            :font-size="emptyFontSize"
          />
        </AnimatePresence>
      </motion.div>

      <!--
        整行点击跳转：舞台铺一层透明按钮（上游是 pointer-events-none，行跳转在外侧桥接层）。
        本项目对齐「倾诉」的做法：点当前行 → seek 到行首。
        ⚠️ 必须铺在**整个舞台**而不是每个词上：词之间有大量空隙，挂在词上会让点空隙落空。
        放在最后 = 最高层（副字幕与歌词都是 pointer-events:none，不吃事件）。
      -->
      <button
        v-if="activeLine.source.value"
        type="button"
        class="glow-line-hit"
        aria-label="跳到本行开头"
        @click="handleSeek"
      />
    </div>

    <!--
      底部副字幕（罗马音 / 译文）或「接下来两句」预览：不吃事件。

      ⚠️ **挂在内容层而不是舞台里**：上游的字幕锚点是「从视口底起算的 112px」，
      而舞台只有 70vh —— 挂在舞台里会让字幕整体低一大截，且不随控制条显隐变化
      （2026-10-14 实测修正，见 glow.scss 的文件头）。
    -->
    <SkinSubtitle
      :rows="subtitleRows"
      :preview="upcomingPreview"
      :background="palette.background"
      :color="palette.secondary"
      :opacity="SUBTITLE_OVERLAY_OPACITY"
      :translation-font-size="subtitleFontSizes.translation"
      :upcoming-font-size="subtitleFontSizes.upcoming"
      :blur="settings.folia.subtitleBlur"
    />
  </div>
</template>

<style scoped lang="scss" src="./glow.scss"></style>
