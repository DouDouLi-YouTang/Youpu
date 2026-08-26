import { defineStore } from 'pinia'

import type { Playlist } from '@/domain/playlist'
import {
  deletePlaylist,
  getPlaylistDetail,
  removePlaylistTracks
} from '@/services/api/endpoints/playlist.api'
import { ApiError, toApiError } from '@/services/api/errors'
import { useAuthStore } from './auth.store'
import { useLibraryStore } from './library.store'

interface PlaylistState {
  currentPlaylist: Playlist | null
  loading: boolean
  error: ApiError | null
}

export const usePlaylistStore = defineStore('playlist', {
  state: (): PlaylistState => ({
    currentPlaylist: null,
    loading: false,
    error: null
  }),

  actions: {
    /**
     * Load a playlist's detail by id into `currentPlaylist`.
     */
    async loadPlaylist(id: number): Promise<void> {
      this.loading = true
      this.error = null
      this.currentPlaylist = null

      try {
        this.currentPlaylist = await getPlaylistDetail(id)
      } catch (error) {
        this.error = toApiError(error)
        this.currentPlaylist = null
      } finally {
        this.loading = false
      }
    },

    /**
     * 从当前歌单删除一首歌曲。调用 /playlist/track/delete,成功后本地同步移除并更新计数。
     */
    async removeTrack(songId: number): Promise<void> {
      const pl = this.currentPlaylist
      if (!pl) return
      const auth = useAuthStore()
      await removePlaylistTracks(pl.id, [songId], auth.cookie)
      pl.tracks = pl.tracks.filter((s) => s.id !== songId)
      pl.trackCount = Math.max(0, pl.trackCount - 1)
    },

    /**
     * 删除当前整个歌单。调用 /playlist/delete,成功后清空 currentPlaylist。
     * 调用方负责跳转(通常回 /library)。
     */
    async deleteCurrentPlaylist(): Promise<void> {
      const pl = this.currentPlaylist
      if (!pl) return
      const auth = useAuthStore()
      await deletePlaylist(pl.id, auth.cookie)
      this.clear()
      // 强制刷新库歌单列表:删除的歌单从侧边栏/库页移除
      // (loadMyPlaylists 的 loadedUserId 缓存会跳过重复请求,不 force 则仍显示已删歌单)
      void useLibraryStore().loadMyPlaylists(true)
    },

    /** Clear the current playlist and any error. */
    clear(): void {
      this.currentPlaylist = null
      this.loading = false
      this.error = null
    }
  }
})
