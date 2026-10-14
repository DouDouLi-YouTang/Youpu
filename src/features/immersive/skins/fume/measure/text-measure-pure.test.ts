/**
 * 文本测量纯函数层单测（规格书 §4.2–§4.6、§4.9）。
 *
 * 这一层最容易错的是**差一位**：光标换算少一个 clamp、字素偏移多算一个字、
 * 片段下标从行首而不是块首起算 —— 这些错误在视觉上都是「渐进错位」，
 * 单看一帧看不出问题，只有把边界值写出来才能钉住。
 *
 * 假数据故意用「每字素 10px」的等宽口径：期望值可以直接手算，
 * 而不是把实现里的公式再抄一遍（抄公式的断言等于没测）。
 */

import { describe, expect, it } from 'vitest'

import {
  buildGlyphOffsets,
  buildRenderSegments,
  buildSegmentMetas,
  buildWordRangeIndexByOffset,
  countRenderableGraphemes,
  cursorToGlobalOffset,
  resolveGlyphAdvance,
  resolveRenderLineOffset,
  resolveSegmentGlyphAdvance,
  resolveSegmentGlyphOffset,
  widthBetweenOffsets,
  type FumePreparedLike
} from './text-measure-pure'
import type { FumeWordRange } from '../core/fume-types'

/**
 * 造一个「等宽」prepared：`segments[i]` 每字素 10px。
 *
 * `breakable` 为 false 的段没有 `breakableFitAdvances`（模拟不可断行的整串西文词），
 * 用来覆盖 §4.4 的第 3 条「按字素比例摊」分支。
 */
function makePrepared(segments: string[], options: { breakable?: boolean } = {}): FumePreparedLike {
  const breakable = options.breakable ?? true
  return {
    segments,
    widths: segments.map((segment) => [...segment].length * 10),
    breakableFitAdvances: segments.map((segment) => {
      if (!breakable) return null
      // 逐字素推进量与段宽同源（等宽假字体）
      const count = [...segment].length
      return new Array<number>(count).fill(10)
    })
  }
}

describe('buildSegmentMetas（§4.2）', () => {
  it('按段累计字素区间，并把所有段拼成整块字素', () => {
    const { graphemes, segmentMetas } = buildSegmentMetas(makePrepared(['你好', 'ab']))

    expect(graphemes).toEqual(['你', '好', 'a', 'b'])
    expect(segmentMetas).toEqual([
      { graphemeStart: 0, graphemeEnd: 2, graphemeCount: 2 },
      { graphemeStart: 2, graphemeEnd: 4, graphemeCount: 2 }
    ])
  })

  it('空段不产生字素，但区间仍然是合法的零宽区间', () => {
    const { graphemes, segmentMetas } = buildSegmentMetas(makePrepared(['', '你']))

    expect(graphemes).toEqual(['你'])
    expect(segmentMetas).toEqual([
      { graphemeStart: 0, graphemeEnd: 0, graphemeCount: 0 },
      { graphemeStart: 0, graphemeEnd: 1, graphemeCount: 1 }
    ])
  })

  it('按**字素**数而不是 UTF-16 长度计数（emoji / 组合字符不能被拆开）', () => {
    const { graphemes, segmentMetas } = buildSegmentMetas(makePrepared(['👨‍👩‍👧é']))

    expect(graphemes).toEqual(['👨‍👩‍👧', 'é'])
    expect(segmentMetas[0]).toEqual({ graphemeStart: 0, graphemeEnd: 2, graphemeCount: 2 })
  })
})

describe('cursorToGlobalOffset（§4.3）', () => {
  const { segmentMetas } = buildSegmentMetas(makePrepared(['你好', 'ab']))

  it('段内游标换算成整块下标', () => {
    expect(cursorToGlobalOffset({ segmentIndex: 0, graphemeIndex: 1 }, segmentMetas)).toBe(1)
    expect(cursorToGlobalOffset({ segmentIndex: 1, graphemeIndex: 1 }, segmentMetas)).toBe(3)
  })

  it('段内游标越界会被钳到该段区间内', () => {
    expect(cursorToGlobalOffset({ segmentIndex: 0, graphemeIndex: 99 }, segmentMetas)).toBe(2)
    expect(cursorToGlobalOffset({ segmentIndex: 0, graphemeIndex: -3 }, segmentMetas)).toBe(0)
  })

  it('段下标越界退化成**最后一段的末尾**（不是 0）', () => {
    expect(cursorToGlobalOffset({ segmentIndex: 9, graphemeIndex: 0 }, segmentMetas)).toBe(4)
  })

  it('空段表返回 0', () => {
    expect(cursorToGlobalOffset({ segmentIndex: 0, graphemeIndex: 0 }, [])).toBe(0)
  })
})

