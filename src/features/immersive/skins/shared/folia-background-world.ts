import type { FumePaperBounds } from '../fume/core/fume-types'

/**
 * 覆盖背景使用的文章世界。
 *
 * 坐标与浮名文章完全一致：左上角 `(0, 0)`，单位 CSS px。尺寸同时记录生成时的
 * 视口，仅用于世界重建瞬间的居中兜底；逐帧相机矩阵始终使用同一帧传入的视口。
 */
export interface FoliaBackgroundWorld {
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  paperBounds?: FumePaperBounds
}

/** 一帧背景视图；字段名与 `resolveFumeBackgroundView` 的产物一一对应。 */
export interface FoliaBackgroundView {
  viewportWidth: number
  viewportHeight: number
  cameraX: number
  cameraY: number
  scale: number
}

/** 覆盖背景可被父级命令式驱动的唯一接口。 */
export interface FoliaSkinBackgroundHandle {
  syncView(view: FoliaBackgroundView): void
}

/**
 * 覆盖背景模糊的几何参数。
 *
 * CSS `filter: blur()` 会把自身边缘一起模糊成半透明。若直接作用在铺满视口的层上，
 * 四周就会露出宿主的浅色底，看起来像一圈白边。这里把模糊层向外扩，再由外层
 * `overflow: hidden` 裁掉多余部分。
 */
export interface FoliaBackgroundBlurGeometry {
  /** 实际作用在背景内容上的模糊半径（px） */
  blurPx: number
  /** 模糊层向四边外扩的距离（px） */
  insetPx: number
}

/**
 * 把设置里的模糊值换算成可安全裁切的几何参数。
 *
 * `0` 必须保持完全无模糊、无外扩；否则关闭模糊时仍会生成一个无意义的合成层。
 * 外扩距离取 `ceil(blur * 3)`：Chromium 用三次盒式模糊近似高斯，`blur(r)` 的
 * 采样支持范围约等于 `3r`，只有外扩到 `3r` 才能让视口边缘落在核之外。
 *
 * 实测（2048×962、`blur(40px)`、纯黑背景）：
 *  - 外扩 `2r`（80px）：四边残留约 4% 透明，宿主浅色底透出，肉眼可见白边；
 *  - 外扩 `3r`（120px）：边缘与原图一致，无残留。
 */
export function resolveFoliaBackgroundBlurGeometry(blurPx: number): FoliaBackgroundBlurGeometry {
  const blur = Number.isFinite(blurPx) ? Math.max(0, blurPx) : 0
  if (blur === 0) return { blurPx: 0, insetPx: 0 }
  return {
    blurPx: blur,
    insetPx: Math.ceil(blur * 3)
  }
}

export interface FoliaBackgroundWorldSource {
  width: number
  height: number
  paperBounds?: FumePaperBounds
}

export interface ResolveFoliaBackgroundWorldInput {
  article: FoliaBackgroundWorldSource | null
  viewport: { width: number; height: number }
  /** 无文章时的临时世界相对视口倍率（浮名原逻辑为 1.8）。 */
  temporaryScale?: number
  /** 世界至少覆盖视口的倍率（浮名原生背景为 1.2）。 */
  minimumViewportScale?: number
}

const DEFAULT_TEMPORARY_SCALE = 1.8
const DEFAULT_MINIMUM_VIEWPORT_SCALE = 1.2

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * 解析覆盖背景世界。
 *
 * 有文章时以文章世界为基准；无文章时用舞台的 1.8 倍作为临时世界。两者都会再取
 * `viewport * 1.2` 的下限，避免相机略微移出文章边缘时露出空白。
 */
