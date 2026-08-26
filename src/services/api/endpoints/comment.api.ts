import type { CommentResource, CommentSort } from '@/domain/comment'
import { request, requestWithCookie } from '../api-client'
import {
  mapCommentListDto,
  mapHotCommentListDto,
  type MappedCommentList
} from '../mapper/comment.mapper'
import type { CommentListDto } from '../types/dto'

/**
 * Comment endpoints. NetEase exposes `/comment/new` (v2, recommended) for the
 * paginated list and `/comment/hot` (v1) for pinned top comments. Both are
 * POST. Comment list requests bypass api-enhanced's 2-minute cache because the
 * local server cache key ignores POST body; otherwise different sort/page/resource
 * params for `/comment/new` can reuse the same cached response. Writes
 * (`/comment/like`) require the session cookie and bypass the cache so the
 * client never sees a stale liked state after toggling.
 */

const SORT_TYPE_MAP: Record<CommentSort, 2 | 3 | 99> = {
  recommend: 99,
  hot: 2,
  time: 3
}

/** Fetch one page of comments for a resource. Uses the v2 endpoint. */
export async function fetchCommentList(
  resource: CommentResource,
  params: { pageNo: number; pageSize?: number; sort: CommentSort; cursor?: string | number }
): Promise<MappedCommentList> {
  const body = await request<CommentListDto>({
    url: '/comment/new',
    method: 'POST',
    noCache: true,
    params: {
      type: resource.type,
      id: resource.id,
      pageNo: params.pageNo,
      pageSize: params.pageSize ?? 20,
      sortType: SORT_TYPE_MAP[params.sort],
      // `cursor` is only honored for sortType=3 (time); the server ignores it
      // for other sorts, so it's safe to always forward when present.
      ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
      showInner: true
    }
  })
  return mapCommentListDto(body)
}

/** Fetch the (small) pinned hot-comment list for a resource. */
export async function fetchHotComments(
  resource: CommentResource,
  params: { limit?: number; offset?: number } = {}
): Promise<MappedCommentList> {
  const body = await request<CommentListDto>({
    url: '/comment/hot',
    method: 'POST',
    noCache: true,
    params: {
      type: resource.type,
      id: resource.id,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0
    }
  })
  return mapHotCommentListDto(body)
}

/**
 * Toggle the like on a comment. Requires a session cookie — the api-enhanced
 * server forwards it to NetEase's weapi layer. `noCache: true` keeps a same-cid
 * unlike→relike round-trip from reading a stale 2-minute-cached response.
 *
 * Throws an ApiError on failure (including missing/expired cookie). The store
 * is responsible for rolling back the optimistic UI update.
 */
export async function toggleCommentLike(
  resource: CommentResource,
  commentId: number,
  like: boolean,
  cookie: string
): Promise<void> {
  await requestWithCookie<{ code: number }>({
    url: '/comment/like',
    method: 'POST',
    noCache: true,
    cookie,
    params: {
      t: like ? 1 : 0,
      type: resource.type,
      id: resource.id,
      cid: commentId
    }
  })
}
