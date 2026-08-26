import type { Song } from './song'

/**
 * Result of a song search. `songCount` is the total number of matches reported
 * by the server (used to know whether more pages can be loaded).
 */
export interface SearchResult {
  songs: Song[]
  songCount: number
}
