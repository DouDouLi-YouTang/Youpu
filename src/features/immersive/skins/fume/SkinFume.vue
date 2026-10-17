<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import { useLyricStore } from '@/stores/lyric.store'
import { usePlayerStore } from '@/stores/player.store'
import { useFoliaPalette } from '../shared/use-folia-palette'
import { attachInterludeLines } from '../shared/interlude-lines'
import { useSmoothClock, type SkinAudioBands } from '../shared/use-smooth-clock'
import { FOLIA_SERIF_FAMILY, useFoliaSerifReady } from '../shared/folia-font'
import { getLineRenderEndTimeMs } from '../shared/render-hints'
import { colorWithAlpha } from '../shared/color-mix'
import SkinEmptyState from '../shared/SkinEmptyState.vue'
import SkinSubtitle from '../shared/SkinSubtitle.vue'
import { toFoliaScale } from '../../backgrounds/folia/shared/audio-bands'
import type { SkinContext } from '../types'
import { resolveArticleOverviewCamera } from './core/camera'
import type { FumeAudioLevels, FumeTheme } from './core/fume-types'
import type { FumeLayoutThemeKey } from './core/layout-key'
import {
  FUME_BACKGROUND_OPACITY_MULTIPLIER,
  FUME_HERO_SCALE,
  FUME_LYRICS_FONT_SCALE,
  FUME_SHOW_PRINT_STAMP,
  FUME_TUNING,
  resolveFumeBackgroundSeed,
  toFumeLines
} from './fume-adapter'
import { buildFumeBackgroundScene } from './render/background'
import { clearSegmentMeasureCache } from './measure/text-measure'
import { useFumeLayout } from './use-fume-layout'
import { FUME_SUBTITLE_OVERLAY_OPACITY, useFumeOverlay } from './use-fume-overlay'
import { useFumeStage, type FumeStageSize } from './use-fume-stage'
import FumeStage from './components/FumeStage.vue'
import FumeLayoutPending from './components/FumeLayoutPending.vue'

/**
 * 「浮名」(fume) 皮肤 —— Folia `fume` 面板的 Vue 重写。
 *
 * ## 一句话结构
 *
 * 一整块 canvas（`FumeStage`）：背景是围绕文字纸张的手绘装饰形状，正文是
 * 逐字素"打印"出来的文章。相机跟着打印光标在世界里移动，唱到结尾会拉远看全貌。
 *
 * ## 本文件只做**组装**
 *
 * 四个部分各有归宿，本层只负责把它们接起来（§15.1 的层划分）：
 * - 数据归一化：`fume-adapter.ts`（`LyricLine` → `FumeLine`，毫秒口径统一）
 * - 排版调度：`use-fume-layout.ts`（§7.9 的 rAF → 防抖 → 版本号，含缓存）
 * - 每帧绘制：`use-fume-stage.ts`（§11.3 的七步流程，含相机与背景）
 * - 主题与调参：`shared/use-folia-palette` + `fume-adapter.ts` 的 `FUME_*` 常量
 *
 * ## ⚠️ 本面板没有设置（用户 2026-10-14 拍板）
 *
 * 与「流光」「倾诉」同款取舍：外观全部固定，不读 store 里的面板外观字段。
 * 所有档位来自 `fume-adapter.ts` 的 `FUME_*` 常量。
 * 仍然跟随的沉浸页通用项：明暗主题、专辑主色、底栏四项、演示模式、歌词偏移。
 *
 * ## 为什么自己铺一层纯色底
 *
 * Folia 的浮名会把外壳几何背景关掉（`disableGeometricBackground`，§12.6），
 * 只留一层 `theme.backgroundColor`。本项目没有那套外壳背景注册表，所以由皮肤
 * 自己铺 —— 不铺的话会直接透出沉浸页原有的背景，观感完全不对。
 */

/**
 * 皮肤契约要求的 `ctx`。
 *
 * ⚠️ F3（只有背景）**还用不到**它，但必须声明：Vue 对「未声明的 prop」会把值落到
 * 根元素上变成 DOM 属性（`ctx="[object Object]"`）。F4 起相机与揭示会读
 * `ctx.currentLineIndex()` / `ctx.isPlaying()`，届时直接在这里调用即可。
 */
