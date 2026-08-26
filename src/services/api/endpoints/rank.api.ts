import type { RankListData } from '../mapper/rank.mapper'
import { mapRankListResponse } from '../mapper/rank.mapper'
import type { RankListResponseDto } from '../types/dto'
import { request } from '../api-client'

/**
 * Fetch all ranking categories and their top-level metadata from
 * `/toplist/detail/v2`. This is a public, cacheable endpoint.
 */
export async function getRankList(): Promise<RankListData> {
  const body = await request<RankListResponseDto>({
    url: '/toplist/detail/v2'
  })

  return mapRankListResponse(body)
}
