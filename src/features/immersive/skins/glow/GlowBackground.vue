<script setup lang="ts">
import type { SmoothClock } from '../shared/use-smooth-clock'
import type { FoliaPalette } from '../shared/use-folia-palette'

/**
 * 「流光」的背景层 —— Folia 的 **`latent` 模式**（流光面板的固定背景，不带设置）。
 *
 * ## 为什么是 latent
 *
 * Folia 的 `classic`（= 本项目「流光」）面板默认走 `latent`：一层封面取色的
 * `mesh-gradient` + 一层 `dithering` 颗粒，速度与色彩都跟着音频能量走。
 * 本项目用户定的规则是「背景 1:1 还原原项目」+「不带设置」，所以这里**写死 latent**，
 * 不读 `settings.backgroundType`。
 *
 * ## 为什么单独一个文件而不是直接挂 `<FoliaBackground mode="latent">`
 *
 * 这一层承担**适配**：把（逐帧时钟、调色板、明暗）翻译成背景子系统要的 props 形状，
 * 并把 WebGL 不可用时的降级底色也放在这里。将来「浮名」要用另一套背景（它自带
 * canvas 背景，不经过这套注册表），两个皮肤各自持有自己的适配层，不互相牵动。
 *
 * ⚠️ 背景子系统的宿主组件在 `backgrounds/folia/FoliaBackground.vue`（另一个并行任务），
 * 接口见该目录的 types.ts。本组件只依赖它的公开 props。
 *
 * ## 五个 prop 为什么现在就全收
 *
 * 宿主组件到位后，`latent` 需要 `coverUrl`（封面取色）/ `paused`（暂停时降速不冻结）/
 * `isDaylight`（反色）/ `clock`（音频与时间驱动的来源）。契约先立在这里，
 * 换实现时**模板一行不改** —— 否则宿主到位那天还要回来改 props 与调用方。
 */

const props = defineProps<{
  coverUrl: string | null
  palette: FoliaPalette
  isDaylight: boolean
  paused: boolean
  clock: SmoothClock
}>()

// 宿主组件尚未接入时，这些 prop 还没有消费方。显式引用一次让 lint 与读者都能看到
// 「它们是有意保留的契约」而不是忘了用；接入后删掉这一段即可。
void [props.coverUrl, props.isDaylight, props.paused, props.clock]
</script>

<template>
  <div class="glow-background" :style="{ backgroundColor: palette.background }" />
</template>

<style scoped lang="scss" src="./glow-background.scss"></style>