const props = defineProps<{ ctx: SkinContext }>()

const player = usePlayerStore()
const lyric = useLyricStore()
/**
 * 面板配色 —— 逐歌主题（从封面推出来，每首歌不同；口径见 `shared/use-folia-palette`）。
 * `lyricLines` 只用于挑**关键词**（逐词配色），封面色盘与歌词无关。
 */
const { palette, isDaylight, wordColors } = useFoliaPalette({
  coverUrl: computed(() => props.ctx.coverUrl()),
  songId: computed(() => player.currentItem?.song.id ?? null),
  // 只给整行文本：候选词的切分口径收在 keyword-colors 里
  // （⚠️ 别把 `line.words` 传进去 —— 那是按字符切的，见那边的说明）
  lyricLines: computed(() => lyric.lines.map((line) => ({ text: line.text })))
})
/**
 * 行源：store 的原始行 + 长空窗里补出的插曲行（`......`）。
 *
 * ⚠️ 上游浮名**同样**会把这些插曲行排进文章（`attachInterludes` 在解析层就补好了，
 * 浮名只是照常排版），所以这里不能跳过 —— 少了它们，长间奏期间纸上会空一块，
 * 而官网演示里会有一串放大的点被"打印"出来。
 *
 * 三方（时钟 / 排版 / 副字幕）必须用同一个数组，见 `use-smooth-clock` 的说明。
 */
const lines = computed(() => attachInterludeLines(lyric.lines, player.durationMs))
/** 逐帧时钟：相机跟随打印光标要求「每帧都有时间」，4Hz 的 store 值不够 */
const clock = useSmoothClock({ lines })

/**
 * 内置衬线字体（`FOLIA_SERIF_FAMILY`）的就绪信号 —— 它一变就**清片段测量缓存**。
 *
 * 为什么必须清：`measureSegmentGlyphOffsets` 按 `(字体串, 文本)` 缓存，而字体文件
 * 加载完成**不改变字体串**（同一个栈从兜底字形换成真字形）。不清的话这次重测只会
 * 把同一个键再问一遍，拿回兜底字量出的旧宽度，排版永久按错误宽度摆着 ——
 * 不报错、不白屏，只是字号一直偏小（与「倾诉」`use-tilt-layout.ts` 同源）。
 *
 * ⚠️ `flush: 'sync'`：清缓存必须发生在排版重算**之前**，否则这一轮又是空转。
 * 重排本身不需要在这里触发 —— 就绪状态并进了 `layoutTheme`（见下）。
 */
const { fontState } = useFoliaSerifReady()
watch(fontState, clearSegmentMeasureCache, { immediate: true, flush: 'sync' })

/**
 * 本面板的主题视图（`FumeTheme`）。字段来源与「流光」同一套口径
 * （见 `shared/use-folia-palette.ts` 的映射表），只有 `name` 是浮名特有的：
 * 它参与背景种子与排版缓存键。
 *
 * `animationIntensity` 固定 `'normal'`：本面板没有设置面板，而强度档只影响
 * 辉光基量（§8.1）。
 *
 * `wordColors` 来自逐歌主题（`useFoliaPalette` 的第三个返回值）——
 * 关键词由本地规则从整首歌的歌词里挑出，颜色跟着封面走（见
 * `shared/song-theme/keyword-colors.ts`）。上游这一项来自 AI 主题生成，
 * 本项目用确定性规则替代，外观契约不变：命中关键词的词用它的颜色，
 * 未命中回退到 `accentColor`。
 */
const theme = computed<FumeTheme>(() => ({
  name: isDaylight.value ? 'daylight' : 'midnight',
  primaryColor: palette.value.primary,
  accentColor: palette.value.accent,
  secondaryColor: palette.value.secondary,
  fontStyle: 'serif',
  animationIntensity: 'normal',
  wordColors: wordColors.value
}))

/**
 * 参与排版缓存键的主题切片（§7.1）。**刻意不是整个 `theme`**：
 * 数组里只有字体这一项，颜色与强度变化不会让整首诗重排
 * （否则主题色过渡期间会每帧都命中不了缓存）。
 */
