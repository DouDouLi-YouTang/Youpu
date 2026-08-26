import { describe, expect, it } from 'vitest'
import { joinJsonLyricSegments, parseJsonLrc } from './parse-json-lrc'

describe('joinJsonLyricSegments', () => {
  it('中文片段不插空格', () => {
    expect(joinJsonLyricSegments([{ tx: '你好' }, { tx: '世界' }])).toBe('你好世界')
  })

  it('英文多段无空格时自动补词间空格', () => {
    expect(joinJsonLyricSegments([{ tx: 'Hello' }, { tx: 'World' }, { tx: 'again' }])).toBe(
      'Hello World again'
    )
  })

  it('已含空格的片段不重复插空', () => {
    expect(
      joinJsonLyricSegments([
        { tx: '作曲: ' },
        { tx: '柳重言' },
        { tx: ' / ' },
        { tx: 'Alex' },
        { tx: 'San' }
      ])
    ).toBe('作曲: 柳重言 / Alex San')
  })
})

describe('parseJsonLrc', () => {
  it('空输入返回空数组', () => {
    expect(parseJsonLrc('')).toEqual([])
  })

  it('解析 JSON 行:t 为 timeMs,c 中 tx 拼接为 text', () => {
    const raw = '{"t":1000,"c":[{"tx":"你好"},{"tx":"世界"}]}'
    expect(parseJsonLrc(raw)).toEqual([{ timeMs: 1000, text: '你好世界' }])
  })

  it('英文/罗马音多段 tx 无空格时自动补词间空格(翻译不粘连)', () => {
    const raw = '{"t":1000,"c":[{"tx":"Hello"},{"tx":"World"},{"tx":"again"}]}'
    expect(parseJsonLrc(raw)).toEqual([{ timeMs: 1000, text: 'Hello World again' }])
  })

  it('JSON 行 text 去空格后为空则跳过', () => {
    const raw = '{"t":2000,"c":[{"tx":""},{"tx":"   "}]}'
    expect(parseJsonLrc(raw)).toEqual([])
  })

  it('非 JSON 行回退标准 LRC 时间戳', () => {
    expect(parseJsonLrc('[00:02.50]回退行')).toEqual([{ timeMs: 2500, text: '回退行' }])
    expect(parseJsonLrc('[01:30.000]一分半')).toEqual([{ timeMs: 90000, text: '一分半' }])
    expect(parseJsonLrc('[00:05:20]冒号分隔')).toEqual([{ timeMs: 5200, text: '冒号分隔' }])
  })

  it('混合 JSON 与 LRC 回退行,合并后按 timeMs 升序', () => {
    const raw = [
      '{"t":1000,"c":[{"tx":"第一行"}]}',
      '[00:03.00]第二行',
      '{"t":2000,"c":[{"tx":""}]}'
    ].join('\n')
    expect(parseJsonLrc(raw)).toEqual([
      { timeMs: 1000, text: '第一行' },
      { timeMs: 3000, text: '第二行' }
    ])
  })

  it('LRC 回退行空文本跳过', () => {
    expect(parseJsonLrc('[00:01.00]   ')).toEqual([])
  })

  it('既非 JSON 也无 LRC 时间戳的行跳过', () => {
    expect(parseJsonLrc('纯文本无时间戳')).toEqual([])
  })

  it('JSON 缺少 t 或 c 字段时不作为 JSON 行(回退 LRC,匹配不上则跳过)', () => {
    expect(parseJsonLrc('{"t":1000}')).toEqual([])
    expect(parseJsonLrc('{"c":[{"tx":"x"}]}')).toEqual([])
  })
})
