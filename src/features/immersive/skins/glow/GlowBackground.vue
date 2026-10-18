<script setup lang="ts">
import FoliaBackground from '@/features/immersive/backgrounds/folia/FoliaBackground.vue'
import type { FoliaBackgroundMode } from '@/features/immersive/backgrounds/folia/types'
import type { SmoothClock } from '../shared/use-smooth-clock'
import type { FoliaPalette } from '../shared/use-folia-palette'

/**
 * 「流光」的背景层 —— Folia 的 **`common` 模式**（本面板的默认背景）。
 *
 * ## 为什么是 common
 *
 * 「背景 1:1 还原原项目」是用户定的规则，而原项目的**官方演示图**
 * （`img/preview-lumi.png`，也就是 README 里「流光」那一格）用的就是 `common`：
 * 深色主题底 + 一层封面取色的流体底 + 一层几何形状（三角 / 圆 / 星 / 火花）+ 暗角。
 * 证据是上游的版本史：那张图提交于 `8f74ab4b`（2026-05-13），
 * 当时**还没有**背景注册表 —— `common` 的三层是直接写在 `VisualizerShell.tsx` 里的，
 * 也就是所有模式共享的唯一背景；`DEFAULT_VISUALIZER_BACKGROUND_MODE = 'latent'`
 * 直到 `c80a2927`（2026-09-02）才出现。所以「流光 = latent」是后来才成为默认的，
 * 与官网演示图不是一回事（这正是用户说的「跟官网演示完全不一样」）。
 *
 * 本项目用户要的是**演示图那个观感**，所以原生档固定 `common`。用户改背景时由外层
 * `FoliaSkinBackground` 换掉本组件，不在这里接管整套背景设置。
 *
 * ## 流体底与几何层都开着
 *
 * `common` 的两个开关取上游 shell 的默认值：`useCoverColorBg = false`
 * （流体底不显示）、几何层显示。演示图里那层「流动色块」其实是**主题底色 + 几何形状**
 * 的组合，不是流体封面底 —— 所以流体底保持关闭才是 1:1。
 *
 * 背景本体（6 种模式、注册表、降级链）在 `features/immersive/backgrounds/folia/`，
 * 那是与「经典」皮肤那套背景**并存**的另一套实现 —— 这里只做适配。
 *
 * ## 这一层适配了什么
 *
 * 1. **音频**：本项目时钟的 `bands()` 是四频带 0–1，Folia 的公式吃五频带 0–255。
 *    换算是宿主 `shared/audio-bands.ts` 的事，所以这里直接传 `() => clock.bands()`
 *    并保持默认的 `audio-scale="0-1"` —— **不要**在这里先除 255 或先乘 255，
 *    那会把量纲换算变成两处。
 * 2. **明暗**：几何层与暗角的取色由 `isDaylight` 决定反色方向。
 * 3. **暂停**：几何层的漂移照常（本项目刻意的差异，见 `backgrounds/GeometricBackground.vue`
 *    的文件头），频带缩放回到静止档。
 *
 * ## 为什么 `staticMode` 不传
 *
 * 它会让背景完全停帧且不建 rAF。本项目的沉浸页在窗口失焦时仍然出帧
 * （`backgroundThrottling: false`），没有「首页且关了动态背景」这条业务分支，
 * 所以恒定 `false`（= 用默认值）。将来若要接「省电模式」，从设置里读一个布尔传下来即可。
 */

/** 流光固定用 common（见文件头）。写成常量而不是内联字面量：这是本面板的**身份**之一 */
const GLOW_BACKGROUND_MODE: FoliaBackgroundMode = 'common'

const props = defineProps<{
  coverUrl: string | null
  palette: FoliaPalette
  /** 浅色主题（由 `useFoliaPalette` 解析明暗档得到） */
  isDaylight: boolean
  paused: boolean
  clock: SmoothClock
}>()
</script>

<template>
  <FoliaBackground
    :mode="GLOW_BACKGROUND_MODE"
    :cover-url="props.coverUrl"
    :palette="props.palette"
    :is-daylight="props.isDaylight"
    :paused="props.paused"
    :seed="props.coverUrl ?? 'default'"
    :audio-power="() => props.clock.bands().power"
    :audio-bands="() => props.clock.bands()"
  />
</template>
