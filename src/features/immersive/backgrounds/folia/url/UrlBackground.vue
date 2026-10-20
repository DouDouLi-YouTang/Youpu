<script setup lang="ts">
import { computed, ref } from 'vue'

import type { FoliaUrlBackgroundItem } from '../types'
import { resolveSelectedUrlBackgroundItem } from './url-background'
import { useDeferredReady } from './use-deferred-ready'

/**
 * url 模式 —— 把一个网页当背景嵌进来（规格 §7）。
 *
 * 结构上只有两件东西：
 *  1. 一个 iframe，`sandbox="allow-scripts"`；
 *  2. 一层从上到下 `rgba(0,0,0,0.15) → 0.35` 的黑遮罩，纯粹为了歌词可读性
 *     （**不用主题色** —— 这一条与其它模式的压暗层不同，别「统一」掉）。
 *
 * ⚠️ 三条不能动的安全约束：
 *  - **不加 `allow-same-origin`**。加了它，`sandbox="allow-scripts"` 就等于没加 ——
 *    嵌入页面会拿到宿主 origin，能读 DOM 与 cookie。这是安全红线，不是兼容性开关。
 *  - `pointerEvents: 'none'`：鼠标事件穿透到底下的应用。背景层不该抢交互。
 *  - `src` 必须经过 `resolveSelectedUrlBackgroundItem` 的白名单校验（只放行 http/https）。
 *    `file:` / `javascript:` / `data:` / `muice-file://` 一类会被拒，整块不渲染。
 *
 * `key` 用 URL：换 URL 时**整块重建** iframe。为什么不能只是改 `src` ——
 * 上一个页面若导航失败，渲染进程会停在 `chrome-error://chromewebdata`，
 * 之后改 `src` 的跨源导航会撞上那个错误页而不是正常加载（规格 §7.5）。
 *
 * ⚠️ 本项目在 Electron 的 `file://` 下运行，「目标站点用 X-Frame-Options / CSP
 * frame-ancestors 拒绝被嵌」的情况**不会**有错误回调可用（iframe 的 onerror 对
 * HTTP 层拒绝不触发），所以这里**不做失败占位** —— 白屏是唯一可观测结果。
 * 这一点在交付报告里标注为未验证 / 未处理。
 */
const props = defineProps<{
  /** 候选列表（`config.url.items`），会被逐项清洗 */
  items?: FoliaUrlBackgroundItem[]
  /** 当前选中项 id（`config.url.selectedId`） */
  selectedId?: string | null
}>()

/** 选中项在这里**再清洗一次**：这是 URL 进入 iframe 的最后一个检查点 */
const selectedItem = computed(() => resolveSelectedUrlBackgroundItem(props.items, props.selectedId))

const container = ref<HTMLElement | null>(null)
const ready = useDeferredReady(
  container,
  computed(() => selectedItem.value?.url ?? '')
)

const overlayStyle = {
  background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.15), rgba(0, 0, 0, 0.35))',
  pointerEvents: 'none'
} as const

defineExpose({ selectedItem, ready })
</script>

<template>
  <!-- 没有选中项时**连遮罩都不渲染**：整块消失，而不是留一层灰蒙在歌词后面 -->
  <div v-if="selectedItem" ref="container" class="folia-url">
    <iframe
      v-if="ready"
      :key="selectedItem.url"
      class="folia-url-frame"
      :src="selectedItem.url"
      :title="selectedItem.note || selectedItem.url"
      sandbox="allow-scripts"
      allowfullscreen
    />
    <div class="folia-url-overlay" :style="overlayStyle" />
  </div>
</template>

<style scoped>
.folia-url {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}

.folia-url-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  /* 背景层不吃鼠标事件（见文件头安全约束） */
  pointer-events: none;
}

.folia-url-overlay {
  position: absolute;
  inset: 0;
}
</style>
