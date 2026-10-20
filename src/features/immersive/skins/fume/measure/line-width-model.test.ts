/**
 * 宽度模型的单测（§4.10 的性能修复）。
 *
 * 这里钉住三件事：
 *
 * 1. **剔除规则**：内容宽度和必须剔掉行首可跳过片段与行末会挂出的片段 —— 它是整个
 *    判据的地基，错一位就会让「含行末空格的行」被判成两行；
 * 2. **安全带**：余量落在 ±`SAFETY_BAND` 之内必须返回 `unsure`（不许猜），落在带外
 *    才允许直接下结论；
 * 3. **退化条件**：含 emoji / 多块（硬换行）/ 非简单走线 / 读不到 pretext 内部字段时
 *    一律返回 `null` —— 这些情况下线性缩放的前提不成立，宁可退回逐候选精确测量。
 *
 * 判据与 `layout().lineCount` 的一致性属于**真实 pretext + 真实字体**的性质，
 * 由浏览器侧的等价性验证覆盖（见 `.tmp-audit` 里的基准脚本），不适合放在 node 单测里。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** 假 pretext：返回值由 `spy.nextPrepared` 决定，调用入参留档 */
const spy = vi.hoisted(() => ({
  calls: [] as Array<{ text: string; font: string; options: unknown }>,
  nextPrepared: null as unknown
}))

vi.mock('@chenglou/pretext', () => ({
  prepare: (text: string, font: string, options?: unknown) => {
    spy.calls.push({ text, font, options })
    return spy.nextPrepared
  }
}))

import {
  FUME_WIDTH_MODEL_REFERENCE_FONT_PX,
  FUME_WIDTH_MODEL_SAFETY_BAND_PX,
  clearLineWidthModelCache,
  resolveLineWidthFit,
  resolveLineWidthModel,
  sumLineContentWidth
} from './line-width-model'

/** 造一个「形状正确」的假 pretext 产物 */
function fakePrepared(
  widths: number[],
  kinds: string[],
  overrides: { chunks?: unknown; simpleLineWalkFastPath?: unknown } = {}
): unknown {
  return {
    widths,
    kinds,
    chunks: overrides.chunks ?? [
      { startSegmentIndex: 0, endSegmentIndex: 1, consumedEndSegmentIndex: 1 }
    ],
    simpleLineWalkFastPath: overrides.simpleLineWalkFastPath ?? true
  }
}

describe('sumLineContentWidth（剔除行首 / 行末悬空片段）', () => {
  it('普通文本就是全部宽度之和', () => {
    expect(sumLineContentWidth([10, 20, 30], ['text', 'text', 'text'])).toBe(60)
  })

  it('行末的空白（含 pre-wrap 的 preserved-space）不计入', () => {
    expect(sumLineContentWidth([10, 20, 5, 5], ['text', 'text', 'space', 'space'])).toBe(30)
    expect(sumLineContentWidth([10, 20, 8], ['text', 'text', 'preserved-space'])).toBe(30)
  })

  it('行首的空白也不计入（走线器会跳过它）', () => {
    expect(sumLineContentWidth([5, 10, 20], ['space', 'text', 'text'])).toBe(30)
  })

  it('行中的空白**计入**（它真的占了宽度）', () => {
    expect(sumLineContentWidth([10, 5, 20], ['text', 'space', 'text'])).toBe(35)
  })

  it('全是空白时结果为 0', () => {
    expect(sumLineContentWidth([5, 5], ['space', 'space'])).toBe(0)
  })
})

describe('resolveLineWidthFit（安全带内外）', () => {
  const model = { referenceFontPx: 32, contentWidth: 320 }

  it('缩放是线性的：字号减半则所需宽度减半', () => {
    // 参考字号 32 下宽 320 → 字号 16 下宽 160，块宽 200 有 40px 余量
    expect(resolveLineWidthFit(model, 16, 200)).toBe('fit')
    // 块宽 100 差 60px
    expect(resolveLineWidthFit(model, 16, 100)).toBe('overflow')
  })

  it('余量正好落在安全带边界之外才下结论', () => {
    const width = 160 + FUME_WIDTH_MODEL_SAFETY_BAND_PX + 0.001
    expect(resolveLineWidthFit(model, 16, width)).toBe('fit')
  })

  it('余量落在安全带之内一律 unsure（交给真实测量）', () => {
    expect(resolveLineWidthFit(model, 16, 160)).toBe('unsure')
    expect(resolveLineWidthFit(model, 16, 160 + FUME_WIDTH_MODEL_SAFETY_BAND_PX)).toBe('unsure')
    expect(resolveLineWidthFit(model, 16, 160 - FUME_WIDTH_MODEL_SAFETY_BAND_PX)).toBe('unsure')
    expect(resolveLineWidthFit(model, 16, 160.2)).toBe('unsure')
  })
})

