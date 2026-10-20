<script setup lang="ts">
import { HourglassOutlined } from '@ant-design/icons-vue'

/**
 * 「正在排版」加载卡（§7.9 / §14.2 的上游语义）。
 *
 * ## 为什么必须有这张卡
 *
 * 浮名的排版是**同步长任务**：列数 × 8 次二分 × 每块测量，几百行的歌可能跑几十到
 * 上百毫秒。上游把它挪到 `rAF + setTimeout` 之外（§7.9），于是「受理了请求但还没
 * 出结果」这段时间是真实存在的。没有卡的话，那段时间屏幕上是**空白纸面**，
 * 用户看到的是「这面板坏了」而不是「它在准备」。
 *
 * 首次排版延迟是 0ms（前奏不能空屏），所以这张卡正常只在**切歌后重排**时闪现
 * （96ms 防抖 + 排版耗时）。它闪一下是**正确行为**，不要为了"好看"把它删掉或加长。
 *
 * ## 为什么图标用 `@ant-design/icons-vue`
 *
 * 上游是 `lucide-react` 的 `Hourglass`，本项目没有 lucide（规格书 §17.2 明说：
 * 「`@ant-design/icons-vue` 的 `HourglassOutlined` 或纯 CSS 骨架」）。
 * 观感次要，**保留这张卡**才是重点 —— 它是「排版确实可能耗时」这条事实的可见化。
 *
 * ## 为什么骨架条是三根不同宽度
 *
 * 上游就是 100% / 78% / 56% 三根：等宽三根看起来像一个表格占位符，
 * 递减宽度才像"正在成形的段落"。颜色也分两档（前两根主色、最后一根次要色），
 * 让这张卡本身有一点层次，而不是一块灰。
 *
 * ## 进出场为什么交给父级的 `<Transition>`
 *
 * 上游用的是 `motion.div` 的 `initial/animate/exit`，但那套 `exit` 只有在
 * `AnimatePresence` 里才生效（`VisualizerFume` 里并没有包 —— 也就是说上游的退场
 * 其实是硬切）。本项目照规格书 §17.2 的建议改用 Vue 的 `<Transition>` + CSS：
 * 语义等价、少一个依赖，而且 0.2s 的淡出在"排版完成"这一刻本来就该是软的。
 *
 * ## 颜色从哪来
 *
 * 全部走 CSS 变量（`--fume-pending-*`），由 `SkinFume.vue` 从调色板注入 ——
 * 本组件不 import 调色板，避免"用哪个颜色"这件事在两层各有一个答案。
 */
</script>

<template>
  <div class="fume-pending-layer">
    <div class="fume-pending-card">
      <HourglassOutlined class="fume-pending-icon" />
      <div class="fume-pending-bars" aria-hidden="true">
        <div class="fume-pending-bar is-first" />
        <div class="fume-pending-bar is-second" />
        <div class="fume-pending-bar is-third" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss" src="./fume-layout-pending.scss"></style>
