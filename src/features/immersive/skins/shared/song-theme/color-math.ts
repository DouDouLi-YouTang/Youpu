/**
 * 逐歌主题的**颜色数学** —— RGB/HSL 互换、WCAG 相对亮度与对比度、亮度求解。
 *
 * ## 为什么需要单独一层
 *
 * 「每首歌主题色都一样」的根因是四个颜色都是写死的字面量（见 `use-folia-palette.ts`）。
 * 要改成「从封面推出每首歌自己的四个颜色」，就必须有一套颜色运算：
 * 色相走短弧的插值（否则混色会绕远路穿过互补色）、
 * 以及**对比度求解** —— 文字色必须压过背景，否则封面越浅、歌词越看不见。
 *
 * ## 三条必须守住的口径
 *
 * 1. **相对亮度走 sRGB 反变换**（WCAG 的 `0.03928` 分段 + `2.4` 次幂），
 *    不是 `0.2126r + 0.7152g + 0.0722b` 的直算：后者是感知亮度的近似，
 *    拿它算对比度会在深色端系统性偏乐观。
 *    ⚠️ `backgrounds/folia/shared/color.ts` 的 `luminanceOf` 就是后者，
 *    它服务于「该取黑字还是白字」的粗判，**不要与本模块混用**。
 * 2. **只认 `#rgb` / `#rrggbb`**：本模块的输入全部是自己生成的十六进制色
 *    （见 `generate.ts`）与封面色（见 `cover-colors.ts`），没有 `rgb()` /
 *    命名色的来源。不做半套兼容，比做半套更不容易出错。
 * 3. **纯函数、不碰 DOM**：整套推导可以在 node 环境直接单测。
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface Hsl {
  h: number
  s: number
  l: number
}

/** 数值钳到 `[0, 1]` */
export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** 通道钳到 `[0, 255]` 并四舍五入 */
function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

/** 色相归一化到 `[0, 360)` */
export function normalizeHue(hue: number): number {
  return ((hue % 360) + 360) % 360
}

/**
 * 解析 `#rgb` / `#rrggbb`。**不做** trim、大小写以外的一切兼容。
 *
 * 输入不合法时返回 `null`（而不是抛错）：整条链路允许「封面给了一个怪串」这种输入，
 * 调用方看到 `null` 就跳过这一个色块，比中途炸掉整首歌的主题便宜得多。
 */
export function parseHexColor(value: unknown): Rgb | null {
  if (typeof value !== 'string') return null
  if (value.length !== 4 && value.length !== 7) return null
  if (value[0] !== '#') return null

  const hex = value.slice(1)
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null

  if (hex.length === 3) {
    return {
      r: Number.parseInt(hex[0] + hex[0], 16),
      g: Number.parseInt(hex[1] + hex[1], 16),
      b: Number.parseInt(hex[2] + hex[2], 16)
    }
  }

  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16)
  }
}

/** 通道 → `#rrggbb`（小写，便于与单测断言逐字比较） */
export function rgbToHex({ r, g, b }: Rgb): string {
  return (
    '#' + [r, g, b].map((channel) => clampChannel(channel).toString(16).padStart(2, '0')).join('')
  )
}

/** RGB → HSL（`h` 为度、`s` / `l` 为 `[0, 1]`） */
export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = clampChannel(r) / 255
  const green = clampChannel(g) / 255
  const blue = clampChannel(b) / 255

  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  const lightness = (max + min) / 2

  if (delta === 0) return { h: 0, s: 0, l: lightness }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  const hue =
    max === red
      ? ((green - blue) / delta) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4

  return { h: normalizeHue(hue * 60), s: clamp01(saturation), l: clamp01(lightness) }
}

/** HSL → RGB */
export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hue = normalizeHue(h)
  const saturation = clamp01(s)
  const lightness = clamp01(l)

  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const offset = lightness - chroma / 2

  const sector = Math.floor(hue / 60) % 6
  const [r, g, b] =
    sector === 0
      ? [chroma, second, 0]
      : sector === 1
        ? [second, chroma, 0]
        : sector === 2
          ? [0, chroma, second]
          : sector === 3
            ? [0, second, chroma]
            : sector === 4
              ? [second, 0, chroma]
              : [chroma, 0, second]

  return {
    r: clampChannel((r + offset) * 255),
    g: clampChannel((g + offset) * 255),
    b: clampChannel((b + offset) * 255)
  }
}

