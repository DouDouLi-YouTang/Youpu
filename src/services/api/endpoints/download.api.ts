import { requestWithCookie } from '../api-client'

/** /song/download/url 返回的下载信息。 */
interface SongDownloadUrlResponseDto {
  code: number
  data: {
    url: string | null
    br?: number
    size?: number
    type?: string
  } | null
}

export interface SongDownloadUrl {
  url: string
  br: number
  size: number
  type: string
}

/**
 * 获取歌曲下载 URL。对应 server `song_download_url.js`。
 * 与 /song/url/v1 的区别:非 VIP 账号也能下载部分无损音质(而试听只能标准音质)。
 * 需登录态:传 cookie。默认 br=999000(最大码率)。
 * 返回 null 表示无下载权限或版权受限。
 */
export async function getSongDownloadUrl(
  id: number,
  cookie: string,
  br = 999000
): Promise<SongDownloadUrl | null> {
  const { data } = await requestWithCookie<SongDownloadUrlResponseDto>({
    url: '/song/download/url',
    noCache: true,
    cookie,
    params: { id, br }
  })
  if (!data.data?.url) return null
  return {
    url: data.data.url,
    br: data.data.br ?? 0,
    size: data.data.size ?? 0,
    type: data.data.type ?? 'mp3'
  }
}
