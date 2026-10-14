import type { FoliaBackgroundImage, FoliaTheme } from '../types'
import {
  colorWithAlpha,
  luminanceOf,
  mixChannels,
  resolveThemeChannels,
  type RgbChannels
} from '../shared/color'
import type { MonetBackgroundTuning } from './monet-tuning'

/**
 * monet 的封面烘焙管线 —— 规格 §4.3 的算法重写（纯 Canvas 2D，不含 shader）。
 *
 * ## 为什么要把封面「先烘成一张 1920×1080 的 JPEG」
 *
 * 画面里的模糊、灰度、饱和度、wash 染色、三角叠加、光斑、纱幕、18 条竖纹**全是逐像素
 * 或多次填充的结果**。如果每帧用 CSS filter 现算，弱机上会直接掉帧，而且 iOS 上
 * `ctx.filter` 存在却静默失效（`checkCanvasFilterSupport` 就是为它写的）。
 * 所以：一次性烘成静态位图，运行期只做 DOM 换图 + 一个合成器动画。
 *
 * ## 两条与 Folia 的**有意差异**（属主已确认，不要改回去）
 *
 * 1. **缓存带 LRU 上限**。Folia 的模块级 `Map<string, Promise<string|null>>` 永不清理，
 *    每换一组「封面 + 主题色」就永久留下一个 200–600 KB 的 data URL；长时间听歌
 *    线性涨内存。这里保留「缓存 Promise」的语义（含失败也缓存，同一 key 不重试），
 *    但超过 `MONET_CACHE_LIMIT` 就淘汰最久未用的条目。
 * 2. 失败也会被缓存 —— 这一条**与 Folia 一致**，是刻意保留的：同一张坏图不该每次
 *    重渲染都去重试一次 `loadImage`（那会在控制台刷屏）。
 *
 * ⚠️ 本文件的 `getImageData` / `texImage2D` 链路在 Electron 的 `file://` 与
 * `muice-cover://` 下**未实测**（规格 §11 风险 2、§12 第 3/4 条）。跨源污染时
 * `getImageData` 会 throw，这里会一路冒到 `buildMonetBackgroundDataUrl` 的 catch →
 * 返回 null → 界面上退回「主题渐变 + 原图」那一档，不会白屏。
 */

export const MONET_BACKGROUND_WIDTH = 1920
export const MONET_BACKGROUND_HEIGHT = 1080

/** 缓存条数上限：一条约 200–600 KB，12 条最多约 7 MB。 */
export const MONET_CACHE_LIMIT = 12

/** 主题色解析失败时的兜底（Folia 同值）：背景极暗、主色近白。 */
const FALLBACK_DARK: RgbChannels = { r: 10, g: 10, b: 12 }
const FALLBACK_LIGHT: RgbChannels = { r: 245, g: 245, b: 245 }

