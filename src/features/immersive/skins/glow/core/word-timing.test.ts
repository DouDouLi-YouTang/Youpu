import { describe, expect, it } from 'vitest'

import {
  resolveActiveEndMs,
  resolveDisplayDurationMs,
  resolveLineContainerMotion,
  resolveWordLookaheadMs,
  resolveWordStatus,
  type GlowWordTimingProfile
} from './word-timing'

/**
 * 「流光」逐词时序。这一层决定「词在哪一帧亮、哪一帧灭、行怎么进出」——
 * 全是边界判定，差一个 `=` 就表现为"词闪了一下"或"整行一起亮"，
 * 所以每个 `>` / `>=` / `<=` 都在这里钉死。
 */

function profile(overrides: Partial<GlowWordTimingProfile> = {}): GlowWordTimingProfile {
  return {
    wordLookaheadMs: 150,
    lineRenderEndTimeMs: 5000,
    wordRevealMode: 'normal',
    lineTransitionMode: 'normal',
    ...overrides
  }
}

describe('提前量', () => {
  it('三档分别是 instant 30 / fast 80 / normal 150 毫秒', () => {
    expect(resolveWordLookaheadMs('instant')).toBe(30)
    expect(resolveWordLookaheadMs('fast')).toBe(80)
    expect(resolveWordLookaheadMs('normal')).toBe(150)
  })
})

describe('三态判定（三个边界符号都按原样）', () => {
  it('正好等于 start - lookahead 时是 active（下界是 >=）', () => {
    expect(resolveWordStatus(850, 1000, 1200, 150)).toBe('active')
  })

  it('差 1ms 没到 start - lookahead 时是 waiting', () => {
    expect(resolveWordStatus(849, 1000, 1200, 150)).toBe('waiting')
  })

  it('正好等于 activeEndTime 时是 active（上界是 <=）', () => {
    expect(resolveWordStatus(1200, 1000, 1200, 150)).toBe('active')
  })

  it('超过 activeEndTime 1ms 才转 passed', () => {
    expect(resolveWordStatus(1201, 1000, 1200, 150)).toBe('passed')
  })

  it('远早于词起点是 waiting，远晚于词尾是 passed', () => {
    expect(resolveWordStatus(0, 1000, 1200, 150)).toBe('waiting')
    expect(resolveWordStatus(9999, 1000, 1200, 150)).toBe('passed')
  })

  it('零提前量时 start 那一帧就 active', () => {
    expect(resolveWordStatus(1000, 1000, 1200, 0)).toBe('active')
    expect(resolveWordStatus(999, 1000, 1200, 0)).toBe('waiting')
  })

  it('词起止相同（零长词）时只有那一瞬间是 active', () => {
    expect(resolveWordStatus(1000, 1000, 1000, 0)).toBe('active')
    expect(resolveWordStatus(1001, 1000, 1000, 0)).toBe('passed')
  })
})

describe('active 结束时刻', () => {
  it('normal：就是词的结束时间', () => {
    expect(resolveActiveEndMs(1000, 1400, profile({ wordRevealMode: 'normal' }))).toBe(1400)
  })

  it('instant：整行退场时刻（词自己多长都无所谓）', () => {
    const result = resolveActiveEndMs(
      1000,
      1040,
      profile({ wordRevealMode: 'instant', lineRenderEndTimeMs: 3000 })
    )
    expect(result).toBe(3000)
  })

  it('fast：短词被 120ms 地板托到 start + 120', () => {
    expect(resolveActiveEndMs(1000, 1050, profile({ wordRevealMode: 'fast' }))).toBe(1120)
  })

  it('fast：长词用词尾，不被地板影响', () => {
    expect(resolveActiveEndMs(1000, 1300, profile({ wordRevealMode: 'fast' }))).toBe(1300)
  })

  it('fast：整行退场时刻会封顶（词活不过这一行）', () => {
    const result = resolveActiveEndMs(
      1000,
      1300,
      profile({ wordRevealMode: 'fast', lineRenderEndTimeMs: 1100 })
    )
    expect(result).toBe(1100)
  })
})

