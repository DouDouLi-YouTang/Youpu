import type { Song } from './song'

/**
 * Where a queue item originated. Used for analytics / UI hints; does not
 * affect playback logic.
 */
export type QueueSource =
  | 'search'
  | 'playlist'
  | 'album'
  | 'artist'
  | 'daily'
  | 'song'
  | 'manual'
  | 'fm'
  | 'download'
  | 'history'

/**
 * Audio quality level requested from `/song/url/v1`. `standard` and `exhigh`
 * are the only ones used in this phase; higher levels require a VIP account.
 */
export type PlayableLevel = 'standard' | 'exhigh' | 'lossless' | 'hires'

/**
 * Queue traversal rule. `sequence` plays in order and stops at the end;
 * `repeat-all` wraps; `repeat-one` replays the current track on natural end;
 * `shuffle` follows a generated shuffle order. See ARCHITECTURE.md §8.3.
 */
export type PlaybackMode = 'sequence' | 'repeat-all' | 'repeat-one' | 'shuffle' | 'heart'

/**
 * Lifecycle state of the player. Driven by `useAudioElement` events and
 * mirrored into `player.store`. UI reads only this.
 */
export type PlaybackState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'ended'
  | 'error'

/**
 * A song placed in the play queue. `uid` distinguishes multiple instances of
 * the same song (same `songId`) so history and queue operations stay
 * unambiguous. `addedAt` is a monotonic-ish timestamp for ordering.
 */
export interface QueueItem {
  uid: string
  songId: number
  song: Song
  source: QueueSource
  addedAt: number
  localFileUrl?: string
  localFilePath?: string
}

/**
 * A song with a resolved, playable URL. Produced by `player-service` after
 * calling `/song/url/v1`. `expiresAt` is when the signed URL stops working.
 */
export interface PlayableTrack {
  song: Song
  url: string
  bitrate?: number
  expiresAt?: number
}
