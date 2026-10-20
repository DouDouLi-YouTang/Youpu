/**
 * 「浮名」传给 pretext 的预制参数（§4.1）——**唯一**的一份。
 *
 * `whiteSpace: 'pre-wrap'` 是必须的：歌词里的空格（含全角空格）是**内容**，用默认的
 * `normal` 会把连续空格折叠、把行首空白吃掉，量出来的宽度与画面上写的不是一回事。
 *
 * ## 为什么单独一个文件
 *
 * 这条参数必须被两条路径用**同一个对象**：真实排版的 `prepare*()`，以及
 * `line-width-model.ts` 里那个「参考字号下量一次、之后按字号缩放」的宽度模型。
 * 两处若各写一份，将来只改一处就会出现「模型按 pre-wrap 量、真实排版按 normal 排」
 * 这种**看不出症状**的分叉（判据在大多数行上仍然成立，只在含空格的行上悄悄偏一点）。
 * 放进独立模块而不是从 `text-measure.ts` 转出，是为了避免
 * `text-measure ↔ line-width-model` 的循环 import。
 */

import type { PrepareOptions } from '@chenglou/pretext'

export const FUME_PRETEXT_OPTIONS = { whiteSpace: 'pre-wrap' } satisfies PrepareOptions
