import type { Album } from '@/domain/album'
import type { ArtistBrief } from '@/domain/artist'
import type { AlbumDto, SongDto } from '../types/dto'
import { mapSongDto } from './song.mapper'

function mapArtistBrief(dto: AlbumDto['artist']): ArtistBrief | null {
  if (!dto) return null
  return { id: dto.id, name: dto.name }
}

/**
 * Map a raw `AlbumDto` (NetEase) to the stable `Album` domain model. Handles
 * missing/null fields with safe defaults.
 *
 * `artists` is the credited-artist list; the single `artist` field is merged in
 * if not already present, so `artists` is always non-empty when any artist is
 * known.
 */
export function mapAlbumDto(dto: AlbumDto, songs: SongDto[] = []): Album {
  const artistBrief = mapArtistBrief(dto.artist)
  const artists: ArtistBrief[] = []
  const list = dto.artists ?? []
  for (const a of list) artists.push({ id: a.id, name: a.name })
  if (artistBrief && !artists.some((a) => a.id === artistBrief.id)) {
    artists.unshift(artistBrief)
  }
  const fallbackArtist: ArtistBrief = artistBrief ?? { id: 0, name: '' }

  return {
    id: dto.id,
    name: dto.name,
    coverUrl: dto.picUrl ?? undefined,
    artist: fallbackArtist,
    artists,
    description: dto.description ?? undefined,
    publishTime: dto.publishTime ?? undefined,
    size: dto.size ?? undefined,
    songs: songs.map(mapSongDto)
  }
}
