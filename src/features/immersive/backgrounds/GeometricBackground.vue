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
 * 几何背景 —— Folia `GeometricBackground.tsx` 的独立重写。两个宿主共用：
 *
 *  1. 「几何背景」皮肤（`ImmersiveBackground.vue`，`backgroundType = 'geometric'`）
 *     —— 不传 props，取色走全局主色系 CSS 变量；
 *  2. Folia 的 `common` 背景层（`backgrounds/folia/common/CommonBackground.vue`）
 *     —— 传 `theme` 让它跟随**这首歌**的主题四色。
 *
 * 构成：底色 + 15 个缓慢漂移自转的几何形状 + 20 个上浮粒子 + 一层径向暗角。
 * 形状取次要色、粒子取强调色 —— 与 Folia 的 `secondaryColor` / `accentColor` 分工一致。
 *
 * ## 为什么取色要能从外面传进来
 *
 * 本组件的默认取色是**全局主色系**（`--rnp-accent-color-*`），那是给「几何背景」皮肤用的
 * —— 那一层没有逐歌主题。但 Folia 的 `common` 层拿的是**当前歌曲的主题**（四色都跟着封面走），
 * 两者不是一回事：不传 `theme` 时形状会是全局主色，而底色层已经是歌曲主题色，
 * 于是「形状与底色不配套」，浅色封面上还会出现「深色形状压在浅色主题底上」。
 *
 * 所以取色做成 props 覆盖（不传 = 沿用 CSS 变量的既有行为），而不是在组件内部读 store ——
 * 组件不该知道「谁在用它」，更不该猜。
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

/**
 * 取色与铺底的覆盖项。**全部可选** —— 不传时沿用全局主色系 CSS 变量（既有行为）。
 */
const props = defineProps<{
  /**
   * 主题四色（Folia `Theme` 的字段名）。传了就用它取色：
   * 形状 ← `secondaryColor`、粒子 ← `accentColor`、底色 ← `backgroundColor`。
   */
  theme?: {
    backgroundColor?: string
    accentColor?: string
    secondaryColor?: string
  } | null
  /**
   * 是否自铺底色。**Folia 的几何层本身是透明的**，底色由外壳的主题底色层负责 ——
   * 所以 `common` 层必须传 `false`，否则几何层会把它上面那层逐歌主题底色整块盖掉
   * （表现是「每首歌的底色都一样」，因为盖上来的是全局主色）。
   *
   * 「几何背景」皮肤那一层没有独立的主题底色层，所以默认 `true`（自铺）。
   */
  paintBackground?: boolean
  /**
   * 暗角末色。Folia 恒为 `rgba(0,0,0,0.6)`；不传时沿用 `--rnp-accent-color-overlay`
   * （随明暗翻转，供「几何背景」皮肤在浅色下用）。
   */
  vignetteColor?: string
}>()

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

/**
 * 取色覆盖 → 容器上的 CSS 变量。
 *
 * 走 CSS 变量而不是把颜色写进每个形状的内联样式：形状是 35 个节点，
 * 颜色进内联样式就得在 `shapeStyle` / `particleStyle` 里各拼一次，
 * 而它们现在是纯几何的（与主题无关）。变量只在容器上写一次。
 *
 * 未提供的项**不写空值**：写 `undefined` 会让 CSS 变量变成空串，
 * 于是 `var(--g-shape-color, 兜底)` 取到空而不是兜底 —— 形状会整层消失。
 */
const colorVars = computed<Record<string, string>>(() => {
  const vars: Record<string, string> = {}
  const theme = props.theme
  if (theme?.secondaryColor) vars['--g-shape-color'] = theme.secondaryColor
  if (theme?.accentColor) vars['--g-particle-color'] = theme.accentColor
  if (theme?.backgroundColor && props.paintBackground !== false) {
    vars['--g-bg-color'] = theme.backgroundColor
  }
  if (props.vignetteColor) vars['--g-vignette-color'] = props.vignetteColor
  return vars
})

/** 是否自铺底色。Folia 的几何层透明，见 props 的说明 */
const paintsBackground = computed(() => props.paintBackground !== false)
</script>

<template>
  <div
    ref="rootRef"
    class="rnp-background-geometric"
    :class="{ 'is-background-transparent': !paintsBackground }"
    :style="colorVars"
  >
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
