import type { Song } from '@/domain/song'
import { requestWithCookie } from '../api-client'
import { mapSongDto } from '../mapper/song.mapper'
import type { SongDto } from '../types/dto'

/** /personal_fm 返回 { data: SongDto[] }(通常 1-3 首) */
interface PersonalFmResponseDto {
  code: number
  data: SongDto[]
}

/**
 * 私人 FM:返回推荐歌曲。无需种子,每首播完再调一次拉下一首。
 * 对应 server `personal_fm.js` → /api/v1/radio/get。
 * 需登录态:必须传 cookie 标识用户,否则返回的不是当前用户的个性化推荐。
 */
export async function getPersonalFm(cookie: string): Promise<Song[]> {
  const { data } = await requestWithCookie<PersonalFmResponseDto>({
    url: '/personal_fm',
    noCache: true,
    cookie
  })
  const dtos = data.data ?? []
  return dtos.map(mapSongDto)
}

/**
 * FM 垃圾桶:把指定歌扔进垃圾桶,私人 FM 不再推荐该歌。对应 server `fm_trash.js`
 * → /api/radio/trash/add(weapi)。仅 FM 模式有意义,影响后续 FM 推荐结果。
 * 需登录态:必须传 cookie 标识用户,否则服务端无法知道是谁在操作。
 * `noCache: true`:写操作不能读缓存。
 * @param songId 歌曲 id
 * @param cookie 登录 cookie
 */
export async function trashFmSong(songId: number, cookie: string): Promise<void> {
  await requestWithCookie<{ code: number }>({
    url: '/fm_trash',
    noCache: true,
    cookie,
    params: { id: songId }
  })
}
