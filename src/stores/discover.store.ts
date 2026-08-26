import { defineStore } from 'pinia'

import type { Playlist } from '@/domain/playlist'
import * as playlistApi from '@/services/api/endpoints/playlist.api'

interface DiscoverState {
  playlists: Playlist[]
  loading: boolean
  error: Error | null
}

export const useDiscoverStore = defineStore('discover', {
  state: (): DiscoverState => ({
    playlists: [],
    loading: false,
    error: null
  }),

  actions: {
    async loadRecommendPlaylists(): Promise<void> {
      if (this.loading) return

      this.loading = true
      this.error = null

      try {
        this.playlists = await playlistApi.getRecommendPlaylists(30)
      } catch (err) {
        this.error = err instanceof Error ? err : new Error(String(err))
        this.playlists = []
      } finally {
        this.loading = false
      }
    },

    clear(): void {
      this.playlists = []
      this.error = null
    }
  }
})
