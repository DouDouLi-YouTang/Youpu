/**
 * 实时绘制**纯参数层**的单测（移植规格书 §10.4b / §10.4c / §10.5）。
 *
 * 这层的数值全部来自上游的秒制公式，换算成毫秒时**最容易差 1000 倍**：
 * 把 0.08 秒写成 0.08 毫秒，方块窗口就变成一个瞬间，肉眼看起来只是「印章没了」，
 * 不会报错。所以下面每条断言都把期望值手算写死，并且**显式标出秒制原文**，
 * 让"这个数从哪来"在断言里就能看出来。
 */

import { describe, expect, it } from 'vitest'

import {
  LIVE_COLOR_TRAIL_EXPONENT,
  LIVE_GLYPH_TRAIL_START_RATIO,
  LIVE_MIN_VISIBLE_ALPHA,
  LIVE_REVEAL_LEAD,
  createFumeGraphemeReveal,
  createFumeLiveGraphemeStyle,
  createFumePrintStamp,
  resolveLiveGraphemeReveal,
  resolveLiveGraphemeStyle,
  resolveLiveLineGlow,
  resolvePrintStamp,
  type FumeGraphemeReveal
} from './live-style'
import { resolveFumeBlockTiming } from '../core/block-frame'
import { makeFumeBlock, makeFumeTheme } from '../core/fume-test-fixtures'
import type { FumeWordRange } from '../core/fume-types'

/** 主题的强调色（`colorWithAlpha` 只认 hex 与 rgb()） */
const ACCENT = 'rgb(234, 88, 12)'
const PRIMARY = 'rgb(244, 244, 245)'

/** 造一个词区间：4 个字素、1000→2000ms、无音节 */
function makeRange(overrides: Partial<FumeWordRange> = {}): FumeWordRange {
  return {
    wordIndex: 0,
    word: { text: '一二三四', startTimeMs: 1000, endTimeMs: 2000 },
    start: 0,
    end: 4,
    colorStart: 0,
    colorEnd: 4,
    graphemeTimings: [],
    ...overrides
  }
}

describe('resolveLiveLineGlow（规格书 §10.4b）', () => {
  const block = makeFumeBlock({ variant: 'body', fontPx: 32 })

  it('行未开始时不亮（包络为 0，只有基量）', () => {
    const timing = resolveFumeBlockTiming(block, 0, null, 1)
    const glow = resolveLiveLineGlow(createLineGlow(), block, timing, 0, 1, ACCENT)

    // lineProgress = 0 → envelope = easeOutCubic(0) = 0 → alpha = 0.12
    expect(glow.alpha).toBeCloseTo(0.12, 10)
    // blur = 8 + 0 = 8
    expect(glow.blur).toBeCloseTo(8, 10)
    expect(glow.fillStyle).toBe('rgba(234, 88, 12, 0.12)')
    expect(glow.shadowColor).toBe('rgba(234, 88, 12, 0.162)')
  })

  it('hero 的两个基量都更大（0.16 / 12 而不是 0.12 / 8）', () => {
    const hero = makeFumeBlock({ variant: 'hero', fontPx: 48 })
    const timing = resolveFumeBlockTiming(hero, 0, null, 1)
    const glow = resolveLiveLineGlow(createLineGlow(), hero, timing, 0, 1, ACCENT)

    expect(glow.alpha).toBeCloseTo(0.16, 10)
    expect(glow.blur).toBeCloseTo(12, 10)
  })

  it('峰值在进度 0.8（不是起点）：0.8 处的包络为 1', () => {
    // ⚠️ 分母是**行时长**（lineEndTimeMs - startTime = 2240 - 1000 = 1240），不是词时长
    const timing = resolveFumeBlockTiming(block, 1000, null, 1)
    // 进度 0.8 → 时间 = 1000 + 0.8 × 1240 = 1992
    const glow = resolveLiveLineGlow(createLineGlow(), block, timing, 1992, 1, ACCENT)

    expect(glow.alpha).toBeCloseTo(0.12 + 0.2, 10)
    expect(glow.blur).toBeCloseTo(8 + 32 * 0.52, 10)
  })

  it('glowIntensity 线性缩放 alpha 与 blur（0 时整层不画）', () => {
    const timing = resolveFumeBlockTiming(block, 1992, null, 1)
    const half = resolveLiveLineGlow(createLineGlow(), block, timing, 1992, 0.5, ACCENT)
    const zero = resolveLiveLineGlow(createLineGlow(), block, timing, 1992, 0, ACCENT)

    expect(half.alpha).toBeCloseTo(0.16, 10)
    expect(half.blur).toBeCloseTo((8 + 32 * 0.52) * 0.5, 10)
    expect(zero.alpha).toBe(0)
    expect(zero.blur).toBe(0)
  })

  it('阴影色 alpha 是字色的 1.35 倍（光晕比字亮一圈）', () => {
    const timing = resolveFumeBlockTiming(block, 1000, null, 1)
    const glow = resolveLiveLineGlow(createLineGlow(), block, timing, 1000, 1, ACCENT)

    // 基量 0.12 → 阴影 0.162
    expect(glow.shadowColor).toBe('rgba(234, 88, 12, 0.162)')
  })
})

