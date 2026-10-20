import type {
  FoliaAudioBands,
  FoliaBackgroundConfig,
  FoliaBackgroundMode,
  FoliaPaperBounds,
  FoliaTheme
} from '../types'

/**
 * 宿主 → 各模式子组件的 props 组装（纯函数，可单测）。
 *
 * ## 为什么要有这一层
 *
 * 1. **Vue 会把未声明的 prop 落成 DOM 属性**：把 Folia 的 RenderProps 整套广播给
 *    每个模式组件，`nomand` 会拿到 `paused="true"` / `tuning="[object Object]"` 这类
 *    无意义属性挂在根 div 上（`config` 那种对象更是 `[object Object]`）。
 *    所以每个模式一份**精确的名字表**。
 * 2. **各模式吃得下哪些字段是 Folia 的事实，不是省略**：
 *    `nomand` 没有 paused / staticMode（永远按 shader 自身速度动画，§5.1）；
 *    `url` 不吃音频与主题；`sora` 把 staticMode 与 paused 合并成同一个「冻结」（§6.4）。
 *    把「谁能吃什么」集中在这里，比散在 6 个 SFC 的 v-bind 里好核对。
 * 3. **可测试**：不依赖 DOM / WebGL，node 环境直接断言每个模式的 props 表。
 */

export interface FoliaChildPropOptions {
  mode: FoliaBackgroundMode
  theme: FoliaTheme
  coverUrl: string | null
  isDaylight: boolean
  paused: boolean
  staticMode: boolean
  seed: string | number
  useCoverColorBg: boolean
  coverColorOpacity: number
  disableGeometricBackground: boolean
  disableVignette: boolean
  /** 浮名 Common 的几何构图边界；其它模式不会收到。 */
  paperBounds?: FoliaPaperBounds
  /** 已换算到 Folia 0–255 量纲的读取函数 */
  audioPower: () => number
  audioBands: () => FoliaAudioBands
  config?: FoliaBackgroundConfig
}

/** common 模式叠加在流体底之上的主题底色默认不透明度（§2.1）。 */
export const DEFAULT_COMMON_BACKGROUND_OPACITY = 0.75

/** 组装某个模式的子组件 props。**这里返回的对象直接进 v-bind**，键名必须与组件 props 对齐。 */
export function resolveFoliaChildProps(options: FoliaChildPropOptions): Record<string, unknown> {
  const { config } = options
  switch (options.mode) {
    case 'latent':
      return {
        theme: options.theme,
        coverUrl: options.coverUrl,
        isDaylight: options.isDaylight,
        paused: options.paused,
        staticMode: options.staticMode,
        audioPower: options.audioPower,
        audioBands: options.audioBands,
        tuning: config?.latent?.tuning
      }
    case 'nomand':
      return {
        theme: options.theme,
        coverUrl: options.coverUrl,
        isDaylight: options.isDaylight,
        customImageUrl: config?.customImage?.url ?? null,
        tuning: config?.nomand?.tuning
      }
    case 'monet':
      return {
        theme: options.theme,
        coverUrl: options.coverUrl,
        isDaylight: options.isDaylight,
        staticMode: options.staticMode,
        customImageUrl: config?.customImage?.url ?? null,
        tuning: config?.monet?.tuning
      }
    case 'sora':
      return {
        theme: options.theme,
        isDaylight: options.isDaylight,
        paused: options.paused || options.staticMode,
        tuning: config?.sora?.tuning
      }
    case 'url':
      return {
        items: config?.url?.items ?? [],
        selectedId: config?.url?.selectedId ?? null
      }
    default:
      return {
        theme: options.theme,
        coverUrl: options.coverUrl,
        isDaylight: options.isDaylight,
        paused: options.paused,
        staticMode: options.staticMode,
        seed: options.seed,
        audioPower: options.audioPower,
        audioBands: options.audioBands,
        useCoverColorBg: options.useCoverColorBg,
        coverColorOpacity: options.coverColorOpacity,
        disableGeometricBackground: options.disableGeometricBackground,
        disableVignette: options.disableVignette,
        paperBounds: options.paperBounds
      }
  }
}

/** 宿主 `config.common` 的四个取值 → 组装入参（默认值逐字对齐 §2.1 的表）。 */
export function resolveCommonOverrides(config?: FoliaBackgroundConfig): {
  useCoverColorBg: boolean
  coverColorOpacity: number
  disableGeometricBackground: boolean
  disableVignette: boolean
} {
  return {
    useCoverColorBg: config?.common?.useCoverColorBg === true,
    coverColorOpacity: config?.common?.opacity ?? DEFAULT_COMMON_BACKGROUND_OPACITY,
    disableGeometricBackground: config?.common?.disableGeometricBackground === true,
    disableVignette: config?.common?.disableVignette === true
  }
}
