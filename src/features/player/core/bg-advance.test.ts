import { describe, expect, it } from 'vitest'

import { decideBgAdvance, type BgAdvanceInput } from './bg-advance'

/** 三个元素的队列,默认顺序模式,当前播第 2 首(index 1)。 */
function baseInput(overrides: Partial<BgAdvanceInput> = {}): BgAdvanceInput {
  return {
    fmMode: false,
    traversal: { itemsLength: 3, currentIndex: 1, mode: 'sequence', shuffleOrder: [] },
    ...overrides
  }
}

describe('decideBgAdvance', () => {
  it('sequence:自然播完推进到下一首', () => {
    expect(decideBgAdvance(baseInput(), 'ended')).toEqual({ kind: 'play', index: 2 })
  })

  it('sequence:播到队尾自然结束 → stop', () => {
    const input = baseInput({
      traversal: { itemsLength: 3, currentIndex: 2, mode: 'sequence', shuffleOrder: [] }
    })
    expect(decideBgAdvance(input, 'ended')).toEqual({ kind: 'stop' })
  })

  it('sequence:用户按下一首也推进(队尾同样 stop)', () => {
    expect(decideBgAdvance(baseInput(), 'next')).toEqual({ kind: 'play', index: 2 })
    const input = baseInput({
      traversal: { itemsLength: 3, currentIndex: 2, mode: 'sequence', shuffleOrder: [] }
    })
    expect(decideBgAdvance(input, 'next')).toEqual({ kind: 'stop' })
  })

  it('repeat-all:队尾自然播完循环回第一首', () => {
    const input = baseInput({
      traversal: { itemsLength: 3, currentIndex: 2, mode: 'repeat-all', shuffleOrder: [] }
    })
    expect(decideBgAdvance(input, 'ended')).toEqual({ kind: 'play', index: 0 })
  })

  it('repeat-one:自然播完重播当前;用户下一首则前进', () => {
    const traversal = {
      itemsLength: 3,
      currentIndex: 1,
      mode: 'repeat-one' as const,
      shuffleOrder: []
    }
    expect(decideBgAdvance(baseInput({ traversal }), 'ended')).toEqual({ kind: 'play', index: 1 })
    expect(decideBgAdvance(baseInput({ traversal }), 'next')).toEqual({ kind: 'play', index: 2 })
  })

  it('shuffle:按 shuffleOrder 的下一个位置推进', () => {
    // 顺序表 [2,0,1]:当前 index 0 在表中位置 1 → 下一个位置 2 → shuffleOrder[2] = 1
    const mid = baseInput({
      traversal: { itemsLength: 3, currentIndex: 0, mode: 'shuffle', shuffleOrder: [2, 0, 1] }
    })
    expect(decideBgAdvance(mid, 'ended')).toEqual({ kind: 'play', index: 1 })
    // 当前 index 1 在表中位置 2(最后)→ 无下一个 → stop
    const last = baseInput({
      traversal: { itemsLength: 3, currentIndex: 1, mode: 'shuffle', shuffleOrder: [2, 0, 1] }
    })
    expect(decideBgAdvance(last, 'ended')).toEqual({ kind: 'stop' })
  })

  it('heart:列表内推进,播完拉下一批', () => {
    const traversal = { itemsLength: 3, currentIndex: 1, mode: 'heart' as const, shuffleOrder: [] }
    expect(decideBgAdvance(baseInput({ traversal }), 'ended')).toEqual({ kind: 'play', index: 2 })
    const exhausted = { itemsLength: 3, currentIndex: 2, mode: 'heart' as const, shuffleOrder: [] }
    expect(decideBgAdvance(baseInput({ traversal: exhausted }), 'next')).toEqual({ kind: 'heart' })
  })

  it('fm:无论播完还是下一首都拉新推荐', () => {
    expect(decideBgAdvance(baseInput({ fmMode: true }), 'ended')).toEqual({ kind: 'fm' })
    expect(decideBgAdvance(baseInput({ fmMode: true }), 'next')).toEqual({ kind: 'fm' })
  })

  it('prev:按索引回退;队首回退不了则 stop', () => {
    expect(decideBgAdvance(baseInput(), 'prev')).toEqual({ kind: 'play', index: 0 })
    const head = baseInput({
      traversal: { itemsLength: 3, currentIndex: 0, mode: 'sequence', shuffleOrder: [] }
    })
    expect(decideBgAdvance(head, 'prev')).toEqual({ kind: 'stop' })
  })

  it('prev:repeat-all 循环回退到队尾', () => {
    const input = baseInput({
      traversal: { itemsLength: 3, currentIndex: 0, mode: 'repeat-all', shuffleOrder: [] }
    })
    expect(decideBgAdvance(input, 'prev')).toEqual({ kind: 'play', index: 2 })
  })

  it('空队列直接 stop', () => {
    const input = baseInput({
      traversal: { itemsLength: 0, currentIndex: -1, mode: 'sequence', shuffleOrder: [] }
    })
    expect(decideBgAdvance(input, 'ended')).toEqual({ kind: 'stop' })
    expect(decideBgAdvance(input, 'prev')).toEqual({ kind: 'stop' })
  })
})
