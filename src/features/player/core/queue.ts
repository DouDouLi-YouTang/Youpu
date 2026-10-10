import type { QueueItem, QueueSource } from '@/domain/player'
import type { Song } from '@/domain/song'

/**
 * Generate a stable-enough unique id for a queue item. Prefers
 * `crypto.randomUUID`; falls back to a composed string for older runtimes.
 * The same song can appear multiple times in a queue and each instance gets a
 * distinct uid.
 */
export function generateUid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `qi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Build a `QueueItem` from a song. `addedAt` is a timestamp for ordering.
 */
export function createQueueItem(
  song: Song,
  source: QueueSource,
  addedAt: number,
  options?: Pick<QueueItem, 'localFileUrl' | 'localFilePath'>
): QueueItem {
  return {
    uid: generateUid(),
    songId: song.id,
    song,
    source,
    addedAt,
    ...options
  }
}

/**
 * Replace the entire queue with `songs`, starting playback at `startIndex`.
 * Returns the new items array and the clamped current index.
 */
export function replaceQueue(
  songs: Song[],
  startIndex: number,
  source: QueueSource,
  addedAt: number
): { items: QueueItem[]; currentIndex: number } {
  if (songs.length === 0) {
    return { items: [], currentIndex: -1 }
  }
  const items = songs.map((song) => createQueueItem(song, source, addedAt))
  const currentIndex = Math.min(Math.max(startIndex, 0), items.length - 1)
  return { items, currentIndex }
}

/**
 * Append a single item to the end of the queue.
 */
export function appendToQueue(
  items: QueueItem[],
  song: Song,
  source: QueueSource,
  addedAt: number
): QueueItem[] {
  return [...items, createQueueItem(song, source, addedAt)]
}

/**
 * Insert a single item immediately after the current index. If the queue is
 * empty, the item becomes the only entry and currentIndex becomes 0.
 */
export function addNext(
  items: QueueItem[],
  currentIndex: number,
  song: Song,
  source: QueueSource,
  addedAt: number
): { items: QueueItem[]; currentIndex: number } {
  const item = createQueueItem(song, source, addedAt)
  if (items.length === 0) {
    return { items: [item], currentIndex: 0 }
  }
  const insertAt = currentIndex + 1
  const next = [...items.slice(0, insertAt), item, ...items.slice(insertAt)]
  // Current index is unchanged; the new item sits after it.
  return { items: next, currentIndex }
}

/**
 * Remove the item with `uid` from the queue. If the removed item was current,
 * the caller decides whether to auto-advance; this function only clamps the
 * current index to stay valid.
 */
export function removeAt(
  items: QueueItem[],
  currentIndex: number,
  uid: string
): { items: QueueItem[]; currentIndex: number } {
  const removeIndex = items.findIndex((item) => item.uid === uid)
  if (removeIndex === -1) {
    return { items, currentIndex }
  }
  const next = items.filter((item) => item.uid !== uid)
  if (next.length === 0) {
    return { items: [], currentIndex: -1 }
  }
  // If we removed an item before the current one, the current index shifts
  // down by one. If we removed the current one, clamp to the same position
  // (which now points to the next song) or the last valid index.
  let newIndex = currentIndex
  if (removeIndex < currentIndex) {
    newIndex = currentIndex - 1
  } else if (removeIndex === currentIndex) {
    newIndex = Math.min(currentIndex, next.length - 1)
  }
  return { items: next, currentIndex: newIndex }
}

/**
 * Generate a shuffle order: an array of indices starting with `currentIndex`
 * (so the currently playing song keeps playing) followed by the rest in a
 * shuffled order. Uses a Fisher-Yates shuffle over a copy.
 */
export function generateShuffleOrder(length: number, currentIndex: number): number[] {
  if (length === 0) return []
  const indices = Array.from({ length }, (_, i) => i)
  // Fisher-Yates, leaving the first element (currentIndex) in place if valid.
  const start = currentIndex >= 0 && currentIndex < length ? currentIndex : 0
  const head = indices.splice(start, 1)
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }
  return [...head, ...indices]
}