export interface BuildMonetBackgroundOptions {
  coverUrl?: string | null
  /** 用户上传图（`VisualizerBackgroundConfig.customImage`，与 nomand 共用同一张） */
  monetBackgroundImage?: FoliaBackgroundImage | null
  theme: FoliaTheme
  tuning: MonetBackgroundTuning
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * wash 的两端：暗端与亮端。
 *
 * 为什么不是「背景 = 暗端」：浅色主题下 `backgroundColor` 比 `primaryColor` 亮，
 * 固定分配会让整张 wash 反相。比较两者亮度后决定，主题明暗都不用手写分支。
 */
export function resolveWashEndpoints(
  background: RgbChannels,
  primary: RgbChannels
): { shadow: RgbChannels; highlight: RgbChannels } {
  return luminanceOf(background) <= luminanceOf(primary)
    ? { shadow: background, highlight: primary }
    : { shadow: primary, highlight: background }
}

/**
 * 按归一化亮度取 wash 目标色：暗部向 shadow 走、中间过 accent、亮部向 highlight 走。
 * 0.55 是拐点（不是 0.5）—— 与 Folia 逐字一致，改它会整体偏色。
 */
export function resolveWashColor(
  normalizedLuminance: number,
  background: RgbChannels,
  accent: RgbChannels,
  primary: RgbChannels
): RgbChannels {
  const { shadow, highlight } = resolveWashEndpoints(background, primary)
  const luminance = Number.isFinite(normalizedLuminance) ? normalizedLuminance : 0
  if (luminance <= 0.55) {
    return mixChannels(shadow, accent, luminance / 0.55)
  }
  return mixChannels(accent, highlight, (luminance - 0.55) / 0.45)
}

/**
 * 逐像素的后处理：灰度 → 饱和度 → wash 染色。
 *
 * 三步的顺序敏感：饱和度用的是**灰度之后**的亮度，wash 用的却是**原始**亮度
 * （`resolveWashColor(clamp(luminance/255))` 里的 `luminance` 是这一步之前算的）。
 * 顺序或基准换一处，画面明暗关系就会反。
 */
export function applyBackgroundPostProcessing(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: FoliaTheme,
  tuning: MonetBackgroundTuning
): void {
  const grayscale = clamp(tuning.backgroundGrayscale, 0, 1)
  const saturation = clamp(tuning.backgroundSaturation, 0, 2)
  const wash = clamp(tuning.backgroundWash, 0, 1)
  // 全默认直接跳过：一次 getImageData + putImageData 在 1920×1080 上是 ~8MB 的来回拷贝
  if (grayscale <= 0 && Math.abs(saturation - 1) < 0.001 && wash <= 0) return

  const imageData = context.getImageData(0, 0, width, height)
  const data = imageData.data
  const background = resolveThemeChannels(theme.backgroundColor, FALLBACK_DARK)
  // accent 的兜底是 background 而不是 FALLBACK_LIGHT：强调色缺失时跟着底色走
  const accent = resolveThemeChannels(theme.accentColor, background)
  const primary = resolveThemeChannels(theme.primaryColor, FALLBACK_LIGHT)
  const customWash = resolveThemeChannels(tuning.backgroundWashCustomColor, accent)
  const washAccent = tuning.backgroundWashColorMode === 'custom' ? customWash : accent

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue

    let r = data[index]
    let g = data[index + 1]
    let b = data[index + 2]
    const luminance = luminanceOf({ r, g, b })

    if (grayscale > 0) {
      r += (luminance - r) * grayscale
      g += (luminance - g) * grayscale
      b += (luminance - b) * grayscale
    }

    if (Math.abs(saturation - 1) >= 0.001) {
      const saturatedLuminance = luminanceOf({ r, g, b })
      r = saturatedLuminance + (r - saturatedLuminance) * saturation
      g = saturatedLuminance + (g - saturatedLuminance) * saturation
      b = saturatedLuminance + (b - saturatedLuminance) * saturation
    }

    if (wash > 0) {
      const washColor = resolveWashColor(
        clamp(luminance / 255, 0, 1),
        background,
        washAccent,
        primary
      )
      r += (washColor.r - r) * wash
      g += (washColor.g - g) * wash
      b += (washColor.b - b) * wash
    }

    data[index] = Math.round(clamp(r, 0, 255))
    data[index + 1] = Math.round(clamp(g, 0, 255))
    data[index + 2] = Math.round(clamp(b, 0, 255))
  }

  context.putImageData(imageData, 0, 0)
}

/**
 * 烘焙进图里的装饰叠加：三角渐变 + 左上光斑 + 右侧纱幕 + 18 条竖纹。
 *
 * 这三个渐变的强度都挂在同一根 `overlay` 旋钮上（系数不同：0.62 / 0.58 / 0.36 …），
 * 所以「overlay = 0」不会变成完全不加装饰，只是回到各自的基准。
 * 竖纹的坐标是**固定算术序列**（`index * 127`、`index * 211`），不是随机数 ——
 * 每次烘焙必须落在同一位置，否则缓存失效时纹理会跳。
 */
