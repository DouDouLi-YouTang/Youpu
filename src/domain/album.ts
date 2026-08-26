import type { ArtistBrief } from './artist'
import type { Song } from './song'

/**
 * Brief album reference embedded in songs.
 */
export interface AlbumBrief {
  id: number
  name: string
  coverUrl?: string
}

/**
 * Full album detail shown on the album page. `songs` is the track list returned
 * by the album detail endpoint (NetEase returns the full list for a single
 * album).
 */
export interface Album {
  id: number
  name: string
  coverUrl?: string
  /** Primary artist (NetEase `artist`). */
  artist: ArtistBrief
  /** All credited artists (NetEase `artists`), guaranteed to include `artist`. */
  artists: ArtistBrief[]
  description?: string
  /** Publish time in epoch ms. */
  publishTime?: number
  /** Total track count as reported by NetEase. */
  size?: number
  songs: Song[]
}
