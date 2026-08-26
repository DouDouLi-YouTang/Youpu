import type { Song } from '@/domain/song'
import { requestWithCookie } from '../api-client'
import { mapSongDto } from '../mapper/song.mapper'
import type { SongDto } from '../types/dto'

/**
 * 智能播放接口在不同网易云客户端版本中有两种等价结构：
 * - `data: [{ songInfo: SongDto }]`（当前 API Enhanced 常见返回）
 * - `data: { items: [{ song: SongDto }] }`（旧版/部分网关返回）
 *
 * 统一兼容两种结构，不能只读取 `data.items`，否则第一种会被误判为空推荐。
 */
interface IntelligenceItemDto {
  song?: SongDto | null
  songInfo?: SongDto | null
}

interface IntelligenceResponseDto {
  code: number
  data?: IntelligenceItemDto[] | { items?: IntelligenceItemDto[] | null } | null
}

/**
 * 心动模式：基于一首种子歌和来源歌单获取智能推荐。
 * 需要登录态，且传入 cookie 标识当前用户。
 */
export async function getIntelligencePlaylist(
  songId: number,
  playlistId: number,
  cookie: string,
  count = 20
): Promise<Song[]> {
  const { data } = await requestWithCookie<IntelligenceResponseDto>({
    url: '/playmode/intelligence/list',
    noCache: true,
    cookie,
    // `sid` 是这次智能播放的起播种子。服务端虽会在缺省时回退到 `id`，
    // 仍显式传递以严格遵守接口文档，避免调用语义依赖服务端默认值。
    // 一次取多个候选，由播放器排除刚听过的歌曲后再播放。
    params: { id: songId, pid: playlistId, sid: songId, count }
  })

  const payload = data.data
  const items = Array.isArray(payload) ? payload : (payload?.items ?? [])
  const songs = items
    .map((item) => item.songInfo ?? item.song ?? null)
    .filter((song): song is SongDto => song != null)

  return songs.map(mapSongDto)
}
