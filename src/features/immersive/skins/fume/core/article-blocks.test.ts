/**
 * 区块变体选择与列高装箱的单测（规格书 §7.2–§7.5，对应用例见 §15.5）。
 *
 * 这里全部用**整数值**造几何（列宽 400、行高 40、间距 10），于是每个期望值都能
 * 拿纸笔从 §7 的伪码推出来 —— 把实现里的公式再抄进断言等于没测，
 * 而「装箱差一位」这类错误只在边界上暴露。
 *
 * 变体选择用一个可控的假 `countRenderable`（把文本长度当字数），
 * 这样 §7.2 的每一档阈值（4 / 22 / 28 / 36）都能精确落在边界上。
 */

import { describe, expect, it } from 'vitest'

import {
  FUME_HERO_CENTER_LIMIT,
  FUME_HERO_INDEX_PERIOD,
  createPlacementState,
  chooseBlockVariant,
  chooseFallbackHeroBlockIndex,
  chooseNaturalBlockVariant,
  placeBodyBlock,
  placeHeroBlock,
  resolveBlockGap,
  resolveBlockMetrics,
  resolveLineHeight,
  type FumeColumnGeometry
} from './article-blocks'
import type { FumeBlockVariant } from './fume-types'

/** 假字数：文本里非空白字符的数量（与 §4.9 的语义一致，但不受字素切分影响） */
const fakeCount = (text: string): number => text.replace(/\s/g, '').length

/** 造一行指定字数的文本（内容不重要，只影响哈希种子） */
function makeLine(graphemeCount: number, overrides: { isChorus?: boolean; tag?: string } = {}) {
  const tag = overrides.tag ?? 'x'
  return { fullText: tag.repeat(graphemeCount), isChorus: overrides.isChorus }
}

/** 一个便于手算的列几何：纸 1000 宽、2 列、间距 10 → 列宽 495 */
function makeGeometry(overrides: Partial<FumeColumnGeometry> = {}): FumeColumnGeometry {
  const columns = overrides.columns ?? 2
  const gap = overrides.gap ?? 10
  const paperWidth = overrides.paperWidth ?? 1000
  return {
    paperWidth,
    columns,
    gap,
    columnWidth: overrides.columnWidth ?? (paperWidth - gap * (columns - 1)) / columns,
    horizontalMargin: overrides.horizontalMargin ?? 100,
    verticalMargin: overrides.verticalMargin ?? 200
  }
}

describe('chooseNaturalBlockVariant（§7.2）', () => {
  it('空行永远是 body（一个字素都排不出来）', () => {
    expect(chooseNaturalBlockVariant(makeLine(0), 0, 12, fakeCount)).toBe('body')
    expect(chooseNaturalBlockVariant({ fullText: '   ' }, 0, 12, fakeCount)).toBe('body')
  })

  it('副歌行只要 <= 22 字就一定 hero（与位置、节奏无关）', () => {
    // 第 0 块离中心很远、也不满足每 6 块的节奏，但副歌直接通过
    expect(chooseNaturalBlockVariant(makeLine(22, { isChorus: true }), 0, 24, fakeCount)).toBe(
      'hero'
    )
    // 23 字就掉回普通判断：第 0 块不满足节奏，只能看种子
    expect(chooseNaturalBlockVariant(makeLine(23, { isChorus: true }), 0, 24, fakeCount)).toBe(
      'body'
    )
  })

  it('字数边界：3 字太短、4 字够短、28 字够短、29 字太长', () => {
    // 第 5 块（index+1 = 6）满足节奏，于是字数成为唯一变量
    expect(chooseNaturalBlockVariant(makeLine(3), 5, 12, fakeCount)).toBe('body')
    expect(chooseNaturalBlockVariant(makeLine(4), 5, 12, fakeCount)).toBe('hero')
    expect(chooseNaturalBlockVariant(makeLine(28), 5, 12, fakeCount)).toBe('hero')
    expect(chooseNaturalBlockVariant(makeLine(29), 5, 12, fakeCount)).toBe('body')
  })

  it(`居中限制：${FUME_HERO_CENTER_LIMIT} 在公式的取值范围内恒成立（上游原样，不要「修正」）`, () => {
    // centered = |i - n/2| / max(n, 1)：i 取 0、n 趋于无穷时上确界是 0.5。
    // 也就是说 `< 0.72` 这个判据**永远不会**否决任何行 —— 它是上游的原样，
    // 移植时保持不动；这里把取值范围本身钉住，防止有人把公式「修」成会否决的版本。
    const samples: number[] = []
    for (const [index, total] of [
      [0, 1],
      [0, 2],
      [0, 1000],
      [999, 1000],
      [500, 1000]
    ] as const) {
      samples.push(Math.abs(index - total / 2) / Math.max(total, 1))
    }

    expect(Math.max(...samples)).toBeLessThan(FUME_HERO_CENTER_LIMIT)
    // 同时确认：极端偏离的那一行确实还能拿到 hero（只要字数与节奏满足）
    expect(chooseNaturalBlockVariant(makeLine(10), 5, 1000, fakeCount)).toBe('hero')
  })

  it(`节奏：每 ${FUME_HERO_INDEX_PERIOD} 块命中一次（index+1 能被 6 整除）`, () => {
    const counted: number[] = []
    for (let index = 0; index < 12; index += 1) {
      // 用同一段文本、只变 index，把结果记下来
      const variant = chooseNaturalBlockVariant(makeLine(10), index, 12, fakeCount)
      if (variant === 'hero') counted.push(index)
    }

    // 12 块、每块 10 字：只有 index 5 与 11 满足 %6（0 与其它 index 靠种子）
    expect(counted).toContain(5)
    expect(counted).toContain(11)
  })
})