export function paintMonetOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: FoliaTheme,
  tuning: MonetBackgroundTuning
): void {
  const overlay = clamp(tuning.backgroundOverlayOpacity, 0, 1)

  const overlayGradient = context.createLinearGradient(0, 0, width, height)
  overlayGradient.addColorStop(0, colorWithAlpha(theme.accentColor, 0.08 + overlay * 0.62))
  overlayGradient.addColorStop(0.44, colorWithAlpha(theme.backgroundColor, 0.16 + overlay * 0.58))
  overlayGradient.addColorStop(1, colorWithAlpha(theme.primaryColor, 0.06 + overlay * 0.36))
  context.fillStyle = overlayGradient
  context.fillRect(0, 0, width, height)

  const leftBloom = context.createRadialGradient(
    width * 0.18,
    height * 0.34,
    0,
    width * 0.18,
    height * 0.34,
    width * 0.55
  )
  leftBloom.addColorStop(0, colorWithAlpha(theme.accentColor, overlay * 0.42))
  leftBloom.addColorStop(1, colorWithAlpha(theme.backgroundColor, 0))
  context.fillStyle = leftBloom
  context.fillRect(0, 0, width, height)

  const rightVeil = context.createLinearGradient(width * 0.45, 0, width, 0)
  rightVeil.addColorStop(0, colorWithAlpha(theme.backgroundColor, 0))
  rightVeil.addColorStop(1, colorWithAlpha(theme.backgroundColor, 0.18 + overlay * 0.38))
  context.fillStyle = rightVeil
  context.fillRect(0, 0, width, height)

  if (tuning.backgroundStreaksEnabled === false) return

  context.fillStyle = colorWithAlpha(theme.backgroundColor, 0.1 + overlay * 0.08)
  for (let index = 0; index < 18; index += 1) {
    const x = (index * 127) % width
    const y = ((index * 211) % height) - 40
    context.fillRect(x, y, 1, height * 0.28)
  }
}

/** 图源选择：`uploaded-global` 优先用户上传图，否则优先封面（与 nomand 同一套语义）。 */
export function resolveMonetPipelineSourceUrl(
  options: Pick<BuildMonetBackgroundOptions, 'coverUrl' | 'monetBackgroundImage' | 'tuning'>
): string | null {
  const uploaded = options.monetBackgroundImage?.url ?? null
  const cover = options.coverUrl ?? null
  return options.tuning.backgroundSource === 'uploaded-global'
    ? (uploaded ?? cover)
    : (cover ?? uploaded)
}

/*
 * 半屏布局的两个派生量（规格 §4.1 布局 B）。
 *
 * 它们**不进缓存 key**，因为只影响 DOM：`imageOpacity` 是半屏图的层不透明度、
 * `imagePositionX` 是 `background-position` 的 X。同把它们放进管线文件是为了
 * 「取值域」与烘焙参数在同一处可查 —— 这两个数都做了一次 clamp，
 * 而 clamp 边界（0.7/0.3、10/90）是 Folia 的硬编码，不是随手取的。
 */

/** 半屏图的基础不透明度：浅色主题要更实（亮底上的暗图会糊），深色主题更透。 */
export function resolveMonetHalfPaneImageOpacity(
  isDaylight: boolean,
  overlayOpacity: number
): number {
  const base = isDaylight ? 0.7 : 0.3
  return base + clamp(overlayOpacity, 0, 1) * 0.16
}

/** 半屏图的 `background-position` X 百分比，钳在 10–90，避免图被推到完全看不见。 */
export function resolveMonetHalfPaneImagePositionX(offsetX: number): number {
  const safeOffset = Number.isFinite(offsetX) ? offsetX : 0
  return clamp(50 + safeOffset, 10, 90)
}

/**
 * 缓存 key。
 *
 * ⚠️ 三个字段**刻意不进 key**：`backgroundLayout`（只影响 DOM 结构）、
 * `backgroundDriftEnabled` / `backgroundDriftStrength`（漂移是 DOM 侧的 transform，
 * 永远不进位图）。反过来 `backgroundStreaksEnabled` **必须**进 ——
 * 竖纹是烘焙进图的，不进 key 就会出现「关了竖纹但图里还留着」。
 */
