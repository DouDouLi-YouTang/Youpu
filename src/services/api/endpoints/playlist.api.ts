import type { Playlist } from '@/domain/playlist'
import { request, requestWithCookie } from '../api-client'
import { ApiError } from '../errors'
import { mapPlaylistDto } from '../mapper/playlist.mapper'
import type { PlaylistDetailResponseDto } from '../types/dto'

/**
 * Fetch a playlist's detail by id. The returned `tracks` are whatever the
 * detail endpoint includes (commonly a prefix of the full track list);
 * fetching every track via `/playlist/track/all` is a later-sprint concern.
 */
export async function getPlaylistDetail(id: number): Promise<Playlist> {
  const body = await request<PlaylistDetailResponseDto>({
    url: '/playlist/detail',
    params: { id }
  })

  return mapPlaylistDto(body.playlist)
}

interface PersonalizedResponseDto {
  result: Array<{
    id: number
    type: number
    name: string
    copywriter: string
    picUrl: string
    playCount: number
    trackCount: number
    highQuality: boolean
  }>
}

/**
 * Fetch personalized recommended playlists for the discover page.
 * Works with anonymous users (returns general recommendations).
 */
export async function getRecommendPlaylists(limit = 30): Promise<Playlist[]> {
  const body = await request<PersonalizedResponseDto>({
    url: '/personalized',
    params: { limit }
  })

  // Map the simplified /personalized response to Playlist domain objects.
  // The API returns minimal fields, so we fill in defaults for missing ones.
  return body.result.map((item) => ({
    id: item.id,
    name: item.name,
    coverUrl: item.picUrl,
    description: item.copywriter || '',
    trackCount: item.trackCount,
    playCount: item.playCount,
    creator: {
      userId: 0,
      nickname: '',
      avatarUrl: ''
    },
    tracks: [],
    tags: [],
    createTime: 0,
    updateTime: 0,
    subscribed: false,
    subscribedCount: 0
  }))
}

/**
 * /playlist/tracks 响应:外层 code 是 HTTP 层,真正的业务结果在 body.code
 * (200=成功, 512=歌曲已在该歌单, 502=参数错误等)。
 */
interface PlaylistTracksResponseDto {
  code: number
  body?: { code?: number }
}

/**
 * 添加歌曲到指定歌单。对应 server `playlist_tracks.js`。
 * 需登录态:传 cookie。v4.29.7 后登录请求须带 timestamp,否则判为不合法。
 * @param pid 目标歌单 id
 * @param trackIds 歌曲 id 列表
 */
export async function addPlaylistTracks(
  pid: number,
  trackIds: number[],
  cookie: string
): Promise<void> {
  const { data } = await requestWithCookie<PlaylistTracksResponseDto>({
    url: '/playlist/tracks',
    method: 'POST',
    noCache: true,
    cookie,
    params: {
      op: 'add',
      pid,
      tracks: trackIds.join(','),
      timestamp: Date.now()
    }
  })
  const bizCode = data.body?.code ?? data.code
  // 512 = 歌曲已存在,视为成功(用户意图已满足)
  if (bizCode !== 200 && bizCode !== 512) {
    throw new Error(`添加到歌单失败 (code ${bizCode})`)
  }
}

/**
 * 从指定歌单删除歌曲。对应 server `playlist_tracks.js`(/playlist/tracks, op=del),与 addPlaylistTracks 对称(同一 endpoint,op 区分增删)。
 * 需登录态:传 cookie。
 * @param pid 目标歌单 id
 * @param trackIds 歌曲 id 列表
 */
export async function removePlaylistTracks(
  pid: number,
  trackIds: number[],
  cookie: string
): Promise<void> {
  try {
    const { data } = await requestWithCookie<PlaylistTracksResponseDto>({
      url: '/playlist/tracks',
      method: 'POST',
      noCache: true,
      cookie,
      params: {
        op: 'del',
        pid,
        tracks: trackIds.join(','),
        timestamp: Date.now()
      }
    })
    const bizCode = data.body?.code ?? data.code
    if (bizCode !== 200 && bizCode !== 512) {
      throw new Error(`从歌单删除歌曲失败 (code ${bizCode})`)
    }
  } catch (error) {
    // 512 = 歌曲不在该歌单(可能已被其他端删除),用户意图已满足,视为成功
    if (error instanceof ApiError && error.status === 512) return
    throw error
  }
}

/**
 * 删除整个歌单。对应 server `playlist_delete.js`(/playlist/delete)。
 * 仅歌单创建者可删(收藏歌单不可删,需走取消收藏)。需登录态:传 cookie。
 * @param pid 歌单 id
 */
export async function deletePlaylist(pid: number, cookie: string): Promise<void> {
  const { data } = await requestWithCookie<{ code: number }>({
    url: '/playlist/delete',
    method: 'POST',
    noCache: true,
    cookie,
    params: {
      id: pid,
      timestamp: Date.now()
    }
  })
  if (data.code !== 200) {
    throw new Error(`删除歌单失败 (code ${data.code})`)
  }
}
