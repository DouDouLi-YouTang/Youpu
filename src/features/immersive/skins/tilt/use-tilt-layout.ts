/**
 * 「倾诉」排版布局 —— 分行 / 倾斜段选择 / 溢出处理（笔记 §2–§4）。
 *
 * 分工：
 *  - 分行与倾斜选择本身是 core 的纯算法（determineLineCount / splitIntoSentences /
 *    pickTiltSegment），本文件只负责「调用顺序 + 测量 + 决策」；
 *  - 测量用 `@chenglou/pretext`（MIT）。它需要 canvas（OffscreenCanvas / DOM canvas），
 *    Node 下会直接抛错，所以**整个测量过程包在 try/catch 里**：拿不到测量就不缩放、
 *    不重切（只是可能偏宽），面板照常显示，绝不白屏；
 *  - 只在「行变化 / 面板宽度变化 / 字号或字体变化」时测量，绝不逐帧测量。
 *
 * 溢出决策链（笔记 §3，原样实现）：
 *   测得最宽段 → 溢出比 = 最宽段 / 可用宽度
 *     ① 溢出比 ≥ 1.6 → 重新切分成更多段（至多 +4 段），按新段数重算倾斜选择，再测一遍
 *     ② 否则按比例缩放：scale = max(1 / 溢出比, 下限)，下限 0.5（有倾斜段）/ 0.55（没有）
 */
import {
  computed,
  onBeforeUnmount,
  ref,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref
} from 'vue'

import { measureNaturalWidth, prepareWithSegments, clearCache } from '@chenglou/pretext'

import { countGraphemes } from './core/graphemes'
import { determineLineCount } from './core/line-count'
import { splitIntoSentences } from './core/segmentation'
import { pickTiltSegment } from './core/tilt-pick'
import {
  EXTRA_SEGMENTS_ON_RESPLIT,
  FALLBACK_REM_PX,
  FONT_WEIGHT_PLAIN,
  FONT_WEIGHT_TILT,
  LETTER_SPACING_EM_PLAIN,
  LETTER_SPACING_EM_TILT,
  SHORT_LAST_SEGMENT_SCALE,
  resolveAvailableWidth,
  resolveBaseFontPx,
  resolveOverflowScale,
  round2,
  shouldResplit,
  type TiltLineSource
} from './tilt-adapter'

/** 布局后的一个段（= 渲染上的一行） */
export interface TiltSegmentLayout {
  text: string
  /** 该段在整行文本中的 UTF-16 起始偏移（core 保证各段拼接 === 原文） */
  offset: number
  isTilt: boolean
  /** 命中「末段过短」补偿（字号 × 1.18） */
  isShortLast: boolean
}

export interface TiltLayout {
  text: string
  segments: TiltSegmentLayout[]
  /** 最终字号 px = clamp 字号 × 用户倍率 × 溢出缩放 */
  fontPx: number
  /** 溢出缩放倍率（1 = 未缩放） */
  scale: number
  /** 是否成功测量过（false = pretext 不可用，回退为不缩放） */
  measured: boolean
  availableWidth: number
}

/** 测量失败时的提示只打一次，避免每行刷屏 */
let measureWarningPrinted = false

function readViewportWidth(): number {
  const width = typeof window === 'undefined' ? 0 : window.innerWidth
  return Number.isFinite(width) && width > 0 ? width : 0
}

/** 根字号（rem 锚点）。浏览器默认 16px，读不到就用兜底值 */
function readRemPx(): number {
  if (typeof document === 'undefined') return FALLBACK_REM_PX
  const parsed = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_REM_PX
}

/**
 * 测量各段在对应字号下的自然宽度，返回最宽值；测量不可用返回 null。
 *
 * 字重 / 字体 / 字间距必须与渲染时一致（笔记 §4），否则量出来的宽度没有意义：
 * 字体族从 DOM 的 computed style 取（自定义字体是通过根元素 inline style 注入的），
 * 字间距 em → px 用当前字号换算。
 *
 * `shortLast` 为真时末段字号要乘 SHORT_LAST_SEGMENT_SCALE —— 渲染侧
 * （tilt-line.scss 的 --tilt-row-scale）乘的是 font-size，字号变了宽度就跟着变，
 * 测量不跟上的话溢出缩放会把这行算窄。
 */
function measureWidestSegment(
  segmentTexts: readonly string[],
  isTiltFlags: readonly boolean[],
  fontPx: number,
  fontFamily: string,
  shortLast: boolean
): number | null {
  try {
    let widest = 0
    for (let index = 0; index < segmentTexts.length; index++) {
      const isTilt = isTiltFlags[index] === true
      const isShortLast = shortLast && index === segmentTexts.length - 1
      const px = isShortLast ? fontPx * SHORT_LAST_SEGMENT_SCALE : fontPx
      const weight = isTilt ? FONT_WEIGHT_TILT : FONT_WEIGHT_PLAIN
      const font = `${isTilt ? 'italic ' : ''}${weight} ${px}px ${fontFamily}`
      const letterSpacingEm = isTilt ? LETTER_SPACING_EM_TILT : LETTER_SPACING_EM_PLAIN
      const prepared = prepareWithSegments(segmentTexts[index], font, {
        letterSpacing: letterSpacingEm * px
      })
      const width = measureNaturalWidth(prepared)
      if (Number.isFinite(width) && width > widest) widest = width
    }
    return widest
  } catch (error) {
    if (!measureWarningPrinted) {
      measureWarningPrinted = true
      console.warn('[倾诉] 文本测量不可用（pretext 需要 canvas），回退为不缩放排版', error)
    }
    return null
  }
}

