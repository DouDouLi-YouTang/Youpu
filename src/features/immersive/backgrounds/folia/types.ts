import type { Component } from 'vue'

import type { LatentBackgroundTuning } from './latent/latent-tuning'
import type { MonetBackgroundTuning } from './monet/monet-tuning'
import type { NomandBackgroundTuning } from './nomand/nomand-tuning'
import type { SoraBackgroundTuning } from './sora/sora-tuning'

/**
 * Folia 背景子系统（6 种模式）的 Vue 版契约。
 *
 * 结构对齐 Folia `backgrounds/definition.ts`（AGPL-3.0），但类型本身是**接口描述**，
 * 实现全部独立重写（本项目 MIT）：见 `docs/folia-backgrounds-porting-notes.md` §1。
 *
 * 两条必须守住的语义（否则渲染层会走样）：
 *  1. `audioPower` / `audioBands()` 是 **0–255** 的桶能量，与 Folia 的 `MotionValue` 同量纲。
 *     本项目上游（skins/shared/use-smooth-clock.ts）给的是 0–1 四频带，换算集中在
 *     `shared/audio-bands.ts`，不要在各模式里各写一遍。
 *  2. 读音频走**函数**而不是响应式 ref：这两个回调每帧被调用，
 *     放进 reactive/ref 会让整棵组件树每帧重渲染（Folia 用 MotionValue 避免的正是这件事）。
 */

/**
 * 六种模式的**单一真源**。新增模式时必须同时改这里与 `registry.ts` 的静态表，
 * `assertFoliaModeList()` 会在模块求值时逐字比对，漏登记当场报错（对齐 Folia
 * `registry.tsx:42-46` 的 `assertBuiltinModeList`）。
 */
export const FOLIA_BACKGROUND_MODES = [
  'common',
  'latent',
  'monet',
  'nomand',
  'sora',
  'url'
] as const

export type FoliaBackgroundMode = (typeof FOLIA_BACKGROUND_MODES)[number]

/** 默认模式 = latent（Folia `src/types/visualizerModes.ts:42`，也是 Folia 的默认背景）。 */
export const DEFAULT_FOLIA_BACKGROUND_MODE: FoliaBackgroundMode = 'latent'

/** 选择器里的排序值，逐字对齐 Folia 的 `order`（§1.5）。 */
export const FOLIA_BACKGROUND_ORDER: Record<FoliaBackgroundMode, number> = {
  common: 10,
  monet: 20,
  nomand: 30,
  latent: 35,
  url: 40,
  sora: 50
}

/**
 * 主题色。对应 Folia `Theme` 里被背景层读到的四个字段
 * （`fontStyle` / `animationIntensity` 等与背景无关，本项目不透传）。
 */
export interface FoliaTheme {
  /** 页面底色：作 shader 边缘兜底、overlay 压暗色、monet 合成底 */
  backgroundColor: string
  /** 主色：dithering 前景、sora 星点、procedural 高光 */
  primaryColor: string
  /** 强调色：nomand 网点/像素画前景、sora 强调星点、monet 光斑 */
  accentColor: string
  /** 次要色：几何层形状、fluted-glass 阴影 */
  secondaryColor: string
  /** 几何层可用的 lucide 图标名（Folia `Theme.lyricsIcons?`；无入口时恒为空） */
  lyricsIcons?: string[]
}

/**
 * Folia 的六频带，**0–255**（对齐 `src/types.ts:1418-1425` 的频段划分）：
 * bass 20–150Hz、lowMid 150–400、mid 400–1200、vocal 1000–3500、treble 3500+。
 */
export interface FoliaAudioBands {
  bass: number
  lowMid: number
  mid: number
  vocal: number
  treble: number
}

/** monet / nomand 共用的用户上传图资产（Folia `MonetBackgroundImage`）。 */
export interface FoliaBackgroundImage {
  id: string
  name: string
  url: string
}

/** url 模式的嵌入项（Folia `UrlBackgroundItem`）。 */
export interface FoliaUrlBackgroundItem {
  id: string
  url: string
  note: string
}

/**
 * 背景配置。本项目**不实现设置面板**（用户决定 A），但结构与取值域照抄，
 * 以后接面板时改渲染层以外的部分即可。
 */
export interface FoliaBackgroundConfig {
  /** true = 整棵背景树返回 null（连几何层与暗角一起消失，§1.6） */
  transparent?: boolean
  common?: {
    /** 封面取色流体底开关（Folia 来自主题设置，本仓库由调用方传入） */
    useCoverColorBg?: boolean
    /** 压在流体底之上的主题底色不透明度，默认 0.75 */
    opacity?: number
    disableGeometricBackground?: boolean
    disableVignette?: boolean
  }
  customImage?: FoliaBackgroundImage | null
  monet?: { tuning?: Partial<MonetBackgroundTuning> }
  nomand?: { tuning?: Partial<NomandBackgroundTuning> }
  latent?: { tuning?: Partial<LatentBackgroundTuning> }
  sora?: { tuning?: Partial<SoraBackgroundTuning> }
  url?: { items?: FoliaUrlBackgroundItem[]; selectedId?: string | null }
}

/**
 * 渲染入参（Folia `VisualizerBackgroundRenderProps` 的 Vue 版）。
 * 每个模式组件只声明自己真正用到的字段 —— 例如 nomand 不吃 paused/staticMode，
 * 这是 Folia 的事实（`nomand/entry.tsx:17-24`），不是遗漏。
 */
export interface FoliaBackgroundRenderProps {
  theme: FoliaTheme
  isDaylight: boolean
  coverUrl: string | null
  /** 整体能量，0–255 */
  audioPower: () => number
  /** 五频带，0–255 */
  audioBands: () => FoliaAudioBands
  /** 几何层重掷种子（Folia `props.seed`） */
  seed: string | number
  staticMode: boolean
  paused: boolean
  config: FoliaBackgroundConfig
}

/**
 * 注册表条目。`renderSettingsPanel` / `renderQuickControls` **有意不实现**（用户决定 A），
 * 但 `resetSettings` 之类的形状留给将来：追加通道见 `registry.ts`。
 */
export interface FoliaBackgroundRegistryEntry {
  mode: FoliaBackgroundMode
  order: number
  /** i18n key，本仓库暂时只有 labelFallback 会被用到 */
  labelKey: string
  labelFallback: string
  component: Component
}

/**
 * 自检：注册表里的 mode 列表必须与 `FOLIA_BACKGROUND_MODES` 逐字相同。
 * 只在模块求值跑一次，把「加了目录忘了登记」这类错误挡在启动时（对齐 Folia 的做法）。
 */
export function assertFoliaModeList(
  source: string,
  modes: readonly string[],
  expected: readonly string[]
): void {
  const actual = [...modes].sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((mode, index) => mode !== wanted[index])) {
    throw new Error(
      `[${source}] Folia 背景模式列表不一致：注册表 ${modes.join('/')}，期望 ${expected.join('/')}`
    )
  }
}

/** 输入 host 的调色板（宿主组件的 props 形状，比 `FoliaTheme` 少一个可选字段）。 */
export interface FoliaPalette {
  background: string
  primary: string
  accent: string
  secondary: string
}

/** 调色板 → 主题色。字段名不同是刻意的：宿主接口用 `background/accent`，内部用 Folia 命名。 */
export function themeFromPalette(palette: FoliaPalette): FoliaTheme {
  return {
    backgroundColor: palette.background,
    primaryColor: palette.primary,
    accentColor: palette.accent,
    secondaryColor: palette.secondary
  }
}
