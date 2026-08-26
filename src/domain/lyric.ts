/**
 * Parsed lyric domain model. The store holds these (not raw LRC text), and the
 * panel renders + scroll-syncs from them.
 */

/** 逐字时间戳中的一个词(YRC)。timeMs/durationMs 单位毫秒。 */
export interface LyricWord {
  timeMs: number
  durationMs: number
  /** 词文本,可能含前导/尾随空格以保证 join('') 还原原文 */
  word: string
  /** 是否为参考项目标记的句末/分段末尾拖长音,用于「长音发光动画」 */
  trailing?: boolean
}

/** One synced lyric line. `translation` is the aligned translated text, if any. */
export interface LyricLine {
  /** Timestamp in milliseconds from the start of the track. */
  timeMs: number
  text: string
  translation?: string
  /** 罗马音/音译歌词（romalrc/yromalrc），存在时作为当前行附属文本显示。 */
  romaji?: string
  /** 逐字时间戳(YRC)。存在时可渲染逐字卡拉OK动画;无逐字数据时为 undefined。 */
  words?: LyricWord[]
}

/** 歌词贡献者中的单个艺人/用户元信息 */
export interface ContributorArtist {
  artistId: number
  artistName: string
}

/** 一个角色(作词/作曲/编曲…)及其对应艺人列表 */
export interface ContributorRole {
  roleName: string
  artistMetaList: ContributorArtist[]
}

/**
 * 歌词贡献者 —— 移植参考项目 lyric-provider.js 的 contributors 结构。
 * original=词作者,translation=翻译者,roles=角色列表(作曲/编曲等),
 * lyricSource=歌词来源。lyricContributorsDisplay 设置控制其显隐。
 */
export interface LyricContributors {
  /** 词作者(lyricUser) */
  original?: { name: string; userid: number }
  /** 翻译者(transUser) */
  translation?: { name: string; userid: number }
  /** 角色列表(已过滤空角色、按艺人去重合并 roleName) */
  roles: ContributorRole[]
  /** 歌词来源 */
  lyricSource?: { name?: string }
}

export interface LyricData {
  lines: LyricLine[]
  /** True when there is at least one usable timed line. */
  hasLyric: boolean
  /** True for instrumental tracks (no real lyric). */
  isPureMusic: boolean
  /** 歌词贡献者(词/曲/译作者、来源),用于沉浸页贡献者显示 */
  contributors: LyricContributors
}