/** HSL → `#rrggbb` */
export function hslToHex(hsl: Hsl): string {
  return rgbToHex(hslToRgb(hsl))
}

/** `#rrggbb` → HSL；解析失败返回 `null` */
export function hexToHsl(color: string): Hsl | null {
  const parsed = parseHexColor(color)
  return parsed ? rgbToHsl(parsed) : null
}

/**
 * 两个颜色按 `amount` 线性混合（0 → `from`，1 → `to`），在十六进制空间里完成。
 *
 * 任一端解析失败时退化成「二选一」：混合两条无法解析的颜色没有正确答案，
 * 而返回一个确定的实色至少不会画出脏边。
 */
export function mixHexColors(from: string, to: string, amount: number): string {
  const start = parseHexColor(from)
  const end = parseHexColor(to)
  if (!start || !end) return end ? rgbToHex(end) : start ? rgbToHex(start) : from

  const ratio = clamp01(amount)
  return rgbToHex({
    r: start.r + (end.r - start.r) * ratio,
    g: start.g + (end.g - start.g) * ratio,
    b: start.b + (end.b - start.b) * ratio
  })
}

/** WCAG 相对亮度（sRGB 反变换后加权，见文件头第 1 条） */
export function getRelativeLuminance(color: string): number {
  const parsed = parseHexColor(color)
  if (!parsed) return 0

  const transform = (channel: number): number => {
    const normalized = channel / 255
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4)
  }

  return 0.2126 * transform(parsed.r) + 0.7152 * transform(parsed.g) + 0.0722 * transform(parsed.b)
}

/** WCAG 对比度（1 到 21）。两端解析失败时按「与黑比」退避，不会返回 NaN */
export function getContrastRatio(foreground: string, background: string): number {
  const a = getRelativeLuminance(foreground)
  const b = getRelativeLuminance(background)
  const [lighter, darker] = a > b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

/** 两个色相的最短角距（0–180），用于判断「这对颜色是不是撞在一起了」 */
export function getHueDistance(a: number, b: number): number {
  const distance = Math.abs(normalizeHue(a) - normalizeHue(b))
  return Math.min(distance, 360 - distance)
}

/**
 * 沿**亮度轴**把颜色推离背景，直到满足最低对比度；色相与饱和度保持不变。
 *
 * 为什么不是「不满足就换成黑/白」：那会让每首歌的主题色退化成同一组黑白，
 * 正是这次要修掉的问题。往上还是往下走由背景亮度决定 —— 背景亮就往暗推、
 * 背景暗就往亮推，方向由**背景**单方面决定，所以同一个颜色在明暗两档下会得到
 * 两个不同的结果（这是对的：它们要压过的是两个不同的背景）。
 *
 * 推到头（亮度钳到 0 或 1）仍不达标时返回**过程中对比度最高**的那个候选，
 * 而不是原色 —— 至少是当下能拿到的最好结果。
 */
export function adjustLightnessForContrast(
  color: string,
  background: string,
  minRatio: number,
  step = 0.02,
  maxSteps = 50
): string {
  const hsl = hexToHsl(color)
  if (!hsl) return color

  const direction = getRelativeLuminance(background) > 0.35 ? -1 : 1

  let bestColor = hslToHex(hsl)
  let bestRatio = getContrastRatio(bestColor, background)

  for (let index = 0; index <= maxSteps; index += 1) {
    const lightness = clamp01(hsl.l + direction * step * index)
    const candidate = hslToHex({ ...hsl, l: lightness })
    const ratio = getContrastRatio(candidate, background)

    if (ratio > bestRatio) {
      bestRatio = ratio
      bestColor = candidate
    }
    if (ratio >= minRatio) return candidate
    // 已经贴到亮度轴的一端，再走也不会变 —— 提前收工
    if (index > 0 && (lightness === 0 || lightness === 1)) break
  }

  return bestColor
}
