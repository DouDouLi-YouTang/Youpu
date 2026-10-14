import { ShaderFitOptions, ShaderMount, type ShaderMountUniforms } from '@paper-design/shaders'

import { markWebgl2Unavailable, releaseWebglContext } from './webgl-support'

/**
 * Vue 版 paper 挂载器 —— `@paper-design/shaders-react` 是 React-only，本仓库没装它，
 * 所以「字符串 URL → HTMLImageElement」「宿主生命周期」「卸载时丢 context」三件事自己写
 * （规格 §8.6 给了对照表与骨架）。
 *
 * 与 Folia 的**实现差异**（结果一致，路径不同）：
 *  - Folia 用 React 的函数式 ref cleanup 在组件卸载时先拿到 element 再 lose context；
 *    Vue 没有这个时机，所以这里显式「先 dispose，再 lose」—— `dispose()` 会把 canvas
 *    从文档移除，随后 `canvas.isConnected === false` 成立，lose 才是安全的。
 *  - uniform 的图片解析放在**挂载前**（await 完成再 new），因为 `ShaderMount` 的
 *    `setTextureUniform` 遇到未加载完的图会直接 throw（`shader-mount.js:226-229`）。
 */

/**
 * 全屏四边形没有深度测试、也没有几何边缘，MSAA 与深度缓冲只花显存
 * （1280×720 两层约 72MB）与每帧一次 resolve，`readPixels` 结果逐通道一致。
 * paper 只在建 context 时读一次，必须显式传（默认值是开启）。
 */
export const PAPER_SHADER_CONTEXT_ATTRIBUTES: WebGLContextAttributes = Object.freeze({
  antialias: false,
  depth: false
})

/** 小图放大到的最小边长（`shaders-react/dist/set-min-image-size.js:6-15`）。 */
const MIN_IMAGE_SIZE = 1024

export interface PaperShaderOptions {
  fragmentShader: string
  uniforms: ShaderMountUniforms
  /** 0 = 不启动 paper 自己的 rAF（静态 shader 不该有持续开销） */
  speed?: number
  frame?: number
  /**
   * **必须显式传 1**：paper 默认 `minPixelRatio = 2`，在 1× 屏上也会按 2 倍分辨率渲染，
   * GPU 开销直接 ×4（规格 §8.5 / §10.4）。
   */
  minPixelRatio?: number
  maxPixelCount?: number
  mipmaps?: string[]
  webGlContextAttributes?: WebGLContextAttributes
  /** 日志用模式名（WebGL 不可用时 warn 一次） */
  mode: string
}

export interface PaperShaderHandle {
  /** 挂载后的 WebGL canvas（lose context 用） */
  readonly canvas: HTMLCanvasElement
  setUniforms(uniforms: ShaderMountUniforms): void
  setSpeed(speed: number): void
  setFrame(frame: number): void
  getCurrentFrame(): number
  dispose(): void
}

/**
 * uniform 里的字符串按 URL 载图。语义对齐 `shaders-react` 的 `processUniforms`：
 *  1. `/` 开头或能被 `new URL()` 解析的才算 URL；
 *  2. **只有跨源 URL 才设 `crossOrigin = 'anonymous'`** —— 本地 data:/blob:/自定义协议
 *     加了它会强制走 CORS 模式；
 *  3. 加载完把小于 1024 的图放大到 1024（`texImage2D` 读的是 naturalWidth，
 *     所以改的是 img.width/height，不是 drawImage 缩放）。
 */
export function isShaderImageUrl(value: string): boolean {
  if (!value) return false
  try {
    if (value.startsWith('/')) return true
    new URL(value)
    return true
  } catch {
    return false
  }
}

export function isExternalShaderUrl(url: string): boolean {
  try {
    if (url.startsWith('/')) return false
    const parsed = new URL(url, window.location.origin)
    return parsed.origin !== window.location.origin
  } catch {
    return false
  }
}

/** 小图放大：`img.naturalWidth/Height` 都小于 1024 时按原宽高比放大到 1024。 */
export function setMinImageSize(img: HTMLImageElement): void {
  if (img.naturalWidth >= MIN_IMAGE_SIZE || img.naturalHeight >= MIN_IMAGE_SIZE) return
  if (img.naturalWidth < 1 || img.naturalHeight < 1) return
  const aspect = img.naturalWidth / img.naturalHeight
  img.width = Math.round(aspect > 1 ? MIN_IMAGE_SIZE * aspect : MIN_IMAGE_SIZE)
  img.height = Math.round(aspect > 1 ? MIN_IMAGE_SIZE : MIN_IMAGE_SIZE / aspect)
}

function loadShaderImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (isExternalShaderUrl(url)) img.crossOrigin = 'anonymous'
    img.onload = () => {
      setMinImageSize(img)
      resolve(img)
    }
    img.onerror = () => reject(new Error(`Failed to load shader image: ${url}`))
    img.src = url
  })
}

