import { describe, expect, it } from 'vitest'

import type { QueueItem } from '@/domain/player'
import type { Song } from '@/domain/song'
import { resolveQueueItemIndex } from './queue'

function makeItem(uid: string): QueueItem {
  const song: Song = {
    id: Number(uid.replace(/\D/g, '')) || 1,
    name: `歌 ${uid}`,
    artists: [{ id: 1, name: '歌手' }],
    album: { id: 1, name: '专辑' },
    durationMs: 200_000,
    playableStatus: 'playable'
  }
  return { uid, songId: song.id, song, source: 'playlist', addedAt: 1 }
}

/** 模拟主进程抓快照:队列与播放移交快照是两份各自 JSON.parse 出来的数据。 */
function parseTwice<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('resolveQueueItemIndex', () => {
  it('按 uid 定位:两份各自 parse 出来的对象引用不同也能找到', () => {
    const items = [makeItem('a'), makeItem('b'), makeItem('c')]
    const queueCopy = parseTwice(items)
    const currentItem = parseTwice(items[2])

    // 引用比较(旧实现)必然是 -1 → Math.max(0, -1) = 0,队列高亮/下一首全错位
    expect(queueCopy.indexOf(currentItem)).toBe(-1)
    expect(resolveQueueItemIndex(queueCopy, currentItem)).toBe(2)
  })

  it('同一首歌在队列里出现多次时,取第一个匹配的 uid 实例', () => {
    const items = [makeItem('dup'), makeItem('other'), parseTwice(makeItem('dup'))]
    expect(resolveQueueItemIndex(items, items[2])).toBe(0)
    expect(resolveQueueItemIndex(items, items[1])).toBe(1)
  })

  it('uid 匹配不上时回退队列自己记录的 currentIndex', () => {
    const items = [makeItem('a'), makeItem('b'), makeItem('c')]
    const stale = makeItem('gone')
    expect(resolveQueueItemIndex(items, stale, 2)).toBe(2)
  })

  it('回退下标越界或缺失时回到 0,不产生非法下标', () => {
    const items = [makeItem('a'), makeItem('b')]
    const stale = makeItem('gone')
    expect(resolveQueueItemIndex(items, stale, -1)).toBe(0)
    expect(resolveQueueItemIndex(items, stale, 9)).toBe(0)
  })

  it('没有当前曲目返回 -1(与旧实现的 item ? … : -1 语义一致)', () => {
    expect(resolveQueueItemIndex([makeItem('a')], null)).toBe(-1)
  })
})
