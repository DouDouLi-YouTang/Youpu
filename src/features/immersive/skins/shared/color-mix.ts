/**
 * 颜色字符串工具 —— 所有 Folia 系皮肤共享（上游 `src/components/visualizer/colorMix.ts`）。
 *
 * ## 为什么它必须在 shared 层
 *
 * 「浮名」的区块辉光、逐字素上色、背景渐变，以及「流光」的逐字辉光 alpha，全都要
 * 「同一个颜色 + 不同透明度」这一件事。上游把它抽成一个模块，本项目的两个皮肤也照做 ——
 * 一旦各写一份，同一个颜色在两个皮肤里会因为「取整时机不同」而差一个色阶。
 * `glow/core/word-glow.ts` 的 `WithAlpha` 注入接口就是为它准备的。
 *
 * ## 三条必须原样保留的怪癖（§17.3 第 5 条）
 *
 * 1. **只认 hex（3/6 位）与 `rgb()/rgba()`**：`hsl()`、命名色（`red`、`transparent`）会走
 *    `passthrough` 分支 —— 原样返回，**alpha 被丢掉**。这是上游行为，不要「顺手修复」：
 *    渲染层已经按「颜色一定来自 Material You 提取」的前提在写，改掉只会让
 *    `transparent` 这类哨兵值突然变成 `rgba(255,255,255,0)`（虽然看起来一样，
 *    但会让 canvas 的 `shadowColor = 'transparent'` 断言失效）。
 * 2. **解析失败（空串、坏 hex、`rgb(1,2)`）回退成白色** `rgba(255,255,255,alpha)`：
 *    比回退成黑色安全 —— 深色纸面上的黑字等于看不见。
 * 3. **通道值四舍五入、alpha 不取整**：`rgba(1, 2, 3, 0.30000000000000004)` 这种串
 *    是允许出现的（上游原样）。canvas / CSS 都能解析，不要画蛇添足加 `toFixed`。
 *
 * ## 缓存
 *
 * 渲染层会**逐字素**问同一个主题色（一首歌每帧上千次），而正则匹配与 `parseInt` 是
 * 这里唯一的成本。所以按「归一化后的颜色串」做一次有界缓存（插入序淘汰，上限 512）。
 * 缓存的是**解析结果**（通道或分支标记），不是最终字符串 —— 因为同一个颜色的 alpha 每帧都变。
 *
 * 淘汰规则本身住在 `shared/bounded-cache.ts`：F2 的字素测量缓存（§4.7）也要用同一条，
 * 于是按当时预留的计划提到了更底层，两个调用点共享同一份实现。
 */

import { rememberBounded } from './bounded-cache'

/** 解析出来的 RGB 通道 */
interface Channels {
  r: number
  g: number
  b: number
}

/**
 * 一次解析的结果：
 * - `Channels`：hex / rgb() 解析成功
 * - `'fallback'`：本来应该是颜色但解析失败（空串、`#12`、`rgb(1,2)`）→ 用白色兜底
 * - `'passthrough'`：不是 hex/rgb 语法（命名色、`hsl()`…）→ 原样返回，忽略 alpha
 */
type ParsedColor = Channels | 'fallback' | 'passthrough'

/** 解析失败时的兜底色（白） */
const FALLBACK_RGB: Channels = { r: 255, g: 255, b: 255 }

/** 解析缓存上限：远大于一首歌用到的颜色数，同时防止长会话无限增长 */
const PARSED_COLOR_LIMIT = 512

