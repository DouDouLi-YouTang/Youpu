<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import FoliaBackground from '@/features/immersive/backgrounds/folia/FoliaBackground.vue'
import type { FoliaBackgroundMode } from '@/features/immersive/backgrounds/folia/types'
import {
  resolveFoliaSkinId,
  useImmersiveSettingsStore
} from '@/features/immersive/immersive-settings.store'
import { audioBands } from '@/features/immersive/use-audio-bands'
import type { AudioBands } from '@/features/immersive/use-audio-bands'
import type { SmoothClock } from './use-smooth-clock'
import {
  resolveFoliaBackgroundBlurGeometry,
  resolveFoliaBackgroundViewportVignette,
  resolveCenteredFoliaBackgroundMatrix,
  resolveFoliaBackgroundMatrix,
  resolveFoliaBackgroundSurfaceStyle,
  resolveFoliaBackgroundWorldStyle,
  type FoliaBackgroundView,
  type FoliaBackgroundWorld,
  type FoliaSkinBackgroundHandle
} from './folia-background-world'

/**
 * Folia 三主题的背景适配层。
 *
 * `native` 直接渲染 slot 中的原生背景；其他模式交给已经移植好的
 * `FoliaBackground`。透明度与模糊只加在覆盖背景这一层，绝不作用到宿主根节点，
 * 否则歌词与 canvas 会一起被淡掉。
 */
const props = defineProps<{
  coverUrl: string | null
  palette: {
    background: string
    primary: string
    accent: string
    secondary: string
  }
  isDaylight: boolean
  paused: boolean
  clock?: SmoothClock
  /**
   * 可选的固定世界。浮名传入文章世界；其它皮肤不传，覆盖背景继续铺满视口，
   * 不引入任何相机耦合。
   */
  world?: FoliaBackgroundWorld | null
  /** 背景模式配置；浮名可借此关闭 Common 的几何层 / 暗角，保持原生纸面观感。 */
  config?: import('@/features/immersive/backgrounds/folia/types').FoliaBackgroundConfig
}>()

const settings = useImmersiveSettingsStore()

const backgroundMode = computed(
  () => settings.folia.backgroundModes[resolveFoliaSkinId(settings.skin)]
)
const isNative = computed(() => backgroundMode.value === 'native')
const isTransparent = computed(() => backgroundMode.value === 'transparent')
const overlayMode = computed(() => backgroundMode.value as FoliaBackgroundMode)
const worldRef = ref<HTMLElement | null>(null)
const surfaceRef = ref<HTMLElement | null>(null)
const blurGeometry = computed(() =>
  resolveFoliaBackgroundBlurGeometry(settings.folia.backgroundBlur)
)
/**
 * 世界容器的**几何**样式（位置 / 尺寸）。
 *
 * ⚠️ 只留 left/top/width/height —— transform 绝不进 `:style`。Vue 在每次 patch 时会把
 * 绑定对象之外的内联 transform 一起接管：绘制循环刚写入的矩阵会被它清掉或覆盖，
 * 而重排恰好发生在 patch 与写入之间，就会漏出「一帧错位」（暂停时更明显，
 * 那一帧会停在屏幕上）。transform 的唯一写入方是 `syncView`。
 *
 * 这里仍然用 `:style` 绑定 width/height：它们与文章一起变，且 Vue 写它们**不会**
 * 动 transform —— 只要 transform 不出现在同一个绑定对象里。
 */
const worldStyle = computed<Record<string, string> | undefined>(() =>
  props.world
    ? resolveFoliaBackgroundWorldStyle(props.world, blurGeometry.value.insetPx)
    : undefined
)
const surfaceStyle = computed<Record<string, string> | undefined>(() =>
  props.world ? resolveFoliaBackgroundSurfaceStyle(overlayMode.value, props.world) : undefined
)

