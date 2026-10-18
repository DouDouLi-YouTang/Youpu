import { describe, expect, it } from 'vitest'

import { getContrastRatio, hexToHsl } from './color-math'
import { buildKeywordColors, pickKeywords } from './keyword-colors'

/** 一段「像歌词」的样本：有重复的情绪词、有虚词、有英日混排 */
const LYRICS = [
  '今日見た夕陽も',
  '零れ落ちそうな星も',
  'あなたは何を思ったの',
  '打ちのめされた今日も',
  '零れ落ちそうな星も',
  'the sunset you saw today',
  'hidden in the train',
  'hidden in the rain'
]

describe('pickKeywords', () => {
  it('不会挑出单字（中文单字绝大多数是虚词）', () => {
    const keywords = pickKeywords(['我爱你 的 了 和 在'], 20)
    for (const word of keywords) expect(word.length).toBeGreaterThanOrEqual(2)
  })

  it('不会挑出高频虚词', () => {
    const keywords = pickKeywords(['什么是这样 如果你 那么 因为 所以 但是'], 20)
    for (const stop of ['什么是这样', '如果你', '那么', '因为', '所以', '但是']) {
      expect(keywords).not.toContain(stop)
    }
  })

  it('不会挑出英文虚词', () => {
    const keywords = pickKeywords(['the and you that was for are with'], 20)
    expect(keywords).toHaveLength(0)
  })

  it('同一个词只出现一次（按频次聚合）', () => {
    const keywords = pickKeywords(LYRICS, 20)
    expect(new Set(keywords).size).toBe(keywords.length)
  })

  it('结果对同一输入永远一致（重播不会换一批关键词）', () => {
    expect(pickKeywords(LYRICS, 12)).toEqual(pickKeywords(LYRICS, 12))
  })

  it('频次高的词排在前面', () => {
    // 两个候选词都是 2 字（长度闸门放行），只差频次
    const keywords = pickKeywords(['银河 银河 银河 星空'], 4)
    expect(keywords[0]).toBe('银河')
  })

  it('频次相同时更长的词优先', () => {
    // 两个候选词频次相同（都出现一次），长词该排在前面
    const keywords = pickKeywords(['星尘 银河'], 2)
    expect(keywords[0]).toBe('银河')
  })

  it('候选词来自 Intl.Segmenter 的词边界，而不是滑窗碎片', () => {
    const keywords = pickKeywords([{ text: '零れ落ちそうな星も' }], 10)

    // 滑窗路径的产物（这些碎片只在按固定窗口切分时才会产生）不该出现
    for (const fragment of ['れ落ち', '落ちそ', 'ちそう', 'そうな']) {
      expect(keywords).not.toContain(fragment)
    }
    // 真实词边界才该入选
    expect(keywords).toContain('落ち')
  })

  it('⚠️ 回归：网易云 YRC 那种「逐字符 words」不再让关键词列表变空', () => {
    // 这条用例钉的是 2026-10-15 修掉的真 bug：原先候选词直接取 `line.words`，
    // 而 YRC 的 words 是按字符切的 → 每个候选词都短于 2 字 → 恒为空数组。
    // 现在切分口径收进本模块，与传不传 words 无关。
    const yrcLike = [
      { text: '爱你孤身走暗巷' },
      { text: '爱你不跪的模样' },
      { text: '爱你对峙过绝望' }
    ]
    const keywords = pickKeywords(yrcLike, 12)

    expect(keywords.length).toBeGreaterThan(0)
    // 「爱」是单字，会被 MIN_KEYWORD_LENGTH 挡掉；「孤身」「暗巷」这类真词该留下
    expect(keywords).toContain('孤身')
    expect(keywords).toContain('暗巷')
  })

  it('单字仍然不选（长度闸门对词粒度同样生效）', () => {
    expect(pickKeywords(['我爱你 的 了 和 在'], 20).every((w) => w.length >= 2)).toBe(true)
  })

  it('limit 生效，且 0 / 负数得到空数组', () => {
    expect(pickKeywords(LYRICS, 3)).toHaveLength(3)
    expect(pickKeywords(LYRICS, 0)).toEqual([])
    expect(pickKeywords(LYRICS, -5)).toEqual([])
  })

  it('过长的连续文本不算「词」', () => {
    const long = '一二三四五六七八九十一二三四五六'
    expect(pickKeywords([long], 10)).not.toContain(long)
  })

  it('能从英日混排里同时挑出两种文字的词', () => {
    const keywords = pickKeywords(LYRICS, 20)
    expect(keywords.some((word) => /[\u3040-\u30ff\u4e00-\u9fff]/.test(word))).toBe(true)
    expect(keywords.some((word) => /^[A-Za-z]+$/.test(word))).toBe(true)
  })

  it('空歌词返回空数组', () => {
    expect(pickKeywords([], 10)).toEqual([])
    expect(pickKeywords(['', '   '], 10)).toEqual([])
  })
})

