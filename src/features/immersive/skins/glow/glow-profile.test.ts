import { describe, expect, it } from 'vitest'

import { resolveGlowRenderProfile } from './glow-profile'

/**
 * 造一行：起点 / 结束时间（毫秒）与可选的「最后一个词的结束时间」。
 *
 * 形状是 `GlowProfileLine`（`timeMs` + `endMs` + 逐词毫秒戳）——
 * 即 `useGlowActiveLine` 产出的行源去掉 `text` / `nextLineStartMs` 之后的那三个字段。
 * `lastWordEndTimeMs` 用「起点 + 时长」表达，与 `LyricWord` 的字段口径一致。
 */
function line(startTimeMs: number, endTimeMs: number, lastWordEndTimeMs?: number) {
  return {
    timeMs: startTimeMs,
    endMs: endTimeMs,
    words:
      lastWordEndTimeMs === undefined
        ? undefined
        : [
            { word: 'a', timeMs: startTimeMs, durationMs: 0 },
            { word: 'b', timeMs: lastWordEndTimeMs, durationMs: 0 }
          ]
  }
}

describe('resolveGlowRenderProfile', () => {
  it('normal 档：lookahead 150ms，过场档位 normal', () => {
    const profile = resolveGlowRenderProfile(line(1000, 3000))
    expect(profile.wordRevealMode).toBe('normal')
    expect(profile.lineTransitionMode).toBe('normal')
    expect(profile.wordLookaheadMs).toBe(150)
  })

  it('short 档（<180ms）：fast 揭示 + fast 过场 + 80ms lookahead', () => {
    const profile = resolveGlowRenderProfile(line(1000, 1150))
    expect(profile.wordRevealMode).toBe('fast')
    expect(profile.lineTransitionMode).toBe('fast')
    expect(profile.wordLookaheadMs).toBe(80)
  })

  it('micro 档（<100ms）：instant 揭示 + 无过场 + 30ms lookahead', () => {
    const profile = resolveGlowRenderProfile(line(1000, 1080))
    expect(profile.wordRevealMode).toBe('instant')
    expect(profile.lineTransitionMode).toBe('none')
    expect(profile.wordLookaheadMs).toBe(30)
  })

  it('档位边界是严格小于：正好 100ms 不进 micro、正好 180ms 不进 short', () => {
    expect(resolveGlowRenderProfile(line(0, 100)).wordRevealMode).toBe('fast')
    expect(resolveGlowRenderProfile(line(0, 100)).lineTransitionMode).toBe('fast')
    expect(resolveGlowRenderProfile(line(0, 180)).wordRevealMode).toBe('normal')
  })

  it('renderEndTime 不小于行结束时间', () => {
    const profile = resolveGlowRenderProfile(line(1000, 3000))
    expect(profile.lineRenderEndTimeMs).toBeGreaterThanOrEqual(3000)
  })

  it('micro 行有 67ms 的渲染地板', () => {
    // 行只有 20ms → 渲染结束时间抬到 start + 67
    expect(resolveGlowRenderProfile(line(1000, 1020)).lineRenderEndTimeMs).toBe(1067)
  })

  it('最后一个词的结束时间晚于行结束时间时，拖尾窗口跟着往后挪', () => {
    const plain = resolveGlowRenderProfile(line(1000, 3000))
    const lateWord = resolveGlowRenderProfile(line(1000, 3000, 4200))
    expect(lateWord.lineRenderEndTimeMs).toBeGreaterThan(plain.lineRenderEndTimeMs)
  })
})
