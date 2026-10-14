/**
 * 封面色盘 → **颜色骨架**（主色相 / 第二色相 / 和声方案 / 气质档）。
 *
 * ## 这一步在整条链路里的位置
 *
 * ```
 * 封面图 → cover-colors.ts 取出 5 个代表色
 *        → 【本模块】它们该以谁为主、配谁、走哪种和声
 *        → generate.ts 按骨架算出四个主题色
 * ```
 *
 * ## 为什么必须有「选主色」这一步，而不是直接取第一个
 *
 * 取色算法按**面积**排序，而面积大的往往是封面的背景纸面（大块浅灰、大块渐变底），
 * 它描述的是「这张图的底色」，不是「这张图想表达的颜色」。直接用会让绝大多数
 * 封面都得到同一个灰调主题。所以这里按「饱和度 × 离中明度的接近程度」打分：
 * 又艳又居中的色块才是封面的身份色，近黑近白只配当背景。
 *
 * ## 和声方案
 *
 * 六个方案各自决定强调色相与主色相的关系（同色 / 邻色 / 互补 / 三分 …）。
 * 方案不是随便挑的：封面上**真的存在**第二种颜色时，优先走 `duotone`（直接用那个
 * 颜色）—— 那是最「来自这张图」的强调色，比任何几何推导都贴题。
 *
 * 本模块是纯函数（随机性由调用方注入 `random`），可在 node 单测。
 */

import { getHueDistance, hexToHsl, normalizeHue, type Hsl } from './color-math'
import {
  MAX_SUPPORT_HUE_DISTANCE,
  MIN_SATURATED_COLOR,
  MIN_SUPPORT_HUE_DISTANCE,
  MONOCHROME_SATURATION_CEILING,
  type PaletteTone
} from './design-space'

/**
 * 和声方案 —— 「强调色相从主色相怎么推出来」的六种答案。
 *
 * `duotone` 是唯一一个**不从几何推导**的：它直接用封面上真实存在的第二种色相。
 */
export type HarmonyScheme =
  | 'analogous'
  | 'complementary'
  | 'split'
  | 'triadic'
  | 'duotone'
  | 'monochrome'

/** 颜色骨架：生成四个主题色所需的全部色相与气质信息 */
export interface CoverPalette {
  baseHue: number
  baseSaturation: number
  baseLightness: number
  accentHue: number
  scheme: HarmonyScheme
  tone: PaletteTone
}

/**
 * 一个色块的「身份分」：**又艳又居中最像这张封面的代表色**。
 *
 * `Math.max(0, 1 - |l - 0.5| * 1.2)` 这一项是可读性折扣：明度离 0.5 越远，
 * 折扣越大，到 `l = 0`（纯黑）或 `l ≈ 0.92` 以上就完全归零。
 */
function getCoverColorScore({ s, l }: Hsl): number {
  return s * Math.max(0, 1 - Math.abs(l - 0.5) * 1.2)
}

/**
 * 按权重随机取一项。
 *
 * 权重总和为 0（或非有限）时退化成**取最后一项**，而不是抛错或返回 `undefined`：
 * 这个函数在主题生成的热路径上，一条被污染的权重表不该让整首歌没有主题色。
 */
function pickWeighted<T>(
  random: () => number,
  entries: readonly { value: T; weight: number }[]
): T {
  if (entries.length === 0) throw new Error('pickWeighted: entries must not be empty')

  const total = entries.reduce((sum, entry) => sum + entry.weight, 0)
  if (!Number.isFinite(total) || total <= 0) return entries[entries.length - 1].value

  let cursor = random() * total
  for (const entry of entries) {
    cursor -= entry.weight
    if (cursor <= 0) return entry.value
  }
  return entries[entries.length - 1].value
}

/**
 * 选主色。
 *
 * 完全无色可用时（没封面、封面解码失败、整张图都是透明的）**也要返回一个色相** ——
 * 用随机源现挑一个。这保证了「无封面歌曲之间也不会撞色」：若这里返回一个固定值，
 * 所有取不到封面的歌会共享同一个主题，又变成「每首歌都一样」。
 */
