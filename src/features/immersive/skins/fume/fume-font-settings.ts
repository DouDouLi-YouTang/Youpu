/**
 * 「浮名」把 Folia 字体设置翻译成画布主题字段的纯函数层。
 *
 * `FumeTheme` 的 `fontFamilyStack` 语义是**原始字体族数组**，内置衬线族由
 * `resolveFumeFontFamily` 在测量时追加；因此这里不能把 `buildFoliaFontStack()`
 * 的整段 CSS 字符串塞进去，否则它会被当成一个字体族名。
 */

import {
  sanitizeFoliaFontFamilies,
  sanitizeFoliaFontWeight,
  type FoliaFontSettings
} from '../../folia-font-settings'

export interface FumeFontSelection {
  /** 自定义字体链；`undefined` = 跟随主题内置字体。 */
  fontFamilyStack: string[] | undefined
  /** 自定义字重；`undefined` = 跟随 hero / body 的内置字重。 */
  fontWeight: number | undefined
}

/**
 * 读取一档 Folia 字体设置。
 *
 * `custom` 只控制自定义字体族；字重始终独立生效。这样三套主题共用一条明确语义：
 * 关闭自定义字体时仍可调整字重，持久化层理论上已经清洗过，这里再做一次清洗是为了
 * 兼容运行中的手改状态。
 */
export function resolveFumeFontSelection(
  value: FoliaFontSettings | null | undefined
): FumeFontSelection {
  if (!value) {
    return { fontFamilyStack: undefined, fontWeight: undefined }
  }

  const families = value.custom ? sanitizeFoliaFontFamilies(value.families) : []
  const weight = sanitizeFoliaFontWeight(value.weight)
  return {
    fontFamilyStack: families.length > 0 ? families : undefined,
    fontWeight: weight ?? undefined
  }
}

/**
 * 浮名测量 / 排版缓存的字体指纹。
 *
 * 除了字体文件就绪状态，还必须带上自定义字体链和字重：`useFumeLayout` 用它作为
 * `lastFumeLayoutCache` 的第二个判据，字体设置变化时不能命中旧文章。
 */
export function buildFumeFontKey(fontState: unknown, selection: FumeFontSelection): string {
  return JSON.stringify([fontState, selection.fontFamilyStack ?? [], selection.fontWeight ?? null])
}
