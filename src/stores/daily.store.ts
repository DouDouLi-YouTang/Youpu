import { defineStore } from 'pinia'

import type { Song } from '@/domain/song'
import { getDailySongs } from '@/services/api/endpoints/user.api'
import { ApiError, toApiError } from '@/services/api/errors'
import { useAuthStore } from './auth.store'
import { registerPrivateDataReset } from './private-data'

/** Local YYYY-MM-DD key, used only to avoid re-fetching within the same day. */
function todayKey(): string {
  const d = new Date()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

interface DailyState {
  songs: Song[]
  loading: boolean
  error: ApiError | null
  /** Day the current `songs` were loaded; '' when never loaded. */
  loadedDate: string
}

export const useDailyStore = defineStore('daily', {
  state: (): DailyState => ({
    songs: [],
    loading: false,
    error: null,
    loadedDate: ''
  }),

  actions: {
    /**
     * Load the daily recommended songs. Skips the fetch if already loaded today
     * (pass `force` to refresh). No-op when logged out; 401 routes to the
     * unified expiry handler.
     */
    async loadDailySongs(force = false): Promise<void> {
      const auth = useAuthStore()
      if (!auth.isLoggedIn) {
        this.songs = []
        return
      }
      if (!force && this.loadedDate === todayKey() && this.songs.length > 0) {
        return
      }

      this.loading = true
      this.error = null
      try {
        this.songs = await getDailySongs(auth.cookie)
        this.loadedDate = todayKey()
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
      this.songs = []
      this.loading = false
      this.error = null
      this.loadedDate = ''
    }
  }
})

// Clear daily recommendations on logout / session expiry.
registerPrivateDataReset(() => useDailyStore().clear())
