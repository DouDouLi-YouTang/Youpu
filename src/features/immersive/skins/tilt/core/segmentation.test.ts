import { describe, expect, it } from 'vitest'
import { countGraphemes, graphemeOffsets, isWhitespaceOnly } from '../../shared/graphemes'
import { splitIntoSentences } from './segmentation'

/** 贴近真实歌词的语料：中英混排、括号引号、省略号、emoji、多空格、首尾空白 */
const CORPUS = [
  '我爱你，可是你爱他',
  'Hello world, how are you today',
  '当时明月在，曾照彩云归。',
  '他说「我们走吧」然后就走了',
  '（副歌）你是我最爱的（没有之一）',
  '不想再想你了……真的',
  'I love you 😍 so much ❤️',
  '你好啊 我的朋友 好久不见',
  '君の名は (Your Name)',
  '啦啦啦，啦啦啦，啦啦啦啦啦',
  'A-B-C 测试 hyphens',
  '余晖下的告白 (Live 版)',
  '｛测试全角括号｝与【方头括号】',
  'one two three four five six seven eight',
  '  前导空白的行  '
]

const SEEDS = [0, 1, 42, 987654321]
const TARGETS = [1, 2, 3, 4, 5, 6, 8]

/** 断言文本里没有「半个 emoji」：段首不能是低位代理项、段尾不能是高位代理项 */
function expectNoBrokenSurrogate(segment: string): void {
  const first = segment.charCodeAt(0)
  const last = segment.charCodeAt(segment.length - 1)
  expect(first >= 0xdc00 && first <= 0xdfff).toBe(false)
  expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
}

describe('splitIntoSentences 不变量', () => {
  it('拼回去必须等于原文（任何语料 / 段数 / 种子）', () => {
    for (const text of CORPUS) {
      for (const target of TARGETS) {
        for (const seed of SEEDS) {
          expect(splitIntoSentences(text, target, seed).join('')).toBe(text)
        }
      }
    }
  })

  it('段数恒等于 min(目标, 字素数)', () => {
    for (const text of CORPUS) {
      const graphemeCount = countGraphemes(text)
      for (const target of TARGETS) {
        for (const seed of SEEDS) {
          expect(splitIntoSentences(text, target, seed)).toHaveLength(
            Math.min(target, graphemeCount)
          )
        }
      }
    }
  })

  it('每段都非空', () => {
    for (const text of CORPUS) {
      for (const target of TARGETS) {
        for (const segment of splitIntoSentences(text, target, 3)) {
          expect(segment.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('实际会用到的段数（1–4）下不出现纯空白段', () => {
    for (const text of CORPUS) {
      for (const target of [1, 2, 3, 4]) {
        for (const segment of splitIntoSentences(text, target, 3)) {
          expect(isWhitespaceOnly(segment)).toBe(false)
        }
      }
    }
  })

  it('每个切点都落在字素边界上（emoji 不被切碎）', () => {
    for (const text of CORPUS) {
      const offsets = new Set(graphemeOffsets(text))
      for (const target of TARGETS) {
        let cumulative = 0
        for (const segment of splitIntoSentences(text, target, 7)) {
          expectNoBrokenSurrogate(segment)
          cumulative += segment.length
          expect(offsets.has(cumulative)).toBe(true)
        }
        expect(cumulative).toBe(text.length)
      }
    }
  })

  it('同一 (text, target, seed) 结果完全一致（可复现）', () => {
    for (const text of CORPUS) {
      for (const target of TARGETS) {
        const first = splitIntoSentences(text, target, 555)
        const second = splitIntoSentences(text, target, 555)
        expect(second).toEqual(first)
      }
    }
  })

  it('不同种子只影响切点位置，不影响字符完整性', () => {
    const text = '啦啦啦，啦啦啦，啦啦啦啦啦'
    const results = SEEDS.map((seed) => splitIntoSentences(text, 4, seed))
    for (const segments of results) {
      expect(segments.join('')).toBe(text)
      expect(segments).toHaveLength(4)
    }
  })
})

describe('splitIntoSentences 各级切分行为（笔记 §2.2）', () => {
  it('级别 1：优先在标点后切，标点归属前段', () => {
    expect(splitIntoSentences('我爱你，可是你爱他', 2, 0)).toEqual(['我爱你，', '可是你爱他'])
  })

  it('级别 1：连续标点当作一个标点单位（「……」不被一分为二）', () => {
    expect(splitIntoSentences('不想再想你了……真的', 2, 0)).toEqual(['不想再想你了……', '真的'])
  })

  it('级别 1：标点后随的空格归后段（笔记原文）', () => {
    expect(splitIntoSentences('我爱你。 可是你爱他', 2, 0)).toEqual(['我爱你。', ' 可是你爱他'])
  })

  it('级别 2：在成对括号外侧切（括号内容自成一段）', () => {
    expect(splitIntoSentences('他说「我们走吧」然后就走了', 3, 0)).toEqual([
      '他说',
      '「我们走吧」',
      '然后就走了'
    ])
  })

  it('级别 3：西文词边界切，空白归前段', () => {
    expect(splitIntoSentences('Hello world', 2, 0)).toEqual(['Hello ', 'world'])
  })

  it('级别 4：中文空格处切，空白归前段', () => {
    expect(splitIntoSentences('你好 世界', 2, 0)).toEqual(['你好 ', '世界'])
  })

  it('级别 5 / 二次切分：无标点无空格的长行也能切够，且切在字素边界', () => {
    const segments = splitIntoSentences('一二三四五六', 3, 0)
    expect(segments).toHaveLength(3)
    expect(segments.join('')).toBe('一二三四五六')
    for (const segment of segments) expect(segment.length).toBeGreaterThan(0)
  })

  it('标点过多（超过目标）时合并相邻段到目标', () => {
    const text = '一，二，三，四，五'
    const segments = splitIntoSentences(text, 2, 0)
    expect(segments).toHaveLength(2)
    expect(segments.join('')).toBe(text)
  })
})

describe('splitIntoSentences 退化输入', () => {
  it('空串返回空数组', () => {
    expect(splitIntoSentences('', 3, 5)).toEqual([])
  })

  it('目标 <= 1 直接返回原文一段', () => {
    expect(splitIntoSentences('你好吗', 1, 5)).toEqual(['你好吗'])
    expect(splitIntoSentences('你好吗', 0, 5)).toEqual(['你好吗'])
    expect(splitIntoSentences('你好吗', -3, 5)).toEqual(['你好吗'])
    expect(splitIntoSentences('你好吗', Number.NaN, 5)).toEqual(['你好吗'])
  })

  it('目标大于字素数时回退为「一段一个字素」', () => {
    expect(splitIntoSentences('你好', 5, 0)).toEqual(['你', '好'])
  })

  it('小数目标向下取整', () => {
    expect(splitIntoSentences('你好世界啊', 2.9, 0)).toHaveLength(2)
  })

  it('纯空白文本不抛异常，且不丢字符', () => {
    const text = '   '
    const segments = splitIntoSentences(text, 2, 0)
    expect(segments.join('')).toBe(text)
    expect(segments.every((segment) => segment.length > 0)).toBe(true)
  })

  it('单字素文本无论目标多少都只有一段', () => {
    expect(splitIntoSentences('啊', 4, 0)).toEqual(['啊'])
  })
})
