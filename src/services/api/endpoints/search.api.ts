import type { SearchResult } from '@/domain/search'
import type { Song } from '@/domain/song'
import { request } from '../api-client'
import { mapSongDto } from '../mapper/song.mapper'
import type { SearchResponseDto, SongDetailResponseDto, SongDto } from '../types/dto'

export interface SearchOptions {
  limit?: number
  offset?: number
}

/**
 * 用 /song/detail 给缺封面的搜索结果补全封面。
 * 只请求缺 cover 的 id,分批 50 个。
 */
async function enrichSongCovers(songs: Song[]): Promise<Song[]> {
  const missingIds = songs
    .filter((s) => !s.coverUrl)
    .map((s) => s.id)
    .filter((id, i, arr) => arr.indexOf(id) === i)

  if (missingIds.length === 0) return songs

  const coverById = new Map<number, string>()
  const batchSize = 50
  for (let i = 0; i < missingIds.length; i += batchSize) {
    const batch = missingIds.slice(i, i + batchSize)
    try {
      const body = await request<SongDetailResponseDto>({
        url: '/song/detail',
        params: { ids: batch.join(',') }
      })
      for (const dto of body.songs ?? []) {
        const pic = dto.al?.picUrl ?? dto.album?.picUrl ?? null
        if (pic) coverById.set(dto.id, pic)
      }
    } catch {
      // 补封面失败不阻断搜索结果
    }
  }

  if (coverById.size === 0) return songs

  return songs.map((song) => {
    if (song.coverUrl) return song
    const pic = coverById.get(song.id)
    if (!pic) return song
    return {
      ...song,
      coverUrl: pic,
      album: { ...song.album, coverUrl: song.album.coverUrl ?? pic }
    }
  })
}

/**
 * Search songs by keyword.
 * 使用 `/cloudsearch`(比 `/search` 更全);仍缺封面时再用 `/song/detail` 补全。
 */
export async function searchSongs(
  keywords: string,
  opts: SearchOptions = {}
): Promise<SearchResult> {
  const body = await request<SearchResponseDto>({
    url: '/cloudsearch',
    params: {
      keywords,
      type: 1,
      limit: opts.limit ?? 30,
      offset: opts.offset ?? 0
    }
  })

  const songDtos: SongDto[] = body.result?.songs ?? []
  let songs = songDtos.map(mapSongDto)
  const songCount = body.result?.songCount ?? songs.length

  songs = await enrichSongCovers(songs)

  return { songs, songCount }
}

/** /search/suggest 返回 { result: { allMatch: [{ keyword }] } } */
interface SearchSuggestResponseDto {
  code: number
  result: {
    allMatch?: { keyword: string }[] | null
  }
}

/** 搜索联想:返回关键词建议列表。type='mobile' 走轻量接口。 */
export async function searchSuggest(keywords: string): Promise<string[]> {
  if (!keywords.trim()) return []
  const body = await request<SearchSuggestResponseDto>({
    url: '/search/suggest',
    params: { keywords, type: 'mobile' }
  })
  return (body.result?.allMatch ?? []).map((m) => m.keyword)
}

/** /search/hot/detail 返回 { data: [{ searchWord, content }] } */
interface SearchHotResponseDto {
  code: number
  data?: { searchWord: string; content?: string | null }[] | null
}

export interface HotSearchItem {
  word: string
  content?: string
}

/** 热搜列表:无搜索词时展示。 */
export async function searchHot(): Promise<HotSearchItem[]> {
  const body = await request<SearchHotResponseDto>({ url: '/search/hot/detail' })
  return (body.data ?? []).map((d) => ({ word: d.searchWord, content: d.content ?? undefined }))
}
