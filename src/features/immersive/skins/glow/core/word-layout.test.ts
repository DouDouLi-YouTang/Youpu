import { describe, expect, it } from 'vitest'

import {
  ACTIVE_SCALE_MULTIPLIER,
  buildLineFloat,
  buildWordLayout,
  clampBreathingFloatMultiplier,
  clampWordSpacing,
  resolvePassedOpacity,
  resolveWaitingPose,
  type BuildWordLayoutInput
} from './word-layout'

/**
 * 「流光」逐词几何。这一层决定「同一行每次播放摆位是否一致」「词会不会叠在一起」，
 * 全都是眼睛看得见、但很难回推原因的数值 —— 所以把 Folia 的公式**按原样**钉在这里。
 *
 * 断言分两类：
 *  1. **确定性**：同一个种子必须给出同一份几何，换行 / 换歌必须给出不同的；
 *  2. **数值**：直接复算 Folia 的公式（`frac(sin(wordSeed + n) * 10000)`）做对照 ——
 *     这些数字若被"顺手优化"过（换随机源、把秒写成毫秒、把系数取整），这里立刻红。
 */

/** Folia 的确定性随机，测试里独立实现一份 —— 与被测代码用同一套公式互为对照 */
function expectedRandom(seed: number, offset: number): number {
  const x = Math.sin(seed + offset) * 10000
  return x - Math.floor(x)
}

/** 一次 layout 调用，只覆盖关心的字段，其余给默认值 */
function build(overrides: Partial<BuildWordLayoutInput> = {}) {
  return buildWordLayout({
    lineStartMs: 10_000,
    words: ['你', '好'],
    intensity: 'normal',
    enableWordRotation: true,
    useLegacyLayout: true,
    wordSpacing: 0.7,
    wordWidths: [],
    pxFontSize: 48,
    ...overrides
  })
}

describe('种子（秒制）', () => {
  it('毫秒入参先除以 1000 —— 否则随机序列整体跑偏', () => {
    // 10_000ms = 10s。用 10 当种子复算第一个词（wordSeed = 10 + 0 = 10）：
    const results = build({ lineStartMs: 10_000 })
    const first = results.words[0]
    const seed = 10

    expect(first.scale).toBeCloseTo(1.1 + expectedRandom(seed, 4) * 0.2, 12)
    expect(first.x).toBeCloseTo((expectedRandom(seed, 1) - 0.5) * 20 * 2, 12)
    expect(first.y).toBeCloseTo((expectedRandom(seed, 2) - 0.5) * 20 * 2, 12)
    expect(first.rotate).toBeCloseTo((expectedRandom(seed, 3) - 0.5) * 5 * 2, 12)
  })

  it('同一行种子 → 同一份几何（渲染多少次都一样）', () => {
    expect(build({ lineStartMs: 12_345 })).toEqual(build({ lineStartMs: 12_345 }))
  })

  it('不同行 → 不同的散落（否则整首歌摆位一模一样）', () => {
    const a = build({ lineStartMs: 10_000 })
    const b = build({ lineStartMs: 20_000 })
    expect(a.words[0].x).not.toBeCloseTo(b.words[0].x, 6)
  })

  it('非有限种子退回 0，不产生 NaN 几何', () => {
    const result = build({ lineStartMs: Number.NaN })
    for (const word of result.words) {
      expect(Number.isFinite(word.x)).toBe(true)
      expect(Number.isFinite(word.y)).toBe(true)
      expect(Number.isFinite(word.scale)).toBe(true)
      expect(Number.isFinite(word.rotate)).toBe(true)
    }
  })
})

describe('容器档位', () => {
  it('calm 恒定居中，justify / align 只有一个候选', () => {
    for (const lineStartMs of [0, 1_000, 7_777, 100_000]) {
      const { line } = build({ intensity: 'calm', lineStartMs })
      expect(line.justifyContent).toBe('justify-center')
      expect(line.alignItems).toBe('items-center')
    }
  })

  it('calm 不散落：x / y / rotate 全为 0', () => {
    const { words } = build({ intensity: 'calm' })
    for (const word of words) {
      // `+ 0` 是为了把 `-0` 归一成 `0`：Folia 的算式（`(r - 0.5) * 0 * 2`）本来就可能产出 `-0`，
      // 实现层刻意**不**去规整它（CSS 里 `-0px` 合法且等价），测试只关心「位移量是零」。
      expect(word.x + 0).toBe(0)
      expect(word.y + 0).toBe(0)
      expect(word.rotate + 0).toBe(0)
    }
  })

  it('calm 的缩放仍在 1.1–1.3 之间（缩放不归零，只有位移与旋转归零）', () => {
    for (const word of build({ intensity: 'calm' }).words) {
      expect(word.scale).toBeGreaterThanOrEqual(1.1)
      expect(word.scale).toBeLessThanOrEqual(1.3)
    }
  })

  it('normal 的 perspective 恒为 1000', () => {
    expect(build({ intensity: 'normal' }).line.perspective).toBe(1000)
  })

  it('chaotic 的 perspective 是 500 + (seed % 500)，seed 已换算成秒', () => {
    const { line } = build({ intensity: 'chaotic', lineStartMs: 123_456 })
    // seed = 123.456 → 500 + (123.456 % 500) = 623.456
    expect(line.perspective).toBeCloseTo(500 + (123.456 % 500), 12)
  })

  it('chaotic 的位移基准是 normal 的 3 倍（60 / 20）', () => {
    const normal = build({ intensity: 'normal' })
    const chaotic = build({ intensity: 'chaotic' })
    expect(chaotic.words[0].x).toBeCloseTo(normal.words[0].x * 3, 12)
  })
})

