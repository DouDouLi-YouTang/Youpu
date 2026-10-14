import { beforeEach, describe, expect, it } from 'vitest'

import {
  getActiveColor,
  resolveFumePassedFadeDurationMs,
  resolvePassedDimAmount,
  resolvePassedTextStyle
} from './text-style'
import type { FumeTheme } from './fume-types'

/** 主题：本项目里 `wordColors` 恒为空，但测试要覆盖命中分支 */
function makeTheme(overrides: Partial<FumeTheme> = {}): FumeTheme {
  return {
    name: 'test',
    primaryColor: 'rgb(244, 244, 245)',
    accentColor: 'rgb(234, 88, 12)',
    secondaryColor: 'rgb(113, 113, 122)',
    fontStyle: 'serif',
    animationIntensity: 'normal',
    ...overrides
  }
}

describe('resolvePassedTextStyle（规格书 §6.1）', () => {
  it('standard：hero 文字更亮、投影更明显', () => {
    expect(resolvePassedTextStyle('hero', 'standard')).toEqual({
      opacity: 0.74,
      glowMultiplier: 1,
      shadowAlphaBase: 0.1,
      shadowAlphaTrail: 0.16
    })
    expect(resolvePassedTextStyle('body', 'standard')).toEqual({
      opacity: 0.58,
      glowMultiplier: 1,
      shadowAlphaBase: 0.1,
      shadowAlphaTrail: 0.16
    })
  })

  it('dimmed：纸痕不发光、不投影，透明度降到 0.11 / 0.075', () => {
    expect(resolvePassedTextStyle('hero', 'dimmed')).toEqual({
      opacity: 0.11,
      glowMultiplier: 0,
      shadowAlphaBase: 0,
      shadowAlphaTrail: 0
    })
    expect(resolvePassedTextStyle('body', 'dimmed')).toEqual({
      opacity: 0.075,
      glowMultiplier: 0,
      shadowAlphaBase: 0,
      shadowAlphaTrail: 0
    })
  })

  it('dimmed 的透明度确实比 standard 小一个量级（防止抄错一位小数）', () => {
    for (const variant of ['hero', 'body'] as const) {
      expect(resolvePassedTextStyle(variant, 'dimmed').opacity).toBeLessThan(
        resolvePassedTextStyle(variant, 'standard').opacity / 4
      )
    }
  })
})

describe('resolvePassedDimAmount（规格书 §6.2）', () => {
  it('不到 passedAt 时恒为 0（还没到渐隐窗口）', () => {
    expect(resolvePassedDimAmount(5000, 6000, 10_000)).toBe(0)
    expect(resolvePassedDimAmount(6000, 6000, 10_000)).toBe(0)
  })

  it('按 easeInCubic 推进：中点只有 0.125，终点为 1', () => {
    // 走完十分之一时长：easeInCubic(0.1) = 0.001（不是线性的 0.1）
    expect(resolvePassedDimAmount(6000, 5000, 10_000)).toBeCloseTo(0.001, 12)
    // 走完一半：easeInCubic(0.5) = 0.125
    expect(resolvePassedDimAmount(10_000, 5000, 10_000)).toBeCloseTo(0.125, 12)
    // 走完：1
    expect(resolvePassedDimAmount(15_000, 5000, 10_000)).toBe(1)
    expect(resolvePassedDimAmount(99_999, 5000, 10_000)).toBe(1)
  })

  it('非有限的任一入参、或 fadeDuration <= 0 → 立刻完全 dim（返回 1）', () => {
    for (const [current, passedAt, fade] of [
      [Number.NaN, 0, 1000],
      [0, Number.NaN, 1000],
      [0, 0, Number.POSITIVE_INFINITY],
      [0, 0, Number.NaN],
      [0, 0, 0],
      [0, 0, -1]
    ]) {
      expect(resolvePassedDimAmount(current, passedAt, fade)).toBe(1)
    }
  })

  it('currentTime 倒退（seek 回退）时年龄按 0 处理，不会得到负的 dim', () => {
    expect(resolvePassedDimAmount(1000, 5000, 10_000)).toBe(0)
  })
})

