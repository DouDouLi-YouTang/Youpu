<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'

import {
  themeFromPalette,
  type FoliaAudioBands,
  type FoliaBackgroundConfig,
  type FoliaBackgroundMode,
  type FoliaPaperBounds,
  type FoliaPalette
} from './types'
import {
  readFoliaBands,
  readFoliaPower,
  type FoliaAudioBandsInput,
  type FoliaAudioScale
} from './shared/audio-bands'
import { resolveCommonOverrides, resolveFoliaChildProps } from './shared/host-props'
import { resolveFoliaBackgroundEntry } from './registry'

/**
 * Folia 背景宿主 —— 唯一的对外入口（6 种模式选一个渲染）。
 *
 * ## 为什么是这个形状
 *
 * 1. **音频走函数不走进响应式**：`audioPower()` / `audioBands()` 每帧被各模式的 rAF 调用。
 *    把它们做成 `ref` 只会让整棵背景树每秒重渲染 60 次（Folia 用 MotionValue 避免的正是
 *    这件事）。本项目上游 `skins/shared/use-smooth-clock.ts` 的 `bands()` 已经是这个形状，
 *    直接传进来即可。
 * 2. **量纲与频带数在 `shared/audio-bands.ts` 换算**：上游是 0–1 的四频带
 *    （`low/mid/high/power`），Folia 的公式吃 0–255 的五频带。这两件事**只在这一层做一次**，
 *    各模式内部一律按 Folia 原量纲写公式（否则 `(cur - prev) * 7` 这种帧间差分会被放大
 *    255 倍或压成 0，且没有任何报错）。
 * 3. **`theme` 按颜色值记忆**：`palette` 是对象 prop，父组件每次重渲染都会换引用。
 *    直接 `computed(() => themeFromPalette(props.palette))` 会让下游的
 *    `watch(shaderColors)` 每次父渲染都触发一次全屏重绘，所以这里只在四个颜色**字符串**
 *    变化时才换 `theme` 的引用。
 * 4. **子组件只收自己声明的 prop**：Vue 对「未声明的 prop」会把值落到根元素上变成 DOM
 *    属性（`tuning="[object Object]"`）。所以每个模式各自组装一份精确的 props 对象，
 *    而不是把 Folia 的 RenderProps 整套广播下去。
 *
 * ⚠️ `transparent` 为真时**整棵背景树返回 null**（连几何层、暗角一起消失）。
 * 它不是「背景透明但装饰还在」（规格 §1.6），这是 Folia 的既有语义。
 */
const props = defineProps<{
  /** 6 选一。未登记 / 旧持久化值会回退到默认模式 latent（不报错、不白屏） */
  mode: FoliaBackgroundMode
  /** 当前封面 URL；取色链路失败时各模式回退到主题色 */
  coverUrl: string | null
  /** 主题四色。字段名与 Folia `Theme` 不同（`background` ↔ `backgroundColor`），见 types.ts */
  palette: FoliaPalette
  /** 是否浅色主题。影响 nomand 的反色、sora 的底色与颜色回退、monet 的图不透明度 */
  isDaylight: boolean
  /** 播放暂停：音频目标归零 + 速度降到基准的 12%（**不是**停帧） */
  paused: boolean
  /** 整层别动：不建 WebGL 帧循环 / 不挂几何层。默认 false */
  staticMode?: boolean
  /**
   * 整体能量的取值函数。**默认按本项目量纲（0–1）解释**；
   * 若上游给的是 Folia 的 0–255 桶能量，把 `audio-scale` 设成 `'0-255'`。
   * 不传 = 恒定静音（背景仍按 tuning 的基准速度动）。
   */
  audioPower?: () => number
  /**
   * 频带能量的取值函数。四频带（`low/mid/high/power`）与 Folia 五频带
   * （`bass/lowMid/mid/vocal/treble`）**都接受**，按对象里出现的键自动判定；
   * 量纲由 `audio-scale` 决定。
   */
  audioBands?: () => FoliaAudioBandsInput
  /** 音频回调的量纲。默认 `'0-1'`（对齐本项目 `use-audio-bands.ts`） */
  audioScale?: FoliaAudioScale
  /**
   * 模式配置。设置面板由 Folia 共享设置页统一提供；以下字段是**渲染必需的输入**：
   * `transparent`、`customImage`（monet / nomand 的用户上传图）、
   * `url.items` / `url.selectedId`、以及各模式的 `tuning`（不传即取 `DEFAULT_*`）。
   */
  config?: FoliaBackgroundConfig
  /** 几何层重掷种子（common 模式用；不传则按 'default'） */
  seed?: string | number
  /** 浮名 Common 的纸张边界；其它模式会忽略。 */
  paperBounds?: FoliaPaperBounds
}>()

