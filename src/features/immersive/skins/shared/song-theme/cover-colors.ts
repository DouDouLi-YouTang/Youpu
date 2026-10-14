/**
 * 封面 → **鲜艳色盘**（逐歌主题的颜色来源）。
 *
 * ## 与背景层那套取色的分工
 *
 * `backgrounds/folia/shared/cover-palette.ts` 的 `extractRepresentativeColors` 是
 * **代表性**取色（加权中位切分）：它要的是「这张图由哪几块大面积颜色构成」，
 * 服务于 latent / mesh 那种需要把色块摆进固定槽位的画面。
 *
 * 本模块要的是**鲜艳**色：主题的四个颜色要从封面里「最像这张图身份」的那一块推出来，
 * 而大面积色块往往是背景纸面（见 `cover-analysis` 的选主色说明）。
 * 两者的诉求相反，所以是两套选择规则 —— 但**共用同一套像素读取**
 * （`loadImagePixels`：CORS、50×50 采样、画布污染的回退都在那边处理过了），
 * 不重复实现一遍 canvas 逻辑。
 *
 * ## 采样为什么隔 2 个像素
 *
 * 50×50 = 2500 个像素，全量遍历在取色热路径上是没必要的一档开销；
 * 隔点采样等于用 625 个点描述同一张 50×50 的缩略图，对「挑几块主色」这个目的足够。
 * 这一步与上游一致 —— 采样密度会直接影响取到的颜色，不是可以随手调的参数。
 *
 * 失败（图加载不出来 / 画布被污染）一律返回 `[]`：调用方据此走「无封面色」路径。
 */

import { channelsToHex, type RgbChannels } from '../../../backgrounds/folia/shared/color'
import { loadImagePixels } from '../../../backgrounds/folia/shared/cover-palette'

/** 采样步长（像素）：见文件头 */
const SAMPLE_STEP = 2

/** 低于该 alpha 的像素视为透明，跳过 */
const MIN_ALPHA = 128

/** 「有颜色」的饱和度门槛：0.2 ≈ 一眼能看出色相 */
const MIN_SATURATION = 0.2

/** 亮度上限/下限：纯黑与纯白不带色相，不配当主题色 */
const MIN_LIGHTNESS = 30
const MAX_LIGHTNESS = 220

/**
 * 低饱和像素的**保底收集量**。
 *
 * 高饱和像素凑不够 `count` 个时，从这里补 —— 一张黑白封面若因为「没有鲜艳色」
 * 而返回空数组，主题会退化成「无封面随机色」，那比「用它的灰调本身」更不像这张图。
 */
const FALLBACK_COLLECT_LIMIT = 100

/** 两个色块之间的最小 RGB 欧氏距离：太近的两个色块算不上「两种颜色」 */
const MIN_COLOR_DISTANCE = 20

/** 像素 RGB → 饱和度（0–1）。分母用 `255 - |max + min - 255|`，与 HSL 同口径 */
function saturationOf({ r, g, b }: RgbChannels): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  return (max - min) / (255 - Math.abs(max + min - 255))
}

/** 两个色块的 RGB 欧氏距离 */
function colorDistance(a: RgbChannels, b: RgbChannels): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

/**
 * RGBA 像素 → 鲜艳色盘（十六进制串，按饱和度降序，最多 `count` 个）。
 *
 * 纯函数、无 DOM 依赖，`pixels` 是 `ImageData.data` 的形状，因此可在 node 单测。
 */
export function extractVibrantColorsFromPixels(
  pixels: Uint8ClampedArray | number[],
  count = 5
): string[] {
  if (count <= 0) return []

  const collected: RgbChannels[] = []
  let fallbackCount = 0

  for (let index = 0; index < pixels.length; index += 4 * SAMPLE_STEP) {
    if (pixels[index + 3] < MIN_ALPHA) continue

    const color: RgbChannels = {
      r: pixels[index],
      g: pixels[index + 1],
      b: pixels[index + 2]
    }
    const saturation = saturationOf(color)
    const lightness =
      (Math.max(color.r, color.g, color.b) + Math.min(color.r, color.g, color.b)) / 2

    if (saturation > MIN_SATURATION && lightness > MIN_LIGHTNESS && lightness < MAX_LIGHTNESS) {
      collected.push(color)
    } else if (fallbackCount < FALLBACK_COLLECT_LIMIT) {
      collected.push(color)
      fallbackCount += 1
    }
  }

  // 饱和度降序：鲜艳的排在前面，逐块挑选时先被选中
  collected.sort((a, b) => saturationOf(b) - saturationOf(a))

  const distinct: RgbChannels[] = []
  for (const color of collected) {
    if (distinct.length >= count) break
    const isDistinct = distinct.every((picked) => colorDistance(color, picked) > MIN_COLOR_DISTANCE)
    if (isDistinct || distinct.length === 0) distinct.push(color)
  }

  return distinct.map(channelsToHex)
}

/**
 * 封面 URL → 鲜艳色盘。取图失败 / 画布被污染 → `[]`（调用方走无封面路径）。
 *
 * `silent` 默认 `true`：逐歌主题会在切歌时自动跑，封面加载失败是完全预期的路径
 * （本地歌、无网络、`muice-cover://` 在某些环境下不可读），不该在控制台刷警告。
 */
export async function extractVibrantCoverColors(
  imageUrl: string,
  count = 5,
  options: { silent?: boolean } = {}
): Promise<string[]> {
  const pixels = await loadImagePixels(imageUrl, { silent: options.silent ?? true })
  return pixels ? extractVibrantColorsFromPixels(pixels, count) : []
}
