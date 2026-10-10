import { describe, expect, it } from 'vitest'
import {
  countGraphemes,
  graphemeOffsets,
  isWhitespaceOnly,
  segmentGraphemes,
  snapToGraphemeBoundary
} from './graphemes'

/** 多码点字素样例（每个都在 UTF-16 里占多个码元） */
const THUMB = '👍🏽' // 基础 emoji + 肤色修饰符
const FLAG = '🇨🇳' // 两个 regional indicator
const ZWJ = '👨‍👩‍👧' // ZWJ 序列
const COMBINING = 'é' // e + 组合尖音符

describe('segmentGraphemes', () => {
  it('多码点字素不被切碎（emoji / 肤色修饰符 / 旗帜 / ZWJ / 组合字符）', () => {
    expect(segmentGraphemes(`a${THUMB}b`).map((g) => g.text)).toEqual(['a', THUMB, 'b'])
    expect(segmentGraphemes(FLAG).map((g) => g.text)).toEqual([FLAG])
    expect(segmentGraphemes(ZWJ).map((g) => g.text)).toEqual([ZWJ])
    expect(segmentGraphemes(COMBINING).map((g) => g.text)).toEqual([COMBINING])
  })

  it('字素数确实少于 UTF-16 码元数（证明不是按 length 切的）', () => {
    const text = `${THUMB}${FLAG}`
    expect(text.length).toBe(8)
    expect(segmentGraphemes(text)).toHaveLength(2)
  })

  it('内容与 Intl.Segmenter(granularity: grapheme) 一致，且可无损拼回', () => {
    const text = `你好a${THUMB}${ZWJ}${COMBINING} ${FLAG}！`
    const reference = [
      ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)
    ].map((part) => part.segment)
    expect(segmentGraphemes(text).map((g) => g.text)).toEqual(reference)
    expect(
      segmentGraphemes(text)
        .map((g) => g.text)
        .join('')
    ).toBe(text)
  })

  it('index 是原文本里的 UTF-16 偏移（可用 slice 取回该字素）', () => {
    const text = `a${THUMB}b${FLAG}`
    for (const grapheme of segmentGraphemes(text)) {
      expect(text.slice(grapheme.index, grapheme.index + grapheme.text.length)).toBe(grapheme.text)
    }
  })

  it('空串返回空数组', () => {
    expect(segmentGraphemes('')).toEqual([])
  })
})

describe('graphemeOffsets', () => {
  it('升序、以 0 开头、以 text.length 结尾，数量 = 字素数 + 1，且无重复', () => {
    for (const text of ['', 'a', '你好', `a${THUMB}b${FLAG}`]) {
      const offsets = graphemeOffsets(text)
      expect(offsets).toHaveLength(segmentGraphemes(text).length + 1)
      expect(offsets[0]).toBe(0)
      expect(offsets[offsets.length - 1]).toBe(text.length)
      expect([...offsets].sort((a, b) => a - b)).toEqual(offsets)
      expect(new Set(offsets).size).toBe(offsets.length)
    }
  })

  it('多码点字素只贡献首尾两个边界', () => {
    expect(graphemeOffsets(`a${THUMB}b${FLAG}`)).toEqual([0, 1, 5, 6, 10])
  })
})

describe('snapToGraphemeBoundary', () => {
  const text = `a${THUMB}b` // 偏移表 [0, 1, 5, 6]
  const offsets = graphemeOffsets(text)

  it('吸附到不超过它的最大字素边界（不切进字素内部）', () => {
    expect(snapToGraphemeBoundary(offsets, 0)).toBe(0)
    expect(snapToGraphemeBoundary(offsets, 1)).toBe(1)
    expect(snapToGraphemeBoundary(offsets, 3)).toBe(1) // 落在 👍🏽 内部
    expect(snapToGraphemeBoundary(offsets, 4)).toBe(1)
    expect(snapToGraphemeBoundary(offsets, 5)).toBe(5)
    expect(snapToGraphemeBoundary(offsets, 6)).toBe(6)
  })

  it('越界与非有限值被钳制到首/末边界', () => {
    expect(snapToGraphemeBoundary(offsets, -10)).toBe(0)
    expect(snapToGraphemeBoundary(offsets, 999)).toBe(6)
    expect(snapToGraphemeBoundary(offsets, Number.NaN)).toBe(0)
  })

  it('返回值恒为字素边界', () => {
    for (let index = -2; index <= text.length + 2; index++) {
      expect(offsets).toContain(snapToGraphemeBoundary(offsets, index))
    }
  })
})

describe('countGraphemes', () => {
  it('按字素计数', () => {
    expect(countGraphemes(`a${THUMB}b`)).toBe(3)
    expect(countGraphemes('你好，世界')).toBe(5)
    expect(countGraphemes('')).toBe(0)
  })

  it('ignoreWhitespace 跳过纯空白字素', () => {
    expect(countGraphemes(' a b ')).toBe(5)
    expect(countGraphemes(' a b ', { ignoreWhitespace: true })).toBe(2)
    expect(countGraphemes('你好  世界', { ignoreWhitespace: true })).toBe(4)
    expect(countGraphemes('   ', { ignoreWhitespace: true })).toBe(0)
  })
})

describe('isWhitespaceOnly', () => {
  it('识别半角/全角空白与换行制表符', () => {
    expect(isWhitespaceOnly(' ')).toBe(true)
    expect(isWhitespaceOnly('　')).toBe(true)
    expect(isWhitespaceOnly('\n\t')).toBe(true)
  })

  it('空串与含可见字符的串都返回 false', () => {
    expect(isWhitespaceOnly('')).toBe(false)
    expect(isWhitespaceOnly('a')).toBe(false)
    expect(isWhitespaceOnly(' a')).toBe(false)
  })
})
