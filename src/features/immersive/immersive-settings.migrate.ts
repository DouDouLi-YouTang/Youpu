import { createDefaultSettings, type ImmersiveSettings } from './immersive-settings.model'
import { DEFAULT_SKIN_ID } from './skins/types'

/**
 * 沉浸设置的**纯迁移逻辑** —— 与 store 分开，只为了能在 node 环境单测
 * （vitest 的 environment 是 node，没有 localStorage / jsdom；store 里的迁移要读
 * localStorage，直接测 store 得注入一堆 mock）。
 *
 * 这里只做「数据的形状变换」，不碰 store、不碰 storage。
 * ⚠️ 依赖必须指向 `immersive-settings.model`（纯数据层），**不能**指向 store ——
 * store 反过来 import 本文件，指过去就成环了（见 model 顶部说明）。
 *
 * 持久化格式换过两次，这里一律按**形状**判断，不看版本号（老数据从来没有版本号）：
 *   v1 扁平   —— 顶层直接挂设置字段 + skin。字段名与当前结构一一对应，无需搬运，
 *                只有 `customFontFamily` 的旧格式（string）要收成数组。
 *   v2 分桶   —— `{ skin, panels: { classic, tilt } }`。那是皮肤系统刚上线时的中间版本：
 *                当时把「经典」与「倾诉」当成两个各有全套设置的面板。该设计已被用户否决
 *                （倾诉没有设置），所以 v2 只需把 **classic 那一桶**取出来当全局设置，
 *                tilt 桶按设计丢弃。
 *   v3 扁平   —— 当前结构：与 v1 同形，但含义不同，这份设置**只属于「经典」面板**
 *                （倾诉没有设置，外观全部固定；只沿用少数沉浸页通用项，读的是同一份）。
 */

/**
 * 判断是不是 v2 的**分桶**结构。
 *
 * 判据是「顶层有 panels 对象」。v1 / v3 的顶层都是设置字段本身，绝不会出现 panels；
 * 单看 `skin` 之类没法区分，因为两种结构都有 skin。
 */
export function isBucketed(raw: Record<string, unknown>): boolean {
  const panels = raw.panels
  return (
    panels !== undefined && typeof panels === 'object' && panels !== null && !Array.isArray(panels)
  )
}

/**
 * 从 v2 的分桶数据里取出「经典」那一桶，作为全局设置。
 *
 * 以当前默认值为底、**只覆盖老数据里出现过的已知键**（未知键天然被忽略，不会污染新结构）。
 * 取不到 classic 桶 / 桶不是对象 → 返回空 Partial（调用方保留默认值，不覆盖成 undefined）。
 *
 * ⚠️ 返回值里的 `customFontFamily` 可能仍是旧格式（string），调用方必须接着跑
 * `normalizeFontFamily`。
 */
export function settingsFromBucketed(raw: Record<string, unknown>): Partial<ImmersiveSettings> {
  const panels = raw.panels
  if (!panels || typeof panels !== 'object' || Array.isArray(panels)) return {}
  const classic = (panels as Record<string, unknown>)[DEFAULT_SKIN_ID]
  if (!classic || typeof classic !== 'object' || Array.isArray(classic)) return {}

  const base = createDefaultSettings()
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(base)) {
    const value = (classic as Record<string, unknown>)[key]
    if (value !== undefined) out[key] = value
  }
  return out as Partial<ImmersiveSettings>
}

/**
 * 把 `customFontFamily` 从旧格式（string）收成数组，**幂等**。
 * 返回是否发生了修改（调用方据此决定要不要写回 storage）。
 *
 * 旧版本（更早的 store）持久化的是字符串，pinia-plugin-persistedstate 恢复时
 * 会用它覆盖默认的 `[]`，必须在首次使用前转一次 —— 否则 `use-backdrop` 的
 * `customFontFamily.map(...)` 拿到字符串会直接抛 TypeError。
 */
export function normalizeFontFamily(target: { customFontFamily: string[] }): boolean {
  if (Array.isArray(target.customFontFamily)) return false
  const legacy = target.customFontFamily as unknown
  target.customFontFamily = legacy ? [legacy as string] : []
  return true
}

/** 把非法的皮肤 id 纠正成默认值。返回是否发生了修改。 */
export function sanitizeSkinId(id: string, allowed: readonly string[], fallback: string): string {
  return allowed.includes(id) ? id : fallback
}
