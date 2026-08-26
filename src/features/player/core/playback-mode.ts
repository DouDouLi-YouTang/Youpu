import type { PlaybackMode } from '@/domain/player'

/**
 * Read-only view of play-queue state used by the pure traversal functions.
 * Keeping this an interface (not the full store) lets the functions stay
 * decoupled from Pinia and trivially testable.
 */
export interface QueueTraversalState {
  itemsLength: number
  currentIndex: number
  mode: PlaybackMode
  shuffleOrder: number[]
}

/**
 * Return the index of the next track to play, or `null` when there is none.
 *
 * `auto=true` means playback ended naturally; `auto=false` means the user
 * pressed "next". The distinction matters for `repeat-one` (natural end
 * replays the same track; user-press advances) and for `sequence` at the end
 * of the queue (both stop, returning null).
 *
 * See ARCHITECTURE.md §8.3 for the rule table.
 */
export function getNextIndex(state: QueueTraversalState, auto: boolean): number | null {
  const { itemsLength, currentIndex, mode, shuffleOrder } = state
  if (itemsLength === 0) return null

  switch (mode) {
    case 'sequence': {
      const next = currentIndex + 1
      return next < itemsLength ? next : null
    }
    case 'repeat-all': {
      return (currentIndex + 1) % itemsLength
    }
    case 'repeat-one': {
      // Natural end → replay current. User skip → advance (wrap like repeat-all).
      if (auto) return currentIndex
      return (currentIndex + 1) % itemsLength
    }
    case 'shuffle': {
      if (shuffleOrder.length === 0) return null
      const pos = shuffleOrder.indexOf(currentIndex)
      // If current isn't in the shuffle order (e.g. queue changed), start
      // from the beginning of the shuffle order.
      const nextPos = pos === -1 ? 0 : pos + 1
      return nextPos < shuffleOrder.length ? shuffleOrder[nextPos] : null
    }
    // 心动模式按顺序依次播放本次拉取的完整推荐列表,到末尾返回 null
    // 触发 player store 拉取下一批(/playmode/intelligence/list 文档语义)。
    case 'heart': {
      const next = currentIndex + 1
      return next < itemsLength ? next : null
    }
    default:
      return null
  }
}

/**
 * Return the index of the previous track. History-based backtracking is owned
 * by the store (it tracks uids); this function provides the fallback
 * index-based previous, used when history is empty. Always wraps within bounds
 * for non-sequence modes so the user can always go back.
 */
export function getPreviousIndex(state: QueueTraversalState): number | null {
  const { itemsLength, currentIndex, mode, shuffleOrder } = state
  if (itemsLength === 0) return null

  switch (mode) {
    case 'sequence': {
      const prev = currentIndex - 1
      return prev >= 0 ? prev : null
    }
    case 'repeat-all': {
      return (currentIndex - 1 + itemsLength) % itemsLength
    }
    case 'repeat-one': {
      return (currentIndex - 1 + itemsLength) % itemsLength
    }
    case 'shuffle': {
      if (shuffleOrder.length === 0) return null
      const pos = shuffleOrder.indexOf(currentIndex)
      const prevPos = pos === -1 ? 0 : pos - 1
      if (prevPos < 0) return null
      return shuffleOrder[prevPos]
    }
    // 心动模式允许在本次推荐列表内回退到上一首,到顶返回 null。
    case 'heart': {
      const prev = currentIndex - 1
      return prev >= 0 ? prev : null
    }
    default:
      return null
  }
}