/** 把 uniform 里的 URL 字符串换成已加载（且已放大）的 HTMLImageElement。 */
export async function resolveShaderUniformImages(
  uniforms: ShaderMountUniforms
): Promise<ShaderMountUniforms> {
  const resolved: ShaderMountUniforms = {}
  const pending: Promise<void>[] = []
  for (const [key, value] of Object.entries(uniforms)) {
    if (typeof value === 'string') {
      const url = value
      if (!isShaderImageUrl(url)) {
        // 非 URL 的字符串 uniform：paper 只支持 GL 标量/数组与图片，丢掉并提示（对齐 Folia 行为）
        console.warn(`[FoliaBackground] uniform "${key}" 的字符串不是合法 URL，已跳过：${url}`)
        continue
      }
      pending.push(
        loadShaderImage(url).then((img) => {
          resolved[key] = img
        })
      )
    } else if (value instanceof HTMLImageElement) {
      pending.push(
        value
          .decode()
          .catch(() => undefined)
          .then(() => {
            setMinImageSize(value)
            resolved[key] = value
          })
      )
    } else {
      resolved[key] = value
    }
  }
  await Promise.all(pending)
  return resolved
}

/**
 * 挂载一个 paper shader。宿主尺寸为 0 或 WebGL2 不可用时返回 null（调用方走渐变兜底），
 * **不抛错** —— 背景层是装饰，任何失败都不该冒泡成未捕获异常。
 *
 * `isStillValid` 是竞态守卫：图片加载是异步的，期间组件可能已卸载或已换图。
 */
export async function createPaperShaderMount(
  host: HTMLElement | null,
  options: PaperShaderOptions,
  isStillValid: () => boolean = () => true
): Promise<PaperShaderHandle | null> {
  if (!host || !host.isConnected) return null

  let uniforms: ShaderMountUniforms
  try {
    uniforms = await resolveShaderUniformImages(options.uniforms)
  } catch (error) {
    console.warn(`[FoliaBackground] 模式 ${options.mode} 的 shader 图片加载失败`, error)
    return null
  }
  if (!isStillValid() || !host.isConnected) return null

  let mount: ShaderMount
  try {
    mount = new ShaderMount(
      host,
      options.fragmentShader,
      uniforms,
      options.webGlContextAttributes ?? PAPER_SHADER_CONTEXT_ATTRIBUTES,
      options.speed ?? 0,
      options.frame ?? 0,
      options.minPixelRatio ?? 1,
      options.maxPixelCount,
      options.mipmaps ?? []
    )
  } catch (error) {
    markWebgl2Unavailable(options.mode, error)
    return null
  }

  const canvas = mount.canvasElement
  return {
    canvas,
    setUniforms: (next) => mount.setUniforms(next),
    setSpeed: (speed) => mount.setSpeed(speed),
    setFrame: (frame) => mount.setFrame(frame),
    getCurrentFrame: () => mount.getCurrentFrame(),
    dispose: () => {
      mount.dispose()
      releaseWebglContext(canvas)
    }
  }
}

/**
 * 写入 uniform：shader 自己在跑帧循环时只写值、不当场重画。
 *
 * 为什么：`setUniforms` 会立刻整帧重画，紧接着帧循环下一帧又画一遍 —— 一次更新画两遍全屏。
 * shader 停着（speed = 0）时没有循环，才必须用 `setUniforms` 立刻画一次。
 * `setUniformValues` 在 d.ts 里是 private、运行时是实例属性；拿不到就退回 `setUniforms`。
 */
export function updatePaperShaderUniforms(
  mount: PaperShaderHandle,
  uniforms: ShaderMountUniforms,
  animating: boolean
): void {
  const writer = (mount as unknown as { setUniformValues?: (values: ShaderMountUniforms) => void })
    .setUniformValues
  if (animating && typeof writer === 'function') {
    writer(uniforms)
    return
  }
  mount.setUniforms(uniforms)
}

/**
 * `shaders-react` 的每个 shader 组件都会把 sizing 那批 uniform 显式传下来，取值来自
 * 包内的 `defaultObjectSizing` / `defaultPatternSizing`（`shader-sizing.js`）。
 * 我们不走 React 封装，就必须自己补上，否则 `u_fit` 保持 GL 默认 0，
 * 图形缩放行为与 Folia 不一致。
 *
 * `u_worldWidth/u_worldHeight = 0` 的语义是「按画布尺寸算」，不是「0 尺寸」。
 */
export function objectSizingUniforms(): ShaderMountUniforms {
  return {
    u_fit: ShaderFitOptions.contain,
    u_scale: 1,
    u_rotation: 0,
    u_offsetX: 0,
    u_offsetY: 0,
    u_originX: 0.5,
    u_originY: 0.5,
    u_worldWidth: 0,
    u_worldHeight: 0
  }
}

/** `defaultPatternSizing`：与 object sizing 只差 `u_fit = none`（屏幕空间图案）。 */
export function patternSizingUniforms(): ShaderMountUniforms {
  return { ...objectSizingUniforms(), u_fit: ShaderFitOptions.none }
}