export function getMonetBackgroundCacheKey(options: BuildMonetBackgroundOptions): string {
  return JSON.stringify({
    sourceUrl: resolveMonetPipelineSourceUrl(options),
    uploadedId:
      options.tuning.backgroundSource === 'uploaded-global'
        ? (options.monetBackgroundImage?.id ?? null)
        : null,
    theme: {
      backgroundColor: options.theme.backgroundColor,
      primaryColor: options.theme.primaryColor,
      accentColor: options.theme.accentColor
    },
    tuning: {
      backgroundSource: options.tuning.backgroundSource,
      backgroundBlurPx: options.tuning.backgroundBlurPx,
      backgroundOverlayOpacity: options.tuning.backgroundOverlayOpacity,
      backgroundGrayscale: options.tuning.backgroundGrayscale,
      backgroundSaturation: options.tuning.backgroundSaturation,
      backgroundWash: options.tuning.backgroundWash,
      backgroundWashColorMode: options.tuning.backgroundWashColorMode,
      backgroundWashCustomColor: options.tuning.backgroundWashCustomColor,
      backgroundStreaksEnabled: options.tuning.backgroundStreaksEnabled
    }
  })
}

let isCanvasFilterSupportedCached: boolean | null = null

/**
 * `ctx.filter` 不可用时的 CSS 模糊样式。
 *
 * `scale(1.1) translateZ(0)` 是配套的：CSS 模糊会把图像四周化掉（露出一圈透明边），
 * 放大 10% 让被化掉的边缘落在视口之外；`translateZ(0)` 把它提升为合成层，
 * 免得模糊每帧重算（这里是静态图，但换图过渡期间会动）。
 *
 * 抽成纯函数是为了能单测 —— 这段逻辑在组件里就是一行三元表达式，但「什么时候空对象、
 * 什么时候必须带 transform」是容易改错的点。
 */
export function resolveMonetBlurStyle(
  blurPx: number,
  canvasFilterSupported: boolean
): Record<string, string> {
  if (canvasFilterSupported) return {}
  const blurValue = clamp(blurPx, 0, 60)
  if (blurValue <= 0) return {}
  return {
    filter: `blur(${blurValue}px)`,
    WebkitFilter: `blur(${blurValue}px)`,
    transform: 'scale(1.1) translateZ(0)'
  }
}

/**
 * 探测 `ctx.filter` 是否**真的生效**（不是「属性存在」）。
 * iOS Safari 上属性存在但静默忽略，只查 `typeof ctx.filter` 会误判成支持、
 * 结果整张图没有模糊。所以画一个 1×1 白点，看它有没有被 1px 模糊洇到 (1,1)。
 */
export function checkCanvasFilterSupport(): boolean {
  if (isCanvasFilterSupportedCached !== null) return isCanvasFilterSupportedCached
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 2
    const context = canvas.getContext('2d')
    if (!context || typeof context.filter !== 'string') {
      isCanvasFilterSupportedCached = false
      return false
    }
    context.fillStyle = '#000000'
    context.fillRect(0, 0, 2, 2)
    context.filter = 'blur(1px)'
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, 1, 1)
    isCanvasFilterSupportedCached = context.getImageData(1, 1, 1, 1).data[0] > 0
    return isCanvasFilterSupportedCached
  } catch {
    isCanvasFilterSupportedCached = false
    return false
  }
}

