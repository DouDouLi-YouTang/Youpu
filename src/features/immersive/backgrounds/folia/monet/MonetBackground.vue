<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { colorWithAlpha } from '../shared/color'
import type { FoliaTheme } from '../types'
import {
  checkCanvasFilterSupport,
  getMonetBackgroundCacheKey,
  resolveMonetBackgroundDataUrl,
  resolveMonetBlurStyle,
  resolveMonetHalfPaneImageOpacity,
  resolveMonetHalfPaneImagePositionX
} from './monet-background-pipeline'
import {
  resolveMonetSourceUrl,
  resolveMonetTuning,
  type MonetBackgroundTuning
} from './monet-tuning'
import MonetFullOverlay from './MonetFullOverlay.vue'
import MonetHalfPane from './MonetHalfPane.vue'
import { useMonetDrift } from './use-monet-drift'

/**
 * monet 模式 —— 封面 / 上传图 + Canvas 2D 烘焙海报 + 合成器漂移。
 *
 * ## 为什么这里没有 rAF
 *
 * 整个画面是**一张烘好的静态位图**，唯一的「动」是 Web Animations 播放的漂移轨道
 * （`use-monet-drift.ts`）。主线程只在换图/换主题时忙一次，之后零成本。
 * 这也是本模式能直接退到 CSS 渐变的原因 —— 没有持续的东西要停。
 *
 * ## 三种背景串的优先级（规格 §4.1，顺序不能换）
 *
 *   1. 烘焙结果 `url(data:...)` —— 最终形态
 *   2. `linear-gradient(主题) , url(原图)` —— 烘焙还没回来时的临时形态（约 180ms 防抖 + 烘焙耗时）
 *   3. `fallbackGradient` —— 没有图源（或烘焙失败）时的最终兜底
 *
 * 第 2 档不是多余的：没有它，换歌时会先闪一下纯渐变再出图（烘焙是异步的）。
 *
 * ⚠️ monet **不吃 `paused`**（Folia `monet/entry.tsx:16-25` 就没有这个 prop）：
 * 漂移只由 `staticMode` 与 `prefers-reduced-motion` 控制。不要「顺手」接上 paused。
 */
const props = defineProps<{
  theme: FoliaTheme
  coverUrl: string | null
  isDaylight: boolean
  staticMode?: boolean
  /** 用户上传图 URL（`config.customImage.url`）；与 nomand 共用同一张 */
  customImageUrl?: string | null
  tuning?: Partial<MonetBackgroundTuning>
}>()

const PIPELINE_DEBOUNCE_MS = 180

const tuning = computed(() => resolveMonetTuning(props.tuning))

/**
 * 宿主只透传上传图的 URL（`config.customImage.url`），而管线接口按 Folia 的形状吃
 * `{ id, name, url }`。这里用 url 顶替 id：缓存 key 里两者本来就都在，
 * 顶替不会造成撞 key，也省得把「上传图 id」这种本仓库没有的概念编造出来。
 */
const customImage = computed(() =>
  props.customImageUrl ? { id: props.customImageUrl, name: '', url: props.customImageUrl } : null
)
const sourceUrl = computed(() =>
  resolveMonetSourceUrl(props.coverUrl, props.customImageUrl ?? null, tuning.value.backgroundSource)
)

const fallbackGradient = computed(
  () =>
    `linear-gradient(135deg, ${colorWithAlpha(props.theme.accentColor, 0.22)}, ${colorWithAlpha(
      props.theme.backgroundColor,
      0.96
    )} 50%, ${colorWithAlpha(props.theme.primaryColor, 0.18)})`
)
const readabilityGradient = computed(
  () =>
    `linear-gradient(90deg, ${colorWithAlpha(props.theme.backgroundColor, 0.18)} 0%, ${colorWithAlpha(
      props.theme.backgroundColor,
      0.32
    )} 34%, ${colorWithAlpha(props.theme.backgroundColor, 0.66)} 70%, ${colorWithAlpha(
      props.theme.backgroundColor,
      0.82
    )} 100%)`
)
const scrimGradient = computed(
  () =>
    `linear-gradient(90deg, ${colorWithAlpha(props.theme.backgroundColor, 0.14)} 0%, ${colorWithAlpha(
      props.theme.backgroundColor,
      0.28
    )} 28%, ${colorWithAlpha(props.theme.backgroundColor, 0.62)} 64%, ${colorWithAlpha(
      props.theme.backgroundColor,
      0.86
    )} 100%)`
)
const bloomGradient = computed(
  () =>
    `radial-gradient(circle at 18% 34%, ${colorWithAlpha(props.theme.accentColor, 0.18)}, transparent 36%)`
)

