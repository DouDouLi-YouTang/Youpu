/**
 * 逐歌主题的**中性兜底** —— 封面还没取到色那一瞬间用的四个颜色。
 *
 * ## 为什么需要「兜底」而不是空着
 *
 * 取色是异步的（要等封面图加载完），所以每一首歌的**首帧**都拿不到颜色。
 * 这段时间必须有一个能看的配色，否则会出现「进入沉浸页先白闪一下再变深」
 * 这种在深色档下非常刺眼的过渡。
 *
 * ## 为什么是这四个值
 *
 * 它们与上游 `baseThemes.ts` 的两套基础主题同值（`#09090b` / `#f4f4f5` /
 * `#71717a`，亮色档 `#f5f5f4` / `#1c1917` / `#ea580c`）——
 * 也就是「没有主题时的主题」。取同值的理由不是抄，而是**观感一致**：
 * 上游用户在没有主题时的第一眼就是这一套，本项目也应当给出同一档中性观感。
 *
 * ⚠️ 这不是「每首歌主题色都一样」的那个bug：那四个值现在是**兜底**，
 * 只在一首歌的头几十毫秒（图还没解码完）里生效，随后被 `use-song-theme`
 * 推出来的真实主题替换掉。原先的问题是它们被当成**最终值**写死了。
 */

import type { SongThemeColors } from './generate'

/** 深夜墨染：与上游 `DEFAULT_THEME` 同值 */
export const DARK_THEME_COLORS: SongThemeColors = {
  backgroundColor: '#09090b',
  primaryColor: '#f4f4f5',
  secondaryColor: '#71717a',
  accentColor: '#f4f4f5'
}

/** 日光素白：与上游 `DAYLIGHT_THEME` 同值 */
export const LIGHT_THEME_COLORS: SongThemeColors = {
  backgroundColor: '#f5f5f4',
  primaryColor: '#1c1917',
  secondaryColor: '#44403c',
  accentColor: '#ea580c'
}
