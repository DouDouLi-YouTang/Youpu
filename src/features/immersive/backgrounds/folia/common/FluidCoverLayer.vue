<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type { FoliaTheme } from '../types'
import {
  COVER_BLUR_SOURCE_MAX,
  FLUID_NO_COVER_OPACITY,
  appendFluidCoverLayer,
  buildDownscaledCover,
  dropFluidCoverLayer,
  resolveFluidBlendOverlayOpacity,
  settleFluidCoverLayers,
  type FluidCoverLayer
} from './fluid-cover'

/**
 * common 的流体封面底 —— 规格 §2.2.4「非 iOS」分支的重写。
 *
 * ## 为什么 opacity 动在 wrapper 上而不是那层 `blur(40px)` 的 img 上
 *
 * 直接在 `blur(40px)` 的图层上改 opacity，浏览器每帧都要**重新栅格化**那层模糊，
 * 而且是分块栅格化 —— 表现为切歌淡入时整屏「网格状闪烁」。
 * 把模糊烘在静态 img 上（只栅格化一次），淡入淡出交给外层的合成层，代价接近 0。
 * 这条与「降采样到 384」是同一个问题的两面（规格 §2.2.2 / §2.2.5）。
 *
 * ## iOS 软焦管线为什么没有实现
 *
 * 本项目是 Electron/Chromium，`detectIOSSafari()` 恒为 false，运行期走不到那条分支
 * （规格 §2.2.7 结论：`软焦管线可整体砍掉`）。判定函数保留在 `fluid-cover.ts` 里作为
 * 这条平台分叉的记录，但**三层径向叠色 / 压暗层 / 预热底图**这些只有 iOS 才出现的层
 * 没有实现 —— 它们的唯一下场是死代码，留着会被误读成「这些层是通用结构」。
 */
const props = defineProps<{
  coverUrl: string | null
  theme: FoliaTheme
}>()

const layers = ref<FluidCoverLayer[]>([])
const readyKeys = ref<Set<number>>(new Set())
let nextKey = 1
/** 降采样的竞态令牌：切歌很快时旧封面的结果不许覆盖新封面 */
let buildToken = 0

watch(
  () => props.coverUrl,
  (url) => {
    const token = ++buildToken
    if (!url) {
      layers.value = []
      readyKeys.value = new Set()
      return
    }
    void buildDownscaledCover(url, COVER_BLUR_SOURCE_MAX).then((smallUrl) => {
      if (token !== buildToken) return
      // 降采样失败（跨源封面污染画布）就回退原图 URL —— 不阻断渲染，只是会闪
      layers.value = appendFluidCoverLayer(layers.value, smallUrl ?? url, url, nextKey)
      nextKey += 1
    })
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  buildToken += 1
})

function isTop(index: number): boolean {
  return index === layers.value.length - 1
}

function layerOpacity(layer: FluidCoverLayer, index: number): number {
  return isTop(index) && !readyKeys.value.has(layer.key) ? 0 : 1
}

/** decode 完成（或失败）后放行淡入；再等一帧让透明状态下先合成一次，避免首帧跳变。 */
function markReady(layer: FluidCoverLayer, element: Element | null): void {
  if (!element || readyKeys.value.has(layer.key)) return
  const image = element as HTMLImageElement
  const ready = (): void => {
    readyKeys.value = new Set([...readyKeys.value, layer.key])
  }
  image
    .decode()
    // 写成 `window.` 前缀：这个文件是 `.vue`，ESLint 的浏览器全局只对 `.ts` 生效，
    // 裸调 `requestAnimationFrame` 会被 no-undef 拦下（`.ts` 那边同样写法却不会）。
    .then(() => window.requestAnimationFrame(ready))
    // decode 失败也放行：卡在透明比「图有瑕疵但看得见」糟得多
    .catch(ready)
}

/** 淡入结束后只留顶层 —— 层数不会随切歌次数增长（见 fluid-cover.ts 的说明）。 */
function onFadeComplete(layer: FluidCoverLayer, index: number): void {
  if (!isTop(index) || !readyKeys.value.has(layer.key)) return
  const settled = settleFluidCoverLayers(layers.value, layer.key)
  layers.value = settled.layers
  readyKeys.value = settled.readyKeys
}

const blendOverlayStyle = computed(() => ({
  background: `linear-gradient(to bottom right, ${props.theme.primaryColor}, transparent, ${props.theme.secondaryColor})`,
  opacity: String(resolveFluidBlendOverlayOpacity(false)),
  mixBlendMode: 'overlay' as const
}))

const noCoverStyle = computed(() => ({
  backgroundColor: props.theme.backgroundColor,
  opacity: String(FLUID_NO_COVER_OPACITY)
}))
</script>

<template>
  <div class="folia-fluid-cover">
    <template v-if="coverUrl">
      <div
        v-for="(layer, index) in layers"
        :key="layer.key"
        class="folia-fluid-cover-fade"
        :style="{
          opacity: String(layerOpacity(layer, index)),
          willChange: 'opacity'
        }"
        @transitionend="onFadeComplete(layer, index)"
      >
        <img
          :ref="(element) => markReady(layer, element as Element | null)"
          class="folia-fluid-cover-image"
          :src="layer.url"
          alt=""
          aria-hidden="true"
          draggable="false"
          decoding="async"
          @error="layers = dropFluidCoverLayer(layers, layer.key)"
        />
      </div>
    </template>

    <!-- 无封面：主题底色 @ 0.8（不是 1，留一点透过率） -->
    <div v-else class="folia-fluid-cover-nocover" :style="noCoverStyle" />

    <!-- 顶层混合渐变：让画面上下角分别沾一点主色/次要色 -->
    <div class="folia-fluid-cover-blend" :style="blendOverlayStyle" />
  </div>
</template>

<style scoped>
/*
 * `isolation: isolate` + `contain: paint` 是这套做法的前提：
 * blur(40px) 的图层不会溢出到容器外，也不会和外部背景的配色互相混色。
 * 少了 `contain: paint`，模糊边缘会渗出容器边界，在歌词区域留下一圈灰边。
 */
.folia-fluid-cover {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  isolation: isolate;
  contain: paint;
  transform: translateZ(0);
}

.folia-fluid-cover-fade {
  position: absolute;
  inset: 0;
  transition: opacity 1.5s ease-in-out;
}

.folia-fluid-cover-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  /* 放大 1.5 抵消模糊把边缘化掉的那一圈（不放大就会露出容器底色） */
  filter: blur(40px);
  transform: scale(1.5) translateZ(0);
}

.folia-fluid-cover-nocover,
.folia-fluid-cover-blend {
  position: absolute;
  inset: 0;
}
</style>