describe('插曲行', () => {
  it('整行等于 "......" 时判定为插曲（半角句点，不是全角省略号）', () => {
    expect(build({ words: ['......'] }).isInterlude).toBe(true)
    expect(build({ words: ['……'] }).isInterlude).toBe(false)
  })

  it('插曲行：居中、放大 1.5、不旋转、右边距 3rem、alignSelf center', () => {
    const { line, words } = build({ words: ['......'], intensity: 'chaotic' })
    expect(line.justifyContent).toBe('justify-center')
    const word = words[0]
    expect(word.scale).toBe(1.5)
    expect(word.rotate).toBe(0)
    expect(word.passedRotate).toBe(0)
    expect(word.marginRight).toBe('3rem')
    expect(word.alignSelf).toBe('center')
    expect(word.x).toBe(0)
  })

  it('插曲行的 y 抖动幅度不超过 ±7.5px', () => {
    // ⚠️ 插曲判定是**整行等于** "......" —— 两个词拼起来是 12 个点，就不是插曲行了（会走普通散落）
    const { words, isInterlude } = build({ words: ['......'] })
    expect(isInterlude).toBe(true)
    expect(Math.abs(words[0].y)).toBeLessThanOrEqual(7.5)
  })

  it('插曲行不受 useLegacyLayout 影响（两条路径都走固定几何）', () => {
    const legacy = build({ words: ['......'], useLegacyLayout: true })
    const precise = build({ words: ['......'], useLegacyLayout: false })
    expect(precise.words).toEqual(legacy.words)
  })
})

describe('精确右边距（默认路径）', () => {
  const widths = [100, 60, 40]
  const shared = {
    words: ['abc', 'de', 'f'],
    wordWidths: widths,
    useLegacyLayout: false,
    pxFontSize: 48
  }

  it('非混乱强度下按「半溢出 + 位移差 + 固定间隙」逐项复算', () => {
    const { words } = buildWordLayout({
      lineStartMs: 10_000,
      intensity: 'normal',
      enableWordRotation: true,
      wordSpacing: 0.7,
      ...shared
    })
    const seed = 10
    const pxFontSize = 48
    const spacing = 0.7

    const scaleAt = (index: number): number => 1.1 + expectedRandom(seed + index, 4) * 0.2
    const xAt = (index: number): number => (expectedRandom(seed + index, 1) - 0.5) * 20 * 2

    for (let index = 0; index < widths.length; index += 1) {
      const currentScaled = scaleAt(index) * ACTIVE_SCALE_MULTIPLIER
      const hasNext = index + 1 < widths.length
      const nextScaled = hasNext ? scaleAt(index + 1) * ACTIVE_SCALE_MULTIPLIER : 1
      const nextX = hasNext ? xAt(index + 1) : 0
      const nextWidth = hasNext ? widths[index + 1] : 0

      const calculated =
        ((widths[index] * (currentScaled - 1)) / 2 +
          (nextWidth * (nextScaled - 1)) / 2 +
          (xAt(index) - nextX) +
          0.05 * pxFontSize) *
        spacing
      const expected = Math.max(0.12 * pxFontSize * spacing, calculated)

      expect(words[index].marginRight).toBe(`${expected.toFixed(1)}px`)
    }
  })

  it('最小间距兜底：词宽为 0 时仍留出 0.12 × 字号 × 间距', () => {
    const { words } = buildWordLayout({
      lineStartMs: 10_000,
      intensity: 'normal',
      enableWordRotation: false,
      useLegacyLayout: false,
      wordSpacing: 1,
      words: ['a', 'b'],
      wordWidths: [0, 0],
      pxFontSize: 50
    })
    // 位移差可能为正（把 margin 顶上去），所以断言的是「不小于兜底值」
    for (const word of words) {
      expect(Number.parseFloat(word.marginRight)).toBeGreaterThanOrEqual(6)
    }
  })

  it('chaotic 的兜底系数更小（0.08 × 字号）', () => {
    const { words } = buildWordLayout({
      lineStartMs: 10_000,
      intensity: 'chaotic',
      enableWordRotation: false,
      useLegacyLayout: false,
      wordSpacing: 1,
      words: ['a', 'b'],
      wordWidths: [0, 0],
      pxFontSize: 50
    })
    for (const word of words) {
      expect(Number.parseFloat(word.marginRight)).toBeGreaterThanOrEqual(4)
    }
  })

  it('wordSpacing 是整体倍率：0 时 margin 归零', () => {
    const { words } = buildWordLayout({
      lineStartMs: 10_000,
      intensity: 'normal',
      enableWordRotation: false,
      useLegacyLayout: false,
      wordSpacing: 0,
      words: ['a', 'b'],
      wordWidths: [100, 100],
      pxFontSize: 48
    })
    for (const word of words) {
      expect(Number.parseFloat(word.marginRight)).toBeCloseTo(0, 1)
    }
  })

  it('词宽缺失（数组短一截）按 0 处理，不产生 NaN', () => {
    const { words } = buildWordLayout({
      lineStartMs: 10_000,
      intensity: 'normal',
      enableWordRotation: true,
      useLegacyLayout: false,
      wordSpacing: 0.7,
      words: ['a', 'b', 'c'],
      wordWidths: [100],
      pxFontSize: 48
    })
    for (const word of words) {
      expect(Number.isFinite(Number.parseFloat(word.marginRight))).toBe(true)
    }
  })
})

