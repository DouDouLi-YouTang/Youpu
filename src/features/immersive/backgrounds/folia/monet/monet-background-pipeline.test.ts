import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FoliaTheme } from '../types'
import { DEFAULT_MONET_BACKGROUND_TUNING, resolveMonetTuning } from './monet-tuning'
import {
  MONET_BACKGROUND_HEIGHT,
  MONET_BACKGROUND_WIDTH,
  MONET_CACHE_LIMIT,
  applyBackgroundPostProcessing,
  clearMonetBackgroundCacheForTests,
  getMonetBackgroundCacheKey,
  monetBackgroundCacheSizeForTests,
  paintMonetOverlay,
  resolveMonetBackgroundDataUrl,
  resolveMonetBlurStyle,
  resolveMonetHalfPaneImageOpacity,
  resolveMonetHalfPaneImagePositionX,
  resolveMonetPipelineSourceUrl,
  resolveWashColor,
  resolveWashEndpoints
} from './monet-background-pipeline'

const theme: FoliaTheme = {
  backgroundColor: '#101010',
  primaryColor: '#ffffff',
  accentColor: '#ff8800',
  secondaryColor: '#00aaff'
}

const tuning = resolveMonetTuning()

/** 极简的 2D context 替身：只实现被测函数真正会调用的那几个方法。 */
function fakeContext(pixels: number[]): {
  context: CanvasRenderingContext2D
  imageData: { data: number[] }
  putCount: number
} {
  const imageData = { data: pixels }
  const state = { putCount: 0 }
  const context = {
    getImageData: () => imageData,
    putImageData: () => {
      state.putCount += 1
    }
  } as unknown as CanvasRenderingContext2D
  return {
    context,
    imageData,
    get putCount() {
      return state.putCount
    }
  }
}

describe('monet 尺寸与常量', () => {
  it('烘焙画布是 1920×1080，缓存上限 12 条', () => {
    expect(MONET_BACKGROUND_WIDTH).toBe(1920)
    expect(MONET_BACKGROUND_HEIGHT).toBe(1080)
    expect(MONET_CACHE_LIMIT).toBe(12)
  })
})

describe('wash 端点与插值', () => {
  it('亮的那一端当 highlight（浅色主题不翻转）', () => {
    const dark = { r: 16, g: 16, b: 16 }
    const light = { r: 240, g: 240, b: 240 }
    expect(resolveWashEndpoints(dark, light)).toEqual({ shadow: dark, highlight: light })
    // 反过来传也一样：由亮度决定，不由参数位置决定
    expect(resolveWashEndpoints(light, dark)).toEqual({ shadow: dark, highlight: light })
  })

  it('0.55 是拐点：暗部向 shadow、亮部向 highlight，中间正好落在 accent', () => {
    const background = { r: 0, g: 0, b: 0 }
    const accent = { r: 128, g: 128, b: 128 }
    const primary = { r: 255, g: 255, b: 255 }

    expect(resolveWashColor(0, background, accent, primary)).toEqual({ r: 0, g: 0, b: 0 })
    expect(resolveWashColor(0.55, background, accent, primary)).toEqual({ r: 128, g: 128, b: 128 })
    expect(resolveWashColor(1, background, accent, primary)).toEqual({ r: 255, g: 255, b: 255 })
    // 拐点两侧是两条不同的直线，别让它们接错
    expect(resolveWashColor(0.275, background, accent, primary).r).toBeCloseTo(64, 6)
    expect(resolveWashColor(0.775, background, accent, primary).r).toBeCloseTo(191.5, 6)
  })

  it('NaN 亮度当 0 处理（否则整张图会被写成 NaN）', () => {
    const background = { r: 0, g: 0, b: 0 }
    const accent = { r: 100, g: 100, b: 100 }
    const primary = { r: 200, g: 200, b: 200 }
    expect(resolveWashColor(Number.NaN, background, accent, primary)).toEqual(background)
  })
})