/**
 * 暗角是否由本层在视口上补画。
 *
 * Common 的暗角平时画在几何层内部；浮名把几何层收进纸张边界后，它会随几何层一起被
 * 裁在纸张矩形里，纸张内外亮度断层（看起来像背景有一圈边界）。这一层铺满视口、
 * 不随相机移动，由它补画才算「盖住整个视野」。判定与几何层内部同源，
 * 见 `resolveFoliaBackgroundViewportVignette`。
 */
const viewportVignette = computed(() =>
  resolveFoliaBackgroundViewportVignette({
    mode: overlayMode.value,
    config: props.config,
    paperBounds: props.world?.paperBounds
  })
)

let lastWorldTransform = ''
/**
 * 上一次写 transform 的元素。
 *
 * 只比对字符串不够：元素被重建（切背景模式）或 transform 被别处清掉时，
 * 新元素上根本没有那个矩阵，缓存却还说「写过」—— 于是这一帧漏写、背景停在左上角。
 */
let lastTransformEl: HTMLElement | null = null
let lastSyncedView: FoliaBackgroundView | null = null

/**
 * 命令式同步：只写 CSS transform，不经过 Vue 响应式，也不新增 rAF。
 * 必须在同一帧由浮名绘制循环调用，保证背景与文字使用同一份相机快照。
 */
function syncView(view: FoliaBackgroundView): void {
  const worldEl = worldRef.value
  if (!worldEl || isNative.value || isTransparent.value) return

  const transform = resolveFoliaBackgroundMatrix(view)
  if (worldEl !== lastTransformEl || transform !== lastWorldTransform) {
    worldEl.style.transform = transform
    lastWorldTransform = transform
    lastTransformEl = worldEl
  }
  lastSyncedView = {
    viewportWidth: view.viewportWidth,
    viewportHeight: view.viewportHeight,
    cameraX: view.cameraX,
    cameraY: view.cameraY,
    scale: view.scale
  }
}

defineExpose<FoliaSkinBackgroundHandle>({ syncView })

/**
 * 挂载 / 切背景模式时补第一帧的 transform。
 *
 * 绘制循环还没跑起来之前（或刚切到覆盖背景、`FoliaBackground` 刚挂载），
 * world 容器上没有任何 transform。先贴最近一次的相机视图，避免首帧停在左上角；
 * 连视图都还没有时用居中兜底矩阵。
 *
 * ⚠️ **不能监听 `props.world`**：窗口 resize 时每排完一版文章就会换一个新的 world 对象，
 * 若在这里重置 transform，就会覆盖掉绘制循环刚写入的真实相机矩阵（`lastWorldTransform`
 * 被清空 → 下一帧再写回来），表现是「改窗口大小背景瞬移一下再弹回」。
 * world 的尺寸变化由 `:style` 绑定的几何负责，transform 的唯一写入方是 `syncView`。
 */
function applyInitialTransform(): void {
  const worldEl = worldRef.value
  if (!worldEl || isNative.value || isTransparent.value) return

  if (lastSyncedView) {
    syncView(lastSyncedView)
    return
  }
  if (!props.world) return
  worldEl.style.transform = resolveCenteredFoliaBackgroundMatrix(props.world)
  lastWorldTransform = worldEl.style.transform
  lastTransformEl = worldEl
}

watch(
  () => [overlayMode.value, props.config],
  () => {
    // 模式 / 配置变化可能重建子组件：等 patch 完成后再补一次（元素判断见 `syncView`）。
    lastWorldTransform = ''
    void nextTick().then(applyInitialTransform)
  },
  { flush: 'post' }
)

onMounted(applyInitialTransform)

onBeforeUnmount(() => {
  lastWorldTransform = ''
  lastTransformEl = null
  lastSyncedView = null
})

/**
 * FoliaBackground 的两个音频入参是**函数**，不是响应式值。
 * 这里返回稳定的读取函数，每个 rAF 都读当前时钟的同一帧。
 */
