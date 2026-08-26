import type { AlbumBrief } from './album'
import type { ArtistBrief } from './artist'

/**
 * Why a song may not be playable. `unknown` is the default before the player
 * service resolves a playable URL; the other variants are set once playability
 * is checked (out of scope for this phase, so most songs stay `unknown`).
 */
export type PlayableStatus =
  | 'unknown'
  | 'playable'
  | 'copyright-restricted'
  | 'vip-required'
  | 'no-url'

/**
 * Stable in-app song model. Mapped from the raw `SongDto` so that the rest of
 * the app never sees NetEase's abbreviated field names (`ar`, `al`, `dt`).
 *
 * `durationMs` is always milliseconds. `coverUrl` is the canonical image URL
 * (falls back to the album cover). `playableStatus` defaults to `unknown`.
 * `aliases` stores NetEase song alias / translated names for the immersive
 * "hide song alias" switch; artists remain a separate line.
 */
export interface Song {
  id: number
  name: string
  artists: ArtistBrief[]
  album: AlbumBrief
  durationMs: number
  coverUrl?: string
  aliases?: string[]
  playableStatus: PlayableStatus
}
