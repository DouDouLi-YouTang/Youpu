/**
 * 「浮名」自带的背景层（移植规格书 §12）—— 纸张周围的手绘装饰形状。
 *
 * ## 这一层画的是什么
 *
 * 浮名的外壳背景（`common` 模式）默认**只留纯色底**（`disableGeometricBackground = true`，
 * 见 §12.6），几何装饰由浮名自己画：一圈围绕文字纸张的圆环 / 方块 / 十字 / 星芒。
 * 形状的位置、尺寸、透明度、转速全部由字符串种子确定性生成 —— 同一首歌、
 * 同一个视口，每次打开画出来的都是同一张图。
 *
 * ## 分两层：场景生成（纯）与绘制（要 canvas）
 *
 * - `buildFumeBackgroundScene` 是**纯函数**（只吃 `seeded` 与钳制），可以在 node 环境单测；
 *   它的产出是形状数组，位置的分布规则（22% 落在纸张内部、78% 挂在四条边上）
 *   与绘制无关，是「场景长什么样」的唯一出处。
 * - `drawFumeBackground` 才碰 `CanvasRenderingContext2D`。它每帧被调用一次，
 *   所以**不能**在这里做分配敏感的事（见下）。
 *
 * ## 两处必须照搬的细节
 *
 * 1. **渐变缓存键不含位置与旋转**。位移 / 旋转由 context 变换施加，`LinearGradient`
 *    只依赖「尺寸 + 透明度 + 两个颜色」。镜头每移动一点就新建一个渐变对象会让
 *    每帧产生几十个长生命对象 —— 上游专门注释了这一点。
 * 2. **`spark` 的 `inner = size * 0.13`** 是很细的星芒（不是常见的 0.3+），
 *    画成 0.3 就从「闪光」变成「星星」了，这是最容易画错的常数。
 *
 * ## 不透明度的三层护栏
 *
 * 基础形状的 opacity 只有 0.01–0.16、火花 0.08–0.22，再乘音频增益，
 * 最后**统一 clamp 到 0.42**。这条上限保证背景装饰永远盖不住文字。
 */

import { clamp, mix, seeded } from '../core/fume-math'
import { colorWithAlpha, mixColors } from '../../shared/color-mix'
import type {
  FumeAudioLevels,
  FumeBackgroundScene,
  FumeBackgroundShape,
  FumeBackgroundShapeKind,
  FumeTheme
} from '../core/fume-types'

/** 形状不透明度的上限（§12.5 的护栏，别调大：会盖住文字） */
export const FUME_BACKGROUND_MAX_OPACITY = 0.42

/** 基础形状的种类循环（6 个一轮） */
const SHAPE_KINDS = ['ring', 'square', 'cross', 'ring', 'square', 'cross'] as const

/** 火花绑定的频带循环（5 个一轮） */
const SPARK_BANDS = ['treble', 'vocal', 'mid', 'treble', 'lowMid'] as const

/** 每个 context 的渐变缓存上限（上游是 256，见 §12.5） */
const GRADIENT_CACHE_LIMIT = 256

/** 世界范围（矩形，用于把锚点钳进可见区域） */
export interface FumeBackgroundBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface FumeBackgroundBuildInput {
  /** 视口尺寸（决定世界下限与基准单位） */
  viewport: { width: number; height: number }
  /** 世界尺寸（文章排版后的画布范围） */
  world: { width: number; height: number }
  /** 文字纸张的范围；不给则用世界 24%~76% / 18%~82% */
  paperBounds?: FumeBackgroundBounds
  seed?: string | number
}

export interface FumeBackgroundDrawInput {
  context: CanvasRenderingContext2D
  scene: FumeBackgroundScene
  theme: FumeTheme
  /** 秒（形状自转用 `rotation + time * rotationSpeed`） */
  time?: number
  audioLevels?: FumeAudioLevels
  /** 相机视差（相机位置与原点，见 §9.8） */
  parallax?: {
    cameraX: number
    cameraY: number
    originX: number
    originY: number
    strength?: number
  }
  /** 整体不透明度倍率（0–2，1 = 原样） */
  objectOpacityMultiplier?: number
}

/**
 * 归一化纸张范围：先归正 min/max，再各自 clamp 进世界。
 *
 * 为什么要归正：`paperBounds` 可能来自 DOM 测量，左右顺序不保证；
 * 不归正会让 `mix(top, bottom, t)` 反着插值，形状跑到纸外面去。
 */
