import type { PlayableLevel, PlayableTrack } from '@/domain/player'
import type { Song } from '@/domain/song'
import { ApiError } from './api/errors'
import { getSongUrl } from './api/endpoints/song.api'

/**
 * Resolve a `PlayableTrack` for a `Song` by requesting a signed playback URL.
 *
 * Returns `null` when the song cannot be played; in that case the song's
 * `playableStatus` is updated in place to a specific reason so the UI can show
 * it:
 *  - `no-url`               — the API returned no URL (removed / not playable).
 *  - `vip-required`         — song requires a VIP account (code 702).
 *  - `copyright-restricted` — song is geo/copyright blocked (code 701).
 *
 * Unexpected API failures are rethrown as `ApiError` — the caller (player
 * store) is responsible for surfacing them via the player `error` state.
 *
 * On success the song is marked `playable` and a `PlayableTrack` containing
 * the signed URL, bitrate and expiry is returned.
 */
export async function resolvePlayableTrack(
  song: Song,
  level: PlayableLevel = 'standard',
  cookie?: string
): Promise<PlayableTrack | null> {
  try {
    const resolved = await getSongUrl(song.id, level, cookie)

    if (resolved == null) {
      song.playableStatus = 'no-url'
      return null
    }

    song.playableStatus = 'playable'
    return {
      song,
      url: resolved.url,
      bitrate: resolved.bitrate,
      expiresAt: resolved.expiresAt
    }
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === 'VIP_REQUIRED') {
        song.playableStatus = 'vip-required'
        return null
      }
      if (error.code === 'COPYRIGHT_RESTRICTED') {
        song.playableStatus = 'copyright-restricted'
        return null
      }
      // Other business/transport errors are not "not playable" — propagate so
      // the player store can show a transient error (network/server/etc.).
      throw error
    }
    throw error
  }
}
