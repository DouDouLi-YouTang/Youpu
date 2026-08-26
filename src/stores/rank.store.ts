import { defineStore } from 'pinia'

import type { RankGroup, RankItem } from '@/domain/rank'
import { getRankList } from '@/services/api/endpoints/rank.api'
import { ApiError, toApiError } from '@/services/api/errors'

interface RankStoreState {
  groups: RankGroup[]
  items: RankItem[]
  loading: boolean
  error: ApiError | null
  loaded: boolean
}

export const useRankStore = defineStore('rank', {
  state: (): RankStoreState => ({
    groups: [],
    items: [],
    loading: false,
    error: null,
    loaded: false
  }),

  actions: {
    /** Fetch all ranking lists and groups. Idempotent — skips if already loaded. */
    async loadRankList(): Promise<void> {
      if (this.loaded || this.loading) return

      this.loading = true
      this.error = null

      try {
        const data = await getRankList()
        this.groups = data.groups
        this.items = data.items
        this.loaded = true
      } catch (error) {
        this.error = toApiError(error)
        this.groups = []
        this.items = []
      } finally {
        this.loading = false
      }
    },

    /** Reset all state (called on page unmount). */
    clear(): void {
      this.groups = []
      this.items = []
      this.loading = false
      this.error = null
      this.loaded = false
    }
  }
})
