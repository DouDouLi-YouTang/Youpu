import { channelsToHex, type RgbChannels } from './color'

/**
 * 封面取色 —— Folia `utils/colorExtractor.ts` + `utils/colorPalette.ts` 的算法重写（§3.4）。
 *
 * 为什么不用本仓库 `use-color-extraction.ts` 的 Material You（QuantizerCelebi）：
 * latent 的 `cover-only` 模式把六色分别塞进六个不同的槽位，**顺序决定画面**。
 * 用另一套算法「取到同样的颜色」也还原不了同一张 mesh（§11 风险 4）。
 * 所以这里按规格把 4-bit 量化直方图 + 加权中位切分重写一遍。
 *
 * 采样尺寸固定 50×50（与 Folia 一致）：再大只是更慢，中位切分的直方图早就饱和了。
 */

/** 采样边长（Folia `colorExtractor.ts:25-26`） */
const SAMPLE_SIZE = 50
/** 4-bit 量化：每个通道右移 4 位 → 每通道 16 档 */
const QUANTIZATION_SHIFT = 4
/** 低于该 alpha 的像素视为透明跳过 */
const MIN_ALPHA = 128

export interface LoadImagePixelsOptions {
  /** true 时不打 warn（批量取色 / 预期会失败的场景） */
  silent?: boolean
}

/**
 * 把图缩到 50×50 读像素。
 *
 * `crossOrigin = 'anonymous'` 是必需的：不带它，画布会被跨源图污染，`getImageData` 抛
 * SecurityError（Folia 的注释就是这么写的）。失败路径一律 resolve(null) ——
 * 取色失败只该退化成主题色，绝不该把一个 Promise 吊死或冒泡成未捕获错误。
 */
export function loadImagePixels(
  imageUrl: string,
  options: LoadImagePixelsOptions = {}
): Promise<Uint8ClampedArray | null> {
  const { silent = false } = options
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'Anonymous'

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = SAMPLE_SIZE
        canvas.height = SAMPLE_SIZE
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
        resolve(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data)
      } catch (error) {
        // 画布被污染（无 CORS 头）时 getImageData 抛错；吞掉并回退，调用方看到的只是 []
        if (!silent) console.warn('Failed to read image pixels for color extraction', error)
        resolve(null)
      }
    }

    img.onerror = (event) => {
      if (!silent) console.warn('Failed to load image for color extraction', event)
      resolve(null)
    }
    img.src = imageUrl
  })
}

interface WeightedColor extends RgbChannels {
  weight: number
}

interface ColorBucket {
  colors: WeightedColor[]
  weight: number
}

function getChannelRange(colors: WeightedColor[], channel: 'r' | 'g' | 'b'): number {
  let min = 255
  let max = 0
  for (const color of colors) {
    min = Math.min(min, color[channel])
    max = Math.max(max, color[channel])
  }
  return max - min
}

function splitBucket(bucket: ColorBucket): [ColorBucket, ColorBucket] | null {
  if (bucket.colors.length < 2) return null

  const ranges = {
    r: getChannelRange(bucket.colors, 'r'),
    g: getChannelRange(bucket.colors, 'g'),
    b: getChannelRange(bucket.colors, 'b')
  }
  const channels = Object.keys(ranges) as Array<keyof typeof ranges>
  const channel = channels.reduce(
    (widest, candidate) => (ranges[candidate] > ranges[widest] ? candidate : widest),
    'r' as keyof typeof ranges
  )
  const sorted = [...bucket.colors].sort((a, b) => a[channel] - b[channel])

  // 按**累计权重**取中点，而不是按个数 —— 这正是「加权」中位切分的含义：
  // 大色块（如整张封面的背景渐变）权重高，会先被单独切出来，不被高饱和小细节带跑。
  const midpoint = bucket.weight / 2
  let accumulatedWeight = 0
  let splitIndex = 1
  for (let index = 0; index < sorted.length - 1; index += 1) {
    accumulatedWeight += sorted[index].weight
    splitIndex = index + 1
    if (accumulatedWeight >= midpoint) break
  }

  const left = sorted.slice(0, splitIndex)
  const right = sorted.slice(splitIndex)
  return [
    { colors: left, weight: left.reduce((sum, color) => sum + color.weight, 0) },
    { colors: right, weight: right.reduce((sum, color) => sum + color.weight, 0) }
  ]
}

