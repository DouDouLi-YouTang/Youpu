import { defineStore } from 'pinia'

import type { LyricContributors, LyricData, LyricLine } from '@/domain/lyric'
import { getLyric } from '@/services/api/endpoints/lyric.api'
import { ApiError, toApiError } from '@/services/api/errors'

const EMPTY_CONTRIBUTORS: LyricContributors = { roles: [] }

/** v3: 罗马音优先 romalrc(有词间空格),旧缓存的 yromalrc 粘连音译需失效重拉 */
const LYRIC_CACHE_PREFIX = 'muice:lyric:v3:'

/** 读取本地缓存的歌词(localStorage)。歌词静态且公开,缓存可跨会话复用,断网时仍可显示。
 *  JSON 解析失败(缓存损坏)静默返回 null,降级为远程获取。 */
function readCachedLyric(songId: number): LyricData | null {
  try {
    const raw = localStorage.getItem(LYRIC_CACHE_PREFIX + songId)
    if (!raw) return null
    return JSON.parse(raw) as LyricData
  } catch {
    return null
  }
}

/** 写入本地歌词缓存。quota 超限等异常静默忽略(降级为不缓存,不影响播放)。 */
function writeCachedLyric(songId: number, data: LyricData): void {
  try {
    localStorage.setItem(LYRIC_CACHE_PREFIX + songId, JSON.stringify(data))
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
    contributors: EMPTY_CONTRIBUTORS,
    loading: false,
    error: null
  }),

  actions: {
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
      if (cached && Array.isArray(cached.lines)) {
        if (token !== requestToken) return
        this.lines = cached.lines
        this.hasLyric = cached.hasLyric
        this.isPureMusic = cached.isPureMusic
        this.contributors = cached.contributors
        this.loading = false
        return
      }

      try {
        const data = await getLyric(songId)
        if (token !== requestToken) return
        this.lines = data.lines
        this.hasLyric = data.hasLyric
        this.isPureMusic = data.isPureMusic
        this.contributors = data.contributors
        writeCachedLyric(songId, data)
      } catch (error) {
        if (token !== requestToken) return
        this.error = toApiError(error)
        this.lines = []
        this.hasLyric = false
        this.isPureMusic = false
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
      this.contributors = EMPTY_CONTRIBUTORS
      this.loading = false
      this.error = null
    }
  }
})
