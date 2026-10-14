<script setup lang="ts">
import FoliaBackground from '@/features/immersive/backgrounds/folia/FoliaBackground.vue'
import type { FoliaBackgroundMode } from '@/features/immersive/backgrounds/folia/types'
import type { SmoothClock } from '../shared/use-smooth-clock'
import type { FoliaPalette } from '../shared/use-folia-palette'

/**
 * 「流光」的背景层 —— Folia 的 **`latent` 模式**（本面板的固定背景，不带设置）。
 *
 * ## 为什么是 latent
 *
 * Folia 的 `classic`（= 本项目「流光」）默认走 `latent`：一层封面取色的
 * `mesh-gradient` + 一层 `dithering` 颗粒，速度与色彩都跟着音频能量走。
 * 本项目用户定的规则是「背景 1:1 还原原项目」+「不带设置」，所以这里**写死 latent**，
 * 不读 `settings.backgroundType`。
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
 * 2. **明暗**：`latent` 的调色盘取自封面，深浅由 `isDaylight` 决定反色方向。
 *    判据是底色本身（浅色档的底色是 `#f5f5f4`），不是设置面板 —— 本面板没有那个入口。
 * 3. **暂停**：`paused` 在 latent 里是「音频归零 + 速度降到 12%」，不是停帧
 *    （见背景宿主的 props 说明）。所以暂停时背景仍在缓慢流动，与上游一致。
 *
 * ## 为什么 `staticMode` 不传
 *
 * 它会让 latent 完全停帧且不建 rAF。本项目的沉浸页在窗口失焦时仍然出帧
 * （`backgroundThrottling: false`），没有「首页且关了动态背景」这条业务分支，
 * 所以恒定 `false`（= 用默认值）。将来若要接「省电模式」，从设置里读一个布尔传下来即可。
 */

/** 流光固定用 latent（见文件头）。写成常量而不是内联字面量：这是本面板的**身份**之一 */
const GLOW_BACKGROUND_MODE: FoliaBackgroundMode = 'latent'

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
    :audio-power="() => props.clock.bands().power"
    :audio-bands="() => props.clock.bands()"
  />
</template>
