import {
  assertFoliaModeList,
  DEFAULT_FOLIA_BACKGROUND_MODE,
  FOLIA_BACKGROUND_MODES,
  FOLIA_BACKGROUND_ORDER,
  type FoliaBackgroundMode,
  type FoliaBackgroundRegistryEntry
} from './types'
import { defineBackground } from './definition'
import FoliaFallbackGradient from './shared/FoliaFallbackGradient.vue'
import LatentBackground from './latent/LatentBackground.vue'
import MonetBackground from './monet/MonetBackground.vue'
import NomandBackground from './nomand/NomandBackground.vue'
import SoraBackground from './sora/SoraBackground.vue'
import UrlBackground from './url/UrlBackground.vue'

/**
 * 背景模式注册表 —— 6 个 entry 的**静态**表 + order 排序 + 未命中回退默认模式。
 *
 * 为什么是静态数组而不是 Folia 的 `import.meta.glob('./*\/entry.tsx', { eager: true })`：
 * glob 会把 6 个模式的 WebGL 代码无条件拉进同一批 chunk，而且本仓库没有 mod 体系，
 * glob 换来的唯一好处（第三方投稿目录自动登记）用不上（规格 §1.8）。
 *
 * 为什么 `assertFoliaModeList` 要在**模块求值**时跑：这是「加了一个模式目录但忘了
 * 登记 order / label」的唯一低成本拦截点。放在函数里就得有人调用它，等于没做。
 *
 * ⚠️ 尚未落地的模式暂时指向 `FoliaFallbackGradient`（主题底色渐变）。这是**过渡态**：
 * 每个模式的实际组件落地时，把对应那一行的 `component` 换掉即可，表格形状不要动 ——
 * order / labelKey / labelFallback 三列已经按规格逐字对齐（§1.5）。
 *
 * 已落地：latent、monet、nomand、sora、url。待落地：common。
 */

const builtinEntries: FoliaBackgroundRegistryEntry[] = [
  defineBackground({
    mode: 'common',
    order: FOLIA_BACKGROUND_ORDER.common,
    labelKey: 'options.visualizerBackgroundModeCommon',
    labelFallback: 'Common',
    component: FoliaFallbackGradient
  }),
  defineBackground({
    mode: 'monet',
    order: FOLIA_BACKGROUND_ORDER.monet,
    labelKey: 'options.visualizerBackgroundModeMonet',
    labelFallback: 'Monet',
    component: MonetBackground
  }),
  defineBackground({
    mode: 'nomand',
    order: FOLIA_BACKGROUND_ORDER.nomand,
    labelKey: 'options.visualizerBackgroundModeNomand',
    labelFallback: 'Nomand',
    component: NomandBackground
  }),
  defineBackground({
    mode: 'latent',
    order: FOLIA_BACKGROUND_ORDER.latent,
    labelKey: 'options.visualizerBackgroundModeLatent',
    labelFallback: 'Latent',
    component: LatentBackground
  }),
  defineBackground({
    mode: 'url',
    order: FOLIA_BACKGROUND_ORDER.url,
    // 注意是 Embed 而不是 Url —— Folia 的 i18n key 与兜底文案都是 Embed（§7）
    labelKey: 'options.visualizerBackgroundModeEmbed',
    labelFallback: 'Embed',
    component: UrlBackground
  }),
  defineBackground({
    mode: 'sora',
    order: FOLIA_BACKGROUND_ORDER.sora,
    labelKey: 'options.visualizerBackgroundModeSora',
    labelFallback: 'Sora',
    component: SoraBackground
  })
]

/**
 * 运行期追加的 entry（Folia 的 mod 投稿通道）。本仓库没有 mod 体系，
 * 但**形状要留着**：以后接插件 / 用户自定义背景时，改动只发生在这两行，
 * 渲染层（`resolveFoliaBackgroundEntry` 的调用方）一行都不用改。
 */
const appendedEntries: FoliaBackgroundRegistryEntry[] = []

/** order 升序；同 order 按 mode 排序，保证列表顺序稳定（对齐 Folia `registry.tsx:13-33`）。 */
function sortEntries(entries: FoliaBackgroundRegistryEntry[]): FoliaBackgroundRegistryEntry[] {
  return [...entries].sort((a, b) => a.order - b.order || a.mode.localeCompare(b.mode))
}

assertFoliaModeList(
  'folia/registry.ts',
  builtinEntries.map((entry) => entry.mode),
  FOLIA_BACKGROUND_MODES
)

/** 全部 entry（内置 + 运行期追加），按 order 升序。每次调用返回新数组，调用方可放心排序。 */
export function foliaBackgroundEntries(): FoliaBackgroundRegistryEntry[] {
  return sortEntries([...builtinEntries, ...appendedEntries])
}

/** 追加一个 entry，返回移除函数（对齐 Folia 的 append / remove 成对语义）。 */
export function appendFoliaBackgroundEntry(entry: FoliaBackgroundRegistryEntry): () => void {
  appendedEntries.push(entry)
  return () => removeFoliaBackgroundEntry(entry.mode)
}

/** 按 mode 移除追加的 entry（内置 entry 移不掉，避免运行期把默认模式删没）。 */
export function removeFoliaBackgroundEntry(mode: FoliaBackgroundMode | string): void {
  const index = appendedEntries.findIndex((entry) => entry.mode === mode)
  if (index >= 0) appendedEntries.splice(index, 1)
}

/**
 * 按 mode 取 entry；**未命中回退默认模式**（latent），不抛错也不返回空。
 *
 * 为什么回退而不是抛错：mode 是持久化值，旧配置 / 手改过的 localStorage /
 * 未来删掉的模式都会走到这里。渲染层拿到 null 的唯一后果是白屏，
 * 而这正是「未命中回退」要避免的（对齐 Folia `registry.tsx:54-57`）。
 */
export function resolveFoliaBackgroundEntry(
  mode: FoliaBackgroundMode | string | null | undefined
): FoliaBackgroundRegistryEntry {
  const all = foliaBackgroundEntries()
  return (
    all.find((entry) => entry.mode === mode) ??
    all.find((entry) => entry.mode === DEFAULT_FOLIA_BACKGROUND_MODE) ??
    // 追加入口理论上不会把默认模式挤掉（内置表恒定含 latent），这里只是给类型收口
    all[0]
  )
}

/**
 * 选择器标签：翻译缺失时用 `labelFallback`。
 *
 * `translate` 本仓库暂时不传（没有 i18n 层），保留这个参数是为了将来接 i18n 时
 * **不改调用方**；判定条件照抄 Folia：`t(key)` 返回空串或原样 key 都算「没翻译」。
 */
export function getFoliaBackgroundModeLabel(
  entry: FoliaBackgroundRegistryEntry,
  translate?: (key: string) => string
): string {
  if (!translate) return entry.labelFallback
  const translated = translate(entry.labelKey)
  return translated && translated !== entry.labelKey ? translated : entry.labelFallback
}