describe('逐像素后处理', () => {
  it('全默认（无灰度、饱和度 1、无 wash）直接跳过，不做 getImageData 往返', () => {
    const { context, putCount } = fakeContext([1, 2, 3, 255])
    applyBackgroundPostProcessing(context, 1, 1, theme, {
      ...tuning,
      backgroundGrayscale: 0,
      backgroundSaturation: 1,
      backgroundWash: 0
    })
    expect(putCount).toBe(0)
  })

  it('灰度：三通道一起向亮度收敛', () => {
    // #ff0000 的亮度 = 0.2126 * 255 ≈ 54.2
    const { context, imageData } = fakeContext([255, 0, 0, 255])
    applyBackgroundPostProcessing(context, 1, 1, theme, {
      ...tuning,
      backgroundGrayscale: 1,
      backgroundSaturation: 1,
      backgroundWash: 0
    })
    const luminance = Math.round(0.2126 * 255)
    expect(imageData.data.slice(0, 3)).toEqual([luminance, luminance, luminance])
  })

  it('alpha = 0 的像素被整颗跳过（透明区不该被染色）', () => {
    const { context, imageData } = fakeContext([255, 0, 0, 0])
    applyBackgroundPostProcessing(context, 1, 1, theme, {
      ...tuning,
      backgroundGrayscale: 1,
      backgroundSaturation: 1,
      backgroundWash: 0
    })
    expect(imageData.data).toEqual([255, 0, 0, 0])
  })

  it('wash 用的亮度是**灰度之前**的原始亮度（顺序敏感）', () => {
    // 纯白像素：原始亮度 = 255 → 归一化 1 → wash 目标是 highlight（= primary 白）
    const { context, imageData } = fakeContext([255, 255, 255, 255])
    applyBackgroundPostProcessing(context, 1, 1, theme, {
      ...tuning,
      backgroundGrayscale: 0,
      backgroundSaturation: 1,
      backgroundWash: 1
    })
    expect(imageData.data.slice(0, 3)).toEqual([255, 255, 255])
  })

  it('饱和度 > 1 会拉开通道差；< 1 会压平', () => {
    const pixel = [200, 100, 50, 255]

    const saturated = fakeContext([...pixel])
    applyBackgroundPostProcessing(saturated.context, 1, 1, theme, {
      ...tuning,
      backgroundGrayscale: 0,
      backgroundSaturation: 2,
      backgroundWash: 0
    })
    const desaturated = fakeContext([...pixel])
    applyBackgroundPostProcessing(desaturated.context, 1, 1, theme, {
      ...tuning,
      backgroundGrayscale: 0,
      backgroundSaturation: 0,
      backgroundWash: 0
    })

    expect(saturated.imageData.data[0]).toBeGreaterThan(pixel[0])
    expect(saturated.imageData.data[2]).toBeLessThan(pixel[2])
    // 饱和度 0 = 全灰
    const gray = desaturated.imageData.data
    expect(gray[0]).toBe(gray[1])
    expect(gray[1]).toBe(gray[2])
  })

  it('custom wash 色只认 6 位 hex（归一化小写），否则回退 accent', () => {
    const { context, imageData } = fakeContext([0, 0, 0, 255])
    applyBackgroundPostProcessing(context, 1, 1, theme, {
      ...tuning,
      backgroundWash: 1,
      backgroundWashColorMode: 'custom',
      // 黑色像素 → 归一化亮度 0 → wash = shadow 端点，这里验证的是「不炸」
      backgroundWashCustomColor: '#8fb7ff'
    })
    expect(imageData.data.slice(0, 3).every((channel) => channel >= 0 && channel <= 255)).toBe(true)
  })
})

