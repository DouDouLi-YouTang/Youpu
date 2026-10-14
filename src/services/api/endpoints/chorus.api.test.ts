import { describe, expect, it } from 'vitest'
import { normalizeChorusRanges } from './chorus.api'

describe('normalizeChorusRanges', () => {
  it('优先取 chorus,并按 startTime 升序排序', () => {
    const ranges = normalizeChorusRanges({
      code: 200,
      chorus: [
        { startTime: 152916, endTime: 178690 },
        { startTime: 60000, endTime: 90000 }
      ]
    })
    expect(ranges).toEqual([
      { startTime: 60000, endTime: 90000 },
      { startTime: 152916, endTime: 178690 }
    ])
  })

  it('chorus 缺失时回退到 data', () => {
    const ranges = normalizeChorusRanges({
      code: 200,
      data: [{ startTime: 1000, endTime: 2000 }]
    })
    expect(ranges).toEqual([{ startTime: 1000, endTime: 2000 }])
  })

  it('过滤掉非有限、非数字、零长度与倒序区间', () => {
    const ranges = normalizeChorusRanges({
      code: 200,
      chorus: [
        { startTime: 1000, endTime: 2000 },
        { startTime: Number.NaN, endTime: 3000 },
        { startTime: 1000, endTime: Number.POSITIVE_INFINITY },
        { startTime: '1000', endTime: 2000 },
        { startTime: 3000, endTime: 3000 },
        { startTime: 5000, endTime: 4000 },
        null,
        'not-an-object'
      ] as unknown as { startTime: number; endTime: number }[]
    })
    expect(ranges).toEqual([{ startTime: 1000, endTime: 2000 }])
  })

  it('空输入 / 畸形输入返回空数组', () => {
    expect(normalizeChorusRanges(null)).toEqual([])
    expect(normalizeChorusRanges(undefined)).toEqual([])
    expect(normalizeChorusRanges({ code: 200 })).toEqual([])
    expect(normalizeChorusRanges({ code: 200, chorus: [] })).toEqual([])
    expect(normalizeChorusRanges({ code: 200, chorus: 'oops' })).toEqual([])
  })
})
