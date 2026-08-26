import { defineStore } from 'pinia'

import { ApiError, toApiError } from '@/services/api/errors'
import {
  dailySignin as dailySigninApi,
  getLikedSongsOverview,
  getPersonalPlaylists,
  getPersonalProfile,
  getUserCollections,
  getUserLevel,
  getUserPlayRecords,
  getUserStats
} from '@/services/api/endpoints/personal-center.api'
import { logger } from '@/services/logger'
import type {
  DailySigninState,
  PersonalCenterPlaylists,
  PersonalCenterProfile,
  PersonalCenterSection,
  UserCollectionOverview,
  UserLevelInfo,
  UserLikedSongsOverview,
  UserPlayRecord,
  UserStats
} from '@/domain/personal-center'
import { useAuthStore } from './auth.store'
import { registerPrivateDataReset } from './private-data'

interface PersonalCenterState {
  profile: PersonalCenterProfile | null
  stats: UserStats | null
  level: UserLevelInfo | null
  playlists: PersonalCenterPlaylists
  /** 周听歌排行(type=1)。 */
  recordsWeek: UserPlayRecord[]
  /** 总听歌排行(type=0)。 */
  recordsAll: UserPlayRecord[]
  likedSongs: UserLikedSongsOverview
  collections: UserCollectionOverview
  dailySignin: DailySigninState
  loading: boolean
  error: ApiError | null
  sectionErrors: Partial<Record<PersonalCenterSection, ApiError>>
  sectionLoading: Partial<Record<PersonalCenterSection, boolean>>
  /** 上次完整加载时间,用于避免重复加载。 */
  loadedAt: number | null
}

const EMPTY_LIKED: UserLikedSongsOverview = { ids: [], count: 0 }
const EMPTY_COLLECTIONS: UserCollectionOverview = {
  artists: [],
  artistCount: 0,
  albums: [],
  albumCount: 0,
  mvs: [],
  mvCount: 0
}
const EMPTY_SIGNIN: DailySigninState = { signed: false }