describe('旧版布局逃生门', () => {
  it('useLegacyLayout 下 normal 用固定 0.8rem', () => {
    for (const word of build({ useLegacyLayout: true }).words) {
      expect(word.marginRight).toBe('0.8rem')
    }
  })

  it('useLegacyLayout 下 chaotic 用随机 rem（0–1.5）', () => {
    for (const word of build({ useLegacyLayout: true, intensity: 'chaotic' }).words) {
      expect(word.marginRight.endsWith('rem')).toBe(true)
      const rem = Number.parseFloat(word.marginRight)
      expect(rem).toBeGreaterThanOrEqual(0)
      expect(rem).toBeLessThan(1.5)
    }
  })
})

describe('旋转开关', () => {
  it('关掉时 rotate / passedRotate 归零，但位移与缩放不受影响', () => {
    const on = build({ enableWordRotation: true })
    const off = build({ enableWordRotation: false })
    expect(off.words[0].rotate).toBe(0)
    expect(off.words[0].passedRotate).toBe(0)
    expect(off.words[0].x).toBeCloseTo(on.words[0].x, 12)
    expect(off.words[0].scale).toBeCloseTo(on.words[0].scale, 12)
  })
})

describe('词间距与呼吸倍率的钳制', () => {
  it('wordSpacing 钳到 [0, 2]，非有限值退回默认 0.7', () => {
    expect(clampWordSpacing(-1)).toBe(0)
    expect(clampWordSpacing(3)).toBe(2)
    expect(clampWordSpacing(0.7)).toBe(0.7)
    expect(clampWordSpacing(Number.NaN)).toBe(0.7)
  })

  it('breathingFloatMultiplier 钳到 [0, 2]，非有限值退回默认 1', () => {
    expect(clampBreathingFloatMultiplier(-1)).toBe(0)
    expect(clampBreathingFloatMultiplier(5)).toBe(2)
    expect(clampBreathingFloatMultiplier(Number.NaN)).toBe(1)
  })
})

describe('等待 / 唱过的姿态', () => {
  it('waiting 的 x / y 是"从远处飘来"的起点（sin(y)*100 / cos(x)*50）', () => {
    // ⚠️ sin 的入参是 **y**、cos 的入参是 **x** —— 看着像笔误，是 Folia 原样
    const pose = resolveWaitingPose({ x: 12, y: -8, rotate: 5 }, true)
    expect(pose.x).toBe(12 + Math.sin(-8) * 100)
    expect(pose.y).toBe(-8 + Math.cos(12) * 50)
    expect(pose.rotate).toBe(25)
    expect(pose.opacity).toBe(0)
    expect(pose.scale).toBe(0.5)
  })

  it('关掉旋转时 waiting 的 rotate 也归零', () => {
    expect(resolveWaitingPose({ x: 0, y: 0, rotate: 5 }, false).rotate).toBe(0)
  })

  it('passed 的不透明度：chaotic 0.9，其余 0.82', () => {
    expect(resolvePassedOpacity('chaotic')).toBe(0.9)
    expect(resolvePassedOpacity('normal')).toBe(0.82)
    expect(resolvePassedOpacity('calm')).toBe(0.82)
  })
})

describe('整行呼吸浮动', () => {
  it('normal 档：14px / 7s', () => {
    expect(buildLineFloat('normal', 1)).toEqual({ distance: 14, duration: 7, multiplier: 1 })
  })

  it('calm 10px / 8.5s，chaotic 18px / 5.8s', () => {
    expect(buildLineFloat('calm', 1)).toEqual({ distance: 10, duration: 8.5, multiplier: 1 })
    expect(buildLineFloat('chaotic', 1)).toEqual({ distance: 18, duration: 5.8, multiplier: 1 })
  })

  it('倍率只缩放距离、不改周期', () => {
    expect(buildLineFloat('normal', 0.5)).toEqual({ distance: 7, duration: 7, multiplier: 0.5 })
  })

  it('倍率 <= 0 时完全不浮动（返回 null，而不是把幅度调成 0）', () => {
    expect(buildLineFloat('normal', 0)).toBeNull()
    expect(buildLineFloat('normal', -1)).toBeNull()
  })

  it('倍率超过 2 被钳到 2', () => {
    expect(buildLineFloat('normal', 9)?.distance).toBe(28)
  })
})
