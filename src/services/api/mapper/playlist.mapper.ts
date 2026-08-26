import type { Playlist } from '@/domain/playlist'
import type { PlaylistDto } from '../types/dto'
import { mapSongDto } from './song.mapper'

/**
 * Map a raw `PlaylistDto` to the stable `Playlist` domain model. Handles
 * missing/null fields with safe defaults. `tracks` is whatever the detail
 * endpoint returned (may be a truncated prefix of the full track list).
 */
export function mapPlaylistDto(dto: PlaylistDto): Playlist {
  const trackDtos = dto.tracks ?? []
  const tracks = Array.isArray(trackDtos) ? trackDtos.map(mapSongDto) : []
  const creator = dto.creator ?? { userId: 0, nickname: '' }

  return {
    id: dto.id,
    name: dto.name,
    coverUrl: dto.coverImgUrl ?? dto.picUrl ?? undefined,
    trackCount: dto.trackCount ?? tracks.length,
    creator: {
      userId: creator.userId,
      nickname: creator.nickname
    },
    tracks,
    specialType: dto.specialType ?? undefined
  }
}
