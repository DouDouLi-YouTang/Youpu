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
  /**
   * 行结束时间（毫秒）。**只有音源本身给出了行时长时才有值** —— 目前是 YRC 行头
   * `[startTime,duration]` 的 `startTime + duration`。老 LRC 只有起始时间戳，
   * 该字段为 undefined，由消费方按「下一行起始」推算。
   * 之所以要保留它：上游 Folia 用真实行结束时间判定「这一行是否还在屏幕上」
   * （超过 renderEndTime 就清空舞台），以及「行间空窗是否够长、要补插曲行」。
   * 若一律用下一行起始当结束时间，长间奏时行下标永远不会失效，舞台也就不会清空。
   */
  endTimeMs?: number
  text: string
  translation?: string
  /** 罗马音/音译歌词（romalrc/yromalrc），存在时作为当前行附属文本显示。 */
  romaji?: string
  /** 逐字时间戳(YRC)。存在时可渲染逐字卡拉OK动画;无逐字数据时为 undefined。 */
  words?: LyricWord[]
  /**
   * 副歌行标记，数据来自 `/song/chorus` 的副歌时间区间（见 `ChorusRange`）。
   * 用于「流光」副歌行的合唱涟漪，以及「浮名」的 hero 变体选择。
   * 无副歌数据时为 undefined（不写 false，避免「无数据」与「确认不是副歌」混淆）。
   */
  isChorus?: boolean
}

/**
 * 副歌时间区间（毫秒）。
 *
 * 放在 domain 层而不是 `endpoints/chorus.api.ts`：它会被 store 的 state 持有、
 * 被 mapper 消费，属于歌词领域模型的一部分；endpoints 层的 `ChorusRangeDto`
 * 才是传输形状（带 id/ugcLocked 等本项目不用的字段）。
 */
export interface ChorusRange {
  startTime: number
  endTime: number
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
