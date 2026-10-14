import type { ChorusRange } from '@/domain/lyric'
import { request } from '../api-client'
import type { ChorusResponseDto } from '../types/dto'

/**
 * 把 `/song/chorus` 的原始响应规整成可信的副歌区间数组。
 *
 * 取 `chorus ?? data`（两字段实测等价，上游 `parseNeteaseChorusRanges` 同口径），
 * 过滤掉非有限或 `end <= start` 的区间（零长度区间永远不可能与歌词行「有重叠」，
 * 留着只会白白参与比较），最后按 `startTime` 升序 —— 上游 `applyNeteaseChorusByTime`
 * 取「第一个命中的区间」，排序能保证结果与响应顺序无关、可复现。
 *
 * 导出为纯函数是为了单测能直接喂畸形输入，不必打桩网络层。
 */
export function normalizeChorusRanges(raw: unknown): ChorusRange[] {
  if (!raw || typeof raw !== 'object') return []
  const source = raw as ChorusResponseDto
  const list = source.chorus ?? source.data
  if (!Array.isArray(list)) return []

  const ranges: ChorusRange[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const { startTime, endTime } = entry as { startTime?: unknown; endTime?: unknown }
    if (typeof startTime !== 'number' || typeof endTime !== 'number') continue
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) continue
    if (endTime <= startTime) continue
    ranges.push({ startTime, endTime })
  }
  ranges.sort((a, b) => a.startTime - b.startTime)
  return ranges
}

/**
 * 获取一首歌的副歌时间区间（毫秒）。
 *
 * 副歌数据是公开且按歌曲静态的，用普通 `request` 走 api-enhanced 的 2 分钟缓存即可。
 * 空数组表示「这首歌没有副歌标注」，是正常结果而非错误 —— 调用方（lyric store）
 * 需要把接口失败也降级成空数组，副歌缺失不能影响歌词本身。
 */
export async function getChorus(songId: number): Promise<ChorusRange[]> {
  const body = await request<ChorusResponseDto>({
    url: '/song/chorus',
    params: { id: songId }
  })
  return normalizeChorusRanges(body)
}