describe('resolveFumePassedFadeDurationMs（规格书 §6.3）', () => {
  it('textHoldRatio >= 1 → +Infinity（本项目恒走这条：永不淡出）', () => {
    expect(resolveFumePassedFadeDurationMs([], 1)).toBe(Number.POSITIVE_INFINITY)
    expect(resolveFumePassedFadeDurationMs([{ startTimeMs: 0, endTimeMs: 1000 }], 1)).toBe(
      Number.POSITIVE_INFINITY
    )
    expect(resolveFumePassedFadeDurationMs([], 1.4)).toBe(Number.POSITIVE_INFINITY)
  })

  it('行数 <= 1 时用 8 秒基准兜底，再按 ratio 缩放', () => {
    expect(resolveFumePassedFadeDurationMs([], 0.5)).toBe(4000)
    expect(resolveFumePassedFadeDurationMs([], 0.01)).toBe(2400) // 80ms → 下限 2.4s
    expect(resolveFumePassedFadeDurationMs([], 0.99)).toBe(7920)
  })

  it('行数 >= 2 时用「首行起点 → 末行渲染结束」的真实跨度', () => {
    // 两行正常行，跨度 = 末行 renderEndTime - 首行 start
    // 每行：1000ms → enter 340 / exit 180 / hold 60
    // 行 A：0→1000，renderEnd = 1000+60+180 = 1240
    // 行 B：2000→3000，renderEnd = 3000+60+180 = 3240
    // 跨度 = 3240 - 0 = 3240；ratio 0.5 → 1620 → 被下限抬到 2400
    const lines = [
      { startTimeMs: 0, endTimeMs: 1000 },
      { startTimeMs: 2000, endTimeMs: 3000 }
    ]
    expect(resolveFumePassedFadeDurationMs(lines, 0.5)).toBe(2400)
    // ratio 0.8 → 2592（落在区间内）
    expect(resolveFumePassedFadeDurationMs(lines, 0.8)).toBeCloseTo(2592, 6)
  })

  it('跨度再大也被 130 秒上限截断', () => {
    const lines = [
      { startTimeMs: 0, endTimeMs: 1000 },
      { startTimeMs: 600_000, endTimeMs: 601_000 }
    ]
    // 跨度 ≈ 601_240；ratio 0.9 → 541_116 → 上限 130_000
    expect(resolveFumePassedFadeDurationMs(lines, 0.9)).toBe(130_000)
  })

  it('非有限时间的行被过滤掉（一条 NaN 会让 max 整体变 NaN，渐隐就再也不动）', () => {
    const lines = [
      { startTimeMs: 5000, endTimeMs: 6000 },
      { startTimeMs: 0, endTimeMs: 1000 },
      { startTimeMs: Number.NaN, endTimeMs: 100 },
      { startTimeMs: 100, endTimeMs: Number.NaN },
      { startTimeMs: Number.POSITIVE_INFINITY, endTimeMs: Number.POSITIVE_INFINITY }
    ]
    // 只剩 0→1000（renderEnd 1240）与 5000→6000（renderEnd 6240）；跨度 6240 → ×0.5
    expect(resolveFumePassedFadeDurationMs(lines, 0.5)).toBe(3120)
  })

  it('反向行不会把跨度拉负：它被 micro 的 67ms 停留地板接住', () => {
    // 9000→8000 的 rawDuration 被钳成 0 → micro → renderEnd = max(8000, 9000 + 67) = 9067
    // 所以「反向行」在过滤后仍然存在（这是上游行为：地板让 end 永远 >= start）
    const lines = [
      { startTimeMs: 0, endTimeMs: 1000 },
      { startTimeMs: 9000, endTimeMs: 8000 }
    ]
    // 跨度 = 9067 - 0 = 9067 → ×0.5
    expect(resolveFumePassedFadeDurationMs(lines, 0.5)).toBeCloseTo(4533.5, 6)
  })

  it('不关心输入顺序：先乱序传入，结果与排好序一致', () => {
    const ordered = [
      { startTimeMs: 0, endTimeMs: 1000 },
      { startTimeMs: 2000, endTimeMs: 3000 }
    ]
    const shuffled = [ordered[1], ordered[0]]
    expect(resolveFumePassedFadeDurationMs(shuffled, 0.8)).toBe(
      resolveFumePassedFadeDurationMs(ordered, 0.8)
    )
  })

  it('同一条时间线命中缓存（第二次调用返回同一个值）', () => {
    const lines = [
      { startTimeMs: 0, endTimeMs: 1000 },
      { startTimeMs: 2000, endTimeMs: 3000 }
    ]
    const first = resolveFumePassedFadeDurationMs(lines, 0.8)
    const second = resolveFumePassedFadeDurationMs(lines, 0.8)
    expect(second).toBe(first)
    // 键变了就必须重算（这里 ratio 变了 → 值也变）
    expect(resolveFumePassedFadeDurationMs(lines, 0.4)).toBe(2400)
  })

  it('时间线变化会击穿缓存（切歌后总时长跟着变）', () => {
    const shortSong = [
      { startTimeMs: 0, endTimeMs: 1000 },
      { startTimeMs: 2000, endTimeMs: 3000 }
    ]
    const longSong = [
      { startTimeMs: 0, endTimeMs: 1000 },
      { startTimeMs: 20_000, endTimeMs: 21_000 }
    ]
    const shortDuration = resolveFumePassedFadeDurationMs(shortSong, 0.8)
    const longDuration = resolveFumePassedFadeDurationMs(longSong, 0.8)
    expect(longDuration).toBeGreaterThan(shortDuration)
    // 回到短歌：必须重新算回短值，而不是被长歌的值粘住
    expect(resolveFumePassedFadeDurationMs(shortSong, 0.8)).toBe(shortDuration)
  })

  it('已经烘好 renderHints 的行用它的 renderEndTimeMs，而不是现算', () => {
    const lines = [
      {
        startTimeMs: 0,
        endTimeMs: 1000,
        renderHints: {
          rawDurationMs: 1000,
          timingClass: 'normal' as const,
          renderEndTimeMs: 10_000,
          lineTransitionMode: 'normal' as const,
          wordRevealMode: 'normal' as const
        }
      },
      { startTimeMs: 20_000, endTimeMs: 21_000 }
    ]
    // 跨度 = 21_000+60+180 - 0 = 21_240；ratio 0.5 → 10_620
    expect(resolveFumePassedFadeDurationMs(lines, 0.5)).toBeCloseTo(10_620, 6)
  })
})

