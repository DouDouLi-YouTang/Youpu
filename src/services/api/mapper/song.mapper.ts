import type { AlbumBrief } from '@/domain/album'
import type { ArtistBrief } from '@/domain/artist'
import type { PlayableStatus, Song } from '@/domain/song'
import type { AlbumDto, ArtistDto, SongDto } from '../types/dto'

function mapArtistDto(dto: ArtistDto): ArtistBrief {
  return {
    id: dto.id,
    name: dto.name
  }
}

/**
 * Normalize an artist payload that may be a single object OR an array.
 * `/artist/top/song` returns `ar` as a single artist object for some tracks,
 * while most endpoints return an array. Wrap a lone object into a one-element
 * array so downstream code only ever deals with arrays.
 */
function normalizeArtists(dto: ArtistDto | ArtistDto[] | null | undefined): ArtistBrief[] {
  if (!dto) return []
  if (Array.isArray(dto)) return dto.map(mapArtistDto)
  return [mapArtistDto(dto)]
}

function mapAlbumDto(dto: AlbumDto | null | undefined): AlbumBrief {
  if (!dto) {
    return { id: 0, name: '' }
  }
  return {
    id: dto.id,
    name: dto.name,
    coverUrl: dto.picUrl ?? undefined
  }
}

function normalizeStringList(values: Array<string[] | null | undefined>): string[] | undefined {
  const normalized = values
    .flatMap((value) => value ?? [])
    .map((value) => value.trim())
    .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index)
  return normalized.length > 0 ? normalized : undefined
}

/**
 * Map a raw `SongDto` (NetEase abbreviated fields) to the stable `Song`
 * domain model. Handles missing/null fields with safe defaults. The default
 * `playableStatus` is `unknown` — actual playability is resolved later by the
 * player service.
 *
 * NetEase returns artists under either `ar` or `artists`, album under either
 * `al` or `album`, duration under either `dt` or `duration`, alias under either
 * `alia` / `alias`, and translated names under either `tns` / `transNames`,
 * depending on the endpoint. All supported variants are normalized here.
 */
export function mapSongDto(dto: SongDto): Song {
  const artists: ArtistBrief[] = normalizeArtists(dto.ar ?? dto.artists)

  const album = mapAlbumDto(dto.al ?? dto.album)
  const durationMs = dto.dt ?? dto.duration ?? 0
  const aliases = normalizeStringList([dto.alia, dto.alias, dto.tns, dto.transNames])
  const playableStatus: PlayableStatus = 'unknown'

  return {
    id: dto.id,
    name: dto.name,
    artists,
    album,
    durationMs,
    coverUrl: album.coverUrl,
    aliases,
    playableStatus
  }
}
