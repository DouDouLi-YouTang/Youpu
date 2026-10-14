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

/** 副字幕的内容档位：不显示 / 只译文 / 只罗马音 / 两个都给 */
export type SubtitleContentMode = 'none' | 'translation' | 'romanization' | 'both'

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
  if (!line || mode === 'none') return []

  const roles: SubtitleTrackRole[] = mode === 'both' ? ['romanization', 'translation'] : [mode]

  const tracks: SubtitleTrack[] = []
  for (const role of roles) {
    const raw = role === 'romanization' ? line.romaji : line.translation
    const text = raw?.trim()
    if (!text || !hasReadableText(text)) continue
    if (tracks.some((track) => track.text === text)) continue
    tracks.push({ role, text })
  }
  return tracks
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
 * 本项目 Folia 系皮肤固定 `scale = 1`（没有设置面板），保留参数是为了与上游公式
 * 保持同样的形状，将来接设置时不用改公式。
 */
export function resolveSubtitleFontSizes(scale = 1): {
  translation: string
  upcoming: string
} {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const clampSize = (minRem: number, preferredVw: number, maxRem: number): string =>
    `clamp(${(minRem * safeScale).toFixed(3)}rem, ${(preferredVw * safeScale).toFixed(3)}vw, ${(maxRem * safeScale).toFixed(3)}rem)`

  return {
    // 译文
    translation: clampSize(1.125, 2.6, 1.25),
    // 下一句预览
    upcoming: clampSize(0.875, 2, 1)
  }
}
