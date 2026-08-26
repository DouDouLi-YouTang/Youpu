import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { message } from 'ant-design-vue'

import type { Playlist } from '@/domain/playlist'
import type { Song } from '@/domain/song'
import { addPlaylistTracks } from '@/services/api/endpoints/playlist.api'
import { ApiError } from '@/services/api/errors'
import { useAuthStore } from '@/stores/auth.store'
import { useLibraryStore } from '@/stores/library.store'

export function playlistLabel(pl: Pick<Playlist, 'name' | 'specialType'>): string {
  return pl.specialType === 5 ? '我喜欢的音乐' : pl.name
}

/**
 * 歌曲右键「添加到歌单」二级菜单：列表/加载态/添加动作。
 * 数据复用 library.store.createdPlaylists（仅自建），展开时 loadMyPlaylists 不 force。
 */
export function useSongAddToPlaylist(song: () => Song): {
  isLoggedIn: ComputedRef<boolean>
  createdPlaylists: ComputedRef<Playlist[]>
  playlistsLoading: ComputedRef<boolean>
  playlistLoadError: ComputedRef<boolean>
  selectablePlaylists: ComputedRef<Playlist[]>
  submittingPlaylistId: Ref<number | null>
  playlistLabel: typeof playlistLabel
  onAddToPlaylistOpen: () => void
  onMenuOpenChange: (keys: (string | number)[]) => void
  tryHandlePlaylistMenuKey: (key: string) => boolean
} {
  const auth = useAuthStore()
  const libraryStore = useLibraryStore()

  const isLoggedIn = computed(() => auth.isLoggedIn)
  const createdPlaylists = computed(() => libraryStore.createdPlaylists)
  const playlistsLoading = computed(() => libraryStore.loading)
  const playlistLoadError = computed(
    () => libraryStore.error != null && createdPlaylists.value.length === 0
  )
  const selectablePlaylists = computed(() => {
    if (!auth.isLoggedIn) return []
    if (playlistsLoading.value && createdPlaylists.value.length === 0) return []
    if (libraryStore.error && createdPlaylists.value.length === 0) return []
    return createdPlaylists.value
  })
  const submittingPlaylistId = ref<number | null>(null)

  function onAddToPlaylistOpen(): void {
    if (!auth.isLoggedIn) {
      message.warning('需要登录后才能添加到歌单')
      return
    }
    void libraryStore.loadMyPlaylists().then(() => {
      if (libraryStore.error) {
        message.error('歌单列表加载失败')
      }
    })
  }

  function onMenuOpenChange(keys: (string | number)[]): void {
    if (keys.map(String).includes('add-to-playlist')) {
      onAddToPlaylistOpen()
    }
  }

  async function addToPlaylist(playlistId: number): Promise<void> {
    if (submittingPlaylistId.value !== null) return
    if (!auth.isLoggedIn) {
      message.warning('需要登录后才能添加到歌单')
      return
    }
    const pl = createdPlaylists.value.find((p) => p.id === playlistId)
    if (!pl) return

    submittingPlaylistId.value = playlistId
    try {
      await addPlaylistTracks(playlistId, [song().id], auth.cookie)
      message.success(`已添加到「${playlistLabel(pl)}」`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'UNAUTHORIZED') {
        auth.handleUnauthorized()
        return
      }
      message.error(e instanceof Error ? e.message : '添加失败')
    } finally {
      submittingPlaylistId.value = null
    }
  }

  /** 若 key 为 playlist-* 则处理并返回 true,否则返回 false 交给其它菜单项。 */
  function tryHandlePlaylistMenuKey(key: string): boolean {
    if (!key.startsWith('playlist-')) return false
    const id = Number(key.slice('playlist-'.length))
    if (Number.isFinite(id) && id > 0) void addToPlaylist(id)
    return true
  }

  return {
    isLoggedIn,
    createdPlaylists,
    playlistsLoading,
    playlistLoadError,
    selectablePlaylists,
    submittingPlaylistId,
    playlistLabel,
    onAddToPlaylistOpen,
    onMenuOpenChange,
    tryHandlePlaylistMenuKey
  }
}