const parsedColors = new Map<string, ParsedColor>()

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** 解析一个颜色串（不做 trim，调用方已完成归一化） */
function readColor(normalizedColor: string): ParsedColor {
  if (!normalizedColor) return 'fallback'

  if (normalizedColor.startsWith('#')) {
    const hex = normalizedColor.slice(1)
    const parseChannel = (value: string) => Number.parseInt(value, 16)

    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      return {
        r: parseChannel(hex[0] + hex[0]),
        g: parseChannel(hex[1] + hex[1]),
        b: parseChannel(hex[2] + hex[2])
      }
    }

    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      return {
        r: parseChannel(hex.slice(0, 2)),
        g: parseChannel(hex.slice(2, 4)),
        b: parseChannel(hex.slice(4, 6))
      }
    }

    // 4/8 位 hex（含 alpha）也走这里 —— 上游没支持
    return 'fallback'
  }

  const rgbMatch = normalizedColor.match(/^rgba?\(([^)]+)\)$/)
  if (rgbMatch) {
    const [r, g, b] = rgbMatch[1]
      .split(',')
      .slice(0, 3)
      .map((part) => Number.parseFloat(part.trim()))
    if ([r, g, b].every((channel) => Number.isFinite(channel))) {
      return { r, g, b }
    }
    return 'fallback'
  }

  return 'passthrough'
}

/** 取「归一化颜色串 → 解析结果」，命中缓存时不重复跑正则 */
function parseColor(color: string): { normalized: string; parsed: ParsedColor } {
  const normalized = typeof color === 'string' ? color.trim() : ''
  let parsed = parsedColors.get(normalized)
  if (parsed === undefined) {
    parsed = rememberBounded(parsedColors, normalized, readColor(normalized), PARSED_COLOR_LIMIT)
  }
  return { normalized, parsed }
}

/** 组装 `rgba(...)`：通道取整并钳到 0..255，alpha 原样输出 */
function formatRgba(channels: Channels, alpha: number): string {
  return `rgba(${Math.round(clamp(channels.r, 0, 255))}, ${Math.round(
    clamp(channels.g, 0, 255)
  )}, ${Math.round(clamp(channels.b, 0, 255))}, ${alpha})`
}

/**
 * 给一个颜色加透明度。
 *
 * ⚠️ 传入命名色 / `hsl()` 时**原样返回**（alpha 被忽略），传入坏 hex / 非有限通道时
 * 回退白色。见文件头第 1、2 条。
 */
export function colorWithAlpha(color: string, alpha: number): string {
  const normalizedAlpha = clamp(alpha, 0, 1)
  const { normalized, parsed } = parseColor(color)
  if (parsed === 'passthrough') return normalized
  return formatRgba(parsed === 'fallback' ? FALLBACK_RGB : parsed, normalizedAlpha)
}

/**
 * 取颜色的三个通道；不是 hex / `rgb()` 时返回 `null`。
 *
 * 与 `colorWithAlpha` 的差别：它把「解析失败」和「不是颜色语法」一并折叠成 `null`，
 * 调用方（如背景的渐变端点）需要自己决定回退色。
 */
export function parseColorChannels(color: string): Channels | null {
  const { parsed } = parseColor(color)
  return typeof parsed === 'string' ? null : { ...parsed }
}

/**
 * 两个颜色按 `amount` 混合（0 → `from`，1 → `to`），再整体乘一个 alpha。
 *
 * 只要任一端解析不了（命名色 / 坏值），就退化成「按 0.5 为界二选一 + 加 alpha」：
 * 混合两条无法混合的颜色没有正确答案，而返回一个确定的实色至少不会画出脏边。
 */
export function mixColors(from: string, to: string, amount: number, alpha = 1): string {
  const normalizedAmount = clamp(amount, 0, 1)
  const fromParsed = parseColor(from).parsed
  const toParsed = parseColor(to).parsed

  if (typeof fromParsed === 'string' || typeof toParsed === 'string') {
    return colorWithAlpha(normalizedAmount >= 0.5 ? to : from, alpha)
  }

  return `rgba(${Math.round(fromParsed.r + (toParsed.r - fromParsed.r) * normalizedAmount)}, ${Math.round(
    fromParsed.g + (toParsed.g - fromParsed.g) * normalizedAmount
  )}, ${Math.round(
    fromParsed.b + (toParsed.b - fromParsed.b) * normalizedAmount
  )}, ${clamp(alpha, 0, 1)})`
}
