import { defineStore } from 'pinia'

import type { ChorusRange, LyricContributors, LyricData, LyricLine } from '@/domain/lyric'
import { getChorus } from '@/services/api/endpoints/chorus.api'
import { getLyric } from '@/services/api/endpoints/lyric.api'
import { ApiError, toApiError } from '@/services/api/errors'
import { applyChorusRanges } from '@/services/api/mapper/lyric.mapper'
import { usePlayerStore } from './player.store'

const EMPTY_CONTRIBUTORS: LyricContributors = { roles: [] }

/**
 * v3: 罗马音优先 romalrc(有词间空格),旧缓存的 yromalrc 粘连音译需失效重拉。
 * v4: 缓存结构从 `LyricData` 变为 `{ data, chorusRanges }` —— lines 里带上了
 *     逐歌副歌标注(isChorus),且副歌区间随歌词一起缓存,切歌回来不用再请求
 *     `/song/chorus`,断网时副歌涟漪/hero 变体也照样可用。
 */
const LYRIC_CACHE_PREFIX = 'muice:lyric:v4:'

/** 缓存载荷:歌词本体 + 副歌区间。两者一起存,读取时才能重新走同一套标注逻辑。 */
interface CachedLyricPayload {
  data: LyricData
  chorusRanges: ChorusRange[]
}

/** 读取本地缓存的歌词(localStorage)。歌词静态且公开,缓存可跨会话复用,断网时仍可显示。
 *  JSON 解析失败(缓存损坏)静默返回 null,降级为远程获取。 */
function readCachedLyric(songId: number): CachedLyricPayload | null {
  try {
    const raw = localStorage.getItem(LYRIC_CACHE_PREFIX + songId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedLyricPayload>
    if (!parsed?.data || !Array.isArray(parsed.data.lines)) return null
    return {
      data: parsed.data,
      chorusRanges: Array.isArray(parsed.chorusRanges) ? parsed.chorusRanges : []
    }
  } catch {
    return null
  }
}

/** 写入本地歌词缓存。quota 超限等异常静默忽略(降级为不缓存,不影响播放)。 */
function writeCachedLyric(songId: number, payload: CachedLyricPayload): void {
  try {
    localStorage.setItem(LYRIC_CACHE_PREFIX + songId, JSON.stringify(payload))
  } catch {
    // 忽略 quota 错误
  }
}

/** 竞态防护令牌:每次 loadLyric/clear 自增。慢响应恢复后令牌不匹配则丢弃结果,
 *  防止快速切歌时上一首的歌词覆盖当前歌曲。 */
let requestToken = 0

interface LyricState {
  songId: number | null
  lines: LyricLine[]
  hasLyric: boolean
  isPureMusic: boolean
  /** 当前歌曲的副歌时间区间(毫秒)。空数组 = 无副歌标注或接口失败。 */
  chorusRanges: ChorusRange[]
  /** 歌词贡献者(词/曲/译作者、来源),用于沉浸页贡献者显示 */
  contributors: LyricContributors
  loading: boolean
  error: ApiError | null
}

export const useLyricStore = defineStore('lyric', {
  state: (): LyricState => ({
    songId: null,
    lines: [],
    hasLyric: false,
    isPureMusic: false,
    chorusRanges: [],
    contributors: EMPTY_CONTRIBUTORS,
    loading: false,
    error: null
  }),

  actions: {
    /**
     * 所有加载路径共用的 lines 落库入口:在这里统一套上副歌标注,避免
     * 「缓存命中」与「网络返回」两条路径的标注口径分叉。
     *
     * 之所以缓存命中也重新标注(而不是直接用缓存里已带 isChorus 的行):
     * 标注依赖 `player.durationMs`,而缓存写入时那个值可能还不准(末行按 5 秒
     * 兜底);重新标注是幂等的,却能在时长变准后把末行副歌判定纠正回来。
     */
    commitLines(lines: LyricLine[], ranges: ChorusRange[]): void {
      this.chorusRanges = ranges
      this.lines = applyChorusRanges(lines, ranges, usePlayerStore().durationMs)
    },

    /**
     * Load (and cache) a song's lyric. Skips the fetch when the same song is
     * already loaded successfully — re-opening the panel for the current song
     * is free.
     */
    async loadLyric(songId: number): Promise<void> {
      if (this.songId === songId && !this.error && (this.lines.length > 0 || this.isPureMusic)) {
        return
      }

      const token = ++requestToken
      this.songId = songId
      this.loading = true
      this.error = null

      // 先查本地缓存:歌词静态,缓存命中即用(断网可用),不重新请求远程。
      const cached = readCachedLyric(songId)
      if (cached) {
        if (token !== requestToken) return
        this.commitLines(cached.data.lines, cached.chorusRanges)
        this.hasLyric = cached.data.hasLyric
        this.isPureMusic = cached.data.isPureMusic
        this.contributors = cached.data.contributors
        this.loading = false
        return
      }

      try {
        // 歌词与副歌并行请求。副歌是装饰性元数据:接口失败(含超时)一律降级成
        // 空区间,绝不因此让歌词加载失败或报错。
        const [data, chorusRanges] = await Promise.all([
          getLyric(songId),
          getChorus(songId).catch((): ChorusRange[] => [])
        ])
        if (token !== requestToken) return
        this.commitLines(data.lines, chorusRanges)
        this.hasLyric = data.hasLyric
        this.isPureMusic = data.isPureMusic
        this.contributors = data.contributors
        writeCachedLyric(songId, { data, chorusRanges })
      } catch (error) {
        if (token !== requestToken) return
        this.error = toApiError(error)
        this.lines = []
        this.hasLyric = false
        this.isPureMusic = false
        this.chorusRanges = []
        this.contributors = EMPTY_CONTRIBUTORS
      } finally {
        if (token === requestToken) this.loading = false
      }
    },

    clear(): void {
      requestToken++
      this.songId = null
      this.lines = []
      this.hasLyric = false
      this.isPureMusic = false
      this.chorusRanges = []
      this.contributors = EMPTY_CONTRIBUTORS
      this.loading = false
      this.error = null
    }
  }
})
