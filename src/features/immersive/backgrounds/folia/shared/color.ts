/**
 * 颜色工具 —— Folia `components/visualizer/colorMix.ts` 的行为规格重写（§4.1、§6.1、§9）。
 *
 * 三条与 Folia 一致的行为，改动会直接改变画面：
 *  1. **不认识的格式原样返回**（命名色、hsl()、渐变串…）。调用方常把结果直接塞进 CSS，
 *     拼成 rgba() 反而会破坏原值。
 *  2. 空串 / 坏 hex / 坏 rgb() 视为「本意是颜色但解析失败」→ 回退**白色**
 *     （Folia `colorMix.ts:79` 的 `FALLBACK_RGB`）。
 *  3. `rgb()/rgba()` 只取前三个通道；第四个（alpha）被忽略，alpha 一律由调用方指定。
 */

export interface RgbChannels {
  r: number
  g: number
  b: number
}

const FALLBACK_RGB: RgbChannels = { r: 255, g: 255, b: 255 }

/** 解析结果：颜色通道 / 需要回退白色 / 不是颜色（原样透传） */
type ParsedColor = RgbChannels | 'fallback' | 'passthrough'

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

function readColor(color: string): ParsedColor {
  if (!color) return 'fallback'

  if (color.startsWith('#')) {
    const hex = color.slice(1)
    const parse = (value: string): number => Number.parseInt(value, 16)
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      return {
        r: parse(hex[0] + hex[0]),
        g: parse(hex[1] + hex[1]),
        b: parse(hex[2] + hex[2])
      }
    }
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      return { r: parse(hex.slice(0, 2)), g: parse(hex.slice(2, 4)), b: parse(hex.slice(4, 6)) }
    }
    return 'fallback'
  }

  const rgbMatch = color.match(/^rgba?\(([^)]+)\)$/)
  if (rgbMatch) {
    const [r, g, b] = rgbMatch[1]
      .split(',')
      .slice(0, 3)
      .map((part) => Number.parseFloat(part.trim()))
    if ([r, g, b].every((channel) => Number.isFinite(channel))) return { r, g, b }
    return 'fallback'
  }

  return 'passthrough'
}

/**
 * 主题色在一次性会话里会被每帧、每个形状反复查询，正则与 parseInt 是这里最贵的部分，
 * 所以按字符串缓存解析结果（容量有上限，避免用户导入大量主题时无限增长）。
 */
const parsedColors = new Map<string, ParsedColor>()
const PARSED_COLOR_LIMIT = 512

function parseColor(color: string): { normalized: string; parsed: ParsedColor } {
  const normalized = typeof color === 'string' ? color.trim() : ''
  let parsed = parsedColors.get(normalized)
  if (parsed === undefined) {
    parsed = readColor(normalized)
    if (parsedColors.size >= PARSED_COLOR_LIMIT) parsedColors.clear()
    parsedColors.set(normalized, parsed)
  }
  return { normalized, parsed }
}

/** 颜色 + alpha → `rgba(...)`；不认识的颜色格式原样返回（对齐 Folia `colorWithAlpha`）。 */
export function colorWithAlpha(color: string, alpha: number): string {
  const normalizedAlpha = clamp(alpha, 0, 1)
  const { normalized, parsed } = parseColor(color)
  if (parsed === 'passthrough') return normalized
  const channels = parsed === 'fallback' ? FALLBACK_RGB : parsed
  return `rgba(${Math.round(clamp(channels.r, 0, 255))}, ${Math.round(
    clamp(channels.g, 0, 255)
  )}, ${Math.round(clamp(channels.b, 0, 255))}, ${normalizedAlpha})`
}

/**
 * 取出颜色通道；不是 hex / rgb() 时返回 null（调用方自行决定回退）。
 * 与 `colorWithAlpha` 不同：这里**不回退白色** —— sora 要靠 null 判断「该用黑白兜底」。
 */
export function parseColorChannels(color: string): RgbChannels | null {
  const { parsed } = parseColor(color)
  return typeof parsed === 'string' ? null : { ...parsed }
}

/** 解析成功则**钳到 0–255**，否则用 fallback（monet 合成管线需要逐通道数值）。 */
export function resolveThemeChannels(color: string, fallback: RgbChannels): RgbChannels {
  const parsed = parseColorChannels(color)
  if (!parsed) return fallback
  return {
    r: clamp(parsed.r, 0, 255),
    g: clamp(parsed.g, 0, 255),
    b: clamp(parsed.b, 0, 255)
  }
}

/** 逐通道线性插值，t 已钳到 0–1。 */
export function mixChannels(from: RgbChannels, to: RgbChannels, amount: number): RgbChannels {
  const t = clamp(amount, 0, 1)
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t
  }
}

/** 逐通道数值 → `#rrggbb`（用于取色链路与单测断言） */
export function channelsToHex(channels: RgbChannels): string {
  const toHex = (value: number): string =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(channels.r)}${toHex(channels.g)}${toHex(channels.b)}`
}

/** 感知亮度权重（Folia 的 0.2126 / 0.7152 / 0.0722 口径，未做 sRGB 反变换） */
export function luminanceOf(channels: RgbChannels): number {
  return 0.2126 * channels.r + 0.7152 * channels.g + 0.0722 * channels.b
}

/** 仅测试用：清空颜色解析缓存 */
export function clearColorCacheForTests(): void {
  parsedColors.clear()
}