function normalizeBounds(
  bounds: FumeBackgroundBounds,
  worldWidth: number,
  worldHeight: number
): FumeBackgroundBounds {
  const left = clamp(Math.min(bounds.left, bounds.right), 0, worldWidth)
  const right = clamp(Math.max(bounds.left, bounds.right), 0, worldWidth)
  const top = clamp(Math.min(bounds.top, bounds.bottom), 0, worldHeight)
  const bottom = clamp(Math.max(bounds.top, bounds.bottom), 0, worldHeight)
  return { left, top, right, bottom }
}

/**
 * 选一个形状的锚点（§12.4）。
 *
 * 分布语义是这条函数的核心：**横跨纸边的形状不是随机撒点**，而是 78% 挂在纸的四条边
 * 之一并向外溢出 16%~24% 自身尺寸，22% 落在纸内部。所以观感才是「纸张周围的手绘装饰」。
 */
function choosePaperHaloAnchor(input: {
  paperBounds: FumeBackgroundBounds
  worldWidth: number
  worldHeight: number
  width: number
  height: number
  seedKey: string
}): { x: number; y: number } {
  const { paperBounds, worldWidth, worldHeight, width, height, seedKey } = input
  const insideChance = seeded(`${seedKey}:inside-chance`)

  if (insideChance < 0.22) {
    return {
      x: clamp(
        mix(
          paperBounds.left + width * 0.12,
          paperBounds.right - width * 0.12,
          seeded(`${seedKey}:inside-x`)
        ),
        0,
        worldWidth
      ),
      y: clamp(
        mix(
          paperBounds.top + height * 0.12,
          paperBounds.bottom - height * 0.12,
          seeded(`${seedKey}:inside-y`)
        ),
        0,
        worldHeight
      )
    }
  }

  const side = Math.floor(seeded(`${seedKey}:side`) * 4) % 4
  const overflowX = width * mix(0.16, 0.24, seeded(`${seedKey}:overflow-x`))
  const overflowY = height * mix(0.16, 0.24, seeded(`${seedKey}:overflow-y`))
  const spanJitterX = width * mix(-0.18, 0.18, seeded(`${seedKey}:span-jitter-x`))
  const spanJitterY = height * mix(-0.18, 0.18, seeded(`${seedKey}:span-jitter-y`))

  const spanY = clamp(
    mix(
      paperBounds.top - height * 0.12,
      paperBounds.bottom + height * 0.12,
      seeded(`${seedKey}:y`)
    ) + spanJitterY,
    0,
    worldHeight
  )
  const spanX = clamp(
    mix(paperBounds.left - width * 0.12, paperBounds.right + width * 0.12, seeded(`${seedKey}:x`)) +
      spanJitterX,
    0,
    worldWidth
  )

  if (side === 0) return { x: clamp(paperBounds.left - overflowX, 0, worldWidth), y: spanY }
  if (side === 1) return { x: clamp(paperBounds.right + overflowX, 0, worldWidth), y: spanY }
  if (side === 2) return { x: spanX, y: clamp(paperBounds.top - overflowY, 0, worldHeight) }
  return { x: spanX, y: clamp(paperBounds.bottom + overflowY, 0, worldHeight) }
}

/**
 * 生成背景场景（§12.3）。
 *
 * 形状数量**与横竖屏有关**：`worldWidth > worldHeight` 时 8 个基础形状 + 12 个火花，
 * 否则 7 + 9。这不是随机，是「宽屏铺得开」的确定性分流。
 */
