import { describe, expect, it } from 'vitest'

import {
  SECONDARY_TRACK_FONT_WEIGHT_FALLBACK,
  SECONDARY_TRACK_GAP_EM,
  SECONDARY_TRACK_OPACITY,
  SECONDARY_TRACK_SIZE_FACTOR,
  hasReadableText,
  resolveSubtitleFontSizes,
  resolveSubtitleTracks
} from './subtitle-tracks'

/**
 * 副字幕轨道解析。它决定底栏显示哪几行 —— 写错的表现是"底栏冒出一行 `//`"
 * 或"罗马音与译文重复两遍"，都属于必须在截图对比里被排除的瑕疵。
 */

describe('可读性门槛', () => {
  it('正常歌词（中文 / 日文 / 英文 / 数字）都算可读', () => {
    for (const text of ['夜に駆ける', '你好世界', 'hello', '12345', 'let it be', 'あ、']) {
      expect(hasReadableText(text)).toBe(true)
    }
  })

  it('纯符号占位行读不出来（Folia 用它滤掉间奏 / 制作人员栏的残留）', () => {
    for (const text of ['//', '●●●', '———', '///', '。。。', '· · ·', '♪♪♪']) {
      expect(hasReadableText(text)).toBe(false)
    }
  })

  it('空串 / 空白 / null / undefined 都读不出来', () => {
    for (const text of ['', '   ', '\t', null, undefined]) {
      expect(hasReadableText(text)).toBe(false)
    }
  })

  it('符号里只要夹一个字母就算可读（门槛是"至少一个"，不是"全是"）', () => {
    expect(hasReadableText('♪♪na♪♪')).toBe(true)
  })
})

describe('轨道解析', () => {
  const line = { romaji: 'yoru ni kakeru', translation: '奔向夜晚' }

  it('none 档不返回任何轨道', () => {
    expect(resolveSubtitleTracks(line, 'none')).toEqual([])
  })

  it('单轨档只返回对应那一条', () => {
    expect(resolveSubtitleTracks(line, 'translation')).toEqual([
      { role: 'translation', text: '奔向夜晚' }
    ])
    expect(resolveSubtitleTracks(line, 'romanization')).toEqual([
      { role: 'romanization', text: 'yoru ni kakeru' }
    ])
  })

  it('both 档罗马音在前、译文在后', () => {
    expect(resolveSubtitleTracks(line, 'both')).toEqual([
      { role: 'romanization', text: 'yoru ni kakeru' },
      { role: 'translation', text: '奔向夜晚' }
    ])
  })

  it('缺一档时不补空行（只返回存在的那一条）', () => {
    expect(resolveSubtitleTracks({ translation: '奔向夜晚' }, 'both')).toEqual([
      { role: 'translation', text: '奔向夜晚' }
    ])
    expect(resolveSubtitleTracks({ romaji: 'yoru' }, 'both')).toEqual([
      { role: 'romanization', text: 'yoru' }
    ])
  })

  it('两档填同一串时只保留一条（否则底栏会重复两遍）', () => {
    const same = { romaji: 'let it be', translation: 'let it be' }
    expect(resolveSubtitleTracks(same, 'both')).toEqual([
      { role: 'romanization', text: 'let it be' }
    ])
  })

  it('占位行被门槛挡掉（`//` 不进轨道）', () => {
    expect(resolveSubtitleTracks({ translation: '//', romaji: '●●●' }, 'both')).toEqual([])
    expect(resolveSubtitleTracks({ translation: '真实译文', romaji: '//' }, 'both')).toEqual([
      { role: 'translation', text: '真实译文' }
    ])
  })

  it('文本两端空白被 trim（对齐后的译文常带缩进）', () => {
    expect(resolveSubtitleTracks({ translation: '  奔向夜晚  ' }, 'translation')).toEqual([
      { role: 'translation', text: '奔向夜晚' }
    ])
  })

  it('只有空白按"没有这一档"处理', () => {
    expect(resolveSubtitleTracks({ translation: '   ' }, 'translation')).toEqual([])
  })

  it('行本身是 null / undefined 时返回空数组（不抛）', () => {
    expect(resolveSubtitleTracks(null, 'both')).toEqual([])
    expect(resolveSubtitleTracks(undefined, 'both')).toEqual([])
  })
})

describe('次级轨道降档常数', () => {
  it('小 12% / 不透明度 0.82 / 字重兜底 400 / 间距 0.25em', () => {
    expect(SECONDARY_TRACK_SIZE_FACTOR).toBe(0.88)
    expect(SECONDARY_TRACK_OPACITY).toBe(0.82)
    expect(SECONDARY_TRACK_FONT_WEIGHT_FALLBACK).toBe(400)
    expect(SECONDARY_TRACK_GAP_EM).toBe(0.25)
  })
})

describe('副字幕字号 clamp', () => {
  it('scale = 1 时给出上游原始三锚点', () => {
    expect(resolveSubtitleFontSizes()).toEqual({
      translation: 'clamp(1.125rem, 2.600vw, 1.250rem)',
      upcoming: 'clamp(0.875rem, 2.000vw, 1.000rem)'
    })
  })

  it('三个锚点**都**乘倍率（只乘中间项是常见错误，会让缩放在触界时失效）', () => {
    const scaled = resolveSubtitleFontSizes(2)
    expect(scaled.translation).toBe('clamp(2.250rem, 5.200vw, 2.500rem)')
    expect(scaled.upcoming).toBe('clamp(1.750rem, 4.000vw, 2.000rem)')
  })

  it('非法 / 非正倍率退回 1（绝不生成 0rem 或 NaN）', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveSubtitleFontSizes(bad)).toEqual(resolveSubtitleFontSizes(1))
    }
  })
})