describe('resolveLineWidthModel（适用性与缓存）', () => {
  beforeEach(() => {
    clearLineWidthModelCache()
    spy.calls.length = 0
    spy.nextPrepared = null
  })

  it('形状正确时给出「参考字号 + 内容宽度」，并按参考字体串调用 prepare', () => {
    spy.nextPrepared = fakePrepared([100, 20], ['text', 'text'])

    const model = resolveLineWidthModel(
      '歌词',
      '640 32px serif',
      FUME_WIDTH_MODEL_REFERENCE_FONT_PX
    )

    expect(model).toEqual({ referenceFontPx: 32, contentWidth: 120 })
    expect(spy.calls).toEqual([
      { text: '歌词', font: '640 32px serif', options: { whiteSpace: 'pre-wrap' } }
    ])
  })

  it('同一 (文本, 字体串) 第二次命中缓存，不再调 pretext', () => {
    spy.nextPrepared = fakePrepared([100], ['text'])

    const first = resolveLineWidthModel('歌词', '640 32px serif', 32)
    const second = resolveLineWidthModel('歌词', '640 32px serif', 32)

    expect(spy.calls).toHaveLength(1)
    expect(second).toBe(first)
  })

  it('「不适用」也进缓存（含 emoji 的歌词每次候选都跑一遍正则才是真的贵）', () => {
    expect(resolveLineWidthModel('带🎵的歌词', '640 32px serif', 32)).toBeNull()
    expect(spy.calls).toHaveLength(0)

    expect(resolveLineWidthModel('带🎵的歌词', '640 32px serif', 32)).toBeNull()
    expect(spy.calls).toHaveLength(0)
  })

  it('清缓存后重新问 pretext（字体到位后必须走这条）', () => {
    spy.nextPrepared = fakePrepared([50], ['text'])
    resolveLineWidthModel('歌词', '640 32px serif', 32)
    clearLineWidthModelCache()
    resolveLineWidthModel('歌词', '640 32px serif', 32)

    expect(spy.calls).toHaveLength(2)
  })

  it('空串不适用（layout 会给 0 行，与判据的 1 行不符）', () => {
    expect(resolveLineWidthModel('', '640 32px serif', 32)).toBeNull()
    expect(spy.calls).toHaveLength(0)
  })

  it('内容宽度为 0 的文本不适用（纯零宽字符）', () => {
    spy.nextPrepared = fakePrepared([0, 0], ['zero-width-break', 'zero-width-break'])

    expect(resolveLineWidthModel('歌词', '640 32px serif', 32)).toBeNull()
  })

  it('多块（含硬换行）不适用：每块独立走线，判据不成立', () => {
    spy.nextPrepared = fakePrepared([10, 10], ['text', 'text'], {
      chunks: [{}, {}]
    })

    expect(resolveLineWidthModel('歌词', '640 32px serif', 32)).toBeNull()
  })

  it('非简单走线（制表符 / 软连字符）不适用', () => {
    spy.nextPrepared = fakePrepared([10], ['text'], { simpleLineWalkFastPath: false })

    expect(resolveLineWidthModel('歌词', '640 32px serif', 32)).toBeNull()
  })

  it('读不到内部字段时返回 null（依赖升级不该让整首诗排不出来）', () => {
    spy.nextPrepared = { widths: [10] }
    expect(resolveLineWidthModel('歌词', '640 32px serif', 32)).toBeNull()

    spy.nextPrepared = null
    expect(resolveLineWidthModel('另一句', '640 32px serif', 32)).toBeNull()

    spy.nextPrepared = {
      widths: [10, Number.NaN],
      kinds: ['text', 'text'],
      chunks: [{}],
      simpleLineWalkFastPath: true
    }
    expect(resolveLineWidthModel('第三句', '640 32px serif', 32)).toBeNull()

    spy.nextPrepared = {
      widths: [10],
      kinds: ['text'],
      chunks: undefined,
      simpleLineWalkFastPath: true
    }
    expect(resolveLineWidthModel('第四句', '640 32px serif', 32)).toBeNull()
  })
})