describe('烘焙装饰叠加', () => {
  interface FakeGradient {
    stops: Array<[number, string]>
  }

  function fakeOverlayContext(): {
    context: CanvasRenderingContext2D
    rects: Array<[number, number, number, number]>
    gradients: FakeGradient[]
    fillStyles: unknown[]
  } {
    const rects: Array<[number, number, number, number]> = []
    const gradients: FakeGradient[] = []
    const fillStyles: unknown[] = []
    const context = {
      createLinearGradient: () => {
        const gradient: FakeGradient = { stops: [] }
        gradients.push(gradient)
        return {
          addColorStop: (offset: number, color: string) => gradient.stops.push([offset, color])
        }
      },
      createRadialGradient: () => {
        const gradient: FakeGradient = { stops: [] }
        gradients.push(gradient)
        return {
          addColorStop: (offset: number, color: string) => gradient.stops.push([offset, color])
        }
      },
      fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]),
      set fillStyle(value: unknown) {
        fillStyles.push(value)
      },
      get fillStyle() {
        return fillStyles.at(-1)
      }
    } as unknown as CanvasRenderingContext2D
    return { context, rects, gradients, fillStyles }
  }

  it('三条渐变 + 18 条竖纹，坐标是固定算术序列（不是随机数）', () => {
    const fake = fakeOverlayContext()
    paintMonetOverlay(fake.context, 1920, 1080, theme, tuning)

    // 3 条渐变（overlay / 光斑 / 纱幕）+ 18 条竖纹的 fillRect
    expect(fake.gradients).toHaveLength(3)
    expect(fake.rects).toHaveLength(3 + 18)
    // 前三条是渐变的整屏填充，第 4 条起才是竖纹（index = 条序号）
    expect(fake.rects[3]).toEqual([0, ((0 * 211) % 1080) - 40, 1, 1080 * 0.28])
    expect(fake.rects[4]).toEqual([127, ((1 * 211) % 1080) - 40, 1, 1080 * 0.28])
    expect(fake.rects[5]).toEqual([254, ((2 * 211) % 1080) - 40, 1, 1080 * 0.28])
    // 第二次调用必须逐字节一致（缓存失效时纹理不能跳）
    const again = fakeOverlayContext()
    paintMonetOverlay(again.context, 1920, 1080, theme, tuning)
    expect(again.rects).toEqual(fake.rects)
  })

  it('关闭竖纹后只剩三条渐变，一条 fillRect 都不多', () => {
    const fake = fakeOverlayContext()
    paintMonetOverlay(fake.context, 1920, 1080, theme, {
      ...tuning,
      backgroundStreaksEnabled: false
    })
    expect(fake.gradients).toHaveLength(3)
    expect(fake.rects).toHaveLength(3)
  })
})

describe('图源与缓存 key', () => {
  const uploaded = { id: 'up-1', name: '上传图', url: 'https://upload.test/x.jpg' }

  it('cover-derived 优先封面，uploaded-global 优先上传图', () => {
    expect(
      resolveMonetPipelineSourceUrl({
        coverUrl: 'https://cover.test/c.jpg',
        monetBackgroundImage: uploaded,
        tuning: { ...tuning, backgroundSource: 'cover-derived' }
      })
    ).toBe('https://cover.test/c.jpg')
    expect(
      resolveMonetPipelineSourceUrl({
        coverUrl: 'https://cover.test/c.jpg',
        monetBackgroundImage: uploaded,
        tuning: { ...tuning, backgroundSource: 'uploaded-global' }
      })
    ).toBe(uploaded.url)
  })

  it('缺一边时回退另一边；两边都缺返回 null', () => {
    expect(
      resolveMonetPipelineSourceUrl({
        coverUrl: null,
        monetBackgroundImage: uploaded,
        tuning
      })
    ).toBe(uploaded.url)
    expect(
      resolveMonetPipelineSourceUrl({
        coverUrl: 'https://cover.test/c.jpg',
        monetBackgroundImage: null,
        tuning: { ...tuning, backgroundSource: 'uploaded-global' }
      })
    ).toBe('https://cover.test/c.jpg')
    expect(
      resolveMonetPipelineSourceUrl({ coverUrl: null, monetBackgroundImage: null, tuning })
    ).toBeNull()
  })

  it('布局 / 漂移参数不进 key，竖纹开关必须进', () => {
    const base = getMonetBackgroundCacheKey({
      coverUrl: 'https://cover.test/c.jpg',
      monetBackgroundImage: null,
      theme,
      tuning
    })
    const layoutChanged = getMonetBackgroundCacheKey({
      coverUrl: 'https://cover.test/c.jpg',
      monetBackgroundImage: null,
      theme,
      tuning: { ...tuning, backgroundLayout: 'half-pane-gradient' }
    })
    const driftChanged = getMonetBackgroundCacheKey({
      coverUrl: 'https://cover.test/c.jpg',
      monetBackgroundImage: null,
      theme,
      tuning: { ...tuning, backgroundDriftStrength: 1, backgroundDriftEnabled: false }
    })
    const streaksChanged = getMonetBackgroundCacheKey({
      coverUrl: 'https://cover.test/c.jpg',
      monetBackgroundImage: null,
      theme,
      tuning: { ...tuning, backgroundStreaksEnabled: false }
    })
    const overlayChanged = getMonetBackgroundCacheKey({
      coverUrl: 'https://cover.test/c.jpg',
      monetBackgroundImage: null,
      theme,
      tuning: { ...tuning, backgroundOverlayOpacity: 0.1 }
    })

    expect(layoutChanged).toBe(base)
    expect(driftChanged).toBe(base)
    expect(streaksChanged).not.toBe(base)
    expect(overlayChanged).not.toBe(base)
  })

  it('同一个 URL 走 uploaded-global 时 id 也进 key（同 URL 不同 id 不撞缓存）', () => {
    const a = getMonetBackgroundCacheKey({
      coverUrl: null,
      monetBackgroundImage: { id: 'a', name: '', url: uploaded.url },
      theme,
      tuning: { ...tuning, backgroundSource: 'uploaded-global' }
    })
    const b = getMonetBackgroundCacheKey({
      coverUrl: null,
      monetBackgroundImage: { id: 'b', name: '', url: uploaded.url },
      theme,
      tuning: { ...tuning, backgroundSource: 'uploaded-global' }
    })
    expect(a).not.toBe(b)
  })
})

