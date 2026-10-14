import { describe, expect, it } from 'vitest'
import {
  clamp,
  easeInCubic,
  easeInOutCubic,
  easeOutCubic,
  hashString,
  isCjk,
  mix,
  quadraticBezier,
  resolveDelayedGlowEnvelope,
  seeded,
  splitGraphemes
} from './fume-math'

describe('hashString / seeded（规格书 §3 与 §15.5）', () => {
  it('hashString 与已知向量一致（FNV-1a 32 位）', () => {
    expect(hashString('')).toBe(2166136261)
    expect(hashString('a')).toBe(3826002220)
    expect(hashString('foobar')).toBe(3214735720)
    // 非 ASCII：FNV-1a 按 UTF-16 码元逐字符 eat，中文同样有确定结果
    expect(hashString('世界')).toBe(3870531327)
  })

  it('hashString 恒为无符号 32 位整数', () => {
    for (const input of ['', 'a', '世界', 'fume:0.123', 'x'.repeat(200)]) {
      const hash = hashString(input)
      expect(Number.isInteger(hash)).toBe(true)
      expect(hash).toBeGreaterThanOrEqual(0)
      expect(hash).toBeLessThan(2 ** 32)
    }
  })

  it('相同输入恒得相同结果（可复现），不同输入大概率不同', () => {
    expect(seeded('世界:0')).toBe(seeded('世界:0'))
    expect(seeded('世界:0')).not.toBe(seeded('世界:1'))
    expect(seeded('a')).toBe(seeded('a'))
  })

  it('与已知种子一致', () => {
    expect(seeded('')).toBe(0.6261)
    expect(seeded('a')).toBe(0.222)
    expect(seeded('foobar')).toBe(0.572)
    expect(seeded('世界')).toBe(0.1327)
  })

  it('粒度是 1/10000：结果恒是 0.0001 的整数倍，且取不到 1', () => {
    const inputs = ['', 'a', '世界', 'fume', 'line:0', 'line:1', 'hero', '🎵:42']
    for (const input of inputs) {
      const value = seeded(input)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      // 乘 10000 后应当是整数（浮点乘法的误差不超过 1e-9）
      expect(Math.abs(value * 10000 - Math.round(value * 10000))).toBeLessThan(1e-9)
    }
  })
})

describe('clamp / mix / quadraticBezier（规格书 §3）', () => {
  it('clamp 两端与越界', () => {
    expect(clamp(5, 1, 3)).toBe(3)
    expect(clamp(-5, 1, 3)).toBe(1)
    expect(clamp(2, 1, 3)).toBe(2)
    expect(clamp(1, 1, 3)).toBe(1)
    expect(clamp(3, 1, 3)).toBe(3)
  })

  it('mix 端点与中点', () => {
    expect(mix(10, 20, 0)).toBe(10)
    expect(mix(10, 20, 1)).toBe(20)
    expect(mix(10, 20, 0.5)).toBe(15)
  })

  it('quadraticBezier 端点精确等于 from / to，中点等于曲线值', () => {
    expect(quadraticBezier(0, 10, 20, 0)).toBe(0)
    expect(quadraticBezier(0, 10, 20, 1)).toBe(20)
    // t = 0.5 → 0.25 * 0 + 0.5 * 10 + 0.25 * 20 = 10
    expect(quadraticBezier(0, 10, 20, 0.5)).toBe(10)
  })

  it('quadraticBezier 把 amount 钳到 [0, 1]（外插不外溢）', () => {
    expect(quadraticBezier(0, 10, 20, -3)).toBe(0)
    expect(quadraticBezier(0, 10, 20, 7)).toBe(20)
  })

  it('非单调控制点时曲线可以越出端点区间（贝塞尔特性，不应被"修好"）', () => {
    // 控制点拉到 100：t = 0.5 时值 = 0.25*0 + 0.5*100 + 0.25*0 = 50
    expect(quadraticBezier(0, 100, 0, 0.5)).toBe(50)
  })
})

