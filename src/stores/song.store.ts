import { defineStore } from 'pinia'

import type { Song } from '@/domain/song'
import * as songApi from '@/services/api/endpoints/song.api'

interface SongState {
  currentSong: Song | null
  loading: boolean
  error: Error | null
}

export const useSongStore = defineStore('song', {
  state: (): SongState => ({
    currentSong: null,
    loading: false,
    error: null
  }),

  actions: {
    async loadSong(id: number): Promise<void> {
      if (this.loading) return

      this.loading = true
      this.error = null

      try {
        const songs = await songApi.getSongDetail([id])
        this.currentSong = songs[0] ?? null
      } catch (err) {
        this.error = err instanceof Error ? err : new Error(String(err))
        this.currentSong = null
      } finally {
        this.loading = false
      }
    },

    clear(): void {
      this.currentSong = null
      this.error = null
    }
  }
})
