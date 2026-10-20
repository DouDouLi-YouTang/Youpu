/**
 * common 模式的流体封面底 —— 规格 §2.2 的算法重写（纯 Canvas 2D + CSS）。
 *
 * ## 为什么必须把封面降到 384px 再交给 `blur(40px)`
 *
 * 这**不是**性能优化，是观感问题：模糊是 40px 的重模糊，比 40px 细的细节全被抹掉，
 * 所以 384px 的源在画面上与全分辨率等价。真正的差别在纹理上传：
 * 全分辨率封面（常见 1000–3000px）首次合成时是**分块上传**的，每块落地都肉眼可见 ——
 * 表现为「网格状闪烁」。384px 只有一块，落地即完成。
 *
 * ⚠️ 后来人如果看到 384 觉得「这么小的图肯定是性能优化，删掉吧」，画面就会开始闪。
 * 这条注释是那个判断的唯一防线（规格 §2.2.2 的原文也点名了这件事）。
 *
 * ## 为什么留着 iOS 判定却明知恒为 false
 *
 * 本项目是 Electron/Chromium，`isIOSSafari` 永远为 false，软焦管线（规格 §2.2.3）
 * 在运行期走不到。但**判定函数必须留着**：它是「非 iOS / iOS 两套预处理」这条分叉的
 * 显式记录，删掉判定而只留非 iOS 分支，后来人就不知道这里曾经有一条平台差异，
 * 更不会去查 `COVER_BLUR_SOURCE_MAX` 为什么存在。
 */

/** 降采样源的最大边长（见文件头：这个数决定会不会闪，不是性能参数）。 */
export const COVER_BLUR_SOURCE_MAX = 384

/** 降采样输出的 JPEG 质量（规格 §2.2.2 第 5 步）。 */
const DOWNSCALED_COVER_QUALITY = 0.82

/**
 * iOS Safari 判定（三个条件同时成立）。
 *
 * 本仓库恒为 false —— 保留的原因见文件头。**不要**把它删成 `return false`：
 * 那样连「这里为什么不需要软焦」的信息都没了。
 */
export function detectIOSSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent ?? ''
  const isAppleMobile =
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1)
  if (!isAppleMobile) return false
  if (!/WebKit/i.test(ua)) return false
  // 第三方内核（Chrome/Firefox/Edge/Opera/DuckDuckGo/Yandex/Google App）也用 WebKit 字样
  return !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser|GSA/i.test(ua)
}

/**
 * 把封面降采样到 `maxSize` 边长以内并转成 data URL。
 *
 * 返回 null 的三种情况都**不阻断渲染**：调用方会退回原图 URL（`smallUrl ?? coverUrl`）。
 * 最常见的一种是跨源封面没有 CORS 头 → 画布被污染 → `toDataURL` 抛错。
 */
export async function buildDownscaledCover(
  coverUrl: string,
  maxSize: number = COVER_BLUR_SOURCE_MAX
): Promise<string | null> {
  if (!coverUrl) return null
  try {
    const image = await loadCoverImage(coverUrl)
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    if (!width || !height) return null

    const scale = Math.min(1, maxSize / Math.max(width, height))
    const target = document.createElement('canvas')
    target.width = Math.max(1, Math.round(width * scale))
    target.height = Math.max(1, Math.round(height * scale))
    const context = target.getContext('2d')
    if (!context) return null

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, target.width, target.height)
    return target.toDataURL('image/jpeg', DOWNSCALED_COVER_QUALITY)
  } catch (error) {
    // 跨源封面没有 CORS 头会污染画布（toDataURL 抛 SecurityError）—— 这是预期路径，不是 bug
    console.warn('[FoliaBackground] common 封面降采样失败，回退原图 URL', error)
    return null
  }
}

function loadCoverImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Failed to load cover: ${src}`))
    image.src = src
  })
}

/** 交叉淡入的一层。`sourceCover` 是**原始封面**，用来判断「同一张图重复推送」。 */
export interface FluidCoverLayer {
  /** 实际用于 `<img src>` 的地址（降采样结果，失败时是原图） */
  url: string
  /** 原始的 `coverUrl`，去重用 */
  sourceCover: string
  key: number
}

/**
 * 交叉淡入的层管理（规格 §2.2.5）。
 *
 * 规则只有两条，但每条都对应一个具体的坏结果：
 *  1. **同一张 `sourceCover` 重复推送直接返回原数组** —— 否则同一张封面会被反复 push，
 *     每次都触发一轮 1.5s 淡入，画面上是「反复闪一下」。
 *  2. **最多保留两层**：新来的 + 当前顶层（让顶层在新层下面淡出）。
 *     留更多层会同时叠好几张模糊图层，每张都有自己的 blur 栅格化开销。
 */
export function appendFluidCoverLayer(
  layers: readonly FluidCoverLayer[],
  url: string,
  sourceCover: string,
  nextKey: number
): FluidCoverLayer[] {
  const top = layers.at(-1)
  if (top?.sourceCover === sourceCover) return layers as FluidCoverLayer[]
  // 只保留当前顶（在新层下面淡出）+ 新来的这一层
  return [...(top ? [top] : []), { url, sourceCover, key: nextKey }]
}

/**
 * 某一层的目标不透明度（规格 §2.2.5）。
 *
 * 「非顶层」恒为 1（正在淡出，动的是外层 wrapper 的 opacity）；
 * 「顶层」在图片 decode 完成前是 0、之后是 1。
 * decode 失败也放行（见 `markCoverReady` 的说明），否则会永远卡在透明。
 */
export function resolveFluidCoverOpacity(isTop: boolean, isReady: boolean): number {
  return isTop && !isReady ? 0 : 1
}

/**
 * 淡出结束后只留顶层，并把 `readyKeys` 收缩成一把。
 *
 * 这是「层数不会随切歌次数增长」的唯一保证：`appendFluidCoverLayer` 只压到两层，
 * 真正把它降到一层的是这里。漏掉这步，切 100 首歌就会留下 100 张模糊图。
 */
export function settleFluidCoverLayers(
  layers: readonly FluidCoverLayer[],
  settleKey: number
): { layers: FluidCoverLayer[]; readyKeys: Set<number> } {
  return {
    layers: layers.filter((layer) => layer.key === settleKey),
    readyKeys: new Set([settleKey])
  }
}

/**
 * 图片加载失败时剔除该层 —— **但最后一层永不移除**（规格 §2.2.5 末条）。
 * 全部剔除会露出下面的主题底色，而那张图明明还在（只是这次请求失败了），
 * 观感上是「背景忽然没了」。
 */
export function dropFluidCoverLayer(
  layers: readonly FluidCoverLayer[],
  failedKey: number
): FluidCoverLayer[] {
  if (layers.length <= 1) return layers as FluidCoverLayer[]
  return layers.filter((layer) => layer.key !== failedKey)
}

/**
 * 无封面时压在底上的主题底色不透明度（规格 §2.2.4 第 5 层）。
 * 不是 1：留一点透过率，未来若在下面加层不用改这里。
 */
export const FLUID_NO_COVER_OPACITY = 0.8

/** 顶层混合渐变的透明度（非 iOS 0.4 / iOS 0.2）。 */
export function resolveFluidBlendOverlayOpacity(isIOSSafari: boolean): number {
  return isIOSSafari ? 0.2 : 0.4
}