describe('getActiveColor（规格书 §6.4 的 bidirectional-contains）', () => {
  beforeEach(() => {
    // 每个用例都用新数组，避免测试之间互相影响（缓存只在 fadeDuration 里，颜色无缓存）
  })

  it('没有 wordColors 时回退 accentColor', () => {
    expect(getActiveColor('世界', makeTheme())).toBe('rgb(234, 88, 12)')
    expect(getActiveColor('世界', makeTheme({ wordColors: [] }))).toBe('rgb(234, 88, 12)')
  })

  it('CJK 词与配置互含都算命中（这是与默认口径的差别）', () => {
    const theme = makeTheme({ wordColors: [{ word: '零れ落ち', color: 'rgb(1, 2, 3)' }] })
    expect(getActiveColor('零れ落ち', theme)).toBe('rgb(1, 2, 3)')
    // 词比配置长 → 默认口径会漏，互含口径命中
    expect(getActiveColor('零れ落ちて', theme)).toBe('rgb(1, 2, 3)')
    // 配置比词长 → 两种口径都命中
    expect(getActiveColor('零れ', theme)).toBe('rgb(1, 2, 3)')
    // 完全不相关 → 回退
    expect(getActiveColor('世界', theme)).toBe('rgb(234, 88, 12)')
  })

  it('非 CJK 词按「配置项拆词后精确比较」，不做包含匹配', () => {
    const theme = makeTheme({ wordColors: [{ word: 'Hello World', color: 'rgb(9, 9, 9)' }] })
    expect(getActiveColor('hello', theme)).toBe('rgb(9, 9, 9)')
    expect(getActiveColor('world', theme)).toBe('rgb(9, 9, 9)')
    expect(getActiveColor('WORLD!', theme)).toBe('rgb(9, 9, 9)')
    expect(getActiveColor('HelloWorld', theme)).toBe('rgb(234, 88, 12)')
  })

  it('按数组顺序取第一个命中项（不做优先级排序）', () => {
    const theme = makeTheme({
      wordColors: [
        { word: '零れ', color: 'rgb(1, 1, 1)' },
        { word: '零れ落ち', color: 'rgb(2, 2, 2)' }
      ]
    })
    expect(getActiveColor('零れ落ち', theme)).toBe('rgb(1, 1, 1)')
  })

  it('空词 / 只有空白 / 配置项为空 → 回退', () => {
    const theme = makeTheme({ wordColors: [{ word: '  ', color: 'rgb(1, 1, 1)' }] })
    expect(getActiveColor('', theme)).toBe('rgb(234, 88, 12)')
    expect(getActiveColor('   ', theme)).toBe('rgb(234, 88, 12)')
  })
})