export function resolveFoliaBackgroundWorld(
  input: ResolveFoliaBackgroundWorldInput
): FoliaBackgroundWorld {
  const viewportWidth = positive(input.viewport.width)
  const viewportHeight = positive(input.viewport.height)
  const temporaryScale =
    Number.isFinite(input.temporaryScale) && (input.temporaryScale ?? 0) > 0
      ? (input.temporaryScale as number)
      : DEFAULT_TEMPORARY_SCALE
  const minimumViewportScale =
    Number.isFinite(input.minimumViewportScale) && (input.minimumViewportScale ?? 0) > 0
      ? (input.minimumViewportScale as number)
      : DEFAULT_MINIMUM_VIEWPORT_SCALE

  const baseWidth = input.article ? positive(input.article.width) : viewportWidth * temporaryScale
  const baseHeight = input.article
    ? positive(input.article.height)
    : viewportHeight * temporaryScale

  return {
    width: Math.max(baseWidth, viewportWidth * minimumViewportScale, 1),
    height: Math.max(baseHeight, viewportHeight * minimumViewportScale, 1),
    viewportWidth,
    viewportHeight,
    ...(input.article?.paperBounds ? { paperBounds: { ...input.article.paperBounds } } : {})
  }
}

/**
 * 世界容器 → 视口的 CSS `matrix(...)`。
 *
 * 与浮名 canvas 的 `translate(center) scale(s) translate(-camera)` 逐项等价；
 * `transform-origin` 必须由样式固定为 `0 0`。数值保留 6 位小数，既足够避免
 * 亚像素抖动，也能让未变化的矩阵稳定命中字符串缓存。
 */
export function resolveFoliaBackgroundMatrix(view: FoliaBackgroundView): string {
  const scale = Number.isFinite(view.scale) && view.scale > 0 ? view.scale : 1
  const viewportWidth = positive(view.viewportWidth)
  const viewportHeight = positive(view.viewportHeight)
  const cameraX = Number.isFinite(view.cameraX) ? view.cameraX : 0
  const cameraY = Number.isFinite(view.cameraY) ? view.cameraY : 0
  const translateX = viewportWidth * 0.5 - cameraX * scale
  const translateY = viewportHeight * 0.5 - cameraY * scale
  return `matrix(${round(scale)}, 0, 0, ${round(scale)}, ${round(translateX)}, ${round(translateY)})`
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/**
 * Common 的几何构图以纸张为舞台；其余覆盖背景仍铺满整个文章世界。
 * 返回 CSS 尺寸而不是类名，避免模式切换时出现一帧沿用旧布局。
 */
export function resolveFoliaBackgroundSurfaceStyle(
  mode: string,
  world: FoliaBackgroundWorld
): Record<string, string> {
  if (mode !== 'common' || !world.paperBounds) {
    return { left: '0', top: '0', width: '100%', height: '100%' }
  }

  const left = Math.min(world.paperBounds.left, world.paperBounds.right)
  const top = Math.min(world.paperBounds.top, world.paperBounds.bottom)
  const right = Math.max(world.paperBounds.left, world.paperBounds.right)
  const bottom = Math.max(world.paperBounds.top, world.paperBounds.bottom)

  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${Math.max(right - left, 1)}px`,
    height: `${Math.max(bottom - top, 1)}px`
  }
}

/**
 * 世界容器的定位样式。
 *
 * 模糊层为了隐藏模糊透明边会向外扩，world 的坐标原点随之外移。这里显式把
 * world 放回视口左上角，保证 `resolveFoliaBackgroundMatrix` 的相机矩阵仍以
 * 视口为基准；否则模糊值一改，背景与文字就会整体错位。
 */
export function resolveFoliaBackgroundWorldStyle(
  world: FoliaBackgroundWorld,
  blurInsetPx: number
): Record<string, string> {
  const inset = Number.isFinite(blurInsetPx) ? Math.max(0, blurInsetPx) : 0
  return {
    left: `${inset}px`,
    top: `${inset}px`,
    width: `${world.width}px`,
    height: `${world.height}px`,
    transform: resolveCenteredFoliaBackgroundMatrix(world)
  }
}

/** 世界重建 / 重挂载瞬间的居中兜底矩阵；下一帧会被真实相机视图覆盖。 */
export function resolveCenteredFoliaBackgroundMatrix(world: FoliaBackgroundWorld): string {
  // 世界比视口大时，把世界左上角按比例往负方向放，使其中心与视口中心重合。
  return resolveFoliaBackgroundMatrix({
    viewportWidth: world.viewportWidth,
    viewportHeight: world.viewportHeight,
    cameraX: world.width * 0.5,
    cameraY: world.height * 0.5,
    scale: 1
  })
}