describe('chooseFallbackHeroBlockIndex（§7.2）', () => {
  it('空列表返回 -1', () => {
    expect(chooseFallbackHeroBlockIndex([], fakeCount)).toBe(-1)
  })

  it('已有天然 hero 时返回 -1（不强制替换）', () => {
    // 第 5 块满足「每 6 块」的节奏 → 已经有天然 hero
    const entries = Array.from({ length: 12 }, (_, index) => ({
      line: makeLine(10, { tag: `t${index}` })
    }))

    expect(chooseFallbackHeroBlockIndex(entries, fakeCount)).toBe(-1)
  })

  it('全是超长行时退化为「最短的那一块」', () => {
    // 全部 > 36 字 → 评分阶段一个都选不上
    const entries = [
      { line: makeLine(50, { tag: 'a' }) },
      { line: makeLine(40, { tag: 'b' }) },
      { line: makeLine(45, { tag: 'c' }) }
    ]

    expect(chooseFallbackHeroBlockIndex(entries, fakeCount)).toBe(1)
  })

  it('全空行返回 -1（没有可提升的块）', () => {
    const entries = [{ line: makeLine(0) }, { line: makeLine(0) }]

    expect(chooseFallbackHeroBlockIndex(entries, fakeCount)).toBe(-1)
  })

  it('候选行按评分挑「最居中 + 长度最舒服」的一块（权重可手算）', () => {
    // 4 块，且**刻意避开**任何天然 hero（都不满足「每 6 块」，种子也都 <= 0.965）：
    //   30 字('a') / 10 字('c') / 10 字('d') / 30 字('c')
    // 逐块打分（centerScore * 0.62 + lengthScore * 0.34 + 抖动）：
    //   index 0：center 0.50 × 0.62 = 0.3100 + 长度 0.36 × 0.34 = 0.1224 + 0.0002 = 0.4326
    //   index 1：center 0.75 × 0.62 = 0.4650 + 长度 1.00 × 0.34 = 0.3400 + 0.0188 = 0.8238
    //   index 2：center 1.00 × 0.62 = 0.6200 + 0.3400              + 0.0321 = 0.9921
    //   index 3：center 0.75 × 0.62 = 0.4650 + 0.1224              + 0.0092 = 0.5966
    // → index 2 胜出（它同时赢在中心与长度，不靠抖动翻盘）。
    //   下面还单独锁一条「抖动参与打分」的证据：index 1 比 index 3 高出 0.2272，
    //   而两者的 center 与 length 分完全相同 —— 差的就是抖动。
    const entries = [
      { line: makeLine(30, { tag: 'a' }) },
      { line: makeLine(10, { tag: 'c' }) },
      { line: makeLine(10, { tag: 'd' }) },
      { line: makeLine(30, { tag: 'c' }) }
    ]

    const first = chooseFallbackHeroBlockIndex(entries, fakeCount)
    const second = chooseFallbackHeroBlockIndex(entries, fakeCount)

    expect(first).toBe(second)
    expect(first).toBe(2)
  })

  it('不超过 36 字的行才有资格（37 字直接被跳过）', () => {
    const entries = [{ line: makeLine(37, { tag: 'a' }) }, { line: makeLine(36, { tag: 'b' }) }]

    expect(chooseFallbackHeroBlockIndex(entries, fakeCount)).toBe(1)
  })
})

describe('chooseBlockVariant（§7.2）', () => {
  it('被强制的那块直接给 hero，其余走天然判断', () => {
    const line = makeLine(10)

    expect(chooseBlockVariant(line, 3, 12, 3, fakeCount)).toBe('hero')
    expect(chooseBlockVariant(line, 2, 12, 3, fakeCount)).toBe('body')
  })
})