/**
 * 布局 hook。
 *
 * @param options.source   当前行（null = 无行可排）。ComputedRef 或 getter 均可
 * @param options.fontScale 用户字号倍率（resolveFontScale 的结果）
 * @param options.fontKey  自定义字体的可响应标识：变化会触发重新测量
 * @param options.panel    面板元素（测它的 clientWidth 当可用宽度，并用 ResizeObserver 跟随）
 */
export function useTiltLayout(options: {
  source: MaybeRefOrGetter<TiltLineSource | null>
  fontScale: MaybeRefOrGetter<number>
  fontKey: MaybeRefOrGetter<string>
  panel: Ref<HTMLElement | null>
}): { layout: ComputedRef<TiltLayout | null> } {
  /** 面板可用宽度（px）；0 = 还没测到 → 布局挂起，避免先用错宽度排一次再抖一下 */
  const panelWidth = ref(0)
  let observer: ResizeObserver | null = null

  function readPanelWidth(): void {
    const el = options.panel.value
    const width = el && Number.isFinite(el.clientWidth) ? el.clientWidth : 0
    panelWidth.value = width > 0 ? width : 0
  }

  // 元素引用在挂载后才出现，用 flush:'post' 确保读到的是已完成布局的尺寸
  watch(
    options.panel,
    (el) => {
      observer?.disconnect()
      observer = null
      if (!el) {
        panelWidth.value = 0
        return
      }
      readPanelWidth()
      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(readPanelWidth)
        observer.observe(el)
      }
    },
    { immediate: true, flush: 'post' }
  )

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    // pretext 按 (文本, 字体) 缓存测量结果。行文本随歌曲无限增长，卸载时清一次，
    // 避免一路播歌把缓存堆在内存里（也顺带释放它的 canvas）。
    clearCache()
  })

  const layout = computed<TiltLayout | null>(() => {
    // 依赖项：字体标识（字体族是从 DOM 读的，Vue 看不到它变化，靠这个 key 建依赖）
    void toValue(options.fontKey)
    const source = toValue(options.source)
    if (!source || source.text.length === 0) return null
    if (panelWidth.value <= 0) return null

    const viewportWidth = readViewportWidth()
    const availableWidth = resolveAvailableWidth(viewportWidth, panelWidth.value)
    if (!(availableWidth > 0)) return null

    const family = readFontFamily(options.panel.value)
    const baseFontPx = resolveBaseFontPx(viewportWidth, readRemPx())
    const rawFontScale = toValue(options.fontScale)
    const fontScale = Number.isFinite(rawFontScale) && rawFontScale > 0 ? rawFontScale : 1
    const baseWithScale = round2(baseFontPx * fontScale)

    const seed = source.timeMs
    const graphemeCount = Math.max(countGraphemes(source.text, { ignoreWhitespace: true }), 1)
    let segmentTexts = splitIntoSentences(
      source.text,
      determineLineCount(graphemeCount, seed),
      seed
    )
    let pick = pickTiltSegment(segmentTexts, seed)
    let widest = measureWidestSegment(
      segmentTexts,
      segmentTexts.map((_, index) => index === pick.tiltIndex),
      baseWithScale,
      family,
      pick.shortLastSegment
    )

    if (widest !== null && shouldResplit(widest / availableWidth)) {
      const target = Math.min(segmentTexts.length + EXTRA_SEGMENTS_ON_RESPLIT, graphemeCount)
      const resplit = splitIntoSentences(source.text, target, seed)
      if (resplit.length > segmentTexts.length) {
        segmentTexts = resplit
        pick = pickTiltSegment(segmentTexts, seed)
        widest = measureWidestSegment(
          segmentTexts,
          segmentTexts.map((_, index) => index === pick.tiltIndex),
          baseWithScale,
          family,
          pick.shortLastSegment
        )
      }
    }

    // widest === null 表示测量不可用：不缩放、不重切，面板按原样排版（宁可能偏宽）
    const measured = widest !== null
    const scale =
      widest === null ? 1 : resolveOverflowScale(widest / availableWidth, pick.tiltIndex !== null)

    let offset = 0
    const segments = segmentTexts.map<TiltSegmentLayout>((text, index) => {
      const isLast = index === segmentTexts.length - 1
      const segment: TiltSegmentLayout = {
        text,
        offset,
        isTilt: index === pick.tiltIndex,
        isShortLast: isLast && pick.shortLastSegment
      }
      offset += text.length
      return segment
    })

    return {
      text: source.text,
      segments,
      fontPx: round2(baseWithScale * scale),
      scale,
      measured,
      availableWidth
    }
  })

  return { layout }
}

function readFontFamily(panel: HTMLElement | null): string {
  if (!panel) return 'sans-serif'
  const family = getComputedStyle(panel).fontFamily
  return family && family.trim().length > 0 ? family : 'sans-serif'
}