const theme = shallowRef(themeFromPalette(props.palette))
watch(
  () => [
    props.palette.background,
    props.palette.primary,
    props.palette.accent,
    props.palette.secondary
  ],
  () => {
    theme.value = themeFromPalette(props.palette)
  }
)

const staticMode = computed(() => props.staticMode === true)
const audioScale = computed<FoliaAudioScale>(() => props.audioScale ?? '0-1')

/**
 * 音频读取面。**每次调用重新取**（不做缓存）—— 各模式的 rAF 需要的是「这一帧的值」，
 * 缓存一份反而会让 shader 拿到上一帧的读数。
 */
function readAudioPower(): number {
  return readFoliaPower(props.audioPower, audioScale.value)
}

function readAudioBands(): FoliaAudioBands {
  return readFoliaBands(props.audioBands, audioScale.value)
}

const transparent = computed(() => props.config?.transparent === true)
const entry = computed(() => resolveFoliaBackgroundEntry(props.mode))
const common = computed(() => resolveCommonOverrides(props.config))

/**
 * 子组件 props。**每个模式一份精确的名字表**，多余字段不会广播下去（见文件头第 4 条）。
 *
 * 各模式吃得下哪些字段是 Folia 的事实，不是省略：例如 `nomand` 根本没有
 * paused / staticMode（它永远按 shader 自身速度动画），`url` 也不吃音频。
 */
const childProps = computed<Record<string, unknown>>(() =>
  resolveFoliaChildProps({
    mode: entry.value.mode,
    theme: theme.value,
    coverUrl: props.coverUrl,
    isDaylight: props.isDaylight,
    paused: props.paused,
    staticMode: staticMode.value,
    seed: props.seed ?? 'default',
    paperBounds: props.paperBounds,
    ...common.value,
    audioPower: readAudioPower,
    audioBands: readAudioBands,
    config: props.config
  })
)
</script>

<template>
  <div v-if="!transparent" class="folia-background">
    <!-- key = mode：换模式时强制重建，卸载钩子会 dispose 旧 shader 并丢 WebGL context -->
    <component :is="entry.component" :key="entry.mode" v-bind="childProps" />
  </div>
</template>

<style scoped>
/* 背景层容器：铺满沉浸层，且不吃鼠标事件（控制条与歌词浮在它上面） */
.folia-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

/*
 * 各模式根节点的兜底定位。**与 immersive/ImmersiveBackground.vue 的 `.rnp-bg > div` 同款契约**
 * （子选择器 + 父 scope 属性 = 特异性 (0,2,0)，与子组件自己的 `.folia-xxx[data-v-child]` 同值）。
 * 同值时由样式表顺序决定，所以这里的规则只写「所有模式都需要的三条」——
 * 任何模式自己写的 position/inset 都与之**完全一致**，谁赢都一样；
 * 各模式想改 z-index / overflow 时请在自己的规则里写，不要指望靠顺序覆盖这里。
 */
.folia-background > :deep(*) {
  position: absolute;
  inset: 0;
}
</style>
