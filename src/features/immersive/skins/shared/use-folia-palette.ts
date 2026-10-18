/**
 * Folia 系皮肤（「流光」「浮名」）的**配色取值** —— 逐歌主题 → 皮肤要的四个字段。
 *
 * ## 这一层现在的职责
 *
 * 只有一件：把 `use-song-theme` 推出来的四个颜色（`backgroundColor` 命名是上游口径，
 * 本项目内部叫 `background`）整理成两个皮肤用的 `FoliaPalette`，
 * 并**把明暗档解析的结果一并给出**（`isDaylight`）。
 *
 * ## 为什么不再自己算颜色
 *
 * 这里以前把 `background` / `primary` / `secondary` 写成上游基础主题的**字面量**，
 * 只让 `accent` 跟随封面 —— 于是「每首歌主题色都一样」。
 * 现在四个颜色都由 `shared/song-theme/` 从封面推出来（每首歌不同、两档配套），
 * 本层只做字段改名与明暗解析，不再持有任何颜色常量。
 *
 * ⚠️ 中性兜底值仍在（`song-theme/neutral-theme.ts`），但它的身份变了：
 * 以前是**最终值**，现在只是「封面还没解码完」那几十毫秒的占位（见那边的说明）。
 *
 * ## 为什么还要返回 `isDaylight`
 *
 * 不只是「怕调用方猜错」：`isLight` 是**明暗档的解析结果**（三态 `'dark' | 'light' | 'auto'`
 * 加系统偏好），而 `palette.background` 只是它的一个**产物**。调用方若拿底色去反推
 * （例如判断底色是不是某个具体十六进制值），等于把具体色值变成第二个契约点：
 * 将来改动主题生成就会静默破坏这一判断。背景系统（`FoliaBackground`）需要的是
 * 语义上的「是不是浅色」，所以在这里给出。
 */

import { computed, type ComputedRef, type Ref } from 'vue'

import type { KeywordSourceLine } from './song-theme/keyword-colors'
import { useSongTheme } from './song-theme/use-song-theme'
import type { WordColorEntry } from './word-coloring'

/** 面板配色（全部是 CSS 颜色字符串） */
export interface FoliaPalette {
  /** 底色：shader 边缘兜底、副字幕辉光底 */
  background: string
  /** 正文色：未唱 / 唱过的字 */
  primary: string
  /** 高亮色：正在唱的字 */
  accent: string
  /** 次级色：副字幕 / 空态 */
  secondary: string
}

/** 两个皮肤消费的输入：封面、歌曲 id、歌词行 */
export interface FoliaPaletteSources {
  /** 当前封面 URL（为空时仍然会按歌曲 id 生成一套随机主题） */
  coverUrl: Ref<string | null | undefined> | ComputedRef<string | null | undefined>
  /** 当前歌曲 id：主题种子，决定「这首歌是什么颜色」 */
  songId: Ref<number | null | undefined> | ComputedRef<number | null | undefined>
  /** 当前歌词纯文本行：只用于挑关键词（逐词配色） */
  lyricLines:
    | Ref<readonly (KeywordSourceLine | string)[]>
    | ComputedRef<readonly (KeywordSourceLine | string)[]>
}

/**
 * 取当前生效的面板配色。
 *
 * ⚠️ 明暗档由 Folia 共享设置 `settings.folia.colorScheme` 决定（不是经典面板外观设置），
 * 三套 Folia 主题共用，由「外观」页签控制。
 * `'auto'` 按系统偏好解析，与外壳的 class 一致。
 *
 * ## 为什么把 `isDaylight` 也返回出去
 *
 * 不只是「怕调用方猜错」：`isLight` 是**明暗档的解析结果**（三态 `'dark' | 'light' | 'auto'`
 * 加系统偏好），而 `palette.background` 只是它的一个**产物**。调用方若拿底色去反推
 * （例如 `palette.background !== '#09090b'`），等于把「上游那两个十六进制字面量」
 * 变成第二个契约点：将来改动主题色值就会静默破坏这一判断。
 * 背景系统（`FoliaBackground`）需要的是语义上的「是不是浅色」，所以在这里给出。
 */
export function useFoliaPalette(sources: FoliaPaletteSources): {
  palette: ComputedRef<FoliaPalette>
  isDaylight: Ref<boolean>
  /** 逐词配色（关键词着色）；为空数组时逐词渲染退化成整行同色 */
  wordColors: ComputedRef<WordColorEntry[]>
} {
  const { colors, wordColors, isDaylight } = useSongTheme(sources)

  const palette = computed<FoliaPalette>(() => ({
    background: colors.value.backgroundColor,
    primary: colors.value.primaryColor,
    accent: colors.value.accentColor,
    secondary: colors.value.secondaryColor
  }))

  return { palette, isDaylight, wordColors }
}
