import type { FumeTheme } from './fume-types'

/**
 * 静态快照 / 实时栅格的主题指纹（§11.1 的失效清单）。
 *
 * 字体三件套和字重都必须参与：这些缓存里烤了字形，字体或字重变化后继续命中旧缓存
 * 会让已经画出来的区块停留在上一套字体上。用 `\u0000` 分隔，避免字体族名里的冒号
 * 把两个不同主题拼成同一个指纹。
 */
export function resolveFumeThemeFingerprint(theme: FumeTheme): string {
  return [
    theme.name,
    theme.primaryColor,
    theme.secondaryColor,
    theme.accentColor,
    theme.fontStyle,
    theme.fontFamily ?? '',
    (theme.fontFamilyStack ?? []).join(','),
    theme.fontWeight ?? 'auto'
  ].join('\u0000')
}