function pickBaseColor(parsedColors: readonly Hsl[], random: () => number): Hsl {
  if (parsedColors.length === 0) {
    return { h: random() * 360, s: 0.35 + random() * 0.3, l: 0.5 }
  }

  let best = parsedColors[0]
  for (const candidate of parsedColors) {
    if (getCoverColorScore(candidate) > getCoverColorScore(best)) best = candidate
  }

  // 分数太低说明这张封面本来就没有「有颜色」的色块（比如整张黑白照），
  // 那就退回第一个（取色算法按面积排序的头部，最接近它的整体色调）
  return getCoverColorScore(best) > 0.02 ? best : parsedColors[0]
}

/**
 * 找封面上真实存在的第二种色相 —— 和声里的「配角」。
 *
 * 三条门槛缺一不可：够艳（能当颜色用）、离主色相**不够近**（太近就不是第二种颜色）、
 * 又**不够远**（太远是对比色，会跟主色打架）。
 */
function pickSupportHue(parsedColors: readonly Hsl[], base: Hsl): number | null {
  for (const candidate of parsedColors) {
    if (candidate.s < MIN_SATURATED_COLOR) continue
    const distance = getHueDistance(candidate.h, base.h)
    if (distance >= MIN_SUPPORT_HUE_DISTANCE && distance <= MAX_SUPPORT_HUE_DISTANCE) {
      return candidate.h
    }
  }
  return null
}

/**
 * 选和声方案。
 *
 * 封面上真有第二种颜色时，**65%** 直接用它（`duotone`）—— 剩下 35% 留给几何推导，
 * 否则「封面上有第二种颜色」的封面会全部长成同一个套路，看多了很单调。
 */
function pickScheme(
  baseSaturation: number,
  supportHue: number | null,
  random: () => number
): HarmonyScheme {
  if (supportHue !== null && random() < 0.65) return 'duotone'

  return pickWeighted<HarmonyScheme>(random, [
    { value: 'analogous', weight: 3 },
    { value: 'complementary', weight: 2 },
    { value: 'split', weight: 2 },
    { value: 'triadic', weight: 1.5 },
    // 本身就是近无彩的封面才给单色方案加权：给它配一个互补色是「加了它没有的东西」，
    // 而给一张彩封面上单色方案则是浪费了现成的颜色
    { value: 'monochrome', weight: baseSaturation < MONOCHROME_SATURATION_CEILING ? 2.5 : 0 }
  ])
}

/** 按和声方案算出强调色相（返回时已归一化到 `[0, 360)`） */
function resolveAccentHue(
  scheme: HarmonyScheme,
  baseHue: number,
  supportHue: number | null,
  random: () => number
): number {
  // 邻色 / 三分色有左右两个方向，随机取一边 —— 同一张封面重新生成时不会永远偏同一侧
  const sign = random() < 0.5 ? -1 : 1

  switch (scheme) {
    case 'duotone':
      return supportHue ?? baseHue
    case 'analogous':
      return baseHue + sign * (20 + random() * 15)
    case 'complementary':
      return baseHue + 150 + random() * 30
    case 'split':
      return baseHue + (sign < 0 ? 150 : 210)
    case 'triadic':
      return baseHue + sign * 120
    case 'monochrome':
    default:
      return baseHue
  }
}

/**
 * 封面色盘 → 颜色骨架。
 *
 * `coverColors` 是十六进制串数组（`cover-colors.ts` 的输出）；解析失败的项直接跳过，
 * 全部解析失败等价于「没有封面」。
 */
export function analyzeCoverPalette(
  coverColors: readonly string[],
  random: () => number
): CoverPalette {
  const parsedColors: Hsl[] = []
  for (const color of coverColors) {
    const hsl = hexToHsl(color)
    if (hsl) parsedColors.push(hsl)
  }

  const base = pickBaseColor(parsedColors, random)
  const supportHue = pickSupportHue(parsedColors, base)
  const scheme = pickScheme(base.s, supportHue, random)

  // 单色方案不加抖动：它的定义就是「强调色与主色同色相」，
  // 加了抖动就不再是单色，方案名会与画面对不上
  const accentJitter = scheme === 'monochrome' ? 0 : (random() - 0.5) * 16

  return {
    baseHue: normalizeHue(base.h),
    baseSaturation: base.s,
    baseLightness: base.l,
    accentHue: normalizeHue(resolveAccentHue(scheme, base.h, supportHue, random) + accentJitter),
    scheme,
    tone: pickWeighted<PaletteTone>(random, [
      { value: 'ink', weight: 3 },
      { value: 'tinted', weight: 4 },
      { value: 'rich', weight: 2.5 }
    ])
  }
}
