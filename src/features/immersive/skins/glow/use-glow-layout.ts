/**
 * 「流光」的**逐词几何** —— 测量词宽 + 调 `core/word-layout` 算整行。
 *
 * ## 为什么要单独一个 hook
 *
 * 逐词几何依赖三件**响应式之外**的东西：视口宽度、根字号、DOM 上真实生效的字体栈。
 * 三者都只能从浏览器读（`window.innerWidth` / `getComputedStyle`），Vue 看不到它们变化，
 * 所以必须显式建立依赖与失效条件，否则窗口缩放后词宽仍按旧字号量，精确右边距整体偏。
 *
 * ⚠️ **视口宽度由调用方传进来**，本模块不自己监听 resize：同一个皮肤里
 * （以及将来的浮名）可能已经有别的消费方在读视口，各装一个监听就会出现同一件事
 * 有两份状态、两次失效。谁需要宽度谁传进来，本模块只负责"宽度变了就重算"。
 *
 * ## 只在需要时测量（绝不逐帧）
 *
 * 一行十几个词的 canvas 测量是**纯 CPU**操作，且只在四种情况下会变：
 *  1. 换行（`source` 变）；
 *  2. 窗口尺寸变（字号 vw 项与可用宽度都跟着变）；
 *  3. 内置字体加载完成（`fontKey`：兜底字与真字形量出的宽度不同）；
 *  4. 行的渲染档位变（`profile`，实际只在换行时变，但列进依赖更稳）。
 *
 * 上述以外**一律不重测** —— 尤其是播放时间推进：逐词几何是「一行生命周期内不变」的
 * 常量，把时间列进依赖会让每个词每帧重算一遍散落参数，视觉上是整行字在抖。
 *
 * ## 测量与渲染必须同字体
 *
 * 字体栈从**渲染元素**（`stage`）的 computed style 读，不由本模块写死：这样
 * `fonts.scss` 里改字体栈、或将来接入自定义字体，测量自动跟上。字重同理 ——
 * `GLOW_FONT_WEIGHT` 与 `glow-word.scss` 的 `font-weight` 是一对契约，同时改。
 *
 * 接入 Folia 字体设置后，字体栈 / 有效字重可由调用方显式传入（更准确）；
 * 未传时才回退到从舞台元素读 computed style / `GLOW_FONT_WEIGHT`。
 */

import { computed, toValue, type MaybeRefOrGetter, type Ref } from 'vue'

import {
  GLOW_FONT_SCALE,
  GLOW_FONT_WEIGHT,
  GLOW_INTENSITY,
  GLOW_ENABLE_WORD_ROTATION,
  GLOW_USE_LEGACY_LAYOUT,
  GLOW_WORD_SPACING,
  resolvePixelFontSize
} from './glow-adapter'
import type { DisplayWord } from './core/cjk-layout'
import { buildWordLayout, type WordLayoutResult } from './core/word-layout'
import { measureWordWidths, readFontStack, readRootFontSizePx } from './glow-measure'

export interface UseGlowLayoutOptions {
  /** 当前行的显示词；为空数组表示没有可排的行 */
  words: MaybeRefOrGetter<readonly DisplayWord[]>
  /** 行起始时刻（毫秒）—— 逐词几何的**种子**（见 `core/word-layout`） */
  lineStartMs: MaybeRefOrGetter<number>
  /** 字体就绪标识：变化即重测（见文件头第 3 条） */
  fontKey: MaybeRefOrGetter<unknown>
  /** 显式字体栈（自定义字体链）；不传时从 stage 的 computed style 读 */
  fontFamily?: MaybeRefOrGetter<string | null | undefined>
  /** 显式字重（有效值）；不传时使用 GLOW_FONT_WEIGHT */
  fontWeight?: MaybeRefOrGetter<number | null | undefined>
  /** 渲染元素：从它读字体栈（族名继承自这里，逐词不覆盖） */
  stage: Ref<HTMLElement | null>
  /** 视口宽度（px）—— `0` / 非有限值时不产出布局（还没测到） */
  viewportWidth: Ref<number>
}

export interface UseGlowLayoutResult {
  /** 布局结果；测量前提不满足时为 null（调用方按「还没有几何」处理） */
  layout: Ref<WordLayoutResult | null>
}

export function useGlowLayout(options: UseGlowLayoutOptions): UseGlowLayoutResult {
  const layout = computed<WordLayoutResult | null>(() => {
    // fontKey 只用来建依赖：它的**值**不参与计算（字体族是从 DOM 读的）。
    // Vue 只追踪真正被读到的响应式值，所以必须在这里显式读一次。
    void toValue(options.fontKey)

    const words = toValue(options.words)
    if (words.length === 0) return null

    const width = options.viewportWidth.value
    if (width <= 0) return null

    const pxFontSize = resolvePixelFontSize(width, readRootFontSizePx(), GLOW_FONT_SCALE)
    if (!(pxFontSize > 0)) return null

    const explicitFontStack = toValue(options.fontFamily)
    const fontStack =
      typeof explicitFontStack === 'string' && explicitFontStack.trim().length > 0
        ? explicitFontStack.trim()
        : readFontStack(options.stage.value)
    const explicitWeight = toValue(options.fontWeight)
    const fontWeight =
      typeof explicitWeight === 'number' && Number.isFinite(explicitWeight)
        ? explicitWeight
        : GLOW_FONT_WEIGHT
    const wordWidths = measureWordWidths(
      words.map((word) => word.text),
      pxFontSize,
      fontStack,
      fontWeight
    )

    return buildWordLayout({
      lineStartMs: toValue(options.lineStartMs),
      words: words.map((word) => word.text),
      intensity: GLOW_INTENSITY,
      enableWordRotation: GLOW_ENABLE_WORD_ROTATION,
      useLegacyLayout: GLOW_USE_LEGACY_LAYOUT,
      wordSpacing: GLOW_WORD_SPACING,
      wordWidths,
      pxFontSize
    })
  })

  return { layout }
}