export function buildFumeBackgroundScene(input: FumeBackgroundBuildInput): FumeBackgroundScene {
  const { viewport, world, paperBounds, seed } = input
  const seedPrefix = seed === undefined ? 'fume' : String(seed)

  // 尺寸非法（0 / 负 / NaN）时不生成任何形状：下游除法会变成 NaN 坐标，画不出来还白耗帧
  if (
    !(viewport.width > 0) ||
    !(viewport.height > 0) ||
    !(world.width > 0) ||
    !(world.height > 0)
  ) {
    return {
      width: Math.max(world.width || 0, viewport.width || 0, 1),
      height: Math.max(world.height || 0, viewport.height || 0, 1),
      shapes: []
    }
  }

  const worldWidth = Math.max(world.width, viewport.width * 1.2)
  const worldHeight = Math.max(world.height, viewport.height * 1.2)
  const baseUnit = clamp(Math.min(viewport.width, viewport.height) * 0.72, 320, 760)

  const resolvedPaperBounds = normalizeBounds(
    paperBounds ?? {
      left: worldWidth * 0.24,
      top: worldHeight * 0.18,
      right: worldWidth * 0.76,
      bottom: worldHeight * 0.82
    },
    worldWidth,
    worldHeight
  )

  const landscape = worldWidth > worldHeight
  const shapeCount = landscape ? 8 : 7
  const sparkCount = landscape ? 12 : 9

  const baseShapes: FumeBackgroundShape[] = []
  for (let index = 0; index < shapeCount; index += 1) {
    const localSeed = `${seedPrefix}:${worldWidth}:${worldHeight}:${index}`
    const kind = SHAPE_KINDS[index % 6] as FumeBackgroundShapeKind
    const width = baseUnit * mix(0.82, 1.36, seeded(`${localSeed}:size`))
    const anchor = choosePaperHaloAnchor({
      paperBounds: resolvedPaperBounds,
      worldWidth,
      worldHeight,
      width,
      height: width,
      seedKey: localSeed
    })
    baseShapes.push({
      id: `fume-bg-${index}`,
      kind,
      x: anchor.x,
      y: anchor.y,
      width,
      height: width,
      rotation: mix(-Math.PI * 0.2, Math.PI * 0.2, seeded(`${localSeed}:rotation`)),
      rotationSpeed: mix(-0.045, 0.045, seeded(`${localSeed}:rotation-speed`)),
      strokeWidth: mix(0.25, 2.1, seeded(`${localSeed}:stroke-width`)),
      opacity: mix(0.01, 0.16, seeded(`${localSeed}:opacity`)),
      color: seeded(`${localSeed}:color`) > 0.5 ? 'accent' : 'secondary',
      depth: seeded(`${localSeed}:depth`),
      ...(kind === 'ring'
        ? {
            ringGapStart: mix(-Math.PI, Math.PI, seeded(`${localSeed}:gap-start`)),
            ringGapSize: mix(Math.PI * 0.12, Math.PI * 0.24, seeded(`${localSeed}:gap-size`))
          }
        : {})
    })
  }

  // 火花按网格撒点再抖动：纯随机会让它们在纸张中心堆成一团
  const sparkArea = {
    left: worldWidth * 0.2,
    right: worldWidth * 0.8,
    top: worldHeight * 0.18,
    bottom: worldHeight * 0.82
  }
  const sparkColumns = Math.ceil(Math.sqrt(sparkCount * (worldWidth / Math.max(worldHeight, 1))))
  const sparkRows = Math.ceil(sparkCount / sparkColumns)
  const sparkCellWidth = (sparkArea.right - sparkArea.left) / sparkColumns
  const sparkCellHeight = (sparkArea.bottom - sparkArea.top) / sparkRows

  const sparkShapes: FumeBackgroundShape[] = []
  for (let index = 0; index < sparkCount; index += 1) {
    const localSeed = `${seedPrefix}:${worldWidth}:${worldHeight}:spark:${index}`
    const width = baseUnit * mix(0.1, 0.24, seeded(`${localSeed}:size`))
    const column = index % sparkColumns
    const row = Math.floor(index / sparkColumns)
    const jitterX = mix(-0.32, 0.32, seeded(`${localSeed}:jitter-x`)) * sparkCellWidth
    const jitterY = mix(-0.32, 0.32, seeded(`${localSeed}:jitter-y`)) * sparkCellHeight
    sparkShapes.push({
      id: `fume-spark-${index}`,
      kind: 'spark',
      x: clamp(
        sparkArea.left + (column + 0.5) * sparkCellWidth + jitterX,
        sparkArea.left,
        sparkArea.right
      ),
      y: clamp(
        sparkArea.top + (row + 0.5) * sparkCellHeight + jitterY,
        sparkArea.top,
        sparkArea.bottom
      ),
      width,
      height: width,
      rotation: mix(-Math.PI, Math.PI, seeded(`${localSeed}:rotation`)),
      rotationSpeed: mix(-0.18, 0.18, seeded(`${localSeed}:rotation-speed`)),
      strokeWidth: mix(0.75, 1.7, seeded(`${localSeed}:stroke-width`)),
      opacity: mix(0.08, 0.22, seeded(`${localSeed}:opacity`)),
      color: seeded(`${localSeed}:color`) > 0.5 ? 'accent' : 'secondary',
      depth: seeded(`${localSeed}:depth`),
      audioBand: SPARK_BANDS[index % 5]
    })
  }

  // 深度排序**就是**绘制顺序：后面的画在上面，于是视差与遮挡关系一致
  return {
    width: worldWidth,
    height: worldHeight,
    shapes: [...baseShapes, ...sparkShapes].sort((a, b) => a.depth - b.depth)
  }
}

