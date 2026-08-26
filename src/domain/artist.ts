/**
 * Brief artist reference embedded in songs, albums, and playlists.
 */
export interface ArtistBrief {
  id: number
  name: string
}

/**
 * Full artist detail shown on the artist page header.
 */
export interface Artist {
  id: number
  name: string
  avatarUrl?: string
  picUrl?: string
  /** Number of albums by this artist, per NetEase. */
  albumSize?: number
  /** Number of songs by this artist, per NetEase. */
  musicSize?: number
  /** Short biography / description. */
  briefDesc?: string
}
