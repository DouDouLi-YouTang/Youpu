<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

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
  resolveCenteredFoliaBackgroundMatrix,
  resolveFoliaBackgroundMatrix,
  resolveFoliaBackgroundSurfaceStyle,
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
const worldStyle = computed<Record<string, string> | undefined>(() =>
  props.world
    ? {
        width: `${props.world.width}px`,
        height: `${props.world.height}px`,
        transform: resolveCenteredFoliaBackgroundMatrix(props.world)
      }
    : undefined
)
const surfaceStyle = computed<Record<string, string> | undefined>(() =>
  props.world ? resolveFoliaBackgroundSurfaceStyle(overlayMode.value, props.world) : undefined
)

let lastWorldTransform = ''
let lastSyncedView: FoliaBackgroundView | null = null
let lastWorld: FoliaBackgroundWorld | null = null

/**
 * 命令式同步：只写 CSS transform，不经过 Vue 响应式，也不新增 rAF。
 * 必须在同一帧由浮名绘制循环调用，保证背景与文字使用同一份相机快照。
 */
function syncView(view: FoliaBackgroundView): void {
  const worldEl = worldRef.value
  if (!worldEl || isNative.value || isTransparent.value) return

  const transform = resolveFoliaBackgroundMatrix(view)
  if (transform !== lastWorldTransform) {
    worldEl.style.transform = transform
    lastWorldTransform = transform
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
 * 浮名切到覆盖背景时，FoliaBackground 刚挂载的那一帧还没有绘制循环唤醒。
 * 用父级最近一次相机视图在 post-flush 补一次，避免首帧停在居中兜底矩阵。
 */
async function syncMountedView(): Promise<void> {
  await nextTick()
  const worldEl = worldRef.value
  if (!worldEl || isNative.value || isTransparent.value) return

  lastWorldTransform = ''
  const view = lastSyncedView
  if (view) syncView(view)
  else if (props.world) worldEl.style.transform = resolveCenteredFoliaBackgroundMatrix(props.world)
}

watch(
  () => [props.world, overlayMode.value, props.config],
  () => {
    lastWorldTransform = ''
    if (props.world !== lastWorld) {
      lastWorld = props.world ?? null
      lastSyncedView = null
    }
    const worldEl = worldRef.value
    if (!worldEl) return
    if (props.world) worldEl.style.transform = resolveCenteredFoliaBackgroundMatrix(props.world)
    void syncMountedView()
  },
  { flush: 'post' }
)

onBeforeUnmount(() => {
  lastWorldTransform = ''
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

const overlayStyle = computed<Record<string, string>>(() => ({
  opacity: String(settings.folia.backgroundOpacity / 100),
  filter: settings.folia.backgroundBlur > 0 ? `blur(${settings.folia.backgroundBlur}px)` : 'none'
}))
</script>

<template>
  <template v-if="isNative">
    <slot />
  </template>
  <div v-else-if="!isTransparent" class="folia-skin-background" :style="overlayStyle">
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
          :audio-power="readAudioPower"
          :audio-bands="readAudioBands"
          :config="props.config"
        />
      </div>
    </div>
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
</style>
