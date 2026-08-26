import type { RankGroup, RankItem } from '@/domain/rank'
import type { RankItemDto, RankListResponseDto, RankCategoryDto } from '../types/dto'

export function mapRankItemDto(dto: RankItemDto, groupId: number): RankItem {
  return {
    id: dto.id,
    name: dto.name,
    coverUrl: dto.coverUrl ?? dto.coverImgUrl ?? undefined,
    updateFrequency: dto.updateFrequency ?? undefined,
    groupId
  }
}

export interface RankListData {
  groups: RankGroup[]
  items: RankItem[]
}

/**
 * Map the full `/toplist/detail/v2` response into a flat `RankListData` object.
 * Returns empty arrays for any missing parts so consumers never null-check.
 */
export function mapRankListResponse(dto: RankListResponseDto): RankListData {
  const categories = dto.data ?? []
  const groups: RankGroup[] = []
  const items: RankItem[] = []

  categories.forEach((category: RankCategoryDto, index: number) => {
    const groupId = index
    groups.push({
      id: groupId,
      name: category.name
    })

    // targetType "H5" 条目指向网易云官方活动页而非真实歌单，id 恒为 0，无法播放/跳转，故过滤。
    const categoryItems = (category.list ?? [])
      .filter((item: RankItemDto) => item.targetType !== 'H5')
      .map((item: RankItemDto) => mapRankItemDto(item, groupId))
    items.push(...categoryItems)
  })

  return { groups, items }
}