function createLineGlow() {
  return { alpha: 0, blur: 0, fillStyle: '', shadowColor: '' }
}

describe('resolveLiveGraphemeReveal（规格书 §10.4c）', () => {
  it('无音节时按词内均分：4 个字素各占 250ms', () => {
    const reveal = resolveLiveGraphemeReveal(
      createFumeGraphemeReveal(),
      makeRange(),
      2,
      1000,
      644.8,
      2240
    )

    expect(reveal.wordDurationMs).toBe(1000)
    expect(reveal.glyphCount).toBe(4)
    expect(reveal.glyphIndexInRange).toBe(2)
    expect(reveal.glyphStartTimeMs).toBe(1500)
    expect(reveal.glyphEndTimeMs).toBe(1750)
    expect(reveal.glyphDurationMs).toBe(250)
  })

  it('拖尾起点 = 字素起点 + 字素时长 × 0.18（§10.4c 点名的常量）', () => {
    const reveal = resolveLiveGraphemeReveal(
      createFumeGraphemeReveal(),
      makeRange(),
      0,
      1000,
      644.8,
      2240
    )

    expect(LIVE_GLYPH_TRAIL_START_RATIO).toBe(0.18)
    expect(reveal.glyphTrailStartMs).toBe(1000 + 250 * 0.18)
  })

  it('揭示提前量 +0.16：进度在字素起点就已经是 0.16', () => {
    const reveal = resolveLiveGraphemeReveal(
      createFumeGraphemeReveal(),
      makeRange(),
      0,
      1000,
      644.8,
      2240
    )

    expect(LIVE_REVEAL_LEAD).toBe(0.16)
    // wordProgress = 0 → 0 × 4 - 0 + 0.16 = 0.16
    expect(reveal.glyphProgress).toBeCloseTo(0.16, 10)
  })

  it('无音节路径的进度是「词进度 × 字素数 - 下标」，字与字之间不留空档', () => {
    // 词进度 0.5 → 0.5 × 4 = 2；下标 2 → 2 - 2 + 0.16 = 0.16
    const second = resolveLiveGraphemeReveal(
      createFumeGraphemeReveal(),
      makeRange(),
      2,
      1500,
      644.8,
      2240
    )
    // 下标 1 → 2 - 1 + 0.16 = 1.16 → 钳到 1
    const first = resolveLiveGraphemeReveal(
      createFumeGraphemeReveal(),
      makeRange(),
      1,
      1500,
      644.8,
      2240
    )

    expect(second.glyphProgress).toBeCloseTo(0.16, 10)
    expect(first.glyphProgress).toBe(1)
  })

  it('有音节时用音节时间，且进度按「字素窗口 + 提前量」算', () => {
    const withSyllables = makeRange({
      word: {
        text: '一二三四',
        startTimeMs: 1000,
        endTimeMs: 2000,
        syllables: [
          { text: '一', startTimeMs: 1000, endTimeMs: 1200 },
          { text: '二', startTimeMs: 1200, endTimeMs: 1400 }
        ]
      },
      graphemeTimings: [
        { char: '一', startTimeMs: 1000, endTimeMs: 1200 },
        { char: '二', startTimeMs: 1200, endTimeMs: 1400 }
      ]
    })

    // 下标 1 → 音节 1200→1400；时间 1200 → (0/200) + 0.16 = 0.16
    const reveal = resolveLiveGraphemeReveal(
      createFumeGraphemeReveal(),
      withSyllables,
      1,
      1200,
      644.8,
      2240
    )

    expect(reveal.glyphStartTimeMs).toBe(1200)
    expect(reveal.glyphEndTimeMs).toBe(1400)
    expect(reveal.glyphProgress).toBeCloseTo(0.16, 10)
  })

  it('音节下标越界时钳到最后一个音节（不会读出 undefined）', () => {
    const withSyllables = makeRange({
      word: {
        text: '一二',
        startTimeMs: 1000,
        endTimeMs: 2000,
        syllables: [{ text: '一', startTimeMs: 1000, endTimeMs: 1200 }]
      },
      graphemeTimings: [{ char: '一', startTimeMs: 1000, endTimeMs: 1200 }]
    })

    const reveal = resolveLiveGraphemeReveal(
      createFumeGraphemeReveal(),
      withSyllables,
      9,
      1000,
      644.8,
      2240
    )

    expect(reveal.glyphStartTimeMs).toBe(1000)
    expect(reveal.glyphEndTimeMs).toBe(1200)
  })

  it('拖尾进度取 pow(phase, 1.35)：前慢后快', () => {
    // 拖尾起点 1045、时长 644.8、cutoff 2240 → 时间 1045 + 322.4 = 1367.4 时 phase = 0.5
    const reveal = resolveLiveGraphemeReveal(
      createFumeGraphemeReveal(),
      makeRange(),
      0,
      1045 + 644.8 * 0.5,
      644.8,
      2240
    )

    expect(LIVE_COLOR_TRAIL_EXPONENT).toBe(1.35)
    expect(reveal.colorTrailProgress).toBeCloseTo(Math.pow(0.5, 1.35), 10)
    expect(reveal.colorTrailProgress).toBeLessThan(0.5)
  })

  it('词时长有 80ms 地板、字素时长有 1ms 地板（防除零）', () => {
    const instant = makeRange({
      word: { text: '一', startTimeMs: 1000, endTimeMs: 1000 }
    })
    const reveal = resolveLiveGraphemeReveal(
      createFumeGraphemeReveal(),
      instant,
      0,
      1000,
      644.8,
      2240
    )

    expect(reveal.wordDurationMs).toBe(80)
    expect(reveal.glyphDurationMs).toBeGreaterThan(0)
  })
})

