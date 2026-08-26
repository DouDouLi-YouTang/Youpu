import type { Playlist } from '@/domain/playlist'
import type { Song } from '@/domain/song'
import type { UserProfile } from '@/domain/user'
import { request, requestWithCookie } from '../api-client'
import { mapPlaylistDto } from '../mapper/playlist.mapper'
import { mapSongDto } from '../mapper/song.mapper'
import { mapUserDto } from '../mapper/user.mapper'
import type { RecommendSongsResponseDto, UserPlaylistResponseDto } from '../types/dto'

interface UserDetailResponseDto {
  profile: {
    userId: number
    nickname: string
    avatarUrl: string
    signature?: string
    gender?: number
    province?: number
    city?: number
    birthday?: number
    backgroundUrl?: string
    userType?: number
    vipType?: number
  }
}

/**
 * User-private endpoints (require a login cookie). All use
 * `requestWithCookie({ noCache: true })`: api-enhanced caches 200 responses for
 * 2 minutes keyed on URL + header-cookies (NOT the body), so without busting it
 * a second account / a refresh would read another user's or a stale cached list.
 *
 * cookie + uid are passed in by the caller (store reads them from auth.store);
 * this layer never imports a store.
 */

/**
 * Fetch user detail by uid. Does NOT require login (public endpoint).
 */
export async function getUserDetail(uid: number): Promise<UserProfile> {
  const body = await request<UserDetailResponseDto>({
    url: '/user/detail',
    params: { uid }
  })

  return mapUserDto(body.profile)
}

/**
 * Fetch user's playlists by uid (public endpoint, no login required).
 * Returns both created and subscribed playlists.
 */
export async function getUserPlaylistsPublic(uid: number, limit = 100): Promise<Playlist[]> {
  const body = await request<UserPlaylistResponseDto>({
    url: '/user/playlist',
    params: { uid, limit }
  })

  return (body.playlist ?? []).map(mapPlaylistDto)
}

/**
 * Fetch the current user's playlists. The first entry is the user's
 * "我喜欢的音乐" (specialType 5). Requires the user's numeric `uid` and cookie.
 */
export async function getUserPlaylists(
  uid: number,
  cookie: string,
  opts?: { limit?: number; offset?: number }
): Promise<Playlist[]> {
  const { data } = await requestWithCookie<UserPlaylistResponseDto>({
    url: '/user/playlist',
    method: 'POST',
    noCache: true,
    cookie,
    params: {
      uid,
      limit: opts?.limit ?? 30,
      offset: opts?.offset ?? 0
    }
  })
  return (data.playlist ?? []).map(mapPlaylistDto)
}

/** Fetch the daily recommended songs for the logged-in user. */
export async function getDailySongs(cookie: string): Promise<Song[]> {
  const { data } = await requestWithCookie<RecommendSongsResponseDto>({
    url: '/recommend/songs',
    method: 'POST',
    noCache: true,
    cookie
  })
  return (data.data?.dailySongs ?? []).map(mapSongDto)
}
