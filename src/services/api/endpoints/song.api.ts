import type { PlayableLevel } from '@/domain/player'
import type { Song } from '@/domain/song'
import { ApiError } from '../errors'
import { request, requestWithCookie } from '../api-client'
import { mapSongDto } from '../mapper/song.mapper'
import type { SongDetailResponseDto, SongUrlResponseDto } from '../types/dto'

/**
 * Fetch detail for one or more songs by id. api-enhanced expects a
 * comma-joined `ids` string. Returns mapped domain `Song` objects.
 */
export async function getSongDetail(ids: number[]): Promise<Song[]> {
  if (ids.length === 0) return []

  const body = await request<SongDetailResponseDto>({
    url: '/song/detail',
    params: {
      ids: ids.join(',')
    }
  })

  const songDtos = body.songs ?? []
  return songDtos.map(mapSongDto)
}

/**
 * Resolved signed playback URL for a song. `level` selects the quality tier
 * requested from `/song/url/v1`.
 *
 * Playback URL must be requested with the active login cookie when available.
 * Otherwise NetEase treats VIP accounts as anonymous users and may return only
 * a short trial URL (`freeTrialInfo`) for member-only songs.
 *
 * Returns `null` when the song is not playable (`url === null` in the
 * response, which happens for VIP-only / copyright-restricted / removed
 * songs). A null return is NOT an error — callers should surface a
 * "no playback" state rather than throwing.
 *
 * On success returns the signed `url`, the bitrate (`br`, bps), and an
 * `expiresAt` epoch-ms computed from the response expiry (`expi` seconds).
 */
export async function getSongUrl(
  id: number,
  level: PlayableLevel = 'standard',
  cookie?: string
): Promise<{ url: string; bitrate: number; expiresAt: number } | null> {
  const { data: body } = await requestWithCookie<SongUrlResponseDto>({
    url: '/song/url/v1',
    // Avoid reusing a 2-minute cached trial URL after login / membership changes.
    noCache: true,
    cookie,
    params: {
      id: String(id),
      level
    }
  })

  const entry = body.data?.[0]
  if (!entry || entry.url == null) {
    return null
  }

  if (entry.freeTrialInfo != null) {
    throw new ApiError({
      code: 'VIP_REQUIRED',
      message: '当前账号仅获取到试听片段，请确认会员状态或重新登录'
    })
  }

  const expiSec = typeof entry.expi === 'number' && entry.expi > 0 ? entry.expi : 0
  return {
    url: entry.url,
    bitrate: entry.br ?? 0,
    expiresAt: Date.now() + expiSec * 1000
  }
}
