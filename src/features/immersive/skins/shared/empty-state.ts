/**
 * 皮肤空态解析 —— 「这个面板现在该显示什么」的**唯一答案**，全部 Folia 系皮肤共用。
 *
 * 住在 `skins/shared/`：「倾诉」「流光」「浮名」三个面板都没有歌词时的处理是同一套
 * 业务问题（歌词在加载？纯音乐？请求失败？还没唱到第一句？），只是外观不同。
 * 复制三份的结果必然是「一个面板说『等待音乐』、另一个说『暂无歌词』」这种口径漂移。
 *
 * ## 为什么先判 `loading`
 *
 * `lyric.loading` 期间 `hasLyric` 还是 false（见 lyric.store）——
 * 先判 `isPureMusic` / `hasLyric` 会把「加载中」误报成「暂无歌词」。
 * 另外 mapper 里 `isPureMusic = !hasLyric || 含纯音乐标记`（lyric.mapper.ts），
 * 所以**成功加载后的「没有歌词」走纯音乐分支**，「暂无歌词」实际是**歌词请求失败**那条路。
 * 两句话各自在解释不同的原因，不能合并。
 *
 * ## 为什么「有歌、只是还没唱到」要显示歌名
 *
 * 2026-10-10 用户反馈：歌明明在放却写「等待音乐」，看上去像没在播。
 * 于是「歌词请求中」与「还没唱到第一句（前奏）」这两种**临时状态**都显示歌名 + 歌手；
 * 纯音乐 / 暂无歌词是**终态**（那两句话本身在解释为什么没有歌词，换成歌名反而丢信息），
 * 未选歌时也没有歌名可显示。
 */

/** 面板该显示的空态内容（`null` = 有行可排，交给各皮肤自己的渲染层） */
export type SkinEmptyState =
  /** 歌名 + 歌手（歌手可能为空串 → 只显示歌名） */
  | { kind: 'song'; title: string; artist: string }
  /** 一句中文提示（纯音乐 / 无歌词 / 未选歌 / 歌词加载中） */
  | { kind: 'text'; text: string }

export interface SkinEmptyStateInput {
  /** 歌词请求中 */
  loading: boolean
  /** 纯音乐（含「成功加载但没有歌词」这条，见文件头） */
  isPureMusic: boolean
  /** 有可用歌词行 */
  hasLyric: boolean
  /** 播放器当前有歌 */
  hasItem: boolean
  songTitle: string | null
  songArtist: string | null
  /**
   * 当前行下标是否 `>= 0`（= 已经唱到某一行）。
   *
   * ⚠️ 调用方传的是**自己的**当前行下标来源：皮肤用逐帧时钟算出来的那个，
   * 不是 store 里的节流值 —— 否则前奏结束的那一瞬间空态会多留一小会儿。
   */
  hasCurrentLine: boolean
}

/** 空态文案常量：全部皮肤口径的唯一出处 */
export const EMPTY_TEXT_LOADING = '歌词加载中…'
export const EMPTY_TEXT_PURE_MUSIC = '纯音乐，请欣赏'
export const EMPTY_TEXT_NO_LYRIC = '暂无歌词'
export const EMPTY_TEXT_WAITING = '等待音乐'

/**
 * 解析当前该显示的空态。
 *
 * 判定顺序是契约的一部分（见文件头），改动前先读那两段说明。
 */
export function resolveSkinEmptyState(input: SkinEmptyStateInput): SkinEmptyState | null {
  /** 歌名 + 歌手卡；连歌名都拿不到（一首歌都没选）时返回 null，由调用处退回文本占位 */
  const songCard = (): SkinEmptyState | null =>
    input.songTitle
      ? { kind: 'song', title: input.songTitle, artist: input.songArtist ?? '' }
      : null

  if (input.loading) return songCard() ?? { kind: 'text', text: EMPTY_TEXT_LOADING }
  if (input.isPureMusic) return { kind: 'text', text: EMPTY_TEXT_PURE_MUSIC }
  if (!input.hasLyric) return { kind: 'text', text: EMPTY_TEXT_NO_LYRIC }
  if (!input.hasItem) return { kind: 'text', text: EMPTY_TEXT_WAITING }
  // 轮到此处：有歌也有歌词，只是还没唱到第一句 —— 显示歌名 + 歌手
  if (!input.hasCurrentLine) return songCard() ?? { kind: 'text', text: EMPTY_TEXT_WAITING }
  return null
}
