import { describe, expect, it } from 'vitest'

import {
  PRIMARY_TRACK_FONT_WEIGHT_FALLBACK,
  SECONDARY_TRACK_FONT_WEIGHT_FALLBACK,
  SECONDARY_TRACK_GAP_EM,
  SECONDARY_TRACK_OPACITY,
  SECONDARY_TRACK_SIZE_FACTOR,
  UPCOMING_PREVIEW_LIMIT,
  buildSubtitleGlowGradient,
  buildSubtitleTextShadow,
  hasReadableText,
  resolveSubtitleClampSize,
  resolveSubtitleFontSizes,
  resolveSubtitleTracks,
  resolveUpcomingPreview,
  scaleSubtitleFontSize
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

  it('首行字重兜底 500（与次级轨道的 400 拉开一档）', () => {
    expect(PRIMARY_TRACK_FONT_WEIGHT_FALLBACK).toBe(500)
  })
})

describe('下一句预览', () => {
  it('最多取两行（上游 nextLines 取 2）', () => {
    expect(UPCOMING_PREVIEW_LIMIT).toBe(2)
    const lines = [{ text: 'a' }, { text: 'b' }, { text: 'c' }]
    expect(resolveUpcomingPreview(lines)).toEqual(['a', 'b'])
  })

  it('同样过可读性门槛：占位行被跳过而不是占掉名额', () => {
    const lines = [{ text: '//' }, { text: '●●●' }, { text: '第一句' }, { text: '第二句' }]
    expect(resolveUpcomingPreview(lines)).toEqual(['第一句', '第二句'])
  })

  it('空行 / null / undefined 都跳过，不抛', () => {
    expect(resolveUpcomingPreview([null, undefined, { text: '' }, { text: '有字' }])).toEqual([
      '有字'
    ])
  })

  it('limit 非法（0 / 负数 / NaN）时返回空数组，不做兜底成"显示一行"', () => {
    const lines = [{ text: 'a' }]
    expect(resolveUpcomingPreview(lines, 0)).toEqual([])
    expect(resolveUpcomingPreview(lines, -3)).toEqual([])
    expect(resolveUpcomingPreview(lines, Number.NaN)).toEqual([])
  })

  it('候选不足时给多少算多少（不补空档）', () => {
    expect(resolveUpcomingPreview([{ text: '只有一句' }])).toEqual(['只有一句'])
    expect(resolveUpcomingPreview([])).toEqual([])
  })
})

describe('辉光底与文字阴影', () => {
  /** 假的 withAlpha：只为断言形状，不引入真实颜色解析 */
  const withAlpha = (color: string, alpha: number) => `rgba(${color},${alpha})`

  it('辉光底三档：中心 0.96 / 62% 处 0.78 / 边缘透明', () => {
    expect(buildSubtitleGlowGradient('#09090b', withAlpha)).toBe(
      'radial-gradient(ellipse 115% 130% at center, ' +
        'rgba(#09090b,0.96) 0%, rgba(#09090b,0.78) 62%, transparent 100%)'
    )
  })

  it('文字阴影是 0 1px 2px 的底色 24%', () => {
    expect(buildSubtitleTextShadow('#f5f5f4', withAlpha)).toBe('0 1px 2px rgba(#f5f5f4,0.24)')
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

  it('三个锚点都由同一个拼装函数产出（浮名的另一套锚点复用它，数值不共用）', () => {
    // 浮名的锚点与流光不同，但"三项都乘倍率"这条规则必须同源
    expect(resolveSubtitleClampSize(1.05, 2.2, 1.2)).toBe('clamp(1.050rem, 2.200vw, 1.200rem)')
  })
})

describe('次级轨道字号缩放', () => {
  it('三项各自乘系数、单位与格式保持（对齐上游 scaleFontSize 的正则替换）', () => {
    expect(scaleSubtitleFontSize('clamp(1.125rem, 2.600vw, 1.250rem)', 0.88)).toBe(
      'clamp(0.990rem, 2.288vw, 1.100rem)'
    )
  })

  it('倍率为 1 时是恒等变换（不会顺手改格式）', () => {
    const size = 'clamp(1.050rem, 2.200vw, 1.200rem)'
    expect(scaleSubtitleFontSize(size, 1)).toBe(size)
  })

  it('非法 / 非正倍率退回 1（绝不生成 0rem 或 NaN）', () => {
    const size = 'clamp(1.050rem, 2.200vw, 1.200rem)'
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(scaleSubtitleFontSize(size, bad)).toBe(size)
    }
  })
})