export const usePersonalCenterStore = defineStore('personal-center', {
  state: (): PersonalCenterState => ({
    profile: null,
    stats: null,
    level: null,
    playlists: { created: [], subscribed: [] },
    recordsWeek: [],
    recordsAll: [],
    likedSongs: EMPTY_LIKED,
    collections: EMPTY_COLLECTIONS,
    dailySignin: EMPTY_SIGNIN,
    loading: false,
    error: null,
    sectionErrors: {},
    sectionLoading: {},
    loadedAt: null
  }),

  actions: {
    /**
     * 加载当前登录账号的个人中心数据。
     * 各区块独立加载;单块失败不阻断其它区块。
     * 不再请求 bindings(账号绑定对用户几乎无用)。
     */
    async loadCurrentUserCenter(force = false): Promise<void> {
      const auth = useAuthStore()
      if (!auth.isLoggedIn || auth.userId == null) {
        this.error = new ApiError({ code: 'UNAUTHORIZED', message: '请先登录后再查看个人中心' })
        return
      }

      if (!force && this.loadedAt && Date.now() - this.loadedAt < 30_000 && this.profile) {
        return
      }

      const uid = auth.userId
      const cookie = auth.cookie
      this.loading = true
      this.error = null

      await Promise.allSettled([
        this.loadSection('profile', () => getPersonalProfile(uid, cookie)),
        this.loadSection('stats', () => getUserStats(cookie)),
        this.loadSection('level', () => getUserLevel(cookie)),
        this.loadSection('playlists', () => this.loadPlaylists(uid, cookie)),
        this.loadSection('records', () => this.loadPlayRecords(uid, cookie)),
        this.loadSection('likedSongs', () => getLikedSongsOverview(uid, cookie)),
        this.loadSection('collections', () => getUserCollections(cookie)),
        this.loadSection('dailySignin', () => this.loadDailySignin(cookie))
      ])

      if (!this.profile) {
        this.error =
          this.sectionErrors.profile ??
          new ApiError({ code: 'UNKNOWN', message: '加载个人中心失败，请重试' })
      }

      this.loading = false
      this.loadedAt = Date.now()
    },

    async loadSection<T>(section: PersonalCenterSection, loader: () => Promise<T>): Promise<void> {
      this.sectionLoading[section] = true
      this.sectionErrors[section] = undefined
      try {
        const result = await loader()
        this.applySectionResult(section, result)
      } catch (error) {
        const apiError = toApiError(error)
        if (apiError.code === 'UNAUTHORIZED') {
          useAuthStore().handleUnauthorized()
          return
        }
        logger.warn(`个人中心区块 ${section} 加载失败`, error)
        this.sectionErrors[section] = apiError
      } finally {
        this.sectionLoading[section] = false
      }
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applySectionResult(section: PersonalCenterSection, result: any): void {
      switch (section) {
        case 'profile':
          this.profile = result as PersonalCenterProfile
          break
        case 'stats':
          this.stats = result as UserStats
          break
        case 'level':
          this.level = result as UserLevelInfo | null
          break
        case 'playlists':
          this.playlists = result as PersonalCenterPlaylists
          break
        case 'records': {
          const r = result as { week: UserPlayRecord[]; all: UserPlayRecord[] }
          this.recordsWeek = r.week
          this.recordsAll = r.all
          break
        }
        case 'likedSongs':
          this.likedSongs = result as UserLikedSongsOverview
          break
        case 'collections':
          this.collections = result as UserCollectionOverview
          break
        case 'dailySignin':
          this.dailySignin = result as DailySigninState
          break
        // bindings 已弃用展示,忽略
        case 'bindings':
          break
      }
    },

    async loadPlaylists(uid: number, cookie: string): Promise<PersonalCenterPlaylists> {
      const all = await getPersonalPlaylists(uid, cookie)
      const created = all.filter((pl) => pl.creator.userId === uid)
      const subscribed = all.filter((pl) => pl.creator.userId !== uid)
      this.playlists = { created, subscribed }
      return this.playlists
    },

    /** 并行拉周榜(type=1) + 总榜(type=0)听歌排行。 */
    async loadPlayRecords(
      uid: number,
      cookie: string
    ): Promise<{ week: UserPlayRecord[]; all: UserPlayRecord[] }> {
      const [week, all] = await Promise.all([
        getUserPlayRecords(uid, cookie, 1),
        getUserPlayRecords(uid, cookie, 0)
      ])
      this.recordsWeek = week
      this.recordsAll = all
      return { week, all }
    },

    async loadDailySignin(cookie: string): Promise<DailySigninState> {
      const state = await dailySigninApi(cookie)
      this.dailySignin = state
      return state
    },

    async reloadSection(section: PersonalCenterSection): Promise<void> {
      const auth = useAuthStore()
      if (!auth.isLoggedIn || auth.userId == null) return
      const uid = auth.userId
      const cookie = auth.cookie
      switch (section) {
        case 'profile':
          await this.loadSection('profile', () => getPersonalProfile(uid, cookie))
          break
        case 'stats':
          await this.loadSection('stats', () => getUserStats(cookie))
          break
        case 'level':
          await this.loadSection('level', () => getUserLevel(cookie))
          break
        case 'playlists':
          await this.loadSection('playlists', () => this.loadPlaylists(uid, cookie))
          break
        case 'records':
          await this.loadSection('records', () => this.loadPlayRecords(uid, cookie))
          break
        case 'likedSongs':
          await this.loadSection('likedSongs', () => getLikedSongsOverview(uid, cookie))
          break
        case 'collections':
          await this.loadSection('collections', () => getUserCollections(cookie))
          break
        case 'dailySignin':
          await this.loadSection('dailySignin', () => this.loadDailySignin(cookie))
          break
        case 'bindings':
          // 不再加载
          break
      }
    },

    async doDailySignin(): Promise<void> {
      const auth = useAuthStore()
      if (!auth.isLoggedIn) return
      this.sectionLoading.dailySignin = true
      try {
        this.dailySignin = await dailySigninApi(auth.cookie)
      } catch (error) {
        const apiError = toApiError(error)
        if (apiError.code === 'UNAUTHORIZED') {
          useAuthStore().handleUnauthorized()
          return
        }
        logger.warn('每日签到失败', error)
        this.dailySignin = { signed: false, message: '签到失败，请稍后重试' }
      } finally {
        this.sectionLoading.dailySignin = false
      }
    },

    clear(): void {
      this.profile = null
      this.stats = null
      this.level = null
      this.playlists = { created: [], subscribed: [] }
      this.recordsWeek = []
      this.recordsAll = []
      this.likedSongs = EMPTY_LIKED
      this.collections = EMPTY_COLLECTIONS
      this.dailySignin = EMPTY_SIGNIN
      this.loading = false
      this.error = null
      this.sectionErrors = {}
      this.sectionLoading = {}
      this.loadedAt = null
    }
  }
})

registerPrivateDataReset(() => {
  try {
    usePersonalCenterStore().clear()
  } catch {
    // Pinia 未就绪时忽略
  }
})