/** 烘焙结果。null = 还没回来 / 没有图源 / 烘焙失败（三种情况都退回第 2、3 档） */
const pipelineUrl = ref<string | null>(null)
/** 组件卸载或换 key 后，旧的烘焙回调不许再写 state（换歌快时最容易撞） */
let pipelineToken = 0
let pipelineTimer: ReturnType<typeof setTimeout> | null = null

function cancelPendingPipeline(): void {
  pipelineToken += 1
  if (pipelineTimer !== null) {
    clearTimeout(pipelineTimer)
    pipelineTimer = null
  }
}

watch(
  () => [
    sourceUrl.value,
    getMonetBackgroundCacheKey({
      coverUrl: props.coverUrl,
      monetBackgroundImage: customImage.value,
      theme: props.theme,
      tuning: tuning.value
    })
  ],
  () => {
    cancelPendingPipeline()
    const url = sourceUrl.value
    if (!url) {
      pipelineUrl.value = null
      return
    }
    const token = pipelineToken
    pipelineTimer = setTimeout(() => {
      pipelineTimer = null
      void resolveMonetBackgroundDataUrl({
        coverUrl: props.coverUrl,
        monetBackgroundImage: customImage.value,
        theme: props.theme,
        tuning: tuning.value
      }).then((result) => {
        if (token !== pipelineToken) return
        if (pipelineUrl.value === result) return
        pipelineUrl.value = result
      })
    }, PIPELINE_DEBOUNCE_MS)
  },
  { immediate: true }
)

onBeforeUnmount(cancelPendingPipeline)

const resolvedBackgroundImage = computed(() => {
  if (pipelineUrl.value) return `url(${pipelineUrl.value})`
  if (sourceUrl.value) {
    return `linear-gradient(135deg, ${colorWithAlpha(
      props.theme.accentColor,
      0.2
    )}, ${colorWithAlpha(props.theme.backgroundColor, 0.78)}), url(${sourceUrl.value})`
  }
  return fallbackGradient.value
})

const layerKey = computed(() => pipelineUrl.value || sourceUrl.value || 'fallback')

/**
 * `ctx.filter` 不可用（iOS Safari 那种「属性存在但静默失效」）时，模糊必须交给 CSS。
 * `scale(1.1) translateZ(0)` 是配套的：CSS 模糊会把边缘化掉，放大 10% 让边缘落在视口外。
 */
// 探测只跑一次（模块级缓存），结果在整个进程中不变
const canvasFilterSupported = checkCanvasFilterSupport()
const blurStyle = computed<Record<string, string>>(() =>
  resolveMonetBlurStyle(tuning.value.backgroundBlurPx, canvasFilterSupported)
)

const imageOpacity = computed(() =>
  resolveMonetHalfPaneImageOpacity(props.isDaylight, tuning.value.backgroundOverlayOpacity)
)
const imagePositionX = computed(() =>
  resolveMonetHalfPaneImagePositionX(tuning.value.backgroundHalfPaneOffsetX)
)

const driftTarget = ref<HTMLElement | null>(null)
const driftStrength = computed(() => Math.min(1, Math.max(0, tuning.value.backgroundDriftStrength)))
const driftEnabled = computed(
  () => tuning.value.backgroundDriftEnabled && props.staticMode !== true && driftStrength.value > 0
)
const { reduceMotion } = useMonetDrift({
  target: driftTarget,
  enabled: () => driftEnabled.value,
  strength: () => driftStrength.value
})

defineExpose({ resolvedTuning: tuning, sourceUrl, pipelineUrl, reduceMotion })
</script>

<template>
  <div class="folia-monet">
    <MonetFullOverlay
      v-if="tuning.backgroundLayout === 'full-overlay'"
      :background-image="resolvedBackgroundImage"
      :layer-key="layerKey"
      :background-color="theme.backgroundColor"
      :readability-gradient="readabilityGradient"
      :blur-style="blurStyle"
      :drift-enabled="driftEnabled"
      :drift-ref="(element) => (driftTarget = element as HTMLElement | null)"
    />
    <MonetHalfPane
      v-else
      :background-image="resolvedBackgroundImage"
      :layer-key="sourceUrl || pipelineUrl ? layerKey : ''"
      :background-color="theme.backgroundColor"
      :fallback-gradient="fallbackGradient"
      :readability-gradient="readabilityGradient"
      :scrim-gradient="scrimGradient"
      :bloom-gradient="bloomGradient"
      :image-opacity="imageOpacity"
      :image-position-x="imagePositionX"
      :blur-style="blurStyle"
      :drift-enabled="driftEnabled"
      :drift-ref="(element) => (driftTarget = element as HTMLElement | null)"
    />
  </div>
</template>

<style scoped>
/* 根节点跟其他模式一样铺满、不吃事件；布局细节交给两个子组件 */
.folia-monet {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
</style>
