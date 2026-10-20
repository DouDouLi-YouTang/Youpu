<script setup lang="ts">
import { computed } from 'vue'

import GeometricBackground from '../../GeometricBackground.vue'
import { DEFAULT_COMMON_BACKGROUND_OPACITY } from '../shared/host-props'
import type { FoliaPaperBounds, FoliaTheme } from '../types'
import { resolveCommonGeometryStyle, resolveCommonLayerPlan } from './common-layer-plan'
import FluidCoverLayer from './FluidCoverLayer.vue'

/**
 * common 模式 —— 流体封面底 + 主题底色层 + 几何层（规格 §2.1）。
 *
 * ## 层序（DOM 顺序 = 层叠顺序，自下而上）
 *
 *  1. `useCoverColorBg` 为真时的流体封面底（进场 1s 淡入）
 *  2. **主题底色层**：`opacity = useCoverColorBg ? (opacity ?? 0.75) : 1`，带 1s 过渡
 *  3. `!staticMode` 时的几何层（含它自带的暗角）
 *
 * 关键理解：**第 2 层压在第 1 层上面**。「打开封面取色」不是把底色删掉，而是把主题底色
 * 以 75% 不透明度盖在流体底上 —— 这就是「染色/压暗」的来源。反过来说：
 * 谁把第 2 层的 `opacity` 无条件写成 1，整个流体底就完全看不见了。
 *
 * ## 三条与 Folia 一致、容易被「顺手优化」掉的点
 *
 * - `staticMode` 是**移除整个几何层**，不是暂停它；`paused` 才是把几何层切成静态快照。
 *   两者是两回事，必须分开落位（规格 §2.3.9 末段）。
 * - 第 2 层的 `opacity` 用 `?? 0.75` 而不是 `|| 0.75`：`opacity = 0` 是合法值
 *   （完全隐藏底色）且必须生效。
 * - 第 2 层带 1s 过渡：改主题色或改 opacity 时是渐变而不是硬切。
 *
 * ## 几何层用的是本仓库已有的独立重写（规格 §10.5）
 *
 * `backgrounds/GeometricBackground.vue`（+ `geometric-model.ts`）是 common 几何层的
 * **既有重写**：确定性种子、CSS keyframes 而非 framer-motion、暂停时不冻结。
 * 这些差异是**有意为之，不要「修正」**。它自己读 player store 与全局 `audioBands`，
 * 所以这一层只做三件事：
 *
 *  1. `disableGeometricBackground` → **整层不挂载**（对应它的 `hideShapes` 语义）；
 *  2. `disableVignette` → 通过 `vignette-placement` 让几何层别画它内部那层暗角。
 *     ⚠️ 浮名传了 `paperBounds` 时几何层被收窄到纸张矩形，暗角**不能**留在几何层里
 *     （会被 `overflow: hidden` 裁在纸张边界上，纸张内外亮度断层 = 一圈背景边界），
 *     这一档由 `vignette-placement = 'viewport'` 表示，改由宿主铺满视口绘制。
 *     两处判断同源，见 `resolveCommonVignettePlacement`。
 *  3. **把逐歌主题交给它，并让它别自铺底色**（`theme` / `:paint-background="false"`）。
 *
 * ## 为什么几何层不能自铺底色（2026-10-14 修正）
 *
 * Folia 的几何层是**透明**的 —— 底色一律由外壳的主题底色层负责（就是上面第 2 层）。
 * 本仓库的几何层却自铺了 `--rnp-accent-color-bg`（**全局主色系**的底色），那是给
 * 「几何背景」皮肤用的（那一层确实没有独立的底色层）。
 *
 * 于是 common 层出现了「每首歌底色都一样」：几何层那块全局主色底把上面第 2 层的
 * **逐歌主题底色**整块盖住了。实测同一首歌里 `.folia-common-background` 是
 * `rgb(45,33,17)`（歌曲主题）、`.rnp-background-geometric` 却是 `rgb(52,49,23)`
 * （全局主色），用户看到的是后者。
 *
 * 同一个原因还让形状/粒子的取色错位：它们取的是全局主色，不是这首歌的主题色，
 * 于是「形状与底色不配套」。传 `theme` 之后两者都跟着歌曲走。
 */
