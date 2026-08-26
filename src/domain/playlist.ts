import type { Song } from './song'

/**
 * A playlist as shown in detail pages. `tracks` is the list of songs returned
 * by the detail endpoint (may be a truncated prefix of the full track list;
 * complete track fetching is a later-sprint concern).
 */
export interface Playlist {
  id: number
  name: string
  coverUrl?: string
  trackCount: number
  creator: {
    userId: number
    nickname: string
  }
  tracks: Song[]
  /**
   * NetEase playlist special type. `5` marks the user's "我喜欢的音乐"
   * (liked-songs) playlist. Undefined for ordinary playlists.
   */
  specialType?: number
}