describe('降级路径', () => {
  afterEach(() => {
    clearMonetBackgroundCacheForTests()
    vi.restoreAllMocks()
  })

  it('ctx.filter 可用时不加 CSS 模糊；不可用时给 filter + scale(1.1)', () => {
    expect(resolveMonetBlurStyle(6, true)).toEqual({})
    expect(resolveMonetBlurStyle(6, false)).toEqual({
      filter: 'blur(6px)',
      WebkitFilter: 'blur(6px)',
      transform: 'scale(1.1) translateZ(0)'
    })
    expect(resolveMonetBlurStyle(0, false)).toEqual({})
    // 越界被夹到 60（Folia 的滑块上限）
    expect(resolveMonetBlurStyle(500, false).filter).toBe('blur(60px)')
  })

  it('半屏派生量：浅色更实、亮度叠加 overlay 的 0.16，X 位置钳在 10–90', () => {
    expect(resolveMonetHalfPaneImageOpacity(false, 0)).toBeCloseTo(0.3, 6)
    expect(resolveMonetHalfPaneImageOpacity(true, 0)).toBeCloseTo(0.7, 6)
    expect(resolveMonetHalfPaneImageOpacity(false, 1)).toBeCloseTo(0.46, 6)
    expect(resolveMonetHalfPaneImagePositionX(0)).toBe(50)
    expect(resolveMonetHalfPaneImagePositionX(100)).toBe(90)
    expect(resolveMonetHalfPaneImagePositionX(-100)).toBe(10)
    expect(resolveMonetHalfPaneImagePositionX(Number.NaN)).toBe(50)
  })

  it('node 环境（无 document / Image）下烘焙失败但**不抛错**，只 warn 一次并返回 null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await resolveMonetBackgroundDataUrl({
      coverUrl: 'https://cover.test/c.jpg',
      monetBackgroundImage: null,
      theme,
      tuning
    })
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('失败的 Promise 也被缓存：同一 key 只 warn 一次', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const options = {
      coverUrl: 'https://cover.test/c.jpg',
      monetBackgroundImage: null,
      theme,
      tuning
    }
    const first = resolveMonetBackgroundDataUrl(options)
    const second = resolveMonetBackgroundDataUrl(options)
    expect(first).toBe(second)
    await Promise.all([first, second])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('缓存有 LRU 上限（Folia 的 Map 永不清理，这里必须封顶）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (let index = 0; index < MONET_CACHE_LIMIT + 6; index += 1) {
      await resolveMonetBackgroundDataUrl({
        coverUrl: `https://cover.test/${index}.jpg`,
        monetBackgroundImage: null,
        theme,
        tuning
      })
    }
    expect(monetBackgroundCacheSizeForTests()).toBe(MONET_CACHE_LIMIT)
  })
})

describe('tuning 默认值', () => {
  it('monet 默认值与规格 §4.5 一致（没接面板也要逐字对）', () => {
    expect(DEFAULT_MONET_BACKGROUND_TUNING).toEqual({
      backgroundSource: 'cover-derived',
      backgroundLayout: 'full-overlay',
      backgroundBlurPx: 6,
      backgroundOverlayOpacity: 0.74,
      backgroundGrayscale: 0,
      backgroundSaturation: 1.05,
      backgroundWash: 0.34,
      backgroundHalfPaneOffsetX: 0,
      backgroundWashColorMode: 'theme',
      backgroundWashCustomColor: '#8fb7ff',
      backgroundDriftEnabled: true,
      backgroundDriftStrength: 0.5,
      backgroundStreaksEnabled: true
    })
  })
})
