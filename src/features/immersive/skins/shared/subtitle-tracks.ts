/**
 * 底部副字幕（罗马音 / 译文 / 下一句预览）的**轨道解析** —— 全部皮肤共享。
 *
 * 移植自 Folia `utils/lyrics/alternateText.ts` 的 `resolveLyricSubtitleTracks`
 * 与 `VisualizerSubtitleOverlay.tsx` 里的 `hasReadableText`。
 *
 * 住在 `skins/shared/`：「流光」与「浮名」都用这套副字幕（Folia 里它本来就是
 * 两个模式共用的一个组件），而两个平级皮肤不该互相依赖。
 *
 * ## 为什么需要「可读性门槛」
 *
 * 有些音源的歌词数据里带着**纯占位行**：`//`、`●●●`、`———`、一串斜杠
 * （乐器间奏或制作人员栏的排版残留）。它们有时间戳、有文本，逐行判断"非空"
 * 会照样显示出来，于是底栏出现一行莫名其妙的符号。
 *
 * 判据是「至少含一个字母或数字」（`\p{L}` / `\p{N}`，任何文字系统都算，
 * 汉字与假名都在 `\p{L}` 里）—— 比"非空"严格，又不会误杀正常歌词。
 */

import type { LyricLine } from '@/domain/lyric'
import type { SubtitleContentMode } from '../../immersive-settings.model'

/**
 * 副字幕的内容档位：两个都给 / 只译文 / 只罗马音 / 隐藏。
 *
 * ⚠️ 类型本体在 `immersive-settings.model`（它同时是「一条设置」与「本层的入参」，
 * 定义放在数据层才是正确方向，见那边的说明），这里**原样再导出** —— 本层与两个
 * 皮肤都继续从本文件 import，不必知道它住在哪。
 */
export type { SubtitleContentMode }

/** 轨道角色。'both' 档里罗马音在前、译文在后 —— 顺序是刻意的，见下。 */
export type SubtitleTrackRole = 'romanization' | 'translation'

/** 一条副字幕轨道 */
export interface SubtitleTrack {
  role: SubtitleTrackRole
  text: string
}

/**
 * 该文本是否"读得出来"（见文件头）。`//`、`●●●` 这类占位行返回 false。
 * 空串 / 只有空白也返回 false。
 */
export function hasReadableText(text: string | null | undefined): boolean {
  if (!text) return false
  return /[\p{L}\p{N}]/u.test(text)
}

/**
 * 解析一行的副字幕轨道。
 *
 * ⚠️ 四条规则逐条对齐 Folia，别"顺手优化"：
 *  1. `mode === 'none'` 或没有行 → 空数组；
 *  2. `'both'` 的顺序是**罗马音在前、译文在后** —— 拉丁转写是"跟着唱的那个"，
 *     译文献唱不了，所以次级轨道归译文（字号与不透明度都降一档，见下）；
 *  3. **不出现空占位行**：某一档没有文本（或读不出来）就少一行，绝不补空行；
 *  4. **同一个字符串只出一条轨道**：有些音源罗马音与译文填的是同一串
 *     （本身就是拉丁字母的歌词），不去重就会上下重复两遍。
 */
export function resolveSubtitleTracks(
  line: Pick<LyricLine, 'romaji' | 'translation'> | null | undefined,
  mode: SubtitleContentMode
): SubtitleTrack[] {
  if (!line) return []

  const tracks: SubtitleTrack[] = []
  for (const role of resolveSubtitleRoles(mode)) {
    const raw = role === 'romanization' ? line.romaji : line.translation
    const text = raw?.trim()
    if (!text || !hasReadableText(text)) continue
    if (tracks.some((track) => track.text === text)) continue
    tracks.push({ role, text })
  }
  return tracks
}

