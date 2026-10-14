<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'

import { usePlayerStore } from '@/stores/player.store'
import { useFoliaPalette } from '../shared/use-folia-palette'
import { useSmoothClock, type SkinAudioBands } from '../shared/use-smooth-clock'
import { FOLIA_SERIF_FAMILY } from '../shared/folia-font'
import { colorWithAlpha } from '../shared/color-mix'
import { toFoliaScale } from '../../backgrounds/folia/shared/audio-bands'
import type { SkinContext } from '../types'
import type { FumeAudioLevels, FumeTheme } from './core/fume-types'
import {
  FUME_BACKGROUND_OPACITY_MULTIPLIER,
  FUME_TUNING,
  resolveFumeBackgroundSeed
} from './fume-adapter'
import FumeStage from './components/FumeStage.vue'
import { useFumeBackground, type FumeStageSize } from './use-fume-background'

/**
 * 「浮名」(fume) 皮肤 —— Folia `fume` 面板的 Vue 重写。
 *
 * ## 一句话结构
 *
 * 一整块 canvas（`FumeStage`）：背景是围绕文字纸张的手绘装饰形状，正文是
 * 逐字素"打印"出来的文章。相机跟着打印光标在世界里移动，唱到结尾会拉远看全貌。
 *
 * ## ⚠️ 本阶段（F3）只有背景
 *
 * 按规格书 §19 的实施顺序，F3 = `render/background.ts` + 一个**只有背景**的
 * 皮肤根。文章排版（F2，子代理在做）、静态快照（F4）、实时逐字绘制（F5）、
 * 相机步进（F6）、字幕与空态（F7）都不在这里 —— 所以现在看到的画面是
 * 「背景形状 + 主题纯色底」，**这是预期的中间状态**，不是缺渲染。
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
defineProps<{ ctx: SkinContext }>()

const player = usePlayerStore()
const { palette, isDaylight } = useFoliaPalette()
/** 逐帧时钟：相机跟随打印光标要求「每帧都有时间」，4Hz 的 store 值不够 */
const clock = useSmoothClock()

/**
 * 本面板的主题视图（`FumeTheme`）。字段来源与「流光」同一套口径
 * （见 `shared/use-folia-palette.ts` 的映射表），只有 `name` 是浮名特有的：
 * 它参与背景种子与排版缓存键。
 *
 * `animationIntensity` 固定 `'normal'`：本面板没有设置面板，而强度档只影响
 * 辉光基量（§8.1）。`wordColors` 恒为空（本项目不做逐词配色，见
 * `shared/word-coloring.ts`）。
 */
const theme = computed<FumeTheme>(() => ({
  name: isDaylight.value ? 'daylight' : 'midnight',
  primaryColor: palette.value.primary,
  accentColor: palette.value.accent,
  secondaryColor: palette.value.secondary,
  fontStyle: 'serif',
  animationIntensity: 'normal',
  wordColors: []
}))

/** 舞台逻辑尺寸（由 `FumeStage` 的 resize 事件驱动） */
const stageSize = ref<FumeStageSize>({ width: 0, height: 0 })
/** canvas 上下文（挂载后由 `FumeStage` 交出，卸载时置回 null） */
const context = shallowRef<CanvasRenderingContext2D | null>(null)
/** canvas 元素（位图尺寸 / DPR 变换的唯一权威在绘制层，见 `FumeStage.vue`） */
const canvas = shallowRef<HTMLCanvasElement | null>(null)

/**
 * 播放态 —— **必须是 ref**：暂停时绘制层会停止排帧（§16.4），
 * 靠它的变化把循环重新唤醒（见 `use-fume-background` 的 `schedule`）。
 */
const isPlaying = computed(() => player.state === 'playing')

/**
 * 文章世界尺寸 —— **还没有**（F2 的排版未接入）。
 * 按 §7.10 的兜底：视口 ×1.8。于是背景走「无文章」分支，
 * 时间轴叠墙钟漂移，相机停在世界中心。
 */
const world = ref<{ width: number; height: number } | null>(null)
const paperBounds = ref<{ left: number; top: number; right: number; bottom: number } | null>(null)

/** 相机停在舞台中心：F3 还没有相机（F6 接管） */
const cameraX = computed(() => stageSize.value.width / 2)
const cameraY = computed(() => stageSize.value.height / 2)

/** 背景种子：含主题名，换主题重掷一套形状（见 `fume-adapter`） */
const seed = computed(() => resolveFumeBackgroundSeed(undefined, theme.value.name))

useFumeBackground({
  context,
  canvas,
  size: stageSize,
  theme,
  world,
  paperBounds,
  seed,
  cameraX,
  cameraY,
  originX: cameraX,
  originY: cameraY,
  currentTimeMs: () => clock.time(),
  audioLevels: () => toFumeAudioLevels(clock.bands()),
  playing: isPlaying,
  opacityMultiplier: FUME_BACKGROUND_OPACITY_MULTIPLIER,
  /**
   * 恒定 `false`：`staticMode` 在上游是「OBS 静态截图 / 背景静止档」，
   * 本项目没有这条业务分支。**不要**拿演示模式（`presentationMode`）来接 ——
   * 那是「鼠标静止时隐藏控制条」，与背景动不动是两件事，接上会让用户一进
   * 演示模式背景就整个消失。与「流光」的 `GlowBackground` 是同一条取舍。
   */
  staticMode: computed(() => false)
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
const stageStyle = computed(() => ({
  backgroundColor: palette.value.background,
  fontFamily: `"${FOLIA_SERIF_FAMILY}", serif`
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
    />
  </div>
</template>

<style scoped lang="scss" src="./fume.scss"></style>
