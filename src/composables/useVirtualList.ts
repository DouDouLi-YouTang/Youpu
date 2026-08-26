import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

export interface VirtualListRange {
  /** 第一个可见项索引(含 overscan)。 */
  start: number
  /** 最后一个可见项索引(不含,含 overscan)。 */
  end: number
  /** 上方垫高(px)。 */
  offsetY: number
  /** 总高度(px)。 */
  totalHeight: number
}

/**
 * 固定行高虚拟列表。只渲染视口附近的行,上千首歌曲也不会卡。
 * container 必须是 overflow 滚动容器,且有明确高度(flex-1 + min-h-0 等)。
 */
export function useVirtualList(options: {
  count: Ref<number>
  itemHeight: number
  /** 视口外预渲染行数,默认 8。 */
  overscan?: number
  containerRef: Ref<HTMLElement | null>
}) {
  const overscan = options.overscan ?? 8
  const scrollTop = ref(0)
  const viewportHeight = ref(0)

  const range = computed<VirtualListRange>(() => {
    const count = Math.max(0, options.count.value)
    const h = options.itemHeight
    const totalHeight = count * h
    if (count === 0 || h <= 0) {
      return { start: 0, end: 0, offsetY: 0, totalHeight: 0 }
    }
    const vh = Math.max(viewportHeight.value, 1)
    const rawStart = Math.floor(scrollTop.value / h)
    const visible = Math.ceil(vh / h) + 1
    const start = Math.max(0, rawStart - overscan)
    const end = Math.min(count, rawStart + visible + overscan)
    return {
      start,
      end,
      offsetY: start * h,
      totalHeight
    }
  })

  function measure(): void {
    const el = options.containerRef.value
    if (!el) return
    viewportHeight.value = el.clientHeight
    scrollTop.value = el.scrollTop
  }

  function onScroll(): void {
    const el = options.containerRef.value
    if (!el) return
    scrollTop.value = el.scrollTop
  }

  let ro: ResizeObserver | null = null

  onMounted(() => {
    measure()
    const el = options.containerRef.value
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure())
      ro.observe(el)
    }
    window.addEventListener('resize', measure)
  })

  onBeforeUnmount(() => {
    ro?.disconnect()
    ro = null
    window.removeEventListener('resize', measure)
  })

  // 数据量变化时若滚动超出范围,夹回
  watch(
    () => options.count.value,
    () => {
      const el = options.containerRef.value
      if (!el) return
      const max = Math.max(0, options.count.value * options.itemHeight - el.clientHeight)
      if (el.scrollTop > max) el.scrollTop = max
      measure()
    }
  )

  return { range, onScroll, measure, scrollTop, viewportHeight }
}
