import { defineStore } from 'pinia'

import type { UserProfile } from '@/domain/user'
import type { Playlist } from '@/domain/playlist'
import * as userApi from '@/services/api/endpoints/user.api'

interface UserState {
  user: UserProfile | null
  playlists: Playlist[]
  loading: boolean
  playlistsLoading: boolean
  error: Error | null
  playlistsError: Error | null
}

export const useUserStore = defineStore('user', {
  state: (): UserState => ({
    user: null,
    playlists: [],
    loading: false,
    playlistsLoading: false,
    error: null,
    playlistsError: null
  }),

  actions: {
    async loadUserDetail(uid: number): Promise<void> {
      if (this.loading) return

      this.loading = true
      this.error = null

      try {
        this.user = await userApi.getUserDetail(uid)
      } catch (err) {
        this.error = err instanceof Error ? err : new Error(String(err))
        this.user = null
      } finally {
        this.loading = false
      }
    },

    async loadUserPlaylists(uid: number): Promise<void> {
      if (this.playlistsLoading) return

      this.playlistsLoading = true
      this.playlistsError = null

      try {
        this.playlists = await userApi.getUserPlaylistsPublic(uid)
      } catch (err) {
        this.playlistsError = err instanceof Error ? err : new Error(String(err))
        this.playlists = []
      } finally {
        this.playlistsLoading = false
      }
    },

    clear(): void {
      this.user = null
      this.playlists = []
      this.error = null
      this.playlistsError = null
    }
  }
})
