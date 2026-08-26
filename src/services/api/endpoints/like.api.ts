import { requestWithCookie } from '../api-client'

interface LikeListResponseDto {
  code: number
  ids: number[]
}

/**
 * 喜欢歌曲/取消喜欢。对应 server `like.js` → /api/radio/like。
 * 需登录态:必须传 cookie 标识用户,否则服务端无法知道是谁在喜欢。
 * `noCache: true`:写操作不能读 2 分钟缓存,避免 unlike→relike 读到旧响应。
 * @param id 歌曲 id
 * @param like true=喜欢,false=取消
 * @param cookie 登录 cookie
 */
export async function likeSong(id: number, like: boolean, cookie: string): Promise<void> {
  await requestWithCookie<{ code: number }>({
    url: '/like',
    noCache: true,
    cookie,
    params: { id, like }
  })
}

/**
 * 获取用户喜欢歌曲 id 列表。对应 server `likelist.js` → /api/song/like/get。
 * 登录后调用,用于初始化"已喜欢"状态。需传 cookie 才能拿到当前用户的列表。
 */
export async function getLikeList(uid: number, cookie: string): Promise<number[]> {
  const { data } = await requestWithCookie<LikeListResponseDto>({
    url: '/likelist',
    noCache: true,
    cookie,
    params: { uid }
  })
  return data.ids ?? []
}
