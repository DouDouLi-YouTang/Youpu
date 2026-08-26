import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'

import type { CommentSort } from '@/domain/comment'
import { useCommentStore } from '@/stores/comment.store'
import { ApiError } from '@/services/api/errors'
import { useCommentsPanel } from './use-comments-panel'

/**
 * Shared comment-panel content logic. `CommentsDrawer` (right-side drawer) and
 * `CommentsView` (full content-area view) both drive the same store bucket from
 * the same `useCommentsPanel` target; only the visibility trigger and layout
 * differ. This composable owns the watch/sort/like/empty logic so the two
 * surfaces stay in lockstep instead of drifting.
 *
 * `visible` is a getter so each surface controls its own open condition — the
 * drawer additionally defers to the immersive "hide comments" setting, while
 * the page view relies on `openPanel` having already gated that.
 */
export function useCommentsContent(visible: () => boolean) {
  const { target } = useCommentsPanel()
  const store = useCommentStore()

  const bucket = computed(() => store.current)

  /**
   * Tracks the comment currently mid-flight so every like button can be
   * disabled until the optimistic update resolves. `null` when idle.
   */
  const likingId = ref<number | null>(null)

  /** Pull a snapshot of the current sort with a sensible default. */
  const sort = computed<CommentSort>(() => bucket.value?.sort ?? 'recommend')

  const sortOptions = [
    { label: '推荐', value: 'recommend' },
    { label: '热度', value: 'hot' },
    { label: '时间', value: 'time' }
  ]

  const showHot = computed(() => sort.value === 'recommend')
  const listTitle = computed(() => {
    switch (sort.value) {
      case 'hot':
        return '热度评论'
      case 'time':
        return '最新评论'
      default:
        return '全部评论'
    }
  })

  /**
   * When the surface opens (or the target resource changes), point the store at
   * the new bucket and kick off the hot + list fetches. The store's own caching
   * makes re-opens cheap.
   */
  watch(
    [() => visible(), target],
    ([isOpen, resource]) => {
      if (!isOpen || !resource) return
      store.setActive(resource)
      void store.loadHot(resource)
      const current = store.current
      if (current && !current.listLoaded && !current.loading) {
        void store.loadList(resource)
      }
    },
    { immediate: true }
  )

  function onSortChange(value: string | number): void {
    const resource = target.value
    if (!resource) return
    void store.changeSort(resource, value as CommentSort)
  }

  function onLoadMore(): void {
    const resource = target.value
    if (!resource) return
    void store.loadMore(resource)
  }

  function onRetry(): void {
    const resource = target.value
    if (!resource) return
    // Preserve the visible page when retrying a failed "load more" request.
    if (bucket.value?.error && bucket.value.list.length > 0) {
      void store.loadMore(resource)
      return
    }
    void store.loadList(resource)
  }

  async function onLike(commentId: number): Promise<void> {
    const resource = target.value
    if (!resource) return
    if (likingId.value !== null) return

    likingId.value = commentId
    try {
      await store.toggleLike(resource, commentId)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'UNAUTHORIZED') {
        message.warning('请先登录后再点赞')
      } else {
        message.error('点赞失败，请稍后重试')
      }
    } finally {
      likingId.value = null
    }
  }

  /** True before the first successful list fetch resolves. */
  const isInitialLoading = computed(() => {
    const b = bucket.value
    return Boolean(b?.loading && !b.listLoaded)
  })

  /** True while an already-populated surface changes to a new sort. */
  const isListLoading = computed(() => {
    const b = bucket.value
    return Boolean(b?.loading && b.listLoaded)
  })

  return {
    bucket,
    likingId,
    sort,
    sortOptions,
    showHot,
    listTitle,
    onSortChange,
    onLoadMore,
    onRetry,
    onLike,
    isInitialLoading,
    isListLoading
  }
}