/**
 * 当前档位**可能出现**哪几条轨道，顺序即渲染顺序（罗马音在前、译文在后）。
 *
 * 与 {@link resolveSubtitleTracks} 的分工：那个回答"这一行**实际**显示哪几行"
 * （缺的档不出现），这个回答"这一档**最多**能有哪几行"（与行数据无关）。
 * 需要后者的只有一个场景 —— **在正常流里占位的布局**（见下面的 slots 说明）。
 *
 * `'none'` 返回空数组：隐藏档位下底栏永远没有内容，连留位都不该有。
 */
export function resolveSubtitleRoles(mode: SubtitleContentMode): SubtitleTrackRole[] {
  if (mode === 'none') return []
  return mode === 'both' ? ['romanization', 'translation'] : [mode]
}

/**
 * 把一行解析成**定长槽位**：槽位数量由档位决定，缺的档给空文本（`''`）。
 *
 * 「流光」「浮名」不需要它 —— 那两个皮肤的底栏是 `absolute` 贴底的，缺一行只会让
 * 整块**向上**长高，贴着底边的那一行纹丝不动（见共用组件 `SkinSubtitle.vue`）。
 *
 * 「倾诉」需要：它的副字幕在**正常流**里（舞台是"扣掉副字幕后剩下的高度"，
 * 见 tilt.scss 与 docs/tilt-porting-notes.md §3.1），于是副字幕一少一行，舞台就跟着
 * 变高、居中的歌词跟着跳 —— 实测换行瞬间 `.tilt-stage-inner` 纵向跳 **11px**
 * （2 行 → 1 行）、**26px**（2 行 → 0 行）。用定长槽位把那一格**留在原地**
 * （空槽只占位、不渲染任何可见内容），舞台高度就与本行有没有副字幕无关了。
 *
 * ⚠️ 空槽是空字符串而不是"这一档不存在"：调用方靠它区分"要渲染占位行"与"没有这一档"。
 */
export function resolveSubtitleSlots(
  rows: readonly SubtitleTrack[],
  mode: SubtitleContentMode
): SubtitleTrack[] {
  const textByRole = new Map(rows.map((row) => [row.role, row.text]))
  return resolveSubtitleRoles(mode).map((role) => ({ role, text: textByRole.get(role) ?? '' }))
}

/**
 * 次级轨道（`both` 档的第二行）的降档系数。
 *
 * 首行是"跟着唱的那个"，第二行是它的注解，所以**在用户设定的字号与字重基础上**
 * 再降一档观感：小 12%、不透明度 0.82。两行都用用户自己的字体与倍率，
 * 这里只裁剪相对关系。
 */
export const SECONDARY_TRACK_SIZE_FACTOR = 0.88
export const SECONDARY_TRACK_OPACITY = 0.82
/** 次级轨道在主题没指定字重时的兜底（首行兜底是 500） */
export const SECONDARY_TRACK_FONT_WEIGHT_FALLBACK = 400
/** 次级轨道上方的间距，单位是**它自己字号的 em**（于是缩放时间距跟着缩） */
export const SECONDARY_TRACK_GAP_EM = 0.25

/**
 * 把一个已经拼好的 clamp 字号串**再乘一个系数**（用于次级轨道）。
 *
 * 上游是在渲染时对 `translationFontSize` 字符串做一次正则替换
 * （`VisualizerSubtitleOverlay.tsx` 的 `scaleFontSize`），所以这里也照做 ——
 * 三项各自乘、单位原样保留。若改成"先算数值再拼串"，就得知道原始三个锚点，
 * 而两个皮肤用的锚点并不相同（见 `resolveSubtitleFontSizes` 的说明）。
 */
export function scaleSubtitleFontSize(fontSize: string, factor = 1): string {
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1
  return fontSize.replace(
    /(-?\d*\.?\d+)(rem|vw|px)/g,
    (_match, value: string, unit: string) => `${(Number(value) * safeFactor).toFixed(3)}${unit}`
  )
}

