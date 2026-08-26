import type { LyricData } from '@/domain/lyric'
import { request } from '../api-client'
import { mapLyricDto } from '../mapper/lyric.mapper'
import type { LyricResponseDto } from '../types/dto'

/**
 * Fetch and parse a song's lyric.
 *
 * 歌词是公开且按歌曲静态的,plain `request` + api-enhanced 2 分钟缓存即可。
 * 当前使用 `/lyric/new`(v1),它在响应里同时返回 yrc.lyric 与 lrc.lyric;
 * 但 v1 返回的是新版富文本 JSON 格式 `{"t":ms,"c":[{"tx":"字"}]}`,与旧版
 * `/lyric` 的标准 LRC `[mm:ss.xx]text` 不兼容 —— mapper 会同时尝试两种解析。
 *
 * 关键:必须显式传 `lv/tv/yv=0`。v1 端点不一定默认返回 yrc,漏传
 * `yv=0` 时只有行级歌词,`LyricLine.words` 为空,逐字动画不会进入 karaoke 分支。
 */
export async function getLyric(songId: number): Promise<LyricData> {
  const body = await request<LyricResponseDto>({
    url: '/lyric/new',
    params: { id: songId, lv: 0, tv: 0, yv: 0 }
  })
  return mapLyricDto(body)
}