describe('三条缓动曲线（规格书 §3 与 §15.5）', () => {
  it('easeOutCubic 在 0 / 0.5 / 1 的取值', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 12)
    expect(easeOutCubic(1)).toBe(1)
  })

  it('easeInCubic 在 0 / 0.5 / 1 的取值', () => {
    expect(easeInCubic(0)).toBe(0)
    expect(easeInCubic(0.5)).toBeCloseTo(0.125, 12)
    expect(easeInCubic(1)).toBe(1)
  })

  it('easeInOutCubic 在 0 / 0.5 / 1 的取值', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(0.5)).toBe(0.5)
    expect(easeInOutCubic(1)).toBe(1)
  })

  it('三条曲线都把入参钳到 [0, 1]', () => {
    for (const ease of [easeOutCubic, easeInCubic, easeInOutCubic]) {
      expect(ease(-1)).toBe(0)
      expect(ease(2)).toBe(1)
    }
  })

  it('easeInOutCubic 关于 (0.5, 0.5) 中心对称', () => {
    for (const t of [0.1, 0.25, 0.4]) {
      expect(easeInOutCubic(t) + easeInOutCubic(1 - t)).toBeCloseTo(1, 12)
    }
  })
})

describe('resolveDelayedGlowEnvelope（规格书 §3）', () => {
  it('起点 0、峰值 1、终点 0', () => {
    expect(resolveDelayedGlowEnvelope(0)).toBe(0)
    expect(resolveDelayedGlowEnvelope(0.8)).toBe(1)
    expect(resolveDelayedGlowEnvelope(1)).toBe(0)
  })

  it('峰值前单调升、峰值后单调降', () => {
    let previous = -1
    for (let t = 0; t <= 0.8; t += 0.05) {
      const value = resolveDelayedGlowEnvelope(t)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
    previous = 2
    for (let t = 0.8; t <= 1.0001; t += 0.05) {
      const value = resolveDelayedGlowEnvelope(t)
      expect(value).toBeLessThanOrEqual(previous)
      previous = value
    }
  })

  it('入参越界被钳制（回落到端点行为）', () => {
    expect(resolveDelayedGlowEnvelope(-4)).toBe(0)
    expect(resolveDelayedGlowEnvelope(9)).toBe(0)
  })

  it('peakProgress 被钳到 [0.05, 0.95]，不会出现除零', () => {
    // peak = 0 → 钳成 0.05：progress = 0.05 处即为峰值 1
    expect(resolveDelayedGlowEnvelope(0.05, 0)).toBe(1)
    // peak = 1 → 钳成 0.95：progress = 0.95 处为峰值 1，.95 之后立刻回落
    expect(resolveDelayedGlowEnvelope(0.95, 1)).toBe(1)
    expect(resolveDelayedGlowEnvelope(0.95, 1)).toBeGreaterThan(resolveDelayedGlowEnvelope(1, 1))
    for (const peak of [0, 0.5, 1]) {
      for (const t of [0, 0.3, 0.7, 1]) {
        expect(Number.isFinite(resolveDelayedGlowEnvelope(t, peak))).toBe(true)
      }
    }
  })
})

describe('isCjk（规格书 §3）', () => {
  it('汉字 / 假名 / 谚文算 CJK', () => {
    expect(isCjk('世界')).toBe(true)
    expect(isCjk('ひらがな')).toBe(true)
    expect(isCjk('カタカナ')).toBe(true)
    expect(isCjk('한글')).toBe(true)
    expect(isCjk('混 a 排')).toBe(true)
  })

  it('纯拉丁 / 数字 / 标点不算 CJK', () => {
    expect(isCjk('hello')).toBe(false)
    expect(isCjk('123 !?')).toBe(false)
    expect(isCjk('')).toBe(false)
    expect(isCjk('……')).toBe(false)
  })
})

describe('splitGraphemes（规格书 §3，复用倾诉的切分口径）', () => {
  it('空串返回空数组，拼接可还原原文', () => {
    expect(splitGraphemes('')).toEqual([])
    for (const text of ['你好世界', 'a b c', 'あ、い。', 'line:0']) {
      expect(splitGraphemes(text).join('')).toBe(text)
    }
  })

  it('emoji / 组合字符 / ZWJ 序列不被切碎', () => {
    expect(splitGraphemes('👍🏽')).toEqual(['👍🏽'])
    expect(splitGraphemes('e\u0301')).toEqual(['e\u0301'])
    expect(splitGraphemes('👨‍👩‍👧')).toEqual(['👨‍👩‍👧'])
    expect(splitGraphemes('a👍🏽b')).toEqual(['a', '👍🏽', 'b'])
  })

  it('空白字素是独立的一项（§5.1 的吞空白规则依赖它）', () => {
    expect(splitGraphemes('你 好')).toEqual(['你', ' ', '好'])
    expect(splitGraphemes('a\tb')).toEqual(['a', '\t', 'b'])
  })
})
