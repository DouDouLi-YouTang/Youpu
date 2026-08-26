import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

export interface Pos {
  x: number
  y: number
  w: number
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 发现页歌单方块布局:FM 卡钉左上角 (0,0),每日推荐钉 FM 右侧第一行,
 * 歌单方块用 bin-packing(候选点 first-fit,最低 y 最左 x)填满 FM/每日推荐周围所有空隙。
 *
 * 关键:FM 矮尺寸时 FM 下方那块"float 环绕填不进"的区域(zone 行),改用自适应宽 tile
 * 填满 FM 宽 -- zone 内 N 个 tile 宽 = (FM 宽 - (N-1)×gap) / N,右边对齐 FM 宽,
 * 消除"FM 宽不整除固定 tileW"留下的残留空白。其余行仍用固定宽 tileW bin-packing。
 * 这样任意 FM 尺寸(5 种宽 360/280/220/210)zone 行都无空白。
 *
 * 监听容器宽度与 FM 卡尺寸变化(ResizeObserver)自动重排;rAF 节流避免 FM 尺寸
 * transition 过程中反复同步重算卡顿。
 */
export function useDiscoverLayout(opts: {
  containerRef: Ref<HTMLElement | null>
  fmRef: Ref<HTMLElement | null>
  count: Ref<number>
  tileW: number
  tileH: number
  dailyW: number
  dailyH: number
  gap: number
}) {
  const dailyPos = ref<Pos>({ x: 0, y: 0, w: 0 })
  const tilePositions = ref<Pos[]>([])
  const containerHeight = ref(0)
  let ro: ResizeObserver | null = null
  let raf = 0

  function rectsOverlap(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  }

  function compute(): void {
    const container = opts.containerRef.value
    const fm = opts.fmRef.value
    if (!container || !fm) return
    const W = container.clientWidth
    if (W === 0) return
    const fmW = fm.offsetWidth
    const fmH = fm.offsetHeight
    const { tileW, tileH, dailyW, dailyH, gap } = opts

    // FM 钉左上角
    const placed: Rect[] = [{ x: 0, y: 0, w: fmW, h: fmH }]
    // 每日推荐:优先 FM 右侧第一行;容器放不下并排则退到 FM 下方
    let dx = fmW + gap
    let dy = 0
    if (dx + dailyW > W) {
      dx = 0
      dy = fmH + gap
    }
    placed.push({ x: dx, y: dy, w: dailyW, h: dailyH })
    dailyPos.value = { x: dx, y: dy, w: dailyW }

    const positions: Pos[] = []

    // zone 行:FM 下方(daily 在 FM 右侧且 FM 比 daily 矮时),用自适应宽 tile 填满 FM 宽,
    // 消除"FM 宽不整除固定 tileW"留下的残留空白。N 取最接近 tileW 的整数列数。
    if (dy === 0 && fmH + gap < dailyH) {
      const zoneY = fmH + gap
      const n = Math.max(1, Math.round(fmW / (tileW + gap)))
      const zoneTileW = (fmW - (n - 1) * gap) / n
      for (let i = 0; i < n; i++) {
        const zx = i * (zoneTileW + gap)
        positions.push({ x: zx, y: zoneY, w: zoneTileW })
        placed.push({ x: zx, y: zoneY, w: zoneTileW, h: tileH })
      }
    }

    // 其余 tile:固定宽 tileW,候选点 = {0} ∪ {已放置矩形右边/底边 + gap},逐个找最低 y 最左 x 的不重叠位置
    const remaining = opts.count.value - positions.length
    for (let i = 0; i < remaining; i++) {
      const xs = new Set<number>([0])
      const ys = new Set<number>([0])
      for (const p of placed) {
        xs.add(p.x + p.w + gap)
        ys.add(p.y + p.h + gap)
      }
      const xsArr = [...xs].sort((a, b) => a - b)
      const ysArr = [...ys].sort((a, b) => a - b)
      let best: Pos | null = null
      for (const y of ysArr) {
        for (const x of xsArr) {
          if (x + tileW > W + 0.5) continue
          const cand: Rect = { x, y, w: tileW, h: tileH }
          let ok = true
          for (const p of placed) {
            if (rectsOverlap(cand, p)) {
              ok = false
              break
            }
          }
          if (ok && (!best || y < best.y || (y === best.y && x < best.x))) {
            best = { x, y, w: tileW }
          }
        }
      }
      if (!best) break
      positions.push(best)
      placed.push({ x: best.x, y: best.y, w: tileW, h: tileH })
    }
    tilePositions.value = positions
    containerHeight.value = placed.reduce((m, p) => Math.max(m, p.y + p.h), 0)
  }

  function schedule(): void {
    if (raf) cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      raf = 0
      compute()
    })
  }

  onMounted(() => {
    schedule()
    ro = new ResizeObserver(() => schedule())
    if (opts.containerRef.value) ro.observe(opts.containerRef.value)
    if (opts.fmRef.value) ro.observe(opts.fmRef.value)
  })
  onBeforeUnmount(() => {
    ro?.disconnect()
    ro = null
    if (raf) cancelAnimationFrame(raf)
  })
  watch(
    () => opts.count.value,
    () => schedule()
  )

  return { dailyPos, tilePositions, containerHeight, recompute: compute }
}
