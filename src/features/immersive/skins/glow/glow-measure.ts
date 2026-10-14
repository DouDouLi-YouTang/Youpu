/**
 * 「流光」的**词宽测量** —— 精确右边距的唯一输入。
 *
 * ## 为什么值得单独一个文件
 *
 * 流光给每个词算右外边距时，要按「词在 active 状态下放大 1.4 倍会溢出多少」来决定
 * 间距（见 `core/word-layout.ts`）。所以它必须知道**每个词排出来有多宽**。
 *
 * 这里用 canvas 的 `measureText`，不用 DOM 量：DOM 量宽要先插进文档再读
 * `getBoundingClientRect`，一行的词可能十几个，逐个引起布局抖动（forced reflow），
 * 而 canvas 测量是纯计算、没有布局副作用。
 *
 * ## 与渲染必须同字体
 *
 * `context.font = '<weight> <px>px <stack>'` 里那个字体栈与字重**必须**与
 * 渲染时完全一致，否则量出来的宽度与浏览器排出来的宽度不是一回事，
 * 精确右边距会整体偏 —— 表现是词放大时互相压住（量窄了）或间距大得离谱（量宽了）。
 *
 * 所以字体栈不由本模块自己写死，而是由调用方从**渲染元素**上读 `getComputedStyle`
 * 传进来（与 `tilt/use-tilt-layout.ts` 的 `readFontFamily` 同款做法）。
 */

/**
 * 模块级复用的测量 canvas。
 *
 * 复用而不是每次新建：`document.createElement('canvas')` 会分配一个
 * 后备缓冲区，逐词新建等于逐词分配/回收，播放期间反复触发 GC。
 */
let measureCanvas: HTMLCanvasElement | null = null

/** 拿不到 canvas / 2d context 时的退化宽度：按"每个字符约 0.65 个字宽"估 */
const FALLBACK_CHAR_WIDTH_RATIO = 0.65

/**
 * 量一个词渲染后的宽度（px）。
 *
 * 退化路径（无 DOM / 拿不到 2d context）：`字符数 × 字号 × 0.65`。这是**下界估计**而非
 * 精确值 —— 对拉丁字母偏窄、对汉字偏窄不少。之所以仍然要用它，是因为
 * "量不准"只会让间距略小，而"不量"会让整行排版直接算不出来。
 */
export function measureWordWidth(
  text: string,
  pxFontSize: number,
  fontStack: string,
  fontWeight: number
): number {
  if (!text) return 0

  if (typeof document === 'undefined') {
    return text.length * pxFontSize * FALLBACK_CHAR_WIDTH_RATIO
  }

  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  const context = measureCanvas.getContext('2d')
  if (!context) {
    return text.length * pxFontSize * FALLBACK_CHAR_WIDTH_RATIO
  }

  context.font = `${fontWeight} ${pxFontSize}px ${fontStack}`
  return context.measureText(text).width
}

/**
 * 逐词量宽（下标与 `words` 一一对应）。
 *
 * 空格词（上游会把空白单独切成一个词）也要量：它在 flex 布局里占位，
 * 当 0 会让前后两个词的间距算小、放大后压到一起。
 */
export function measureWordWidths(
  words: readonly string[],
  pxFontSize: number,
  fontStack: string,
  fontWeight: number
): number[] {
  return words.map((word) => measureWordWidth(word, pxFontSize, fontStack, fontWeight))
}

/**
 * 从元素上读出渲染用的字体栈（computed style）。
 *
 * 拿不到元素 / 读不到字体时返回空串 —— 交给 canvas 用它的默认字体，
 * 而不是在这里编一个字体栈出来（编错了反而与渲染不一致）。
 */
export function readFontStack(element: HTMLElement | null): string {
  if (!element || typeof getComputedStyle !== 'function') return ''
  return getComputedStyle(element).fontFamily || ''
}

/**
 * 读根字号（rem 的 **px** 值）。字号 clamp 的 rem 锚点要靠它换算成像素。
 *
 * 本项目跟着读真实根字号而不是假定 16：应用会把根字号设成非 16
 * （字号设置 / 高 DPI 缩放都会），用 16 会让量宽与排版系统性偏差。
 */
export function readRootFontSizePx(): number {
  if (typeof document === 'undefined') return 16
  const parsed = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 16
}