function readAudioPower(): number {
  return props.clock?.bands().power ?? audioBands.value.power
}

function readAudioBands(): AudioBands {
  if (!props.clock) return audioBands.value
  const bands = props.clock.bands()
  return {
    low: bands.bass,
    mid: bands.mid,
    high: bands.treble,
    power: bands.power
  }
}

/**
 * 只把不透明度放在裁切层上。模糊不能直接加在这里：这一层刚好铺满视口，
 * CSS 模糊会把四边一起化掉，露出 `.immersive-root` 的底色（白边）。
 */
const overlayStyle = computed<Record<string, string>>(() => ({
  opacity: String(settings.folia.backgroundOpacity / 100)
}))

/**
 * 模糊层必须比视口大一圈。外扩值只跟模糊半径有关；浮名有 world 时，
 * `resolveFoliaBackgroundWorldStyle` 会同时把 world 原点补偿回视口左上角，
 * 相机同步仍然只改 `.folia-background-world` 的 transform。
 */
const blurLayerStyle = computed<Record<string, string>>(() => {
  const geometry = blurGeometry.value
  return {
    inset: `-${geometry.insetPx}px`,
    filter: geometry.blurPx > 0 ? `blur(${geometry.blurPx}px)` : 'none'
  }
})
</script>

<template>
  <template v-if="isNative">
    <slot />
  </template>
  <div v-else-if="!isTransparent" class="folia-skin-background" :style="overlayStyle">
    <div class="folia-background-blur" :style="blurLayerStyle">
      <div
        ref="worldRef"
        class="folia-background-world"
        :class="{ 'has-world': Boolean(props.world) }"
        :style="worldStyle"
      >
        <div
          ref="surfaceRef"
          class="folia-background-surface"
          :class="{ 'has-world': Boolean(props.world) }"
          :style="surfaceStyle"
        >
          <FoliaBackground
            :mode="overlayMode"
            :cover-url="props.coverUrl"
            :palette="props.palette"
            :is-daylight="props.isDaylight"
            :paused="props.paused"
            :seed="props.coverUrl ?? 'default'"
            :paper-bounds="props.world?.paperBounds"
            :audio-power="readAudioPower"
            :audio-bands="readAudioBands"
            :config="props.config"
          />
        </div>
      </div>
    </div>

    <!--
      视口级暗角：与几何层内部的暗角同一条渐变（Folia 的 rgba(0,0,0,.6)），
      但铺满视口、不随相机移动 —— 几何层被收进纸张边界时由它负责「盖住整个视野」。
      放在模糊层之外：模糊层比视口大一圈（inset 为负），铺在里面会让渐变的边界跟着外扩。
    -->
    <div v-if="viewportVignette" class="folia-background-vignette" />
  </div>
</template>

<style scoped>
.folia-skin-background {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  transform: translateZ(0);
}

.folia-background-blur {
  position: absolute;
  /* 模糊层本身不能裁切：它已经向外扩了一圈，若这里再裁会把外扩部分
     连同模糊核一起切掉，白边会重新出现。裁切由最外层负责。 */
  overflow: visible;
  transform: translateZ(0);
}

.folia-background-world {
  position: absolute;
  inset: 0;
  overflow: visible;
  transform-origin: 0 0;
}

.folia-background-world.has-world {
  inset: auto;
  will-change: transform;
}

.folia-background-surface {
  position: absolute;
  inset: 0;
}

.folia-background-surface.has-world {
  inset: auto;
}

/*
 * 视口级暗角：数值与 `backgrounds/geometric-background.scss` 的 `.rnp-geo-vignette`
 * 逐项对齐（中心透明 40%、末色黑、整体 opacity .6）。改一处必须同步另一处，
 * 否则「纸张框里的暗角」与「视口上的暗角」在切换几何层范围时会跳一档。
 */
.folia-background-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.6;
  background: radial-gradient(circle, transparent 40%, rgb(0, 0, 0) 100%);
}
</style>
