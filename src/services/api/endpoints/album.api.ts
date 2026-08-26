import type { Album } from '@/domain/album'
import { request } from '../api-client'
import { mapAlbumDto } from '../mapper/album.mapper'
import type { AlbumResponseDto } from '../types/dto'

/**
 * Fetch an album's detail by id. Public (no cookie). Returns the album info
 * plus its full track list. Uses the plain cacheable `request`.
 */
export async function getAlbumDetail(id: number): Promise<Album> {
  const body = await request<AlbumResponseDto>({
    url: '/album',
    params: { id }
  })
  return mapAlbumDto(body.album ?? { id, name: '' }, body.songs ?? [])
}