/**
 * 描一个形状的路径（§12.2）。**调用方负责先 translate / rotate 到形状中心**。
 *
 * 这条约定是刻意的：路径本身以原点为中心（`(-w/2, -h/2)` 起），
 * 于是同一份路径能被「背景绘制」与「印章 / 火花」复用，不需要传中心点进来。
 */
export function buildFumeShapePath(
  context: CanvasRenderingContext2D,
  shape: FumeBackgroundShape
): void {
  const { kind, width } = shape
  context.beginPath()

  if (kind === 'ring') {
    // 正圆 + **永远留一个缺口**（缺口位置 / 大小由种子决定）→ 手绘圆环的观感
    const gapStart = shape.ringGapStart ?? -Math.PI * 0.18
    const gapSize = clamp(shape.ringGapSize ?? Math.PI * 0.2, 0.18, Math.PI * 0.6)
    context.lineCap = 'round'
    context.ellipse(0, 0, width / 2, width / 2, 0, gapStart + gapSize, gapStart + Math.PI * 2)
    return
  }

  if (kind === 'square') {
    const size = width
    context.rect(-size / 2, -size / 2, size, size)
    return
  }

  if (kind === 'cross') {
    const size = width
    const arm = size * 0.3
    context.moveTo(-arm, -size / 2)
    context.lineTo(arm, -size / 2)
    context.lineTo(arm, -arm)
    context.lineTo(size / 2, -arm)
    context.lineTo(size / 2, arm)
    context.lineTo(arm, arm)
    context.lineTo(arm, size / 2)
    context.lineTo(-arm, size / 2)
    context.lineTo(-arm, arm)
    context.lineTo(-size / 2, arm)
    context.lineTo(-size / 2, -arm)
    context.lineTo(-arm, -arm)
    context.closePath()
    return
  }

  // spark：四角星。inner = 0.13 是**很细的星芒**（不是常见的 0.3+），见文件头第 2 条
  const outer = width * 0.5
  const inner = width * 0.13
  context.moveTo(0, -outer)
  context.lineTo(inner, -inner)
  context.lineTo(outer, 0)
  context.lineTo(inner, inner)
  context.lineTo(0, outer)
  context.lineTo(-inner, inner)
  context.lineTo(-outer, 0)
  context.lineTo(-inner, -inner)
  context.closePath()
}

/**
 * 每个 context 一份渐变缓存。
 *
 * 用 `WeakMap` 而不是普通 `Map`：上下文随 canvas 卸载而消失，普通 Map 会把它连同
 * 缓存一起钉在内存里（长时间切歌 = 每次泄漏一整张渐变表）。
 */
const gradientCaches = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasGradient>>()

