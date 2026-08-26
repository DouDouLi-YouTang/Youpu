import { ref, watch, type MaybeRefOrGetter, toValue } from 'vue'

const cache = new Map<string, string | null>()

function thumbUrl(url: string): string {
  if (url.includes('param=')) return url.replace(/param=\d+x\d+/, 'param=48y48')
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}param=48y48`
}

function isVibrant(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const sum = r + g + b
  if (sum < 90) return false
  if (sum > 690) return false
  return max - min >= 25
}

async function extractDominant(url: string): Promise<string | null> {
  if (cache.has(url)) return cache.get(url) ?? null
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = thumbUrl(url)
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('cover load failed'))
    })
    const size = 24
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      cache.set(url, null)
      return null
    }
    ctx.drawImage(img, 0, 0, size, size)
    const data = ctx.getImageData(0, 0, size, size).data
    const buckets = new Map<string, { count: number; rs: number; gs: number; bs: number }>()
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (!isVibrant(r, g, b)) continue
      const key = `${r >> 6}-${g >> 6}-${b >> 6}`
      const cur = buckets.get(key)
      if (cur) {
        cur.count++
        cur.rs += r
        cur.gs += g
        cur.bs += b
      } else {
        buckets.set(key, { count: 1, rs: r, gs: g, bs: b })
      }
    }
    if (buckets.size === 0) {
      cache.set(url, null)
      return null
    }
    let best: { count: number; rs: number; gs: number; bs: number } | null = null
    for (const v of buckets.values()) {
      if (!best || v.count > best.count) best = v
    }
    const avg = best!
    const rgb = `${Math.round(avg.rs / avg.count)},${Math.round(avg.gs / avg.count)},${Math.round(avg.bs / avg.count)}`
    cache.set(url, rgb)
    return rgb
  } catch {
    cache.set(url, null)
    return null
  }
}

export function useCoverColor(source: MaybeRefOrGetter<string | undefined | null>) {
  const color = ref<string | null>(null)
  watch(
    () => toValue(source),
    async (url) => {
      color.value = null
      if (!url) return
      color.value = await extractDominant(url)
    },
    { immediate: true }
  )
  return color
}