/**
 * 副字幕整层的不透明度 —— 上游 `subtitleOverlayOpacity` 的默认值。
 *
 * 它作用在**整个字幕层**上（含辉光底），次级轨道的 `SECONDARY_TRACK_OPACITY` 再在
 * 它之上叠一层不透明度 —— 两个系数是相乘关系，不是二选一。
 * 上游取值链：`resolvedOpacity = subtitleOverlayOpacity ?? 0.6`。
 */
export const SUBTITLE_OVERLAY_OPACITY = 0.6

/**
 * 换行时字幕栈的淡入档：**opacity 0 → 1、y 10px → 0、200ms。**
 *
 * 上游是同一个 overlay 组件里那层 keyed `motion.div`（见 `SkinSubtitle.vue` 的文件头），
 * 三个 Folia 系皮肤看到的是**同一次换行动画** —— 所以数字只能有一份出处，两个
 * 消费方各自映射：
 *  - `shared/SkinSubtitle.vue`（流光 / 浮名）—— 直接喂给 motion-v 的 `initial / animate`；
 *  - `skins/tilt/tilt.scss`（倾诉）—— 倾诉的副字幕不走 motion-v，它用 CSS 动画。
 *    CSS 没法 import 这个常量，所以那边是**渲染侧的副本**
 *    （`animation` 简写里的 200ms / ease-out 与 keyframes 里的 10px），
 *    由 `tilt/tilt-subtitle-swap.test.ts` 逐值锁死 —— 改这里而不改那边会直接红测试。
 *
 * `motionEase` 与 `cssEase` 是**同一条曲线**的两种写法（easeOut 与 CSS 的 ease-out
 * 都是 `cubic-bezier(0, 0, 0.58, 1)`），各用各的 API 拼写。
 */
export const SUBTITLE_SWAP_MOTION = {
  /** 淡入时长（毫秒）—— motion-v 的 `duration` 是秒，换算在共用组件里做 */
  durationMs: 200,
  /** 起始位移（px）：从下方 10px 滑到位 */
  offsetPx: 10,
  /** motion-v 的缓动名 */
  motionEase: 'easeOut',
  /** CSS 的缓动名 */
  cssEase: 'ease-out'
} as const

/**
 * 「下一句预览」最多显示几行 —— 上游 `nextLines` 取 2 行。
 *
 * 多于此值会把底栏堆成一小段歌词列表，反而抢走主舞台的注意力。
 */
export const UPCOMING_PREVIEW_LIMIT = 2

/**
 * 取「接下来几句」作为预览。
 *
 * 上游的完整语义是：**当前行有可读的副字幕就不显示预览**，没有才显示接下来的行
 * （`VisualizerSubtitleOverlay` 里 `subtitleText ? [] : previewLines`）。
 * 这个前置条件不在这里判 —— 本函数只负责"从候选里挑出可读的前 N 行"，
 * 是否该显示由调用方按副字幕轨道是否为空来决定（两件事分开，各自可测）。
 *
 * 同样过一遍可读性门槛：`//`、`●●●` 这类占位行不能进预览（与副字幕同一条规矩）。
 */
export function resolveUpcomingPreview(
  lines: readonly (Pick<LyricLine, 'text'> | null | undefined)[],
  limit = UPCOMING_PREVIEW_LIMIT
): string[] {
  if (!Number.isFinite(limit) || limit <= 0) return []
  const result: string[] = []
  for (const line of lines) {
    if (result.length >= limit) break
    const text = line?.text
    if (!text || !hasReadableText(text)) continue
    result.push(text)
  }
  return result
}

/**
 * 「下一句预览」的设置闸门。
 *
 * 预览也是副字幕的一种形态：档位为 `'none'` 时，当前行没有轨道所触发的
 * 预览必须一起消失，不能把「用户选择隐藏」误当成「这一行恰好没有副字幕」。
 */
export function resolveSubtitlePreview(
  lines: readonly (Pick<LyricLine, 'text'> | null | undefined)[],
  mode: SubtitleContentMode
): string[] {
  if (mode === 'none') return []
  return resolveUpcomingPreview(lines)
}