const props = defineProps<{
  theme: FoliaTheme
  coverUrl: string | null
  isDaylight: boolean
  paused: boolean
  staticMode?: boolean
  /**
   * 几何层的重掷种子。**本组件收下但不用** —— 本仓库的几何层自己按当前歌曲 id
   * 折叠出种子（`resolveGeometricSeed`），比外部传进来的更稳（切皮肤/暂停不会重掷）。
   * 收这个 prop 是为了让宿主的名字表保持统一，删掉它反而会让「谁负责种子」变得含糊。
   */
  seed: string | number
  useCoverColorBg: boolean
  coverColorOpacity: number
  disableGeometricBackground: boolean
  disableVignette: boolean
  /** 浮名覆盖背景的几何构图边界；其它调用方不传即铺满世界。 */
  paperBounds?: FoliaPaperBounds
}>()

/** 三层的落位判断全在 common-layer-plan.ts（每条都对应一个「写错了也不报错」的坑） */
const plan = computed(() =>
  resolveCommonLayerPlan({
    useCoverColorBg: props.useCoverColorBg,
    coverColorOpacity: props.coverColorOpacity,
    staticMode: props.staticMode === true,
    disableGeometricBackground: props.disableGeometricBackground,
    disableVignette: props.disableVignette,
    paperBounds: props.paperBounds
  })
)

const backgroundLayerStyle = computed(() => ({
  backgroundColor: props.theme.backgroundColor,
  opacity: String(plan.value.backgroundOpacity)
}))

const geometryStyle = computed(() => resolveCommonGeometryStyle(props.paperBounds))

defineExpose({ plan, defaultOpacity: DEFAULT_COMMON_BACKGROUND_OPACITY })
</script>

<template>
  <div class="folia-common">
    <!-- 1. 流体封面底：进场 1s 淡入（Folia 的 motion.div initial/animate/exit opacity） -->
    <Transition name="folia-common-fluid-fade">
      <div v-if="plan.showFluid" class="folia-common-fluid">
        <FluidCoverLayer :cover-url="coverUrl" :theme="theme" />
      </div>
    </Transition>

    <!-- 2. 主题底色层：压在流体层之上，1s 过渡 -->
    <div class="folia-common-background" :style="backgroundLayerStyle" />

    <!-- 3. 几何层：staticMode 时整层消失（不是暂停） -->
    <div v-if="plan.showGeometric" class="folia-common-geometric" :style="geometryStyle">
      <!--
        `paint-background=false`：底色归上面第 2 层（逐歌主题），几何层必须透明，
        否则会把主题底色整块盖掉（见文件头）。
        `vignette-color` 固定黑：Folia 的暗角末色是 `rgba(0,0,0,.6)`，不跟随明暗翻转
        —— 那套翻转是「几何背景」皮肤为了浅色底才加的。
        这里给不透明黑而不是 `rgba(...,.6)`：样式表上那层已经有 `opacity: .6`，
        两处都写 0.6 会相乘成 0.36，暗角会明显偏淡。
        `vignette-placement` 与本文件的 plan 同源：几何层收窄到纸张时暗角由宿主在视口层画
        （见 `resolveCommonVignettePlacement`），这里只负责把几何层里那份关掉。
      -->
      <GeometricBackground
        :theme="theme"
        :paint-background="false"
        vignette-color="rgb(0, 0, 0)"
        :vignette-placement="plan.vignette"
      />
    </div>
  </div>
</template>

<style scoped>
.folia-common {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.folia-common-fluid,
.folia-common-background,
.folia-common-geometric {
  position: absolute;
  inset: 0;
}

/* 主题底色层的 1s 过渡：改主题色 / 改 opacity 时渐变而不是硬切 */
.folia-common-background {
  transition: all 1s;
}

.folia-common-fluid-fade-enter-active,
.folia-common-fluid-fade-leave-active {
  transition: opacity 1s ease-in-out;
}

.folia-common-fluid-fade-enter-from,
.folia-common-fluid-fade-leave-to {
  opacity: 0;
}
</style>
