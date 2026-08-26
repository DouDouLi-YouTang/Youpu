import { computed } from 'vue'

import { useSettingsStore } from '@/stores/settings.store'

/** 虚拟列表固定行高(px)。封面开/关都保持一致,避免滚动跳动。 */
export const SONG_ROW_HEIGHT = 56

/**
 * 歌曲列表的列布局。
 *
 * 表头行与 `SongRow` 行内 grid 必须共用同一套 `grid-cols` 模板才能逐列对齐,
 * 因此把模板收敛到这里。设置项 `showCoverInList` 开启时,在序号列后插入一列
 * 封面缩略图(列宽 2.75rem);`removable`(歌单详情页等可管理场景)时末尾多一列
 * 放删除按钮(2.25rem)。
 *
 * 注意:必须返回完整的 `grid-cols-[...]` 字面量,不能用字符串拼接。Tailwind JIT
 * 静态扫描源码字面量生成 CSS,拼接出来的 class 无法被识别,grid 列定义缺失会让
 * 整行退化为单列垂直堆叠。
 */
export function useSongListColumns() {
  const settings = useSettingsStore()
  const showCover = computed(() => settings.showCoverInList)

  function buildGridClass(removable: boolean): string {
    // 序号略宽、歌名优先、歌手次之、时长固定；封面开时插入缩略图列
    if (showCover.value) {
      return removable
        ? 'grid-cols-[2.5rem_2.75rem_minmax(0,2.2fr)_minmax(0,1fr)_4.25rem_2.25rem]'
        : 'grid-cols-[2.5rem_2.75rem_minmax(0,2.2fr)_minmax(0,1fr)_4.25rem]'
    }
    return removable
      ? 'grid-cols-[2.5rem_minmax(0,2.2fr)_minmax(0,1fr)_4.25rem_2.25rem]'
      : 'grid-cols-[2.5rem_minmax(0,2.2fr)_minmax(0,1fr)_4.25rem]'
  }

  return { showCover, buildGridClass }
}