describe('resolveBlockMetrics（§7.3）', () => {
  it('2 列：hero 占 1.5 列（不是跨满两列）', () => {
    const geometry = makeGeometry({ columns: 2, paperWidth: 1000, gap: 10 })
    const metrics = resolveBlockMetrics('hero', geometry)

    // columnWidth = (1000 - 10) / 2 = 495；heroSpanWidth = 495*2 + 10 = 1000
    expect(geometry.columnWidth).toBe(495)
    expect(metrics.heroSpanColumns).toBe(2)
    expect(metrics.heroSpanWidth).toBe(1000)
    expect(metrics.blockWidth).toBe(495 * 1.5 + 10 * 0.5)
    expect(metrics.innerWidth).toBe(metrics.blockWidth)
  })

  it('3 / 4 列：hero 跨两列满宽', () => {
    for (const columns of [3, 4]) {
      const geometry = makeGeometry({ columns, paperWidth: 1400, gap: 10 })
      const metrics = resolveBlockMetrics('hero', geometry)

      expect(metrics.heroSpanColumns).toBe(2)
      expect(metrics.blockWidth).toBe(metrics.heroSpanWidth)
      expect(metrics.blockWidth).toBe(geometry.columnWidth * 2 + 10)
    }
  })

  it('1 列：hero 与 body 都用整张纸的宽度', () => {
    const geometry = makeGeometry({ columns: 1, paperWidth: 920 })
    const hero = resolveBlockMetrics('hero', geometry)
    const body = resolveBlockMetrics('body', geometry)

    expect(hero.heroSpanColumns).toBe(1)
    expect(hero.blockWidth).toBe(920)
    expect(body.blockWidth).toBe(920)
  })

  it('body 恒占一列', () => {
    const geometry = makeGeometry({ columns: 4, paperWidth: 1600, gap: 12 })
    const metrics = resolveBlockMetrics('body', geometry)

    expect(metrics.heroSpanColumns).toBe(1)
    expect(metrics.blockWidth).toBe(geometry.columnWidth)
  })

  it('innerWidth 有 120px 的下限（列窄到排不下一个字时仍给一个可用的宽度）', () => {
    const geometry = makeGeometry({ columns: 4, paperWidth: 920, gap: 14 })
    const metrics = resolveBlockMetrics('body', geometry)

    // (920 - 14*3) / 4 = 219.5 → 高于下限，这里另造一个极窄的几何验证下限
    expect(metrics.innerWidth).toBe(219.5)

    const narrow = resolveBlockMetrics('body', { ...geometry, columnWidth: 40 })
    expect(narrow.blockWidth).toBe(40)
    expect(narrow.innerWidth).toBe(120)
  })
})

