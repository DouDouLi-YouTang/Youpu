import { defineStore } from 'pinia'
import { reactive } from 'vue'

import type { Comment, CommentResource, CommentSort } from '@/domain/comment'
import {
  fetchCommentList,
  fetchHotComments,
  toggleCommentLike
} from '@/services/api/endpoints/comment.api'
import { ApiError, toApiError } from '@/services/api/errors'
import { useAuthStore } from './auth.store'

/**
 * Multi-resource comment store. Each (type, id) pair gets its own `bucket`
 * holding hot/list/sort/pagination/loading/error. The buckets Map lives at
 * MODULE scope, NOT inside the Pinia state — Pinia's options-store action
 * proxy corrupts non-function instance members (see auth.store / player.store
 * for the documented pit). Only the primitive `activeKey` lives in state.
 *
 * Cache policy: keep the last 5 buckets in a poor-man's LRU. Re-opening the
 * panel for a recently-viewed resource skips the network entirely.
 */

const MAX_BUCKETS = 5
const HOT_LIMIT = 10

export type LoadingPhase = 'idle' | 'loading' | 'ready' | 'error'

export interface CommentBucket {
  resource: CommentResource
  hot: Comment[]
  list: Comment[]
  sort: CommentSort
  pageNo: number
  /** Continuation cursor returned by time-sorted `/comment/new` responses. */
  cursor: string | number | null
  hasMore: boolean
  /** At least one list request for this bucket has completed successfully. */
  listLoaded: boolean
  loading: boolean
  loadingMore: boolean
  error: ApiError | null
  /** Incremented per list request so late responses cannot overwrite newer data. */
  requestToken: number
  /** Hot comments have their own loading flag; some resources have none. */
  hotLoaded: boolean
  hotLoading: boolean
}

// LRU: insertion-ordered Map. On every access we delete + re-set to bump the
// key to "most-recent" position; eviction pops the iterator head.
const buckets = new Map<string, CommentBucket>()

function keyOf(resource: CommentResource): string {
  return `${resource.type}-${resource.id}`
}

function emptyBucket(resource: CommentResource): CommentBucket {
  // The buckets Map lives at module scope (Pinia options-store proxy would
  // corrupt non-function instance members), so its values aren't reactive
  // by default. Wrap each bucket in `reactive()` so field mutations
  // (loading flag flipping, list pushes) propagate to subscribers — without
  // this, CommentsDrawer stays on the spinner forever after the request
  // finishes.
  return reactive({
    resource,
    hot: [],
    list: [],
    sort: 'recommend',
    pageNo: 0,
    cursor: null,
    hasMore: true,
    listLoaded: false,
    loading: false,
    loadingMore: false,
    error: null,
    requestToken: 0,
    hotLoaded: false,
    hotLoading: false
  }) as CommentBucket
}

/** Touch `key` so it becomes the LRU tail; evict oldest if over capacity. */
function touch(key: string, bucket: CommentBucket): void {
  if (buckets.has(key)) buckets.delete(key)
  buckets.set(key, bucket)
  if (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value
    if (oldest !== undefined) buckets.delete(oldest)
  }
}

interface CommentStoreState {
  activeKey: string | null
}