describe('resolveLiveGraphemeStyle（规格书 §10.4c 的四条分支）', () => {
  const block = makeFumeBlock({ variant: 'body', fontPx: 32 })

  it('不属于任何词的字素只用基础 alpha（等待 / 前沿 / 已打印三档）', () => {
    const timing = resolveFumeBlockTiming(block, 0, null, 1)

    const waiting = resolveLiveGraphemeStyle(createFumeLiveGraphemeStyle(), block, timing, {
      timeMs: 0,
      primaryColor: PRIMARY,
      reveal: null,
      activeColor: ACCENT,
      isPrinted: false,
      isFrontier: false,
      passedGlowBase: 1,
      activeGlowBoost: 1
    })
    expect(waiting.alpha).toBe(0.035)
    expect(waiting.shadowBlur).toBe(0)

    const frontier = resolveLiveGraphemeStyle(createFumeLiveGraphemeStyle(), block, timing, {
      timeMs: 0,
      primaryColor: PRIMARY,
      reveal: null,
      activeColor: ACCENT,
      isPrinted: false,
      isFrontier: true,
      passedGlowBase: 1,
      activeGlowBoost: 1
    })
    expect(frontier.alpha).toBe(0.82)

    const printed = resolveLiveGraphemeStyle(createFumeLiveGraphemeStyle(), block, timing, {
      timeMs: 0,
      primaryColor: PRIMARY,
      reveal: null,
      activeColor: ACCENT,
      isPrinted: true,
      isFrontier: false,
      passedGlowBase: 1,
      activeGlowBoost: 1
    })
    expect(printed.alpha).toBe(0.92)
  })

  it('词还没开始：等主色、不发光（即使 isPrinted 为真也不混活动色）', () => {
    const timing = resolveFumeBlockTiming(block, 500, null, 1)
    const reveal = resolveLiveGraphemeReveal(
      createFumeGraphemeReveal(),
      makeRange(),
      0,
      500,
      644.8,
      2240
    )

    const style = resolveLiveGraphemeStyle(createFumeLiveGraphemeStyle(), block, timing, {
      timeMs: 500,
      primaryColor: PRIMARY,
      reveal,
      activeColor: ACCENT,
      isPrinted: false,
      isFrontier: false,
      passedGlowBase: 1,
      activeGlowBoost: 1
    })

    expect(style.alpha).toBe(timing.waitingOpacity)
    expect(style.fillStyle).toBe('rgba(244, 244, 245, 0.035)')
    expect(style.shadowBlur).toBe(0)
    expect(style.shadowColor).toBe('transparent')
  })

  it('正在打印：alpha 从 waiting 混向 active，辉光按 eased 进度长出来', () => {
    // 字素 0：1000→1250，拖尾起点 1045；时间取 1000（glyphProgress = 0.16）
    const timing = resolveFumeBlockTiming(block, 1000, null, 1)
    const reveal = resolveLiveGraphemeReveal(
      createFumeGraphemeReveal(),
      makeRange(),
      0,
      1000,
      644.8,
      2240
    )

    const style = resolveLiveGraphemeStyle(createFumeLiveGraphemeStyle(), block, timing, {
      timeMs: 1000,
      primaryColor: PRIMARY,
      reveal,
      activeColor: ACCENT,
      isPrinted: true,
      isFrontier: false,
      passedGlowBase: 0.8,
      activeGlowBoost: 1.2
    })

    const eased = reveal.easedGlyphProgress
    expect(style.alpha).toBeCloseTo(0.035 + (0.92 - 0.035) * eased, 10)
    expect(style.shadowBlur).toBeCloseTo((4 + 32 * 0.22) * eased * 1.2, 10)
    expect(style.shadowColor).toBe(`rgba(234, 88, 12, ${0.4 + eased * 0.44})`)
  })

  it('颜色拖尾：混向主色、辉光退到 passedGlowBase 档', () => {
    // 拖尾起点 1045，取时间 2000 → trail = pow(1, 1.35) = 1
    const timing = resolveFumeBlockTiming(block, 2000, null, 1)
    const reveal = resolveLiveGraphemeReveal(
      createFumeGraphemeReveal(),
      makeRange(),
      0,
      2000,
      644.8,
      2240
    )

    const style = resolveLiveGraphemeStyle(createFumeLiveGraphemeStyle(), block, timing, {
      timeMs: 2000,
      primaryColor: PRIMARY,
      reveal,
      activeColor: ACCENT,
      isPrinted: true,
      isFrontier: false,
      passedGlowBase: 0.8,
      activeGlowBoost: 1.2
    })

    expect(reveal.colorTrailProgress).toBe(1)
    // trail = 1 → alpha = passedStyle.opacity = 0.58
    expect(style.alpha).toBe(0.58)
    // 混色权重 0.18 + 1 × 0.82 = 1 → 完全等于主色
    expect(style.fillStyle).toBe('rgba(244, 244, 245, 0.58)')
    // shadowBlur = (2 + 3.2) × (1 - 0.35) × 0.8 × 1
    expect(style.shadowBlur).toBeCloseTo((2 + 32 * 0.1) * 0.65 * 0.8, 10)
  })

  it('已过行截止时走拖尾分支（即使时间还没到拖尾起点）', () => {
    // cutoff = 2240，时间取 2240 → hasPassCutoffReached = true
    const timing = resolveFumeBlockTiming(block, 2240, null, 1)
    const reveal = resolveLiveGraphemeReveal(
      createFumeGraphemeReveal(),
      makeRange(),
      0,
      2240,
      644.8,
      2240
    )

    const style = resolveLiveGraphemeStyle(createFumeLiveGraphemeStyle(), block, timing, {
      timeMs: 2240,
      primaryColor: PRIMARY,
      reveal,
      activeColor: ACCENT,
      isPrinted: true,
      isFrontier: false,
      passedGlowBase: 0.8,
      activeGlowBoost: 1.2
    })

    expect(timing.hasPassCutoffReached).toBe(true)
    // 截止把拖尾进度顶到 1 → 与「拖尾结束」同一取值
    expect(style.alpha).toBe(0.58)
  })

  it('拖尾分支用 transitionPassedStyle（恒为 standard），不随 dimmed 档熄灭', () => {
    // textHoldRatio < 1 才走 dimmed；本项目恒为 1，但分支必须留对。
    // ⚠️ 拖尾分支取的是 `transitionPassedStyle`（standard 档），不是 `passedStyle`：
    // 「纸痕不发光」由 §8.4 的快照层用 dimmed 那张图表达，实时拖尾这一路始终按
    // standard 的 glowMultiplier = 1 走 —— 这是上游口径，别"顺手改成 passedStyle"。
    const timing = resolveFumeBlockTiming(block, 3000, null, 0.5)
    const reveal = resolveLiveGraphemeReveal(
      createFumeGraphemeReveal(),
      makeRange(),
      0,
      3000,
      644.8,
      timing.linePassCutoffTimeMs
    )

    const style = resolveLiveGraphemeStyle(createFumeLiveGraphemeStyle(), block, timing, {
      timeMs: 3000,
      primaryColor: PRIMARY,
      reveal,
      activeColor: ACCENT,
      isPrinted: true,
      isFrontier: false,
      passedGlowBase: 0.8,
      activeGlowBoost: 1.2
    })

    expect(timing.effectiveTextHoldStyle).toBe('dimmed')
    expect(timing.transitionPassedStyle.glowMultiplier).toBe(1)
    expect(style.shadowBlur).toBeCloseTo((2 + 32 * 0.1) * 0.65 * 0.8, 10)
  })

  it('可见性阈值是 0.002（§10.4c），低于它的 alpha 由绘制层跳过', () => {
    expect(LIVE_MIN_VISIBLE_ALPHA).toBe(0.002)
  })
})

