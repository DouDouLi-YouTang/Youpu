/**
 * Map raw `/comment/new` and `/comment/hot` payloads to the `Comment` domain
 * model. The two endpoints return different envelopes — `/comment/new` nests
 * the page under `data.comments`, `/comment/hot` returns a flat `hotComments`
 * array — so the helpers below accept either shape defensively.
 */

import type { Comment, CommentUser } from '@/domain/comment'
import type { CommentDto, CommentListDto, CommentUserDto } from '../types/dto'

export function mapCommentUserDto(dto: CommentUserDto | null | undefined): CommentUser {
  return {
    id: dto?.userId ?? 0,
    nickname: dto?.nickname ?? '匿名用户',
    avatarUrl: dto?.avatarUrl ?? ''
  }
}

export function mapCommentDto(dto: CommentDto): Comment {
  const replied = dto.beReplied?.[0]
  return {
    id: dto.commentId,
    ...mapCommentExcerptDto(dto),
    timeMs: dto.time ?? 0,
    likedCount: dto.likedCount ?? 0,
    liked: dto.liked ?? false,
    ...(replied ? { replyTo: mapCommentExcerptDto(replied) } : {})
  }
}

function mapCommentExcerptDto(dto: CommentDto): Pick<Comment, 'user' | 'content'> {
  return {
    user: mapCommentUserDto(dto.user),
    content: (dto.content ?? '').trim()
  }
}

/** Result of either `/comment/new` or `/comment/hot`, normalized. */
export interface MappedCommentList {
  comments: Comment[]
  hasMore: boolean
  total: number
  /** Only `/comment/new` time-sorted pages return a continuation cursor. */
  cursor: string | number | null
}

/**
 * Map a `/comment/new` (v2) response. Comments and pagination live under
 * `data`; `hasMore` is authoritative there.
 */
export function mapCommentListDto(dto: CommentListDto): MappedCommentList {
  const raw = dto.data?.comments ?? []
  return {
    comments: raw.map(mapCommentDto),
    hasMore: dto.data?.hasMore ?? false,
    total: dto.data?.totalCount ?? raw.length,
    cursor: dto.data?.cursor ?? null
  }
}

/**
 * Map a `/comment/hot` response. The v1 endpoint returns `hotComments` at the
 * top level; `hasMore`/`total` sit on the body too.
 */
export function mapHotCommentListDto(dto: CommentListDto): MappedCommentList {
  const raw = dto.hotComments ?? []
  return {
    comments: raw.map(mapCommentDto),
    hasMore: dto.hasMore ?? false,
    total: dto.total ?? raw.length,
    cursor: null
  }
}