export const useCommentStore = defineStore('comment', {
  state: (): CommentStoreState => ({
    activeKey: null
  }),

  getters: {
    /** Current bucket reactive view; null when no resource is active. */
    current(state): CommentBucket | null {
      return state.activeKey ? (buckets.get(state.activeKey) ?? null) : null
    }
  },

  actions: {
    /**
     * Point the store at a resource. Creates or revives the bucket; callers
     * still need to invoke `loadHot` / `loadList` themselves to fetch.
     */
    setActive(resource: CommentResource): void {
      const key = keyOf(resource)
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = emptyBucket(resource)
        touch(key, bucket)
      } else {
        touch(key, bucket)
      }
      this.activeKey = key
    },

    /**
     * Load the pinned hot-comment block once per bucket. Re-opens for the same
     * resource are free.
     */
    async loadHot(resource: CommentResource): Promise<void> {
      const key = keyOf(resource)
      const bucket = buckets.get(key)
      if (!bucket || bucket.hotLoaded || bucket.hotLoading) return

      bucket.hotLoading = true
      try {
        const result = await fetchHotComments(resource, { limit: HOT_LIMIT })
        bucket.hot = result.comments
        bucket.hotLoaded = true
      } catch {
        // Hot comments are non-essential — swallow the error so the main list
        // can still load. The drawer falls back to the main comment list only.
        bucket.hot = []
      } finally {
        bucket.hotLoading = false
      }
    },

    /**
     * Load (or reload) the paginated comment list. A new request for this
     * resource supersedes every prior one, so late replace/append responses
     * never overwrite the current sort or pagination state.
     */
    async loadList(
      resource: CommentResource,
      options: { sort?: CommentSort; append?: boolean } = {}
    ): Promise<void> {
      const key = keyOf(resource)
      const bucket = buckets.get(key)
      if (!bucket) return

      const append = options.append ?? false
      const sort = append ? bucket.sort : (options.sort ?? bucket.sort)

      // A successful cached bucket is already ready when reopening the panel.
      if (!append && options.sort === undefined && bucket.listLoaded && !bucket.error) return
      if (
        append &&
        (!bucket.listLoaded || bucket.loading || bucket.loadingMore || !bucket.hasMore)
      ) {
        return
      }

      const token = ++bucket.requestToken
      const nextPage = append ? bucket.pageNo + 1 : 1
      const cursor = append && sort === 'time' ? bucket.cursor : null

      if (append) {
        bucket.loadingMore = true
        bucket.error = null
      } else {
        bucket.loading = true
        bucket.loadingMore = false
        bucket.error = null
        bucket.pageNo = 0
        bucket.cursor = null
        bucket.list = []
        bucket.hasMore = true
        bucket.sort = sort
      }

      try {
        const result = await fetchCommentList(resource, {
          pageNo: nextPage,
          sort,
          ...(cursor !== null ? { cursor } : {})
        })
        if (token !== bucket.requestToken) return

        bucket.list = append ? bucket.list.concat(result.comments) : result.comments
        bucket.hasMore = result.hasMore
        bucket.error = null
        bucket.pageNo = nextPage
        bucket.cursor = sort === 'time' ? result.cursor : null
        bucket.listLoaded = true
      } catch (error) {
        if (token !== bucket.requestToken) return
        bucket.error = toApiError(error)
        if (!append) bucket.list = []
      } finally {
        if (token === bucket.requestToken) {
          if (append) {
            bucket.loadingMore = false
          } else {
            bucket.loading = false
          }
        }
      }
    },

    /** Switch the active bucket to a new sort and reload from page 1. */
    async changeSort(resource: CommentResource, sort: CommentSort): Promise<void> {
      const bucket = buckets.get(keyOf(resource))
      if (!bucket || bucket.sort === sort) return
      await this.loadList(resource, { sort, append: false })
    },

    /** Load the next page; no-op if already on the last page. */
    async loadMore(resource: CommentResource): Promise<void> {
      await this.loadList(resource, { append: true })
    },

    /**
     * Toggle the like on a comment with an optimistic update + rollback on
     * failure. The auth store gates the request: a missing/expired cookie
     * never hits the network — the UI handles the "请先登录" message itself
     * (this action throws `ApiError({ code: 'UNAUTHORIZED' })` for callers to
     * branch on).
     */
    async toggleLike(resource: CommentResource, commentId: number): Promise<void> {
      const bucket = buckets.get(keyOf(resource))
      if (!bucket) return

      const auth = useAuthStore()
      if (!auth.isLoggedIn || !auth.cookie) {
        throw new ApiError({
          code: 'UNAUTHORIZED',
          message: '请先登录后再点赞',
          retryable: false
        })
      }

      // Locate the comment in either the hot block or the main list. NetEase
      // may surface the same comment in both, so we update every match.
      const targets: Comment[] = [
        ...bucket.hot.filter((c) => c.id === commentId),
        ...bucket.list.filter((c) => c.id === commentId)
      ]
      if (targets.length === 0) return

      const prevSnapshots = targets.map((c) => ({ liked: c.liked, likedCount: c.likedCount }))
      const nextLiked = !targets[0].liked

      for (const c of targets) {
        c.liked = nextLiked
        c.likedCount = Math.max(0, c.likedCount + (nextLiked ? 1 : -1))
      }

      try {
        await toggleCommentLike(resource, commentId, nextLiked, auth.cookie)
      } catch (error) {
        // Roll back every mutated copy in the same order we updated them.
        for (let i = 0; i < targets.length; i++) {
          targets[i].liked = prevSnapshots[i].liked
          targets[i].likedCount = prevSnapshots[i].likedCount
        }
        throw toApiError(error)
      }
    },

    /** Drop every cached bucket. Called from auth/logout flows. */
    clear(): void {
      for (const bucket of buckets.values()) bucket.requestToken++
      buckets.clear()
      this.activeKey = null
    }
  }
})