/** 首行（罗马音 / 单条译文）的字重兜底 —— 上游是 500 */
export const PRIMARY_TRACK_FONT_WEIGHT_FALLBACK = 500

/**
 * 副字幕辉光底：铺在文字后面的椭圆径向渐变，给文字一个离背景的"垫子"。
 *
 * 三档透明度与形状逐字对齐上游（`VisualizerSubtitleOverlay` 的 `subtitleGlowStyle`）：
 * 中心 0.96、62% 处 0.78、边缘透明。底色取主题的 `backgroundColor`。
 *
 * ⚠️ 尺寸（`ellipse 115% 130%`）是**相对那层自己的盒子**，不是相对视口 ——
 * 所以调用方必须把它铺在一个略大于文字的层上（上游用 `-inset-x-10 -inset-y-6` 外扩）。
 */
export function buildSubtitleGlowGradient(
  background: string,
  withAlpha: (color: string, alpha: number) => string
): string {
  return (
    `radial-gradient(ellipse 115% 130% at center, ` +
    `${withAlpha(background, 0.96)} 0%, ` +
    `${withAlpha(background, 0.78)} 62%, ` +
    `transparent 100%)`
  )
}

/**
 * 副字幕的文字阴影：`0 1px 2px` 的主题底色 24%。
 *
 * 极浅（0.24）是刻意的：它只在文字与辉光底边缘相接的那一两个像素上起作用，
 * 目的是把上下描边从背景里"抠"出来，不是做投影。调大会在浅色主题上变成脏边。
 */
export function buildSubtitleTextShadow(
  background: string,
  withAlpha: (color: string, alpha: number) => string
): string {
  return `0 1px 2px ${withAlpha(background, 0.24)}`
}

/**
 * 副字幕字号的 clamp 三锚点（对齐 Folia `subtitleFontSizes.ts`），倍率已乘进去。
 *
 * ⚠️ 三项**都**要乘 `scale`：只乘中间项是常见的移植错误 —— 那样缩放到触到
 * 上下界时就会失效（大屏上字号不跟着变大，小窗口里压不下去）。
 *
 * 本项目 Folia 系皮肤固定 `scale = 1`（不套用经典排版滑杆），保留参数是为了与上游公式
 * 保持同样的形状，将来接设置时不用改公式。
 */
export function resolveSubtitleClampSize(
  minRem: number,
  preferredVw: number,
  maxRem: number,
  scale = 1
): string {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  return (
    `clamp(${(minRem * safeScale).toFixed(3)}rem, ` +
    `${(preferredVw * safeScale).toFixed(3)}vw, ` +
    `${(maxRem * safeScale).toFixed(3)}rem)`
  )
}

/**
 * 副字幕字号的三锚点 —— **「流光」（classic）那一套**。
 *
 * ⚠️ 浮名用的是**另一套**（`clamp(1.05rem, 2.2vw, 1.2rem)`，见 `fume-adapter`）：
 * 上游 `VisualizerFume.tsx` 自己拼了这组 clamp，没有走 `subtitleFontSizes.ts`。
 * 两个面板的字幕字号在 Folia 里本来就不一样，**不要**为了"统一"把它们合并 ——
 * 合并的结果必然是其中一个面板的字幕大小与上游对不上。
 *
 * 共用的是上面那个拼装函数（三项都乘倍率这条规则只有一份），不是锚点数值。
 */
export function resolveSubtitleFontSizes(scale = 1): {
  translation: string
  upcoming: string
} {
  const clampSize = (minRem: number, preferredVw: number, maxRem: number): string =>
    resolveSubtitleClampSize(minRem, preferredVw, maxRem, scale)

  return {
    // 译文
    translation: clampSize(1.125, 2.6, 1.25),
    // 下一句预览
    upcoming: clampSize(0.875, 2, 1)
  }
}