const layoutTheme = computed<FumeLayoutThemeKey>(() => ({
  name: theme.value.name,
  fontStyle: theme.value.fontStyle,
  fontFamily: theme.value.fontFamily,
  fontFamilyStack: theme.value.fontFamilyStack,
  fontWeight: theme.value.fontWeight
}))

/** 舞台逻辑尺寸（由 `FumeStage` 的 resize 事件驱动） */
const stageSize = ref<FumeStageSize>({ width: 0, height: 0 })
/** canvas 上下文（挂载后由 `FumeStage` 交出，卸载时置回 null） */
const context = shallowRef<CanvasRenderingContext2D | null>(null)
/** canvas 元素（位图尺寸 / DPR 变换的唯一权威在绘制层，见 `FumeStage.vue`） */
const canvas = shallowRef<HTMLCanvasElement | null>(null)

/**
 * 播放态 —— **必须是 ref**：暂停时绘制层会停止排帧（§16.4），
 * 靠它的变化把循环重新唤醒（见 `use-fume-stage` 的 `schedule`）。
 */
const isPlaying = computed(() => player.state === 'playing')

/**
 * 归一化后的整首歌（`FumeLine[]`）。**下游全部读这一份**：
 * 排版（§7.7 要看整篇）、缓存键（§7.1 的行指纹）、快照（§8.4 的 `renderHints`）。
 *
 * ⚠️ 依赖 `player.durationMs`：末行的结束时间用它推算（§15.2）。时长从 0 变成真实值
 * 时会重算一次 —— 那次重排是必要的，否则末行的拖尾窗口按 5 秒兜底算，唱到曲末会提前变暗。
 */
const fumeLines = computed(() => toFumeLines(lines.value, player.durationMs))

/**
 * 文章排版（§7.9）。入参 `lines` 是 `fumeLines`，视口是舞台逻辑尺寸 ——
 * 也就是排版与绘制用**同一个**尺寸来源（`FumeStage` 的 resize 事件），
 * 不会出现「画布已按新尺寸画、排版还用旧尺寸」的帧。
 */
const { article, isLayoutPending, isViewportRefreshPending } = useFumeLayout({
  lines: fumeLines,
  viewport: stageSize,
  layoutTheme,
  lyricsFontScale: computed(() => FUME_LYRICS_FONT_SCALE),
  heroScale: computed(() => FUME_HERO_SCALE),
  fontKey: fontState
})

/**
 * 画布之外那一层（副字幕 / 空态 / 加载卡配色）全部在 `use-fume-overlay.ts` ——
 * 那一段的输入（当前行、字号档、调色板）与画布那一段（文章 / 场景 / 相机）无关，
 * 拆开既守住 AGENTS.md 的 400 行上限，也让"哪一段属于画布"一眼可见。
 */
const {
  emptyState,
  subtitleRows,
  upcomingPreview,
  subtitleFontSize,
  upcomingFontSize,
  emptyFontSize,
  overlayStyleVars
} = useFumeOverlay({
  ctx: props.ctx,
  clock,
  lines,
  palette,
  // resize 时旧文章仍会继续画，不算「没有内容」：只有真正切歌 / 首排才让空态让位。
  isLayoutPending: computed(() => isLayoutPending.value && !isViewportRefreshPending.value),
  hasArticle: computed(() => article.value !== null)
})

/**
 * 背景场景（§7.10）。`world` 就是文章尺寸；没有文章时用视口 ×1.8 兜底，
 * 于是前奏期间背景照常转动（§16.4 的唯一空转场景）。
 */