describe('resolvePrintStamp（规格书 §10.5）', () => {
  const block = makeFumeBlock({ variant: 'body', fontPx: 32, lineHeight: 40 })

  /** 字素 0：1000→1250，拖尾起点 1045；印章窗口 = 1045 - lead .. 1045 + lead × 0.42 */
  function makeReveal(timeMs: number): FumeGraphemeReveal {
    return resolveLiveGraphemeReveal(
      createFumeGraphemeReveal(),
      makeRange(),
      0,
      timeMs,
      644.8,
      2240
    )
  }

  function stampAt(timeMs: number, timing = resolveFumeBlockTiming(block, timeMs, null, 1)) {
    return resolvePrintStamp(createFumePrintStamp(), block, timing, {
      timeMs,
      grapheme: '一',
      glyphAdvance: 50,
      anchorX: 100,
      anchorY: 200,
      activeColor: ACCENT,
      activeGlowBoost: 1,
      reveal: makeReveal(timeMs)
    })
  }

  it('窗口之前不画（stampProgress 为 0）', () => {
    // lead = clamp(min(250 × 0.86 = 215, 行时长 1240 × 0.16 = 198.4), 55, 160) = 160
    // → 窗口起点 = 1045 - 160 = 885
    expect(stampAt(880)).toBe(false)
  })

  it('窗口之内要画，且方块在基线上方（下落段中心高于锚点）', () => {
    const stamp = createFumePrintStamp()
    const timing = resolveFumeBlockTiming(block, 1000, null, 1)
    const drawn = resolvePrintStamp(stamp, block, timing, {
      timeMs: 1000,
      grapheme: '一',
      glyphAdvance: 50,
      anchorX: 100,
      anchorY: 200,
      activeColor: ACCENT,
      activeGlowBoost: 1,
      reveal: makeReveal(1000)
    })

    expect(drawn).toBe(true)
    expect(stamp.width).toBeGreaterThan(0)
    expect(stamp.height).toBeCloseTo(32 * 0.62, 10)
    // 下落段的 y 应高于「已经落到位」的 y（即更小）
    expect(stamp.y + stamp.height / 2).toBeLessThan(200 - 32 * 0.38)
  })

  it('窗口之后不画（stampProgress 为 1）', () => {
    // 窗口终点 = 1045 + 160 × 0.42 = 1112.2
    expect(stampAt(1113)).toBe(false)
  })

  it('hero 的方块更大、透明度更高（0.82 vs 0.72）', () => {
    const hero = makeFumeBlock({ variant: 'hero', fontPx: 48, lineHeight: 49 })
    const body = createFumePrintStamp()
    const heroStamp = createFumePrintStamp()
    const heroTiming = resolveFumeBlockTiming(hero, 1000, null, 1)
    const bodyTiming = resolveFumeBlockTiming(block, 1000, null, 1)

    const reveal = makeReveal(1000)
    resolvePrintStamp(body, block, bodyTiming, {
      timeMs: 1000,
      grapheme: '一',
      glyphAdvance: 50,
      anchorX: 100,
      anchorY: 200,
      activeColor: ACCENT,
      activeGlowBoost: 1,
      reveal
    })
    resolvePrintStamp(heroStamp, hero, heroTiming, {
      timeMs: 1000,
      grapheme: '一',
      glyphAdvance: 50,
      anchorX: 100,
      anchorY: 200,
      activeColor: ACCENT,
      activeGlowBoost: 1,
      reveal
    })

    expect(heroStamp.height).toBeGreaterThan(body.height)
    // 下落距离也更大：hero 0.24 行高 vs body 0.2
    expect(heroStamp.y).toBeLessThan(body.y)
  })

  it('拉丁字素的方块最小宽度比 CJK 小（0.38 vs 0.56 字号）', () => {
    const cjk = createFumePrintStamp()
    const latin = createFumePrintStamp()
    const timing = resolveFumeBlockTiming(block, 1000, null, 1)
    const base = {
      timeMs: 1000,
      glyphAdvance: 1, // 故意给一个极窄的推进量，让字号项主导
      anchorX: 100,
      anchorY: 200,
      activeColor: ACCENT,
      activeGlowBoost: 1,
      reveal: makeReveal(1000)
    }

    resolvePrintStamp(cjk, block, timing, { ...base, grapheme: '一' })
    resolvePrintStamp(latin, block, timing, { ...base, grapheme: 'i' })

    expect(cjk.width).toBeGreaterThan(latin.width)
  })

  it('印章的辉光不量化（方块不经过字形缓存，量化只会让它跳）', () => {
    const stamp = createFumePrintStamp()
    const timing = resolveFumeBlockTiming(block, 1000, null, 1)
    resolvePrintStamp(stamp, block, timing, {
      timeMs: 1000,
      grapheme: '一',
      glyphAdvance: 50,
      anchorX: 100,
      anchorY: 200,
      activeColor: ACCENT,
      activeGlowBoost: 1,
      reveal: makeReveal(1000)
    })

    // 只要不是整数就说明没有 round()；这里断言它是有限正数即可
    expect(stamp.shadowBlur).toBeGreaterThan(0)
    expect(Number.isFinite(stamp.shadowBlur)).toBe(true)
  })

  it('印章不参与 theme（只吃 activeColor），与整行辉光的 accentColor 是两套', () => {
    const theme = makeFumeTheme()
    const stamp = createFumePrintStamp()
    const timing = resolveFumeBlockTiming(block, 1000, null, 1)
    resolvePrintStamp(stamp, block, timing, {
      timeMs: 1000,
      grapheme: '一',
      glyphAdvance: 50,
      anchorX: 100,
      anchorY: 200,
      activeColor: 'rgb(1, 2, 3)',
      activeGlowBoost: 1,
      reveal: makeReveal(1000)
    })

    // 色板来自 activeColor（不是 theme.accentColor），且 alpha 由 blockPulse 决定
    expect(stamp.fillStyle).toMatch(/^rgba\(1, 2, 3, 0\./)
    expect(theme.accentColor).not.toBe(stamp.fillStyle)
  })
})
