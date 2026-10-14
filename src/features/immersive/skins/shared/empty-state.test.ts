import { describe, expect, it } from 'vitest'

import {
  EMPTY_TEXT_LOADING,
  EMPTY_TEXT_NO_LYRIC,
  EMPTY_TEXT_PURE_MUSIC,
  EMPTY_TEXT_WAITING,
  resolveSkinEmptyState,
  type SkinEmptyStateInput
} from './empty-state'

/** 默认：有歌 / 歌词就绪 / 已经唱到某一行 —— 也就是「空态为 null」的常见情况 */
function input(overrides: Partial<SkinEmptyStateInput> = {}): SkinEmptyStateInput {
  return {
    loading: false,
    isPureMusic: false,
    hasLyric: true,
    hasItem: true,
    songTitle: '歌名',
    songArtist: '歌手',
    hasCurrentLine: true,
    ...overrides
  }
}

describe('resolveSkinEmptyState', () => {
  it('有行可排时返回 null', () => {
    expect(resolveSkinEmptyState(input())).toBeNull()
  })

  it('加载中且有歌名 → 歌名卡（不是「暂无歌词」）', () => {
    expect(resolveSkinEmptyState(input({ loading: true, hasLyric: false }))).toEqual({
      kind: 'song',
      title: '歌名',
      artist: '歌手'
    })
  })

  it('加载中但没有歌名 → 加载中文案', () => {
    expect(
      resolveSkinEmptyState(input({ loading: true, hasLyric: false, songTitle: null }))
    ).toEqual({ kind: 'text', text: EMPTY_TEXT_LOADING })
  })

  it('纯音乐优先于「没有歌词」', () => {
    expect(
      resolveSkinEmptyState(input({ isPureMusic: true, hasLyric: false, hasCurrentLine: false }))
    ).toEqual({ kind: 'text', text: EMPTY_TEXT_PURE_MUSIC })
  })

  it('没有歌词（请求失败那条路）→ 暂无歌词', () => {
    expect(resolveSkinEmptyState(input({ hasLyric: false, hasCurrentLine: false }))).toEqual({
      kind: 'text',
      text: EMPTY_TEXT_NO_LYRIC
    })
  })

  it('没选歌 → 等待音乐', () => {
    expect(
      resolveSkinEmptyState(
        input({ hasItem: false, songTitle: null, songArtist: null, hasCurrentLine: false })
      )
    ).toEqual({ kind: 'text', text: EMPTY_TEXT_WAITING })
  })

  it('有歌有词、还没唱到第一句 → 歌名卡（不是「等待音乐」）', () => {
    expect(resolveSkinEmptyState(input({ hasCurrentLine: false }))).toEqual({
      kind: 'song',
      title: '歌名',
      artist: '歌手'
    })
  })

  it('前奏但没有歌名 → 退回等待音乐', () => {
    expect(
      resolveSkinEmptyState(input({ hasCurrentLine: false, songTitle: null, songArtist: null }))
    ).toEqual({ kind: 'text', text: EMPTY_TEXT_WAITING })
  })
})
