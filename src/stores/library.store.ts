import { defineStore } from 'pinia'

import type { Playlist } from '@/domain/playlist'
import { getUserPlaylists } from '@/services/api/endpoints/user.api'
import { ApiError, toApiError } from '@/services/api/errors'
import { useAuthStore } from './auth.store'
import { registerPrivateDataReset } from './private-data'

/** NetEase specialType for the user's "我喜欢的音乐" playlist. */
const LIKED_SPECIAL_TYPE = 5

interface LibraryState {
  myPlaylists: Playlist[]
  loading: boolean
  error: ApiError | null
  /** 已加载过哪个用户的数据,避免同一用户重复请求(SidebarNav 与 LibraryPage 共用)。null=未加载/已登出。 */
  loadedUserId: number | null
}

export const useLibraryStore = defineStore('library', {
  state: (): LibraryState => ({
    myPlaylists: [],
    loading: false,
    error: null,
    loadedUserId: null
  }),

  getters: {
    /** 当前登录账号创建的歌单(过滤掉收藏的),用于侧边栏"我的音乐"二级菜单。未登录返回空。 */
    createdPlaylists(state): Playlist[] {
      const auth = useAuthStore()
      const uid = auth.userId
      if (uid == null) return []
      return state.myPlaylists.filter((pl) => pl.creator.userId === uid)
    }
  },

  actions: {
    /**
     * Load the logged-in user's playlists with the "我喜欢的音乐" playlist
     * pinned first. No-op (cleared) when logged out. A 401 routes to the unified
     * expiry handler rather than surfacing a raw error.
     *
     * 同一用户已加载过则跳过(除非 force),SidebarNav 与 LibraryPage 共用此 store。
     */
    async loadMyPlaylists(force = false): Promise<void> {
      const auth = useAuthStore()
      if (!auth.isLoggedIn || !auth.profile) {
        this.myPlaylists = []
        this.loadedUserId = null
        return
      }

      const uid = auth.profile.userId
      if (!force && this.loadedUserId === uid) return

      this.loading = true
      this.error = null
      try {
        const lists = await getUserPlaylists(uid, auth.cookie)
        // Pin the liked-songs playlist (specialType 5) to the front.
        this.myPlaylists = [...lists].sort((a, b) => {
          const al = a.specialType === LIKED_SPECIAL_TYPE ? 0 : 1
          const bl = b.specialType === LIKED_SPECIAL_TYPE ? 0 : 1
          return al - bl
        })
        this.loadedUserId = uid
      } catch (error) {
        const err = toApiError(error)
        if (err.code === 'UNAUTHORIZED') {
          useAuthStore().handleUnauthorized()
        } else {
          this.error = err
        }
      } finally {
        this.loading = false
      }
    },

    clear(): void {
      this.myPlaylists = []
      this.loading = false
      this.error = null
      this.loadedUserId = null
    }
  }
})

// Clear my playlists on logout / session expiry.
registerPrivateDataReset(() => useLibraryStore().clear())