const backgroundScene = computed(() =>
  buildFumeBackgroundScene({
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
)

/** 总览镜头（§9.4）：把整页区块装进视口；没有文章时为 null */
const overviewCamera = computed(() =>
  article.value ? resolveArticleOverviewCamera(article.value, stageSize.value) : null
)

/**
 * 总览开始时刻（§7.10）：**最后一条可渲染行的起止中点**，不是唱完。
 * 提前起飞让最后的字在镜头拉远的过程中继续打印 —— 这是浮名收尾的招牌动作。
 */
const overviewStartTimeMs = computed(() => {
  const current = article.value
  if (!current) return Number.POSITIVE_INFINITY
  for (let index = current.chronologicalBlocks.length - 1; index >= 0; index -= 1) {
    const line = current.chronologicalBlocks[index].line
    if (line.fullText.trim().length === 0) continue
    return line.startTimeMs + Math.max(getLineRenderEndTimeMs(line) - line.startTimeMs, 0) * 0.5
  }
  return Number.POSITIVE_INFINITY
})

/**
 * 每帧绘制循环（§11.3）。它内部自己起 rAF，`playing` 的变化会唤醒它（§16.4）。
 */
useFumeStage({
  context,
  canvas,
  size: stageSize,
  theme,
  article,
  backgroundScene: computed(() => backgroundScene.value),
  overviewCamera,
  overviewStartTimeMs,
  cameraSpeed: FUME_TUNING.cameraSpeed,
  cameraTrackingMode: FUME_TUNING.cameraTrackingMode,
  glowIntensity: FUME_TUNING.glowIntensity,
  showPrintStamp: FUME_SHOW_PRINT_STAMP,
  textHoldRatio: FUME_TUNING.textHoldRatio,
  backgroundOpacityMultiplier: FUME_BACKGROUND_OPACITY_MULTIPLIER,
  currentTimeMs: () => clock.time(),
  audioLevels: () => toFumeAudioLevels(clock.bands()),
  /**
   * 相机焦点用的行下标 —— **必须与 `article` 同源**。
   *
   * 文章是按 `fumeLines` 排的，而 `fumeLines` 来自**补过插曲行**的 `lines`
   * （见上面 `lines` 的说明），所以 `article.blockBySourceLineIndex` 的键是
   * **含插曲行的那一份数组**的下标。
   *
   * ⚠️ 不能用 `props.ctx.currentLineIndex()`：它数的是 store 的**原始行**
   * （`useActiveLyricIndex` 只遍历 `lyric.lines`），两者在**有插曲行的歌**上
   * 会差出「当前行之前有几个插曲行」那么多格 —— 相机于是停在前面的某一句上，
   * 而纸上的打印已经走到后面去了。表现就是「歌词跟歌曲进度对不上」，
   * 且只在这类歌曲上出现（`attachInterludeLines` 只补 >3s 的空窗）。
   *
   * 逐帧时钟的行下标与 `lines` 是同一个数组、同一个 rAF 里算出来的，
   * 是唯一正确的来源（「流光」的 `useSkinActiveLine` 走的就是它）。
   */
  currentLineIndex: () => clock.currentLineIndex(),
  onPrintedContent: handlePrintedContent,
  playing: isPlaying,
  /**
   * 恒定 `false`：`staticMode` 在上游是「OBS 静态截图 / 背景静止档」，
   * 本项目没有这条业务分支。**不要**拿演示模式（`presentationMode`）来接 ——
   * 那是「鼠标静止时隐藏控制条」，与背景动不动是两件事，接上会让用户一进
   * 演示模式整个画面就停住。与「流光」的 `GlowBackground` 是同一条取舍。
   */
  staticMode: computed(() => false)
})

/**
 * 首个区块开始打印时的入场动画（§17.1 第 5 条）。
 *
 * `hasPrintedContent` 的标志位由 `use-fume-stage` 持有并在文章变化时重置，
 * 本回调是**每次播放只触发一次**的那一侧 —— 所以这里只做视觉动作。
 *
 * ⚠️ 用 `requestAnimationFrame` 把类名切换推到下一帧：这是「CSS 过渡需要一个
 * 不同的初始状态」的标准做法（元素先以 `is-printed=false` 渲染一帧，再切到 true，
 * 过渡才会真的播）。同步切换的话浏览器会把两个状态合并成一次样式计算，动画不出现。
 */
const hasPrinted = ref(false)
let printedFrameId: number | null = null

function handlePrintedContent(): void {
  // ⚠️ 裸调的 `requestAnimationFrame` 会被 no-undef 拦下（只有 `.ts` 文件里不会）
  if (printedFrameId !== null) window.cancelAnimationFrame(printedFrameId)
  printedFrameId = window.requestAnimationFrame(() => {
    printedFrameId = null
    hasPrinted.value = true
  })
}

onBeforeUnmount(() => {
  if (printedFrameId !== null) window.cancelAnimationFrame(printedFrameId)
  printedFrameId = null
})

/**
 * 频带换算：逐帧时钟的六频带（0–1）→ Folia 的 0–255（§13.2）。
 *
 * ⚠️ **不要**在这里再做加权映射：`shared/use-smooth-clock.ts` 的 `bands()` 已经把
 * 本项目的四频带（low/mid/high/power）**近似映射**成 Folia 的六频带
 * （`toSkinBands`：bass/lowMid/mid/vocal/treble/power），与背景宿主的
 * `backgrounds/folia/shared/audio-bands.ts` 是同一套口径。这里只做量纲放大。
 *
 * 也不做噪声门：门限 `(v - 10) / 190` 在绘制层（`render/background.ts`）——
 * 它是「怎么用」而不是「量纲是什么」。与「流光」接 latent 背景时同一分工。
 *
 * `bass` 与 `power` 会被传进去但浮名**从不读取**（§13.1 表格已确认），
 * 保留字段是为了让「传了但没用」这件事看得见，而不是让人以为漏了。
 */
function toFumeAudioLevels(bands: SkinAudioBands): FumeAudioLevels {
  return {
    bass: toFoliaScale(bands.bass),
    lowMid: toFoliaScale(bands.lowMid),
    mid: toFoliaScale(bands.mid),
    vocal: toFoliaScale(bands.vocal),
    treble: toFoliaScale(bands.treble),
    power: toFoliaScale(bands.power)
  }
}

/** 主题纯色底（`theme.backgroundColor` 的等价物） */
/**
 * 皮肤根的内联变量：底色 / 字体 + 共享组件要读的那几个（见 `use-fume-overlay`）。
 *
 * 底色与字体在**这一层**给（而不是也塞进 overlay hook）：它们是皮肤根自己的外观，
 * 与"字幕/空态要什么变量"不是同一件事。
 */
const stageStyle = computed<Record<string, string>>(() => ({
  backgroundColor: palette.value.background,
  fontFamily: `"${FOLIA_SERIF_FAMILY}", serif`,
  ...overlayStyleVars.value
}))

/**
 * 调试可读面：把当前主题与调参暴露出去，方便在真机里核对
 * （与「流光」的 `defineExpose` 同一种做法）。
 */
defineExpose({
  theme,
  tuning: FUME_TUNING,
  accentWithAlpha: (alpha: number) => colorWithAlpha(theme.value.accentColor, alpha)
})
</script>

<template>
  <div class="fume-root" :style="stageStyle">
    <FumeStage
      @ready="
        (ctx, canvasEl) => {
          context = ctx
          canvas = canvasEl
        }
      "
      @resize="(size) => (stageSize = size)"
    >
      <!-- 空态：居中一层（宿主的 flex 静态定位，见 shared/skin-empty.scss） -->
      <div
        v-if="emptyState && !(isLayoutPending && !isViewportRefreshPending)"
        class="fume-empty-layer"
      >
        <SkinEmptyState :state="emptyState" :font-size="emptyFontSize" />
      </div>

      <!-- 正在排版：盖在空态之上（切歌瞬间两者会同时满足条件，卡优先） -->
      <Transition name="fume-pending-fade">
        <FumeLayoutPending v-if="isLayoutPending && !isViewportRefreshPending" />
      </Transition>

      <!-- 底部副字幕（罗马音 / 译文，或"接下来两句"预览）：不吃事件 -->
      <SkinSubtitle
        :rows="subtitleRows"
        :preview="upcomingPreview"
        :background="palette.background"
        :color="palette.secondary"
        :opacity="FUME_SUBTITLE_OVERLAY_OPACITY"
        :translation-font-size="subtitleFontSize"
        :upcoming-font-size="upcomingFontSize"
      />
    </FumeStage>
  </div>
</template>

<style scoped lang="scss" src="./fume.scss"></style>
