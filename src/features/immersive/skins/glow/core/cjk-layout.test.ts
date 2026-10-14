import { describe, expect, it } from 'vitest'

import { buildDisplayWords, type TimedWord } from './cjk-layout'

/**
 * 「流光」显示词切分。这一层决定"哪些字会被当成一个词一起位移 / 旋转"，
 * 切错的表现是标点自己飞出去、或缩写被甩成三份 —— 都是只有肉眼才看得见的错误，
 * 所以每条规则都在这里钉死。
 */

/** 把整行按单字切成带时间的词（模拟 YRC 逐字歌词） */
function perChar(text: string, startMs = 0, stepMs = 100): TimedWord[] {
  const words: TimedWord[] = []
  let index = 0
  for (const char of text) {
    words.push({
      text: char,
      startTime: startMs + index * stepMs,
      endTime: startMs + (index + 1) * stepMs
    })
    index += 1
  }
  return words
}

/** 按给定词表构造（时间均匀分配，只为断言分组结果） */
function words(texts: string[]): TimedWord[] {
  return texts.map((text, index) => ({ text, startTime: index * 100, endTime: (index + 1) * 100 }))
}

describe('空与退化输入', () => {
  it('没有词时返回空数组', () => {
    expect(buildDisplayWords('', [])).toEqual([])
  })

  it('词拼起来与整行不一致时原样返回（不猜）', () => {
    // 上游数据异常：words 拼不出 lineText。任何分组都可能让时间戳错位，必须原样退回。
    const input = words(['你', '好'])
    expect(buildDisplayWords('完全不同的文本', input)).toEqual([
      { text: '你', startTime: 0, endTime: 100 },
      { text: '好', startTime: 100, endTime: 200 }
    ])
  })
})

describe('CJK 语义合并', () => {
  it('语义单元**返回原始词**，逐字时间戳完整保留', () => {
    // ⚠️ 这是本层最容易误解的一条，别"顺手改成合并"：
    // 「世界的尽头」在 Segmenter 眼里是「世界 / 的 / 尽头」三个词，但流光的显示词
    // **仍然是逐字的** —— 每个汉字各自带自己的时间戳，各自参与位移 / 旋转 / 缩放。
    // 这正是 Folia `buildDisplayWordsFromLayoutUnits` 里
    // `if (!unit.isSticky || unit.isSemantic) return unit.words` 的含义：
    // 语义分组只用于**布局规划**，不用于**渲染粒度**。
    // 若在这里合并成「世界」，逐字动画会退化成"两个字一起亮"。
    const result = buildDisplayWords('世界的尽头', perChar('世界的尽头'))
    expect(result.map((word) => word.text)).toEqual(['世', '界', '的', '尽', '头'])
    // 时间戳逐字递增，没有被合并吞掉
    expect(result.map((word) => word.startTime)).toEqual([0, 100, 200, 300, 400])
  })

  it('CJK 行里的句号仍是一个独立显示词（因为前面的单元是语义单元）', () => {
    // 「你好」是两个原始词拼成的 CJK 语义单元，标点粘上去后单元**仍然是语义单元**，
    // 于是返回原始词 —— 句号跟着变成独立的一个显示词。这是 Folia 的实际行为，别改。
    const result = buildDisplayWords('你好。', perChar('你好。'))
    expect(result.map((word) => word.text)).toEqual(['你', '好', '。'])
  })

  it('单字单元 + 标点会合并成一个显示词（前一个单元非语义时）', () => {
    // 与上一条方向相反，差别在**前一个单元是不是语义单元**：
    // 「あ」是单个原始词 → 不是语义单元 → 粘上「、」后成为粘性非语义单元 → 合并成"あ、"。
    // 这两条并存不是漏洞，是 Folia 的原样行为。
    const result = buildDisplayWords('あ、', perChar('あ、'))
    expect(result).toEqual([{ text: 'あ、', startTime: 0, endTime: 200 }])
  })

  it('日文假名与汉字混排：逐字保留、拼回原文', () => {
    const result = buildDisplayWords('零れ落ちそう', perChar('零れ落ちそう'))
    expect(result.map((word) => word.text).join('')).toBe('零れ落ちそう')
    // 日文解析器词也是单字（YRC 逐字），所以全部逐字保留
    expect(result.map((word) => word.text)).toEqual(['零', 'れ', '落', 'ち', 'そ', 'う'])
  })
})

describe('粘性标点（非 CJK）', () => {
  it('英文缩写 It + ’ + s 合成一个词', () => {
    // 不合并的话 ’ 和 s 会被各自甩出去
    const result = buildDisplayWords('It’s', words(['It', '’', 's']))
    expect(result).toEqual([{ text: 'It’s', startTime: 0, endTime: 300 }])
  })

  it("直连缩写 's 粘到前一个词", () => {
    const result = buildDisplayWords("she's", words(['she', "'s"]))
    expect(result).toEqual([{ text: "she's", startTime: 0, endTime: 200 }])
  })

  it('尾随标点粘到前一个词（英文）', () => {
    const result = buildDisplayWords('hello,', words(['hello', ',']))
    expect(result).toEqual([{ text: 'hello,', startTime: 0, endTime: 200 }])
  })

  it('无 CJK 的整行不跑语义分组，空格保持独立单元', () => {
    // 纯英文行不满足「含 CJK」这道门，直接退回一词一单元 —— 连粘性标点也不做。
    // 这是有意的：非 CJK 的解析器词本来就分好了，再动一次只会引入不一致。
    const result = buildDisplayWords('hello world', words(['hello', ' ', 'world']))
    expect(result.map((word) => word.text)).toEqual(['hello', ' ', 'world'])
  })

  it('含 CJK 的混排行仍会走粘性标点（英文缩写在该行内也合并）', () => {
    // 整行含 CJK 时分组器会跑，于是同一行里的英文缩写也一并被合并
    const result = buildDisplayWords('歌It’s', words(['歌', 'It', '’', 's']))
    expect(result.map((word) => word.text)).toContain('It’s')
  })
})

describe('时间戳完整性', () => {
  it('无论怎么分组，输出词拼起来恒等于整行、且时间单调不减', () => {
    const samples = [
      '世界的尽头',
      '你好。',
      'It’s unbelievable',
      '零れ落ちそうな星も',
      'あ、い、う。'
    ]
    for (const text of samples) {
      const result = buildDisplayWords(text, perChar(text))
      expect(result.map((word) => word.text).join('')).toBe(text)
      for (let i = 1; i < result.length; i++) {
        expect(result[i].startTime).toBeGreaterThanOrEqual(result[i - 1].startTime)
      }
    }
  })
})
