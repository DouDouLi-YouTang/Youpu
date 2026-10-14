<script setup lang="ts">
import { computed, onMounted, ref, watch, type Component } from 'vue'
import {
  Asterisk,
  Cloud,
  Diamond,
  Flower,
  Heart,
  Hexagon,
  Leaf,
  PawPrint,
  Sparkle,
  Star,
  Triangle as TriangleIcon,
  Zap
} from '@lucide/vue'

import { usePlayerStore } from '@/stores/player.store'
import { audioBands } from '@/features/immersive/use-audio-bands'
import {
  buildParticles,
  buildShapes,
  PARTICLE_RISE_PX,
  resolveBandScale,
  resolveGeometricSeed,
  SHAPE_DRIFT_X_PX,
  SHAPE_DRIFT_Y_PX,
  type BackgroundIconName,
  type GeometricShape
} from './geometric-model'

/**
 * 几何背景（`backgroundType = 'geometric'`）—— Folia `GeometricBackground.tsx` 的独立重写。
 *
 * 构成：底色 + 15 个缓慢漂移自转的几何形状 + 20 个上浮粒子 + 一层径向暗角。
 * 形状取次要色（`shade-2`，跟随明暗主题自动翻转），粒子与暗角取专辑主色系。
 *
 * **与 Folia 的三点差异（都是刻意的）**：
 *  1. 随机源换成确定性种子（同一首歌恒定同一套布局），见 geometric-model.ts 文件头；
 *  2. 不做 JS 弹簧，频带 → 缩放改用 CSS `scale` 独立属性 + `transition` 平滑；
 *  3. 形状的尺寸/位置/漂移写成 CSS 变量，漂移与自转交给 CSS keyframes（见
 *     geometric-background.scss）—— 不用 JS 逐帧写内联样式，避免与 60fps 流体背景
 *     抢性能预算。
 *
 * **频带缩放刻意绕开 Vue 的渲染管线**：`audioBands` 每帧一个新对象，若在模板里读它，
 * 整个组件（35 个节点）会每帧重渲染一次。这里改为把四档缩放写成**容器上的 CSS 变量**
 * （每个形状用 `var(--g-band-*)` 间接取），只在 `watch` 里写一次样式 —— 每帧 4 次
 * style 写入，零 VDOM 工作。模板因此只依赖 `shapes` / `particles`（只随歌曲变）。
 *
 * 暂停时不冻结漂移动画（Folia 会冻结）：背景是环境层，定格反而像卡住；但频带缩放
 * 会回到静止档，避免停在被放大的一帧。
 */

const player = usePlayerStore()

// 种子：按歌曲折叠。**不含播放进度** —— 背景不该随每一句歌词重掷
const seed = computed(() => resolveGeometricSeed(player.currentItem?.song.id ?? null))

const shapes = computed<GeometricShape[]>(() => buildShapes(seed.value, true))
const particles = computed(() => buildParticles(seed.value))

/** 图标名 → 组件。Record<BackgroundIconName, ...> 让 tsc 保证映射完备 */
const ICON_MAP: Record<BackgroundIconName, Component> = {
  Star,
  Sparkle,
  Cloud,
  Triangle: TriangleIcon,
  Hexagon,
  Diamond,
  Flower,
  Leaf,
  Zap,
  Asterisk,
  Heart,
  PawPrint
}

/** 频带缩放（每帧写一次，不经 VDOM） */
const rootRef = ref<HTMLElement | null>(null)

function writeBandVars(): void {
  const el = rootRef.value
  if (!el) return
  const bands = audioBands.value
  const playing = player.isPlaying
  el.style.setProperty('--g-band-low', String(resolveBandScale(bands.low, playing)))
  el.style.setProperty('--g-band-mid', String(resolveBandScale(bands.mid, playing)))
  el.style.setProperty('--g-band-high', String(resolveBandScale(bands.high, playing)))
  el.style.setProperty('--g-band-power', String(resolveBandScale(bands.power, playing)))
}

// 暂停/恢复也要立刻反应（频带不再变化时 watch 不会触发）。
// 不订阅 useAudioBands()：采样循环由 SkinShell 统一启停，这里只读全局 ref。
watch([audioBands, () => player.isPlaying], writeBandVars)
onMounted(writeBandVars)

/** 形状的内联样式：只有不随帧变化的量（位置/尺寸/漂移幅度/时长） */
function shapeStyle(shape: GeometricShape): Record<string, string> {
  const driftX = SHAPE_DRIFT_X_PX
  const driftY = SHAPE_DRIFT_Y_PX
  return {
    left: `${shape.leftPct}%`,
    top: `${shape.topPct}%`,
    width: `${shape.sizePx}px`,
    height: `${shape.sizePx}px`,
    opacity: String(shape.opacity),
    '--g-dur': `${shape.durationSec}s`,
    '--g-delay': `${shape.delaySec}s`,
    '--g-rot': `${shape.rotationDeg}deg`,
    // reverse 只翻转漂移方向：keyframes 是 var → -var → var，起点符号决定往哪边先走
    '--g-drift-x': `${shape.reverse ? driftX : -driftX}px`,
    '--g-drift-y': `${shape.reverse ? driftY : -driftY}px`
  }
}

function particleStyle(p: (typeof particles.value)[number]): Record<string, string> {
  return {
    left: `${p.leftPct}%`,
    top: `${p.topPct}%`,
    width: `${p.sizePx}px`,
    height: `${p.sizePx}px`,
    // 内联 opacity：动画被关掉（prefers-reduced-motion）时的不透明度；
    // 动画跑起来后真正生效的是关键帧里的 --g-p-opacity（两者同值，见 scss 说明）
    opacity: String(p.opacity),
    '--g-p-opacity': String(p.opacity),
    '--g-dur': `${p.durationSec}s`,
    '--g-delay': `${p.delaySec}s`,
    '--g-rise': `${PARTICLE_RISE_PX}px`
  }
}
</script>

<template>
  <div ref="rootRef" class="rnp-background-geometric">
    <div
      v-for="shape in shapes"
      :key="shape.id"
      class="rnp-geo-shape"
      :class="[`is-${shape.type}`, { 'is-filled': shape.filled }]"
      :style="shapeStyle(shape)"
    >
      <component
        :is="ICON_MAP[shape.icon as BackgroundIconName]"
        v-if="shape.type === 'icon' && shape.icon"
        :size="shape.sizePx"
        :stroke-width="1"
        absolute-stroke-width
      />
    </div>

    <div
      v-for="p in particles"
      :key="`p-${p.id}`"
      class="rnp-geo-particle"
      :style="particleStyle(p)"
    />

    <!-- 径向暗角：中心透明、四周压暗，让中心的歌词更突出 -->
    <div class="rnp-geo-vignette" />
  </div>
</template>

<style scoped lang="scss" src="./geometric-background.scss"></style>
