/**
 * Folia 字体设置的纯函数层。
 *
 * 这里不依赖 Vue / DOM / store，供设置模型、迁移和渲染层共用。持久化时只保存
 * 字体族名称；转成 CSS 栈时再统一转义并追加兜底字体。
 */
export interface FoliaFontSettings {
  custom: boolean
  families: string[]
  /** null 表示跟随主题内置字重。 */
  weight: number | null
}

const GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong'
])

/** 新建一套 Folia 字体设置；每次调用都返回全新的数组。 */
export function createFoliaFontSettingsDefaults(): FoliaFontSettings {
  return {
    custom: false,
    families: [],
    weight: null
  }
}

/**
 * 清洗字体回退链：只保留字符串，trim 后去掉空项，按首次出现顺序去重。
 *
 * 字体族名在 CSS 中按大小写不敏感匹配，因此这里也用忽略大小写的键去重，
 * 同时保留用户第一次输入时的写法。
 */
export function sanitizeFoliaFontFamilies(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const families: string[] = []
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue
    const family = candidate.trim()
    if (!family) continue

    const key = family.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    families.push(family)
  }
  return families
}

/** 字重只接受 null（跟随主题）或 100–900 的整百数。 */
export function sanitizeFoliaFontWeight(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < 100 || value > 900 || value % 100 !== 0) return null
  return value
}

/** 把持久化中的未知值收成完整的 Folia 字体设置。 */
export function normalizeFoliaFontSettings(value: unknown): FoliaFontSettings {
  const raw =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}

  return {
    custom: typeof raw.custom === 'boolean' ? raw.custom : false,
    families: sanitizeFoliaFontFamilies(raw.families),
    weight: sanitizeFoliaFontWeight(raw.weight)
  }
}

/**
 * 把单个字体族名转成带引号的 CSS 字符串 token。
 *
 * 除引号和反斜杠外，控制字符也转成 CSS 十六进制转义，避免字体名截断样式；
 * 返回结果已经包含单引号，可直接放进 font-family 栈。
 */
export function escapeFontFamily(family: string): string {
  let escaped = ''
  for (const character of family) {
    const codePoint = character.codePointAt(0) ?? 0
    if (character === '\\') {
      escaped += '\\\\'
    } else if (character === "'") {
      escaped += "\\'"
    } else if (codePoint < 0x20 || codePoint === 0x7f) {
      escaped += `\\${codePoint.toString(16)} `
    } else {
      escaped += character
    }
  }
  return `'${escaped}'`
}

function formatFontFamily(family: string): string {
  const normalized = family.toLowerCase()
  return GENERIC_FONT_FAMILIES.has(normalized) ? normalized : escapeFontFamily(family)
}

/**
 * 构造最终 CSS 字体栈：自定义族在前，主题内置族随后，最后保证有通用兜底族。
 * 所有名称先做同一套清洗，因此跨来源的重复项也只会保留第一次出现的位置。
 */
export function buildFoliaFontStack(
  customFamilies: unknown,
  fallbackFamilies: readonly string[] = [],
  genericFallback = 'sans-serif'
): string {
  const families = sanitizeFoliaFontFamilies([
    ...sanitizeFoliaFontFamilies(customFamilies),
    ...sanitizeFoliaFontFamilies(fallbackFamilies)
  ])
  const tokens = families.map(formatFontFamily)

  // 调用方按需选择 serif / sans-serif；沿用原有泛型：
  // 主题字体默认是衬线，只有明确传 sans-serif 时才走无衬线兜底。
  const fallbackToken = GENERIC_FONT_FAMILIES.has(genericFallback.toLowerCase())
    ? genericFallback.toLowerCase()
    : formatFontFamily(genericFallback)
  if (!families.some((family) => family.toLowerCase() === fallbackToken)) {
    tokens.push(fallbackToken)
  }
  return tokens.join(', ')
}
