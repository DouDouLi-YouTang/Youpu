<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import { colorWithAlpha } from '../shared/color-mix'
import FoliaSkinBackground from '../shared/FoliaSkinBackground.vue'
import SkinEmptyState from '../shared/SkinEmptyState.vue'
import SkinSubtitle from '../shared/SkinSubtitle.vue'
import type { SkinContext } from '../types'
import {
  FUME_BACKGROUND_OPACITY_MULTIPLIER,
  FUME_SHOW_PRINT_STAMP,
  FUME_TUNING
} from './fume-adapter'
import { FUME_SUBTITLE_OVERLAY_OPACITY, useFumeOverlay } from './use-fume-overlay'
import { useFumeStage } from './use-fume-stage'
import { useFumeTheme } from './use-fume-theme'
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
 * ## 设置
 *
 * 使用 Folia 三主题共享的 `settings.folia`：明暗、配色方案、副歌词档位、
 * 背景模式、逐词着色。排版 / 相机 / 打印参数仍来自 `fume-adapter.ts` 的 `FUME_*` 常量。
 * 跟随的沉浸页通用项：专辑主色、底栏四项、演示模式、歌词偏移。
 *
 * ## 原生背景与覆盖背景
 *
 * Folia 的浮名会把外壳几何背景关掉（`disableGeometricBackground`，§12.6），
 * 只留一层 `theme.backgroundColor`。原生档仍由画布绘制手绘纸面，并由皮肤根铺
 * `theme.backgroundColor`；用户选择覆盖背景时，画布背景场景设为 `null`，根节点
 * 透明，由 `FoliaSkinBackground` 提供背景，canvas 只负责歌词文字。
 */

/**
 * 皮肤契约要求的 `ctx`。
 *
 * ⚠️ F3（只有背景）**还用不到**它，但必须声明：Vue 对「未声明的 prop」会把值落到
 * 根元素上变成 DOM 属性（`ctx="[object Object]"`）。F4 起相机与揭示会读
 * `ctx.currentLineIndex()` / `ctx.isPlaying()`，届时直接在这里调用即可。
 */
const props = defineProps<{ ctx: SkinContext }>()

const {
  palette,
  isDaylight,
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
  overviewCamera,
  overviewStartTimeMs,
  stageStyle,
  toAudioLevels
} = useFumeTheme({ ctx: props.ctx })

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
  audioLevels: () => toAudioLevels(clock.bands()),
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

/** 皮肤根的内联变量：主题层 + 共享组件要读的 overlay 变量 */
const rootStyle = computed<Record<string, string>>(() => ({
  ...stageStyle.value,
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
  <FoliaSkinBackground
    :cover-url="ctx.coverUrl()"
    :palette="palette"
    :is-daylight="isDaylight"
    :paused="!ctx.isPlaying()"
    :clock="clock"
  >
    <!-- 原生档：画布自己画手绘纸面背景，这一层不需要额外背景 -->
  </FoliaSkinBackground>

  <div class="fume-root" :style="rootStyle">
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