function averageBucket(bucket: ColorBucket): WeightedColor {
  const totals = bucket.colors.reduce(
    (result, color) => ({
      r: result.r + color.r * color.weight,
      g: result.g + color.g * color.weight,
      b: result.b + color.b * color.weight
    }),
    { r: 0, g: 0, b: 0 }
  )
  return {
    r: Math.round(totals.r / bucket.weight),
    g: Math.round(totals.g / bucket.weight),
    b: Math.round(totals.b / bucket.weight),
    weight: bucket.weight
  }
}

/**
 * 像素 → 代表性色盘（4-bit 量化直方图 + 加权中位切分），按权重降序输出 `#rrggbb`。
 *
 * 纯函数、无 DOM 依赖：`pixels` 是 RGBA 扁平数组（`ImageData.data` 的形状），
 * 因此可以在 node 环境直接单测（见 cover-palette.test.ts）。
 */
export function extractRepresentativeColorsFromPixels(
  pixels: Uint8ClampedArray | number[],
  count = 5
): string[] {
  if (count <= 0) return []

  // 同一量化格的像素先合并成「加权平均色」，权重 = 命中像素数
  const histogram = new Map<number, WeightedColor>()
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < MIN_ALPHA) continue
    const r = pixels[index]
    const g = pixels[index + 1]
    const b = pixels[index + 2]
    const key =
      ((r >> QUANTIZATION_SHIFT) << 8) |
      ((g >> QUANTIZATION_SHIFT) << 4) |
      (b >> QUANTIZATION_SHIFT)
    const existing = histogram.get(key)
    if (existing) {
      existing.r += r
      existing.g += g
      existing.b += b
      existing.weight += 1
    } else {
      histogram.set(key, { r, g, b, weight: 1 })
    }
  }

  const colors: WeightedColor[] = [...histogram.values()].map((color) => ({
    r: Math.round(color.r / color.weight),
    g: Math.round(color.g / color.weight),
    b: Math.round(color.b / color.weight),
    weight: color.weight
  }))
  if (colors.length === 0) return []

  const buckets: ColorBucket[] = [
    { colors, weight: colors.reduce((sum, color) => sum + color.weight, 0) }
  ]
  while (buckets.length < Math.min(count, colors.length)) {
    // 挑「最宽通道跨度 × sqrt(权重)」最大的桶继续切：跨度保证颜色区分度，
    // sqrt 权重保证大面积色块优先成桶（直接用权重会让细节色永远切不出来）。
    let bucketIndex = -1
    let bestScore = -1
    for (let index = 0; index < buckets.length; index += 1) {
      const bucket = buckets[index]
      if (bucket.colors.length < 2) continue
      const widestRange = Math.max(
        getChannelRange(bucket.colors, 'r'),
        getChannelRange(bucket.colors, 'g'),
        getChannelRange(bucket.colors, 'b')
      )
      const score = widestRange * Math.sqrt(bucket.weight)
      if (score > bestScore) {
        bestScore = score
        bucketIndex = index
      }
    }
    if (bucketIndex < 0) break
    const split = splitBucket(buckets[bucketIndex])
    if (!split) break
    buckets.splice(bucketIndex, 1, ...split)
  }

  return buckets
    .map(averageBucket)
    .sort((a, b) => b.weight - a.weight)
    .map(channelsToHex)
}

/**
 * 封面 URL → 代表性色盘。取图失败 / 画布被污染 → `[]`（调用方走主题色兜底）。
 *
 * ⚠️ 本仓库的 Electron 生产环境是 `file://`，封面可能走 `muice-cover://`（该协议注册时
 * **没有** `bypassCSP`）。这条链路在真实环境下的可用性未实测，见交付报告。
 */
export async function extractRepresentativeColors(
  imageUrl: string,
  count = 5,
  options: LoadImagePixelsOptions = {}
): Promise<string[]> {
  const pixels = await loadImagePixels(imageUrl, options)
  return pixels ? extractRepresentativeColorsFromPixels(pixels, count) : []
}
