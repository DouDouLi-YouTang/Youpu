import { defineStore } from 'pinia'

import type { Album } from '@/domain/album'
import { getAlbumDetail } from '@/services/api/endpoints/album.api'
import { ApiError, toApiError } from '@/services/api/errors'

interface AlbumState {
  currentAlbum: Album | null
  loading: boolean
  error: ApiError | null
}

export const useAlbumStore = defineStore('album', {
  state: (): AlbumState => ({
    currentAlbum: null,
    loading: false,
    error: null
  }),

  actions: {
    /** Load an album's detail by id into `currentAlbum`. */
    async loadAlbum(id: number): Promise<void> {
      this.loading = true
      this.error = null
      this.currentAlbum = null

      try {
        this.currentAlbum = await getAlbumDetail(id)
      } catch (error) {
        this.error = toApiError(error)
        this.currentAlbum = null
      } finally {
        this.loading = false
      }
    },

    /** Clear the current album and any error. */
    clear(): void {
      this.currentAlbum = null
      this.loading = false
      this.error = null
    }
  }
})
