import { defineStore } from 'pinia'

import type { Song } from '@/domain/song'
import { searchSongs } from '@/services/api/endpoints/search.api'
import { ApiError, toApiError } from '@/services/api/errors'

const PAGE_SIZE = 30

interface SearchState {
  keyword: string
  results: Song[]
  total: number
  loading: boolean
  loadingMore: boolean
  error: ApiError | null
  page: number
  hasMore: boolean
}

export const useSearchStore = defineStore('search', {
  state: (): SearchState => ({
    keyword: '',
    results: [],
    total: 0,
    loading: false,
    loadingMore: false,
    error: null,
    page: 0,
    hasMore: false
  }),

  actions: {
    /**
     * Run a fresh search for `keyword`. Resets pagination and results.
     * An empty keyword clears state without making a request.
     */
    async search(keyword: string): Promise<void> {
      const trimmed = keyword.trim()
      this.keyword = trimmed
      this.error = null

      if (trimmed === '') {
        this.results = []
        this.total = 0
        this.page = 0
        this.hasMore = false
        return
      }

      this.loading = true
      this.results = []
      this.page = 0

      try {
        const { songs, songCount } = await searchSongs(trimmed, {
          limit: PAGE_SIZE,
          offset: 0
        })
        this.results = songs
        this.total = songCount
        this.page = 1
        this.hasMore = songs.length > 0 && songs.length < songCount
      } catch (error) {
        this.error = toApiError(error)
        this.results = []
        this.hasMore = false
      } finally {
        this.loading = false
      }
    },

    /**
     * Load the next page of results and append. No-op while a load is in
     * flight or when there are no more pages.
     */
    async loadMore(): Promise<void> {
      if (this.loadingMore || this.loading || !this.hasMore) return
      if (this.keyword === '') return

      this.loadingMore = true
      const offset = this.page * PAGE_SIZE

      try {
        const { songs } = await searchSongs(this.keyword, {
          limit: PAGE_SIZE,
          offset
        })
        this.results.push(...songs)
        this.page += 1
        this.hasMore = songs.length >= PAGE_SIZE && this.results.length < this.total
      } catch (error) {
        this.error = toApiError(error)
      } finally {
        this.loadingMore = false
      }
    },

    /** Clear all search state. */
    clear(): void {
      this.keyword = ''
      this.results = []
      this.total = 0
      this.loading = false
      this.loadingMore = false
      this.error = null
      this.page = 0
      this.hasMore = false
    },

    /** Clear only the error, leaving results intact. */
    clearError(): void {
      this.error = null
    }
  }
})
