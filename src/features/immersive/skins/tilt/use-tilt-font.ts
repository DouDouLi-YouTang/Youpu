/**
 * 「倾诉」的内置字体 —— **就绪信号**（字体栈本身写在 `tilt.scss`，见那里与
 * `@/assets/fonts/fonts.scss` 的说明）。
 *
 * 为什么需要这个文件：倾诉的排版要**测量文字宽度**（use-tilt-layout 的
 * `measureWidestSegment` 走 canvas），而字体文件是**异步**就绪的。若在文件到位前
 * 测量，canvas 会拿兜底字体量出一组宽度 —— 等真字体换上来，字的宽窄全变了，
 * 排版却还按旧宽度缩放着，于是溢出或留白过窄。所以要把「字体是否到位」变成一个
 * **可响应信号**，交给 use-tilt-layout 的 `fontKey` 触发重测（那正是该入参的用途：
 * 「字体变化会触发重新测量」）。
 *
 * 分工（字体族名的**唯一 TS 出处**，与 tilt.scss 的栈逐字对应，由
 * use-tilt-font.test.ts 锁住不得漂移）：
 *  - `ZCOOL KuaiLe`（站酷快乐体）—— 汉字主力，圆胖笔画 + 弯钩；
 *  - `M PLUS Rounded 1c`—— 假名（以及快乐体缺的生僻字）的兜底，同为圆头笔画。
 */
import { onBeforeUnmount, ref, type Ref } from 'vue'

/** 汉字主力：站酷快乐体（纯简体字库，5977 字，**无假名字形**） */
export const TILT_FONT_HANZI = 'ZCOOL KuaiLe'

/** 假名兜底：M PLUS Rounded 1c（日本圆体，与快乐体同为圆头笔画） */
export const TILT_FONT_KANA = 'M PLUS Rounded 1c'

/**
 * 两个字体族的加载顺序（= `tilt.scss` 里 font-family 的书写顺序）。
 * 越靠前优先级越高：汉字优先给快乐体，它没有的字符再落到圆体。
 */
export const TILT_LYRIC_FONT_FAMILIES = [TILT_FONT_HANZI, TILT_FONT_KANA] as const

/**
 * 探测样本 —— 必须让**每个字体族都能被单独触发**：
 * `document.fonts.load(font, text)` 只挑「有该 text 里字符」的字面去加载，
 * 若统一传同一串（比如只给汉字），圆体的假名字面就不会被拉起来。
 */
const KANA_SAMPLE = 'あいうえおアイウエオー'

/** 就绪状态：'pending' 首帧 / `document.fonts` 不可用或加载完 = 'ready' */
export type TiltFontState = 'pending' | 'ready'

/**
 * 等倾诉的两个字体就绪，返回可响应标识。
 *
 * 失败也让状态落到 'ready'：字体缺失时 CSS 的字体栈会照常兜底（系统无衬线），
 * 排版该照常跑 —— 因为字体加载不出来就永远不排版，是比「用兜底字量」更糟的失败。
 */
export function useTiltFontReady(): { fontState: Ref<TiltFontState> } {
  const fontState = ref<TiltFontState>('pending')
  let cancelled = false

  /** 拿不到 Font Loading API（老环境 / 非浏览器）就直接认为就绪，不拖住排版 */
  const fontSet = typeof document === 'undefined' ? undefined : document.fonts
  if (!fontSet || typeof fontSet.load !== 'function') {
    fontState.value = 'ready'
    return { fontState }
  }

  const jobs = [
    fontSet.load(`400 32px "${TILT_FONT_HANZI}"`, '汉字'),
    fontSet.load(`400 32px "${TILT_FONT_KANA}"`, KANA_SAMPLE)
  ]

  void Promise.allSettled(jobs).then(() => {
    // 卸载后别再改状态（组件已没了，改它只会触发一次无意义的 watcher）
    if (!cancelled) fontState.value = 'ready'
  })

  onBeforeUnmount(() => {
    cancelled = true
  })

  return { fontState }
}