describe('widthBetweenOffsets（§4.4）', () => {
  const prepared = makePrepared(['你好', 'ab'])
  const { segmentMetas } = buildSegmentMetas(prepared)

  it('整段被覆盖时直接用段宽', () => {
    expect(widthBetweenOffsets(prepared, segmentMetas, 0, 2)).toBe(20)
  })

  it('区间跨段时逐段相加', () => {
    expect(widthBetweenOffsets(prepared, segmentMetas, 1, 3)).toBe(10 + 10)
  })

  it('零宽 / 反向区间直接返回 0', () => {
    expect(widthBetweenOffsets(prepared, segmentMetas, 2, 2)).toBe(0)
    expect(widthBetweenOffsets(prepared, segmentMetas, 3, 1)).toBe(0)
  })

  it('段内推进量可用时按 advance 累加（不是按宽度比例）', () => {
    // 段宽 20、两个字素，advance 分别给 3 / 17 —— 只取第二个字素应得 17
    const uneven: FumePreparedLike = {
      segments: ['你好'],
      widths: [20],
      breakableFitAdvances: [[3, 17]]
    }
    const metas = buildSegmentMetas(uneven).segmentMetas

    expect(widthBetweenOffsets(uneven, metas, 1, 2)).toBe(17)
  })

  it('不可断行段（advance 为 null）按字素比例摊宽度', () => {
    const unbreakable = makePrepared(['abcd'], { breakable: false })
    const metas = buildSegmentMetas(unbreakable).segmentMetas

    // 段宽 40、4 个字素 → 2 个字素 = 20
    expect(widthBetweenOffsets(unbreakable, metas, 0, 2)).toBe(20)
  })
})

describe('buildGlyphOffsets / resolveGlyphAdvance（§4.5）', () => {
  const prepared = makePrepared(['你好', 'ab'])
  const { segmentMetas } = buildSegmentMetas(prepared)

  it('offsets[i] 是「行首到第 i 个字素」的宽度（不含第 i 个字素）', () => {
    expect(buildGlyphOffsets(prepared, segmentMetas, 1, 3)).toEqual([0, 10, 20])
  })

  it('字数为 0 时返回空数组', () => {
    expect(buildGlyphOffsets(prepared, segmentMetas, 0, 0)).toEqual([])
  })

  it('末字素的推进量用行宽兜底（glyphOffsets 里没有它的右边界）', () => {
    const renderLine = {
      glyphOffsets: [0, 10, 20],
      graphemes: ['你', '好', 'a'],
      width: 33
    }

    expect(resolveGlyphAdvance(renderLine, 1)).toBe(10)
    expect(resolveGlyphAdvance(renderLine, 2)).toBe(13)
  })

  it('推进量最小为 0（字体回退时可能算出负差值）', () => {
    const renderLine = {
      glyphOffsets: [0, 30, 20],
      graphemes: ['你', '好', 'a'],
      width: 20
    }

    expect(resolveGlyphAdvance(renderLine, 1)).toBe(0)
  })
})

describe('buildRenderSegments（§4.6）', () => {
  const prepared = makePrepared(['你好', 'ab'])
  const { segmentMetas } = buildSegmentMetas(prepared)
  /** 假测量：每字素 10px，末尾补整段宽（与真实现「长度 = 字素数 + 1」同口径） */
  const measure = (text: string): number[] =>
    Array.from({ length: [...text].length + 1 }, (_, index) => index * 10)

  it('整段被行覆盖时直接用原文本，并保留 isFullSegment', () => {
    const segments = buildRenderSegments(prepared, segmentMetas, 0, 2, measure)

    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      text: '你好',
      start: 0,
      end: 2,
      localStart: 0,
      localEnd: 2,
      x: 0,
      width: 20,
      isFullSegment: true
    })
  })

  it('段被行边界切开时按字素切片，localStart 相对**行首**而不是段首', () => {
    const segments = buildRenderSegments(prepared, segmentMetas, 1, 3, measure)

    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ text: '好', start: 1, end: 2, localStart: 0, localEnd: 1 })
    expect(segments[1]).toMatchObject({ text: 'a', start: 2, end: 3, localStart: 1, localEnd: 2 })
  })

  it('行左边缘落在段中间时，片段的 x 从**行首**起算（不是从段首）', () => {
    const segments = buildRenderSegments(prepared, segmentMetas, 1, 4, measure)

    // 行首在「好」上（全局下标 1）：第一个片段 x = 0（它就是行首），
    // 第二个片段 x = 行首到段首（1→2）的宽度 = 10
    expect(segments[0]).toMatchObject({ text: '好', start: 1, x: 0, width: 10 })
    expect(segments[1]).toMatchObject({ text: 'ab', start: 2, x: 10, width: 20 })
  })

  it('与行完全不相交的段被跳过（左跳过 / 右 break）', () => {
    expect(buildRenderSegments(prepared, segmentMetas, 0, 1, measure)).toHaveLength(1)
    expect(buildRenderSegments(prepared, segmentMetas, 2, 4, measure)).toHaveLength(1)
  })

  it('空行区间返回空数组', () => {
    expect(buildRenderSegments(prepared, segmentMetas, 2, 2, measure)).toEqual([])
  })

  it('measureGlyphOffsets 是注入的：调用参数是片段文本', () => {
    const seen: string[] = []
    buildRenderSegments(prepared, segmentMetas, 1, 3, (text) => {
      seen.push(text)
      return [0, 10]
    })

    expect(seen).toEqual(['好', 'a'])
  })
})

