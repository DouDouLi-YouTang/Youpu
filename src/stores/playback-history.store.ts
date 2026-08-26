import { defineStore } from 'pinia'

import type { Song } from '@/domain/song'
import { useAuthStore } from './auth.store'

/**
 * 本地播放历史(最近播放)。
 *
 * 按 用户身份 隔离存储 namespace:
 * - 未登录 → `muice:history:guest`(游客历史,登出后仍保留)
 * - 登录 → `muice:history:user:<userId>`(该账号专属)
 *
 * 切换账号 / 登出时 `load()` 自动切换 namespace 并重载,各自历史互不污染。
 * 全部走 localStorage,不依赖云端接口,断网可用。
 */

/** 单用户历史最多保留条数。 */
const HISTORY_LIMIT = 200
const GUEST_KEY = 'muice:history:guest'

function userKey(userId: number): string {
  return `muice:history:user:${userId}`
}

function storageKey(userId: number | undefined): string {
  return userId != null ? userKey(userId) : GUEST_KEY
}

interface PlaybackHistoryState {
  items: Song[]
  /** 当前已加载的存储 key;切换账号/登出时变更并重新加载。null 表示尚未加载。 */
  loadedKey: string | null
}

export const usePlaybackHistoryStore = defineStore('playback-history', {
  state: (): PlaybackHistoryState => ({
    items: [],
    loadedKey: null
  }),

  actions: {
    /**
     * 从 localStorage 加载当前用户(或游客)的历史。登录态变化时调用以切换 namespace。
     * 幂等:若 key 未变则不重复读。
     */
    load(): void {
      const auth = useAuthStore()
      const key = storageKey(auth.userId)
      if (this.loadedKey === key) return
      this.loadedKey = key
      try {
        const raw = localStorage.getItem(key)
        this.items = raw ? (JSON.parse(raw) as Song[]) : []
      } catch {
        this.items = []
      }
    },

    /**
     * 记录一首歌到历史顶部:去重(同 id 移除旧条目)、unshift、截断到上限、持久化。
     * 在 player.store.playQueueItem 切歌时调用。首次调用会自动 load() 确保正确 namespace。
     */
    record(song: Song): void {
      this.load()
      const filtered = this.items.filter((s) => s.id !== song.id)
      this.items = [song, ...filtered].slice(0, HISTORY_LIMIT)
      this.persist()
    },

    /** 从历史中移除指定歌曲(按 id)。 */
    remove(songId: number): void {
      if (this.items.length === 0) return
      this.items = this.items.filter((s) => s.id !== songId)
      this.persist()
    },

    /** 清空当前用户(或游客)的历史。 */
    clear(): void {
      this.items = []
      this.persist()
    },

    persist(): void {
      if (this.loadedKey == null) return
      try {
        localStorage.setItem(this.loadedKey, JSON.stringify(this.items))
      } catch {
        // 配额不足或 localStorage 不可用:静默失败,内存历史仍可用
      }
    }
  }
})
