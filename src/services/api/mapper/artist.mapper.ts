import type { AlbumBrief } from '@/domain/album'
import type { Artist } from '@/domain/artist'
import type { ArtistAlbumDto, ArtistDetailDto } from '../types/dto'

/**
 * Map a raw `ArtistDetailDto` to the stable `Artist` domain model.
 *
 * Avatar field varies by endpoint: `/artist/detail` returns `avatar` (square)
 * + `cover` (landscape), older shapes return `img1v1Url` / `picUrl`. Prefer the
 * square avatar for `avatarUrl`, fall back through the rest.
 */
export function mapArtistDto(dto: ArtistDetailDto): Artist {
  const picUrl = dto.cover ?? dto.picUrl ?? undefined
  return {
    id: dto.id,
    name: dto.name,
    avatarUrl: dto.avatar ?? dto.img1v1Url ?? picUrl,
    picUrl,
    albumSize: dto.albumSize ?? undefined,
    musicSize: dto.musicSize ?? undefined,
    briefDesc: dto.briefDesc ?? undefined
  }
}

/**
 * Map a raw `ArtistAlbumDto` (album card from `/artist/albums`) to an
 * `AlbumBrief` so it renders the same as any album reference elsewhere.
 */
export function mapArtistAlbumDto(dto: ArtistAlbumDto): AlbumBrief {
  return {
    id: dto.id,
    name: dto.name,
    coverUrl: dto.picUrl ?? undefined
  }
}