describe('显示时长（正文层颜色过渡）', () => {
  it('normal 的地板是 100ms', () => {
    expect(resolveDisplayDurationMs(1000, 1040, profile({ wordRevealMode: 'normal' }))).toBe(100)
  })

  it('fast 的地板是 120ms', () => {
    expect(resolveDisplayDurationMs(1000, 1050, profile({ wordRevealMode: 'fast' }))).toBe(120)
  })

  it('instant 的地板是 80ms', () => {
    const result = resolveDisplayDurationMs(
      1000,
      1010,
      profile({ wordRevealMode: 'instant', lineRenderEndTimeMs: 1050 })
    )
    expect(result).toBe(80)
  })

  it('正常长度的词取实际时长，不触地板', () => {
    expect(resolveDisplayDurationMs(1000, 1400, profile())).toBe(400)
  })

  it('instant 档整行很长时取整行剩余时长（词不会提前灭）', () => {
    const result = resolveDisplayDurationMs(
      1000,
      1040,
      profile({ wordRevealMode: 'instant', lineRenderEndTimeMs: 3000 })
    )
    expect(result).toBe(2000)
  })
})

describe('整行容器出入场', () => {
  it('none 档：几乎不动（原地淡出，微微放大 + 6px 模糊）', () => {
    const motion = resolveLineContainerMotion('none')
    expect(motion.initial).toEqual({ opacity: 1, scale: 1, filter: 'blur(0px)' })
    expect(motion.exit).toMatchObject({ opacity: 0, scale: 1.02, filter: 'blur(6px)' })
  })

  it('none 档的出场时长是 120ms easeOut', () => {
    const exit = resolveLineContainerMotion('none').exit as {
      transition: { durationMs: number; ease: string }
    }
    expect(exit.transition).toEqual({ durationMs: 120, ease: 'easeOut' })
  })

  it('fast 档：从半透明 + 略小开始，出场放大到 1.04', () => {
    const motion = resolveLineContainerMotion('fast')
    expect(motion.initial).toEqual({ opacity: 0.35, scale: 0.96, filter: 'blur(4px)' })
    expect(motion.exit).toMatchObject({ opacity: 0, scale: 1.04, filter: 'blur(10px)' })
  })

  it('fast 档进出场都是 160ms', () => {
    const motion = resolveLineContainerMotion('fast')
    const animate = motion.animate as { transition: { durationMs: number; ease: string } }
    const exit = motion.exit as { transition: { durationMs: number; ease: string } }
    expect(animate.transition).toEqual({ durationMs: 160, ease: 'easeOut' })
    expect(exit.transition).toEqual({ durationMs: 160, ease: 'easeInOut' })
  })

  it('normal 档：从完全透明 + 0.9 缩放开始，出场放大到 1.1 / 20px 模糊 / 300ms', () => {
    const motion = resolveLineContainerMotion('normal')
    expect(motion.initial).toEqual({ opacity: 0, scale: 0.9, filter: 'blur(10px)' })
    expect(motion.exit).toMatchObject({ opacity: 0, scale: 1.1, filter: 'blur(20px)' })
    expect((motion.exit as { transition: { durationMs: number } }).transition.durationMs).toBe(300)
  })

  it('三档的 animate 都带 transitionEnd 摘掉 filter（否则常驻模糊合成层）', () => {
    for (const mode of ['none', 'fast', 'normal'] as const) {
      const animate = resolveLineContainerMotion(mode).animate as {
        transitionEnd: { filter: string }
      }
      expect(animate.transitionEnd).toEqual({ filter: 'none' })
    }
  })

  it('normal 档的 animate **没有**显式时长（让动画库用默认值，原样）', () => {
    const animate = resolveLineContainerMotion('normal').animate as { transition?: unknown }
    expect(animate.transition).toBeUndefined()
  })
})
