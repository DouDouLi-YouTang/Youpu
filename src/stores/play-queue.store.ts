import { defineStore } from 'pinia'

import type { PlaybackMode, QueueItem, QueueSource } from '@/domain/player'
import type { Song } from '@/domain/song'
import { getNextIndex, getPreviousIndex } from '@/features/player/core/playback-mode'
import type { QueueTraversalState } from '@/features/player/core/playback-mode'
import {
  addNext,
  appendToQueue,
  createQueueItem,
  generateShuffleOrder,
  removeAt,
  replaceQueue
} from '@/features/player/core/queue'

interface PlayQueueState {
  items: QueueItem[]
  currentIndex: number
  mode: PlaybackMode
  /** Uids of previously-played items, most-recent last. */
  history: string[]
  /** Shuffle traversal order (indices into `items`). */
  shuffleOrder: number[]
  /**
   * 当前曲目的播放位置(ms)。低内存模式回收渲染进程后,无后台会话时(回收前
   * 未在播放)由 use-low-memory-restore 读回并恢复为暂停态;正在播放时进度来自
   * 音频引擎的 position 事件(引擎一直持有音频),这里只是兜底。
   * 由 use-low-memory-restore 跟随 player.currentTimeMs 节流回写。
   */
  positionMs: number
}

/**
 * 持久化键必须与主进程 memory-mode.ts 的 QUEUE_STORAGE_KEY 完全一致:
 * 回收渲染进程前主进程会 executeJavaScript 读这个键做快照。
 */
export const PLAY_QUEUE_PERSIST_KEY = 'muice:play-queue'

export const usePlayQueueStore = defineStore('play-queue', {
  state: (): PlayQueueState => ({
    items: [],
    currentIndex: -1,
    mode: 'sequence',
    history: [],
    shuffleOrder: [],
    positionMs: 0
  }),

  getters: {
    current(): QueueItem | null {
      return this.currentIndex >= 0 && this.currentIndex < this.items.length
        ? this.items[this.currentIndex]
        : null
    },
    length(): number {
      return this.items.length
    }
  },

  actions: {
    traversalState(): QueueTraversalState {
      return {
        itemsLength: this.items.length,
        currentIndex: this.currentIndex,
        mode: this.mode,
        shuffleOrder: this.shuffleOrder
      }
    },

    /**
     * Replace the entire queue with `songs`, starting at `index`. Clears
     * history and rebuilds the shuffle order (if in shuffle mode). Returns the
     * item that should start playing.
     */
    replaceQueue(songs: Song[], index: number, source: QueueSource): QueueItem | null {
      const addedAt = Date.now()
      const { items, currentIndex } = replaceQueue(songs, index, source, addedAt)
      this.items = items
      this.currentIndex = currentIndex
      this.history = []
      if (this.mode === 'shuffle') {
        this.shuffleOrder = generateShuffleOrder(items.length, currentIndex)
      } else {
        this.shuffleOrder = []
      }
      return this.current
    },

    appendToQueue(song: Song, source: QueueSource): void {
      this.items = appendToQueue(this.items, song, source, Date.now())
    },

    addNext(song: Song, source: QueueSource): void {
      const { items, currentIndex } = addNext(
        this.items,
        this.currentIndex,
        song,
        source,
        Date.now()
      )
      this.items = items
      this.currentIndex = currentIndex
    },

    remove(uid: string): void {
      const wasCurrent = this.current?.uid === uid
      const { items, currentIndex } = removeAt(this.items, this.currentIndex, uid)
      this.items = items
      this.currentIndex = currentIndex
      if (this.mode === 'shuffle') {
        this.shuffleOrder = generateShuffleOrder(items.length, currentIndex)
      }
      void wasCurrent
    },

    clear(): void {
      this.items = []
      this.currentIndex = -1
      this.history = []
      this.shuffleOrder = []
      // 队列清空后旧进度没有意义,留着会让下一次恢复把新队列 seek 到旧位置
      this.positionMs = 0
    },

    setMode(mode: PlaybackMode): void {
      if (mode === this.mode) return
      this.mode = mode
      if (mode === 'shuffle') {
        this.shuffleOrder = generateShuffleOrder(this.items.length, this.currentIndex)
      } else {
        this.shuffleOrder = []
      }
    },

    /** 记录当前曲目的播放位置(低内存模式重建渲染进程后续播用)。 */
    setPosition(ms: number): void {
      this.positionMs = Math.max(0, Math.round(ms))
    },

    /**
     * Advance to the next track. `auto=true` means playback ended naturally
     * (repeat-one replays; sequence stops at the end). Pushes the current uid
     * to history before moving. Returns the new current item or null (queue
     * exhausted).
     */
    next(auto: boolean): QueueItem | null {
      if (this.items.length === 0) return null
      if (this.currentIndex >= 0) {
        const cur = this.items[this.currentIndex]
        if (cur) this.history.push(cur.uid)
      }
      const nextIndex = getNextIndex(this.traversalState(), auto)
      if (nextIndex == null) {
        this.currentIndex = -1
        return null
      }
      this.currentIndex = nextIndex
      return this.current
    },

    previous(): QueueItem | null {
      if (this.items.length === 0) return null
      // Prefer explicit history if available.
      if (this.history.length > 0) {
        const prevUid = this.history[this.history.length - 1]
        const idx = this.items.findIndex((item) => item.uid === prevUid)
        if (idx >= 0) {
          this.history.pop()
          this.currentIndex = idx
          return this.current
        }
      }
      const prevIndex = getPreviousIndex(this.traversalState())
      if (prevIndex == null) return null
      this.currentIndex = prevIndex
      return this.current
    },

    /** Insert a single ad-hoc song (e.g. not from a list) and play it next. */
    playNow(song: Song, source: QueueSource): QueueItem {
      const item = createQueueItem(song, source, Date.now())
      this.items = [item]
      this.currentIndex = 0
      this.history = []
      this.shuffleOrder = []
      return item
    },

    /** Play a downloaded local file without resolving an online playback URL. */
    playNowLocal(song: Song, fileUrl: string, filePath: string): QueueItem {
      const item = createQueueItem(song, 'download', Date.now(), {
        localFileUrl: fileUrl,
        localFilePath: filePath
      })
      this.items = [item]
      this.currentIndex = 0
      this.history = []
      this.shuffleOrder = []
      return item
    }
  },

  // 低内存模式销毁渲染进程前,主进程会读 localStorage['muice:play-queue'] 做快照
  // (见 electron/main/memory-mode.ts),重建后再靠它恢复队列,所以键名必须显式写死,
  // 不能依赖 pinia-plugin-persistedstate 以 store id 推导的默认键。
  persist: {
    key: PLAY_QUEUE_PERSIST_KEY
  }
})
