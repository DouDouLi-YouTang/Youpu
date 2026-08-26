import { QuantizerCelebi } from '@importantimport/material-color-utilities'

/**
 * 封面取色的共享底层：跨域图片加载 + 50×50 像素读取 + ARGB 量化。
 *
 * 主色提取（use-color-extraction）与 gradient 背景（ImmersiveBackground）共用
 * 这套像素→量化流程，避免重复实现 canvas 跨域逻辑。参考项目用 colorthief
 * 取色盘，本应用改用同源的 QuantizerCelebi（material-color-utilities）派生，
 * 视觉上仍是"从封面取色的渐变"，且减少一个依赖。
 */

export function argbToRgb(argb: number): [number, number, number] {
  return [(argb >> 16) & 0xff, (argb >> 8) & 0xff, argb & 0xff]
}

/** 加载跨域封面图（配合主进程注入的 ACAO 头，可被 canvas 读取） */
export async function loadCrossOriginImage(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = url
  })
}

/** 把图片缩到 50×50 读取像素，每 4 字节(R,G,B,A)打包成 ARGB int（对齐参考项目） */
export function imageToArgbPixels(img: HTMLImageElement): number[] {
  const canvas = document.createElement('canvas')
  canvas.width = 50
  canvas.height = 50
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  ctx.drawImage(img, 0, 0, w, h, 0, 0, 50, 50)
  const data = ctx.getImageData(0, 0, 50, 50).data
  const pixels: number[] = []
  for (let i = 0; i < data.length; i += 4) {
    const argb =
      (((data[i + 3] << 24) >>> 0) |
        ((data[i] << 16) >>> 0) |
        ((data[i + 1] << 8) >>> 0) |
        data[i + 2]) >>>
      0
    pixels.push(argb)
  }
  return pixels
}

/** 量化取色，返回按频率降序排列的 [r,g,b][] 色盘；失败返回 null */
export async function getDominantRgbPalette(url: string, count = 8): Promise<number[][] | null> {
  try {
    const img = await loadCrossOriginImage(url)
    const pixels = imageToArgbPixels(img)
    const quantized = QuantizerCelebi.quantize(pixels, 128)
    const sorted = Array.from(quantized.entries()).sort((a, b) => b[1] - a[1])
    return sorted.slice(0, count).map(([argb]) => argbToRgb(argb))
  } catch {
    return null
  }
}
