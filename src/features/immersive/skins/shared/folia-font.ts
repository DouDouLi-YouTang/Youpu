/**
 * Folia 系皮肤（「流光」「浮名」）的**内置衬线字体** —— 族名常量与就绪信号。
 *
 * 字体文件与 `@font-face` 声明在 `src/assets/fonts/fonts.scss`（全局样式，
 * 理由见那里的注释：`@font-face` 没有选择器可供 scoped 加哈希，而且皮肤是异步组件，
 * 样式块加载时机晚于外壳，测量层首帧就要能读到族名）。
 *
 * ## 为什么需要「就绪信号」
 *
 * 两个皮肤的排版都要**测量文字宽度**（流光的精确右边距、浮名的文章列宽），
 * 而字体文件是异步到位的。若在文件到位前测量，canvas / pretext 会拿兜底字量出一组宽度 ——
 * 等真字体换上来，字的宽窄全变了，排版却还按旧宽度摆着，于是溢出或间距错乱。
 * 所以把「字体是否到位」变成一个可响应信号，交给测量层当**重测键**。
 *
 * 失败也让状态落到 `'ready'`：字体缺失时 CSS 字体栈会照常兜底（系统衬线），
 * 排版该照常跑 —— 因为字体加载不出来就永远不排版，是比「用兜底字量」更糟的失败。
 * 这与「倾诉」的 `use-tilt-font.ts` 是同一条取舍。
 *
 * ## 两个字重都要探测
 *
 * 正文用 500（标题类）、唱过的字用 400 —— 只探一个会让另一个在首帧后才到位，
 * 而测量用的字重一旦变化，宽度也会变（衬线字体的 400/500 字宽并不相同）。
 */

import { onBeforeUnmount, ref, type Ref } from 'vue'

/** 内置衬线字体的族名（**唯一 TS 出处**，与 `fonts.scss` 的 @font-face 逐字对应） */
export const FOLIA_SERIF_FAMILY = 'Folia Noto Serif SC'

/** 就绪状态：'pending' 首帧 / `document.fonts` 不可用或加载完 = 'ready' */
export type FoliaSerifState = 'pending' | 'ready'

/** 探测样本：汉字 + 假名 + 拉丁，确保每个字面都被拉起（子集字体按码位分片） */
const PROBE_TEXT = '歌词Lyricsあいう'

/**
 * 等内置衬线字体就绪，返回可响应标识。
 *
 * 两个字重各自 `load()` 一次：`document.fonts.load()` 只挑「样本里有该字符」的字面，
 * 所以两个调用都必须给同样的探测文本。
 */
export function useFoliaSerifReady(): { fontState: Ref<FoliaSerifState> } {
  const fontState = ref<FoliaSerifState>('pending')
  let cancelled = false

  const fontSet = typeof document === 'undefined' ? undefined : document.fonts
  if (!fontSet || typeof fontSet.load !== 'function') {
    fontState.value = 'ready'
    return { fontState }
  }

  const jobs = [
    fontSet.load(`400 32px "${FOLIA_SERIF_FAMILY}"`, PROBE_TEXT),
    fontSet.load(`500 32px "${FOLIA_SERIF_FAMILY}"`, PROBE_TEXT)
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