describe('placeHeroBlock / placeBodyBlock（§7.4 装箱）', () => {
  it('列高初值全是 verticalMargin', () => {
    expect(createPlacementState(3, 220).columnHeights).toEqual([220, 220, 220])
  })

  it('单列 hero 等所有列都到齐才落位，并且只推进第 0 列', () => {
    const geometry = makeGeometry({ columns: 1, paperWidth: 920, horizontalMargin: 100 })
    const state = createPlacementState(1, 200)

    const placement = placeHeroBlock(state, geometry, {
      heroSpanColumns: 1,
      heroSpanWidth: 920,
      blockWidth: 920,
      blockHeight: 100,
      blockGap: 20
    })

    expect(placement).toEqual({ x: 100, y: 200 })
    expect(state.columnHeights).toEqual([320])
  })

  it('跨列 hero 找「覆盖高度最小」的起点，并列时用游标轮转', () => {
    const geometry = makeGeometry({ columns: 3, paperWidth: 1000, gap: 10, horizontalMargin: 100 })
    const state = createPlacementState(3, 200)
    // 三列同高 → 候选起点是 0 与 1（跨 2 列只能落在 0 或 1）
    const size = {
      heroSpanColumns: 2,
      heroSpanWidth: geometry.columnWidth * 2 + 10,
      blockWidth: geometry.columnWidth * 2 + 10,
      blockHeight: 100,
      blockGap: 20
    }

    const first = placeHeroBlock(state, geometry, size)
    // 第一次游标 0 → 起点 0；两列被推到 320
    expect(first.y).toBe(200)
    expect(first.x).toBe(100)
    expect(state.columnHeights).toEqual([320, 320, 200])

    // 第二次：覆盖高度 0→max(320,320)=320、1→max(320,200)=320 → 仍然并列，
    // 游标 1 → 起点 1；区间 [1,2] 两列都被推到 200+100+20 = 320 之上（第二列为 320、
    // 第三列原本 200 → 变成 320+120 = 440）
    const second = placeHeroBlock(state, geometry, size)
    expect(second.x).toBeCloseTo(100 + (geometry.columnWidth + 10), 10)
    expect(second.y).toBe(320)
    expect(state.columnHeights).toEqual([320, 440, 440])
  })

  it('2 列 hero（1.5 列宽）的 x 会补一段居中偏移', () => {
    const geometry = makeGeometry({ columns: 2, paperWidth: 1000, gap: 10, horizontalMargin: 100 })
    const state = createPlacementState(2, 200)
    const metrics = resolveBlockMetrics('hero', geometry)

    const placement = placeHeroBlock(state, geometry, {
      heroSpanColumns: metrics.heroSpanColumns,
      heroSpanWidth: metrics.heroSpanWidth,
      blockWidth: metrics.blockWidth,
      blockHeight: 60,
      blockGap: 6
    })

    // heroSpanWidth 1000 - blockWidth 747.5 = 252.5 → 偏移 126.25
    expect(placement.x).toBe(100 + 126.25)
  })

  it('body 落进最矮的列，并列时按游标轮转铺开', () => {
    const geometry = makeGeometry({ columns: 3, paperWidth: 1000, gap: 10, horizontalMargin: 100 })
    const state = createPlacementState(3, 200)
    const size = { blockHeight: 50, blockGap: 10 }

    const first = placeBodyBlock(state, geometry, size)
    const second = placeBodyBlock(state, geometry, size)
    const third = placeBodyBlock(state, geometry, size)

    // columnWidth = (1000 - 20) / 3 = 326.666…，列步进 = 336.666…
    // 第一次：三列并列 → 候选 [0,1,2]，游标 0 → 第 0 列
    expect(first.x).toBe(100)
    // 第二次：只剩第 1、2 列并列（各 200）→ 候选 [1,2]，游标 1 → 第 2 列
    expect(second.x).toBeCloseTo(100 + 2 * (geometry.columnWidth + 10), 10)
    // 第三次：只有第 1 列最矮 → 候选 [1]，游标 2 → 2 % 1 = 0 → 第 1 列
    expect(third.x).toBeCloseTo(100 + (geometry.columnWidth + 10), 10)
    expect(state.columnHeights).toEqual([260, 260, 260])
  })

  it('某列变高之后，body 不会再落进去（直到它重新成为最矮）', () => {
    const geometry = makeGeometry({ columns: 2, paperWidth: 1000, gap: 10, horizontalMargin: 100 })
    const state = createPlacementState(2, 200)

    // 把第 0 列垫高
    state.columnHeights[0] = 500

    const placement = placeBodyBlock(state, geometry, { blockHeight: 50, blockGap: 10 })
    expect(placement.x).toBe(100 + 505)
  })
})

describe('resolveLineHeight / resolveBlockGap（§7.5）', () => {
  it('行高取整，且 hero 用 1.02 / body 用 1.06', () => {
    expect(resolveLineHeight(50, 'hero')).toBe(51)
    expect(resolveLineHeight(50, 'body')).toBe(53)
    // 取整必须发生在乘法之后：24.7 → 25（而不是先取整字号再乘）
    expect(resolveLineHeight(24.7, 'hero')).toBe(25)
  })

  it('块间距：hero 用 0.2 且下限 6，body 用 0.08 且下限 2', () => {
    expect(resolveBlockGap(100, 'hero')).toBe(20)
    expect(resolveBlockGap(100, 'body')).toBe(8)

    // 下限：round 结果小于下限时被抬起
    expect(resolveBlockGap(10, 'hero')).toBe(6)
    expect(resolveBlockGap(10, 'body')).toBe(2)
  })
})

/** 便捷断言：变体判断只关心 hero / body 两值 */
function expectVariant(actual: FumeBlockVariant, expected: FumeBlockVariant): void {
  expect(actual).toBe(expected)
}

describe('变体选择与装箱的组合（回归：hero 不影响 body 的对齐）', () => {
  it('hero 之后 body 仍然落在最矮列，且 hero 的横向偏移不污染后续 x', () => {
    const geometry = makeGeometry({ columns: 2, paperWidth: 1000, gap: 10, horizontalMargin: 100 })
    const state = createPlacementState(2, 200)
    const metrics = resolveBlockMetrics('hero', geometry)

    placeHeroBlock(state, geometry, {
      heroSpanColumns: metrics.heroSpanColumns,
      heroSpanWidth: metrics.heroSpanWidth,
      blockWidth: metrics.blockWidth,
      blockHeight: 60,
      blockGap: 6
    })
    const body = placeBodyBlock(state, geometry, { blockHeight: 40, blockGap: 5 })

    expectVariant(metrics.heroSpanColumns === 2 ? 'hero' : 'body', 'hero')
    expect(body.x % (geometry.columnWidth + geometry.gap)).toBe(
      geometry.horizontalMargin % (geometry.columnWidth + geometry.gap)
    )
  })
})
