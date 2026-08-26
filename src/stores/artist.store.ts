import { defineStore } from 'pinia'

import type { AlbumBrief } from '@/domain/album'
import type { Artist } from '@/domain/artist'
import type { Song } from '@/domain/song'
import {
  getArtistAlbums,
  getArtistDetail,
  getArtistSongs,
  getArtistTopSongs
} from '@/services/api/endpoints/artist.api'
import { ApiError, toApiError } from '@/services/api/errors'

/** One tab's loadable slice (header is separate, songs/albums reuse this). */
interface TabState<T extends unknown[]> {
  data: T
  loading: boolean
  error: ApiError | null
  loaded: boolean
}

interface ArtistStoreState {
  /** The artist id the current data belongs to; mismatch => stale, reload. */
  artistId: number | null
  artist: Artist | null
  artistLoading: boolean
  artistError: ApiError | null

  topSongs: TabState<Song[]>
  songs: TabState<Song[]>
  songsTotal: number
  albums: TabState<AlbumBrief[]>
}

function emptyTab<T extends unknown[]>(): TabState<T> {
  return { data: [] as unknown as T, loading: false, error: null, loaded: false }
}

export const useArtistStore = defineStore('artist', {
  state: (): ArtistStoreState => ({
    artistId: null,
    artist: null,
    artistLoading: false,
    artistError: null,
    topSongs: emptyTab<Song[]>(),
    songs: emptyTab<Song[]>(),
    songsTotal: 0,
    albums: emptyTab<AlbumBrief[]>()
  }),

  actions: {
    /** True when `id` matches the loaded artist; callers reload on mismatch. */
    isCurrent(id: number): boolean {
      return this.artistId === id
    },

    /** Reset everything to a fresh state for a new artist id. */
    resetFor(id: number): void {
      this.artistId = id
      this.artist = null
      this.artistLoading = false
      this.artistError = null
      this.topSongs = emptyTab<Song[]>()
      this.songs = emptyTab<Song[]>()
      this.songsTotal = 0
      this.albums = emptyTab<AlbumBrief[]>()
    },

    /** Load the artist header. */
    async loadArtist(id: number): Promise<void> {
      if (!this.isCurrent(id)) this.resetFor(id)
      // Skip if already loaded successfully for this artist.
      if (this.artist && !this.artistError) return

      this.artistLoading = true
      this.artistError = null
      try {
        this.artist = await getArtistDetail(id)
      } catch (error) {
        this.artistError = toApiError(error)
        this.artist = null
      } finally {
        this.artistLoading = false
      }
    },

    /** Load hot 50 songs (default tab). Idempotent per artist. */
    async loadTopSongs(id: number): Promise<void> {
      if (!this.isCurrent(id)) this.resetFor(id)
      if (this.topSongs.loaded || this.topSongs.loading) return

      this.topSongs.loading = true
      this.topSongs.error = null
      try {
        this.topSongs.data = await getArtistTopSongs(id)
        this.topSongs.loaded = true
      } catch (error) {
        this.topSongs.error = toApiError(error)
        this.topSongs.data = []
      } finally {
        this.topSongs.loading = false
      }
    },

    /** Load the full songs list (hot order, first page). Idempotent per artist. */
    async loadSongs(id: number): Promise<void> {
      if (!this.isCurrent(id)) this.resetFor(id)
      if (this.songs.loaded || this.songs.loading) return

      this.songs.loading = true
      this.songs.error = null
      try {
        const page = await getArtistSongs(id, { order: 'hot', limit: 100 })
        this.songs.data = page.songs
        this.songsTotal = page.total
        this.songs.loaded = true
      } catch (error) {
        this.songs.error = toApiError(error)
        this.songs.data = []
      } finally {
        this.songs.loading = false
      }
    },

    /** Load the album cards (first page). Idempotent per artist. */
    async loadAlbums(id: number): Promise<void> {
      if (!this.isCurrent(id)) this.resetFor(id)
      if (this.albums.loaded || this.albums.loading) return

      this.albums.loading = true
      this.albums.error = null
      try {
        const page = await getArtistAlbums(id, { limit: 30 })
        this.albums.data = page.albums
        this.albums.loaded = true
      } catch (error) {
        this.albums.error = toApiError(error)
        this.albums.data = []
      } finally {
        this.albums.loading = false
      }
    },

    /** Clear all artist data. */
    clear(): void {
      this.artistId = null
      this.artist = null
      this.artistLoading = false
      this.artistError = null
      this.topSongs = emptyTab<Song[]>()
      this.songs = emptyTab<Song[]>()
      this.songsTotal = 0
      this.albums = emptyTab<AlbumBrief[]>()
    }
  }
})