/** 线性渐变：细底两笔里的「上色那一笔」，四段停靠点（见 §12.5）。 */
function resolveLineGradient(
  context: CanvasRenderingContext2D,
  shape: FumeBackgroundShape,
  opacity: number,
  theme: FumeTheme
): CanvasGradient {
  let cache = gradientCaches.get(context)
  if (!cache) {
    cache = new Map<string, CanvasGradient>()
    gradientCaches.set(context, cache)
  }

  // 键**不含位置与旋转**：位移 / 旋转由 context 变换施加，渐变只依赖
  // 尺寸 + 透明度 + 两个颜色。所以镜头移动不会不断新建渐变对象。
  const key = `${shape.width}|${shape.height}|${opacity}|${theme.secondaryColor}|${theme.accentColor}`
  const cached = cache.get(key)
  if (cached) return cached

  const { width, height } = shape
  const gradient = context.createLinearGradient(
    -width * 0.55,
    -height * 0.28,
    width * 0.55,
    height * 0.28
  )
  gradient.addColorStop(0, colorWithAlpha(theme.secondaryColor, opacity * 0.18))
  gradient.addColorStop(
    0.28,
    colorWithAlpha(mixColors(theme.secondaryColor, theme.accentColor, 0.24), opacity * 0.58)
  )
  gradient.addColorStop(
    0.54,
    colorWithAlpha(mixColors(theme.secondaryColor, theme.accentColor, 0.62), opacity * 0.92)
  )
  gradient.addColorStop(1, colorWithAlpha(theme.accentColor, opacity * 0.7))

  // 按插入序淘汰最旧的一条：缓存是「同尺寸形状的复用」，不是无限增长的表
  if (cache.size >= GRADIENT_CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(key, gradient)
  return gradient
}

/** 细底 + 粗顶两笔：单笔描边给不出「中间亮、边缘淡」的笔触感。 */
function drawFumeGradientGeometry(
  context: CanvasRenderingContext2D,
  shape: FumeBackgroundShape,
  opacity: number,
  theme: FumeTheme
): void {
  const baseWidth = Math.max(shape.strokeWidth * 0.28, 0.14)
  const topWidth = Math.max(shape.strokeWidth * 0.92, 0.78)

  // 两次都显式清掉阴影：上一形状若是 spark，会留下 shadowBlur，糊掉这一笔
  context.shadowBlur = 0
  context.shadowColor = 'transparent'

  context.save()
  context.lineWidth = baseWidth
  context.strokeStyle = resolveLineGradient(context, shape, opacity * 0.56, theme)
  buildFumeShapePath(context, shape)
  context.stroke()
  context.restore()

  context.save()
  context.lineWidth = topWidth
  context.strokeStyle = resolveLineGradient(context, shape, opacity, theme)
  buildFumeShapePath(context, shape)
  context.stroke()
  context.restore()
}

/** 描一个形状：save → translate → rotate → 路径 → stroke → restore。 */
function traceFumeShape(context: CanvasRenderingContext2D, shape: FumeBackgroundShape): void {
  context.save()
  context.translate(shape.x, shape.y)
  context.rotate(shape.rotation)
  buildFumeShapePath(context, shape)
  context.stroke()
  context.restore()
}

/**
 * 画一帧背景（§12.5）。
 *
 * ⚠️ 本函数**不做 clear / 不做 transform 复位**：清屏与相机变换由 stage 的每帧流程统一管
 * （§11.3 的顺序里背景画在正文之前、共用同一套世界坐标变换）。
 */
export function drawFumeBackground(input: FumeBackgroundDrawInput): void {
  const {
    context,
    scene,
    theme,
    time = 0,
    audioLevels,
    parallax,
    objectOpacityMultiplier = 1
  } = input

  const resolvedOpacityMultiplier = clamp(objectOpacityMultiplier, 0, 2)
  const parallaxStrength = parallax?.strength ?? 1

  for (const shape of scene.shapes) {
    // 频带只在 spark 上读得到；基础形状没有 audioBand，两条增益都恒为 1
    const bandValue = shape.audioBand ? audioLevels?.[shape.audioBand] : undefined
    const bandProgress = bandValue === undefined ? 0 : clamp((bandValue - 10) / 190, 0, 1)
    const audioScale = bandValue === undefined ? 1 : mix(0.95, 1.45, bandProgress)
    const audioOpacityBoost = bandValue === undefined ? 1 : mix(0.85, 1.55, bandProgress)

    const shapeColor = shape.color === 'accent' ? theme.accentColor : theme.secondaryColor
    const opacity = clamp(
      shape.opacity * audioOpacityBoost * resolvedOpacityMultiplier,
      0,
      FUME_BACKGROUND_MAX_OPACITY
    )

    // 伪景深：depth 越大越"近"，视差系数 1 - layerResponse 越小 ——
    // depth = 0 → +0.42（跟着镜头同向漂），depth = 1 → -0.16（近乎钉住甚至轻微反向）
    const layerResponse = mix(0.58, 1.16, shape.depth)
    const parallaxOffsetX = parallax
      ? (parallax.cameraX - parallax.originX) * (1 - layerResponse) * parallaxStrength
      : 0
    const parallaxOffsetY = parallax
      ? (parallax.cameraY - parallax.originY) * (1 - layerResponse) * parallaxStrength
      : 0

    const rendered: FumeBackgroundShape = {
      ...shape,
      x: shape.x + parallaxOffsetX,
      y: shape.y + parallaxOffsetY,
      width: shape.width * audioScale,
      height: shape.height * audioScale,
      rotation: shape.rotation + time * shape.rotationSpeed
    }

    if (rendered.kind === 'spark') {
      context.save()
      context.lineWidth = shape.strokeWidth
      context.strokeStyle = colorWithAlpha(shapeColor, opacity)
      // 只有火花会发光（10 * audioScale），这是「闪」的来源
      context.shadowBlur = 10 * audioScale
      context.shadowColor = colorWithAlpha(shapeColor, opacity * 0.75)
      traceFumeShape(context, rendered)
      context.restore()
      continue
    }

    context.save()
    context.translate(rendered.x, rendered.y)
    context.rotate(rendered.rotation)
    drawFumeGradientGeometry(context, rendered, opacity, theme)
    context.restore()
  }
}