describe('buildKeywordColors', () => {
  const keywords = pickKeywords(LYRICS, 12)

  it('每个关键词都拿到一个合法颜色', () => {
    const entries = buildKeywordColors(keywords, '#ea580c', '#09090b')

    expect(entries).toHaveLength(keywords.length)
    for (const entry of entries) {
      expect(entry.word).toMatch(/\S/)
      expect(entry.color).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('颜色跟着封面强调色走（色相在强调色的 ±45° 内）', () => {
    const accent = '#0ea5e9'
    const accentHue = hexToHsl(accent)!.h
    const entries = buildKeywordColors(keywords, accent, '#09090b')

    for (const entry of entries) {
      const hue = hexToHsl(entry.color)!.h
      const distance = Math.min(Math.abs(hue - accentHue), 360 - Math.abs(hue - accentHue))
      expect(distance).toBeLessThanOrEqual(45.5)
    }
  })

  it('换一个强调色 → 关键词整体换色系', () => {
    const warm = buildKeywordColors(keywords, '#ea580c', '#09090b')
    const cool = buildKeywordColors(keywords, '#0ea5e9', '#09090b')

    expect(warm[0].color).not.toBe(cool[0].color)
  })

  it('同一个词的颜色稳定（不随调用顺序漂移）', () => {
    expect(buildKeywordColors(keywords, '#ea580c', '#09090b')).toEqual(
      buildKeywordColors(keywords, '#ea580c', '#09090b')
    )
  })

  it('不同关键词互不撞色（色相或明度至少有一项不同）', () => {
    const entries = buildKeywordColors(keywords, '#ea580c', '#09090b')
    const colors = entries.map((entry) => entry.color)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('关键词色在深色底上可读（对比度不低于 3）', () => {
    const entries = buildKeywordColors(keywords, '#ea580c', '#09090b')
    for (const entry of entries) {
      expect(getContrastRatio(entry.color, '#09090b')).toBeGreaterThan(3)
    }
  })

  it('关键词色在浅色底上也可读', () => {
    const entries = buildKeywordColors(keywords, '#ea580c', '#f5f5f4')
    for (const entry of entries) {
      expect(getContrastRatio(entry.color, '#f5f5f4')).toBeGreaterThan(3)
    }
  })

  it('单个关键词取色相弧的中点', () => {
    const accent = '#0ea5e9'
    const [entry] = buildKeywordColors(['孤独'], accent, '#09090b')

    expect(hexToHsl(entry.color)!.h).toBeCloseTo(hexToHsl(accent)!.h, 1)
  })

  it('没有关键词 / 强调色不可解析时返回空数组', () => {
    expect(buildKeywordColors([], '#ea580c', '#09090b')).toEqual([])
    expect(buildKeywordColors(['孤独'], 'not-a-color', '#09090b')).toEqual([])
  })

  it('可关闭饱和度下限，让单色方案的关键词不被重新染成彩色', () => {
    const [entry] = buildKeywordColors(['孤独'], '#52525b', '#f4f4f5', {
      minSaturation: 0
    })

    expect(hexToHsl(entry.color)!.s).toBeLessThan(0.2)
  })
})
