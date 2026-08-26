/**
 * Comment domain model. The store holds these (not raw DTOs), and the panel
 * renders + interacts with them.
 *
 * Three resource types share one comment flow: songs (0), playlists (2), and
 * albums (3). The numeric value matches NetEase's `resourceTypeMap` so it can be
 * passed straight to `/comment/new` and `/comment/like` without translation.
 */

/** NetEase resource type for comment endpoints. Subset of the full map. */
export type CommentResourceType = 0 | 2 | 3

/** Identifies a comment thread. Stable across resource lifetimes. */
export interface CommentResource {
  type: CommentResourceType
  id: number
}

export interface CommentUser {
  id: number
  nickname: string
  avatarUrl: string
}

export interface Comment {
  id: number
  user: CommentUser
  /** Comment body. Plain text — NetEase strips most markup server-side. */
  content: string
  /** Epoch ms when the comment was posted. */
  timeMs: number
  likedCount: number
  /** Whether the current user (if logged in) has already liked this comment. */
  liked: boolean
  /** A compact display model for the single comment this item replies to. */
  replyTo?: Pick<Comment, 'user' | 'content'>
}

/**
 * UI-level sort key. Mapped to NetEase's numeric `sortType` in the endpoint
 * layer so callers stay in semantic terms.
 *
 *   recommend → 99 (default mix, the app's first tab)
 *   hot       →  2 (likedCount desc)
 *   time      →  3 (time desc)
 */
export type CommentSort = 'recommend' | 'hot' | 'time'
