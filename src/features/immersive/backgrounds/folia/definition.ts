import type { FoliaBackgroundRegistryEntry } from './types'

/**
 * 恒等函数，只为类型推断（对齐 Folia `backgrounds/definition.ts:131` 的思路）。
 *
 * 它的价值是「声明点即校验点」：`mode` 写错、`component` 类型不对，会在写 entry 的那一行
 * 报错，而不是等到注册表排序或渲染时才暴露。运行时零开销。
 */
export function defineBackground(
  entry: FoliaBackgroundRegistryEntry
): FoliaBackgroundRegistryEntry {
  return entry
}
