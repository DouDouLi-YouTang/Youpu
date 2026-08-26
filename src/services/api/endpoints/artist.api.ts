import type { AlbumBrief } from '@/domain/album'
import type { Artist } from '@/domain/artist'
import type { Song } from '@/domain/song'
import { request } from '../api-client'
import { mapArtistAlbumDto, mapArtistDto } from '../mapper/artist.mapper'
import { mapSongDto } from '../mapper/song.mapper'
import type {
  ArtistAlbumsResponseDto,
  ArtistDetailResponseDto,
  ArtistSongsResponseDto,
  ArtistTopSongsResponseDto
} from '../types/dto'

/** Sort order for an artist's songs list. */
export type ArtistSongOrder = 'hot' | 'time'

/** Page slice of an artist's songs. */
export interface ArtistSongsPage {
  songs: Song[]
  total: number
  more: boolean
}

/** Page slice of an artist's albums (as album cards). */
export interface ArtistAlbumsPage {
  albums: AlbumBrief[]
  more: boolean
}

/** Fetch an artist's header info. Public (no cookie). */
export async function getArtistDetail(id: number): Promise<Artist> {
  const body = await request<ArtistDetailResponseDto>({
    url: '/artist/detail',
    params: { id }
  })
  const detail = body.data?.artist ?? body.artist
  return mapArtistDto(detail ?? { id, name: '' })
}

/** Fetch an artist's hot 50 songs. Public (no cookie). */
export async function getArtistTopSongs(id: number): Promise<Song[]> {
  const body = await request<ArtistTopSongsResponseDto>({
    url: '/artist/top/song',
    params: { id }
  })
  return (body.songs ?? []).map(mapSongDto)
}

/** Fetch a page of an artist's songs. Defaults to hot order, 100 per page. */
export async function getArtistSongs(
  id: number,
  opts: { order?: ArtistSongOrder; offset?: number; limit?: number } = {}
): Promise<ArtistSongsPage> {
  const body = await request<ArtistSongsResponseDto>({
    url: '/artist/songs',
    params: {
      id,
      order: opts.order ?? 'hot',
      offset: opts.offset ?? 0,
      limit: opts.limit ?? 100
    }
  })
  return {
    songs: (body.songs ?? []).map(mapSongDto),
    total: body.total ?? 0,
    more: body.more ?? false
  }
}

/** Fetch a page of an artist's albums. Defaults to 30 per page. */
export async function getArtistAlbums(
  id: number,
  opts: { offset?: number; limit?: number } = {}
): Promise<ArtistAlbumsPage> {
  const body = await request<ArtistAlbumsResponseDto>({
    url: '/artist/album',
    params: {
      id,
      offset: opts.offset ?? 0,
      limit: opts.limit ?? 30,
      total: true
    }
  })
  return {
    albums: (body.hotAlbums ?? []).map(mapArtistAlbumDto),
    more: body.more ?? false
  }
}