describe('buildWordRangeIndexByOffset（§4.9）', () => {
  function makeRange(
    start: number,
    end: number,
    colorStart = start,
    colorEnd = end
  ): FumeWordRange {
    return {
      wordIndex: 0,
      word: { text: 'x', startTimeMs: 0, endTimeMs: 0 },
      start,
      end,
      colorStart,
      colorEnd,
      graphemeTimings: []
    }
  }

  it('把字素下标映射到词区间下标，未覆盖处为 -1', () => {
    const index = buildWordRangeIndexByOffset(4, [makeRange(0, 2), makeRange(2, 4)])

    expect(index).toEqual([0, 0, 1, 1])
  })

  it('rangeKind = color 时读 colorStart / colorEnd', () => {
    const ranges = [makeRange(0, 2, 1, 2)]

    expect(buildWordRangeIndexByOffset(3, ranges, 'timing')).toEqual([0, 0, -1])
    expect(buildWordRangeIndexByOffset(3, ranges, 'color')).toEqual([-1, 0, -1])
  })

  it('区间重叠时后写入的区间获胜（与「后一个词吞掉前一个词尾空白」一致）', () => {
    const index = buildWordRangeIndexByOffset(2, [makeRange(0, 2), makeRange(1, 2)])

    expect(index).toEqual([0, 1])
  })

  it('区间越界不会写到字素数组之外', () => {
    const index = buildWordRangeIndexByOffset(1, [makeRange(0, 8)])

    expect(index).toEqual([0])
  })
})

describe('countRenderableGraphemes（§4.9）', () => {
  it('空白不算、标点算', () => {
    expect(countRenderableGraphemes('你 好')).toBe(2)
    expect(countRenderableGraphemes('　')).toBe(0)
    expect(countRenderableGraphemes('。')).toBe(1)
    expect(countRenderableGraphemes('')).toBe(0)
  })

  it('按字素数计数（emoji 算一个）', () => {
    expect(countRenderableGraphemes('👨‍👩‍👧ab')).toBe(3)
  })
})

describe('resolveRenderLineOffset / resolveSegmentGlyphOffset / resolveSegmentGlyphAdvance（§4.9）', () => {
  const renderLine = {
    glyphOffsets: [0, 10, 20],
    graphemes: ['你', '好', 'a'],
    width: 33
  }

  it('行内偏移 <= 0 → 0（行首由 left 承载，不读 glyphOffsets[0]）', () => {
    expect(resolveRenderLineOffset(renderLine, 0)).toBe(0)
    expect(resolveRenderLineOffset(renderLine, -2)).toBe(0)
  })

  it('行内偏移 >= 字素数 → 行宽（末字右边界不在表里）', () => {
    expect(resolveRenderLineOffset(renderLine, 3)).toBe(33)
    expect(resolveRenderLineOffset(renderLine, 99)).toBe(33)
  })

  it('中间偏移查表', () => {
    expect(resolveRenderLineOffset(renderLine, 2)).toBe(20)
  })

  it('片段内偏移把全局下标换算成片段内下标，并钳到两端', () => {
    const segment = { start: 5, measuredGlyphOffsets: [0, 7, 15] }

    expect(resolveSegmentGlyphOffset(segment, 5)).toBe(0)
    expect(resolveSegmentGlyphOffset(segment, 6)).toBe(7)
    expect(resolveSegmentGlyphOffset(segment, 7)).toBe(15)
    expect(resolveSegmentGlyphOffset(segment, 99)).toBe(15)
    expect(resolveSegmentGlyphOffset(segment, 0)).toBe(0)
  })

  it('片段内推进量下标上限是 length - 2（保证 [i+1] 一定存在）', () => {
    const segment = { start: 0, measuredGlyphOffsets: [0, 7, 15] }

    expect(resolveSegmentGlyphAdvance(segment, 0)).toBe(7)
    expect(resolveSegmentGlyphAdvance(segment, 1)).toBe(8)
    // 越界钳到 length-2 = 1 → 取的仍是最后一段真实推进量（8），
    // 而不是「到整段末尾」的 15，也不会因为没有 [i+1] 而突然归零
    expect(resolveSegmentGlyphAdvance(segment, 9)).toBe(8)
  })

  it('片段内推进量在负向越界时钳到片段首', () => {
    const segment = { start: 5, measuredGlyphOffsets: [0, 7, 15] }

    expect(resolveSegmentGlyphAdvance(segment, 0)).toBe(7)
  })

  it('推进量最小为 0', () => {
    const segment = { start: 0, measuredGlyphOffsets: [0, 20, 10] }

    expect(resolveSegmentGlyphAdvance(segment, 1)).toBe(0)
  })
})
