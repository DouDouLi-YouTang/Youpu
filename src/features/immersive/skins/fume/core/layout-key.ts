/**
 * 排版缓存键（移植规格书 §7.1）。
 *
 * fume 的排版很贵（每行一次字号二分 + pretext 换行 + 逐字素测量），所以整篇文章
 * 缓存在一个 `Map` 里，键必须精确回答一个问题：**哪些输入变了就必须重排？**
 *
 * ## 键里放什么、不放什么
 *
 * 放（影响几何的）：
 * - 视口尺寸（**取整**，见下）；
 * - 影响字体度量的主题字段：`name` / `fontStyle` / `fontFamily` / `fontFamilyStack` / `fontWeight`；
 * - `lyricsFontScale` 与 `heroScale`（两个字号倍率）；
 * - 行数 + 每行的时间与文本指纹。
 *
 * 不放（不影响几何的）：**颜色、动画强度、辉光强度、背景不透明度**。
 * 这条是上游刻意为之（源码注释「Layout cache key intentionally ignores short-lived
 * playback state」）：改一个颜色不该触发整首诗重排 —— 那会卡住主线程好几帧。
 * 本项目的 `FumeTheme` 里颜色是每帧从 CSS 变量读的，若进了键，主题色过渡期间
 * 会**每一帧都重排**。
 *
 * ## 为什么视口尺寸必须 `Math.round`
 *
 * `ResizeObserver` 的 `contentRect` 是浮点数，窗口拖动时每像素都可能给出 `xxx.4`、
 * `xxx.7` 这样的值。不取整就是「拖一下窗口重排几百次」。
 * 取整后「亚像素抖动」不会重排，而真正的偶数像素变化仍然会。
 *
 * ## 行指纹为什么用 FNV 混合而不是直接拼字符串
 *
 * 一首歌几百行，每行都带上完整文本的话键会长到几 KB，`Map` 的哈希计算量也上去了。
 * 用 FNV-1a 把每行折叠成一个 32 位数，再把整首歌的折叠值混合起来 ——
 * 冲突概率在「几百行、每次比较」的量级下可以忽略，而上游就是这么做的。
 * ⚠️ 行的**顺序**必须参与：`hash(lines)` 与 `hash(reverse(lines))` 必须不同。
 * FNV 的 `xor → imul` 序列天然区分顺序，不要改成「先排序再哈希」。
 *
 * ## 为什么每行指纹里要带 `words.length` 与 `isChorus`
 *
 * 两者都参与排版：`words.length` 影响 §7.7 的行内片段切分（词边界决定绘制片段数），
 * `isChorus` 影响 §7.2 的变体选择（进而影响字号与跨列）。少了任何一项，
 * 同一段文本但词边界不同的两次加载会命中同一张缓存。
 */

import { hashString } from './fume-math'
import type { FumeLine, FumeTheme } from './fume-types'

/** FNV-1a 32 位偏移基准（与 `fume-math.ts` 的 `hashString` 同源） */
const FNV_OFFSET_BASIS = 2166136261

/** FNV-1a 32 位质数 */
const FNV_PRIME = 16777619

/**
 * 参与键的主题字段（`Pick<FumeTheme, …>` 的口径）。
 *
 * 之所以只取这五个：它们是**唯一**会改变字形度量或字体栈的字段。
 * 类型上刻意不接收整个 `FumeTheme`，这样调用处传错（例如把带颜色的主题对象整个丢进来）
 * 会直接编译不过 —— 用类型把「哪些字段参与重排」写死。
 */
export interface FumeLayoutThemeKey {
  name: string
  fontStyle: FumeTheme['fontStyle']
  fontFamily?: string
  fontFamilyStack?: readonly string[]
  fontWeight?: number
}

/** 视口尺寸（只读，键里会被取整） */
export interface FumeLayoutViewportKey {
  width: number
  height: number
}

/** 参与键的调参（本项目只有 `heroScale` 影响排版） */
export interface FumeLayoutTuningKey {
  heroScale: number
}

/**
 * 把整首歌的行折成一个 32 位指纹。
 *
 * 每行的字符串形状是上游原样：`startTime:endTime:fullText:words.length:isChorus`
 * （`isChorus` 是 `1` / `0`）。**时间用毫秒**（本项目口径），所以这里的数字比上游长三位，
 * 但相对关系一致：两个只有在毫秒小数位上不同的时间线仍然会得到不同的键 ——
 * 这正是我们要的（歌词时间戳变了就该重排）。
 */
function buildLinesHash(lines: readonly FumeLine[]): number {
  let linesHash = FNV_OFFSET_BASIS

  for (const line of lines) {
    const lineKey = `${line.startTimeMs}:${line.endTimeMs}:${line.fullText}:${line.words.length}:${
      line.isChorus ? 1 : 0
    }`
    linesHash ^= hashString(lineKey)
    linesHash = Math.imul(linesHash, FNV_PRIME)
  }

  return linesHash >>> 0
}

/**
 * 排版缓存键（规格书 §7.1）。
 *
 * 返回值用 `|` 分隔，最后三项是「行数 + 行指纹」：两者都留是有意的 ——
 * 行数是一眼能看懂的量（调试日志里 `11|4231` 就知道是 11 行、指纹 4231），
 * 指纹负责区分「行数相同但内容不同」。只留指纹的话，日志里看不出规模。
 */
export function buildLayoutCacheKey(
  lines: readonly FumeLine[],
  viewport: FumeLayoutViewportKey,
  layoutTheme: FumeLayoutThemeKey,
  lyricsFontScale: number,
  fumeTuning: FumeLayoutTuningKey
): string {
  return [
    Math.round(viewport.width),
    Math.round(viewport.height),
    layoutTheme.fontStyle,
    layoutTheme.fontFamily ?? '',
    layoutTheme.fontFamilyStack?.join(',') ?? '',
    layoutTheme.fontWeight ?? 'auto',
    layoutTheme.name,
    lyricsFontScale.toFixed(4),
    fumeTuning.heroScale.toFixed(4),
    lines.length,
    buildLinesHash(lines)
  ].join('|')
}
