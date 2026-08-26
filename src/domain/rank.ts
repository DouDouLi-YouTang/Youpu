/** A ranking category group like "云音乐特色榜" or "全球媒体榜". */
export interface RankGroup {
  id: number
  name: string
}

/**
 * A single ranking list item (e.g. "飙升榜", "热歌榜"). Its `id` is the playlist id.
 * Official campaign-page entries (畅销榜/有声书榜等，非真实歌单) are filtered out
 * upstream in the mapper, so every item here is a real, navigable playlist.
 */
export interface RankItem {
  id: number
  name: string
  coverUrl?: string
  updateFrequency?: string
  groupId: number
}