/** 仅测试用：清掉滤镜探测的模块级缓存 */
export function resetCanvasFilterSupportCacheForTests(): void {
  isCanvasFilterSupportedCached = null
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    // 只对 http(s) 设 crossOrigin：自定义协议（muice-cover://）与 data:/blob: 加了它
    // 会强制走 CORS 模式，而 muice-cover:// 注册时没有 bypassCSP（§11 风险 2）。
    if (src.startsWith('http://') || src.startsWith('https://')) {
      image.crossOrigin = 'anonymous'
    }
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`))
    image.src = src
    // decode() 是「解码完成」而不是「下载完成」，某些环境不支持或对 SVG 直接 reject，
    // 所以失败后退回 onload 那条路径（两条都挂了才 reject）。
    void image.decode().then(
      () => resolve(image),
      () => undefined
    )
  })
}

function resolveCanvasImageDimension(
  image: CanvasImageSource,
  dimension: 'width' | 'height',
  fallback: number
): number {
  const value = (image as Partial<Record<'width' | 'height', unknown>>)[dimension]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 居中裁切，等价 `background-size: cover` + `center`。 */
function drawCoverCropped(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number
): void {
  const imageWidth = resolveCanvasImageDimension(image, 'width', width)
  const imageHeight = resolveCanvasImageDimension(image, 'height', height)
  if (!imageWidth || !imageHeight) return

  const scale = Math.max(width / imageWidth, height / imageHeight)
  const drawWidth = imageWidth * scale
  const drawHeight = imageHeight * scale
  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight
  )
}

/** 生成烘焙结果。任何一步失败都返回 null（装饰层不该把异常抛给宿主）。 */
export async function buildMonetBackgroundDataUrl(
  options: BuildMonetBackgroundOptions
): Promise<string | null> {
  const sourceUrl = resolveMonetPipelineSourceUrl(options)
  if (!sourceUrl) return null

  const image = await loadImage(sourceUrl)
  const canvas = document.createElement('canvas')
  canvas.width = MONET_BACKGROUND_WIDTH
  canvas.height = MONET_BACKGROUND_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) return null

  context.fillStyle = options.theme.backgroundColor
  context.fillRect(0, 0, canvas.width, canvas.height)

  context.save()
  if (checkCanvasFilterSupport()) {
    context.filter = `blur(${clamp(options.tuning.backgroundBlurPx, 0, 60)}px)`
  }
  drawCoverCropped(context, image, canvas.width, canvas.height)
  context.restore()

  applyBackgroundPostProcessing(context, canvas.width, canvas.height, options.theme, options.tuning)
  paintMonetOverlay(context, canvas.width, canvas.height, options.theme, options.tuning)

  return canvas.toDataURL('image/jpeg', 0.92)
}

/** key → Promise 的 LRU。命中时重新插入一次，让 Map 的迭代顺序变成「最近使用顺序」。 */
const monetBackgroundCache = new Map<string, Promise<string | null>>()

function readCachedBackground(cacheKey: string): Promise<string | null> | undefined {
  const cached = monetBackgroundCache.get(cacheKey)
  if (cached) {
    monetBackgroundCache.delete(cacheKey)
    monetBackgroundCache.set(cacheKey, cached)
  }
  return cached
}

function writeCachedBackground(cacheKey: string, value: Promise<string | null>): void {
  monetBackgroundCache.set(cacheKey, value)
  while (monetBackgroundCache.size > MONET_CACHE_LIMIT) {
    const oldest = monetBackgroundCache.keys().next().value
    if (oldest === undefined) break
    monetBackgroundCache.delete(oldest)
  }
}

/**
 * 取（或开始烘焙）背景。
 *
 * **同一个 key 永远只烘焙一次**：并发的第二次调用拿到的是同一个 Promise，
 * 不会出现两张图互相覆盖。失败的 Promise 同样会写进缓存（与 Folia 一致）。
 */
export function resolveMonetBackgroundDataUrl(
  options: BuildMonetBackgroundOptions
): Promise<string | null> {
  const cacheKey = getMonetBackgroundCacheKey(options)
  const cached = readCachedBackground(cacheKey)
  if (cached) return cached

  const next = buildMonetBackgroundDataUrl(options).catch((error: unknown) => {
    console.warn('[FoliaBackground] monet 背景烘焙失败，退回主题渐变 + 原图', error)
    return null
  })
  writeCachedBackground(cacheKey, next)
  return next
}

/** 仅测试用：清空缓存 */
export function clearMonetBackgroundCacheForTests(): void {
  monetBackgroundCache.clear()
}

/** 仅测试用：当前缓存条数（验证 LRU 上限） */
export function monetBackgroundCacheSizeForTests(): number {
  return monetBackgroundCache.size
}
