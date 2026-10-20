import { describe, expect, it } from 'vitest'

import { PLAYER_DURATION_EPSILON_MS, shouldApplyPlayerDuration } from './media-duration'

describe('shouldApplyPlayerDuration', () => {
  it('第一次拿到真实时长必须写回', () => {
    expect(shouldApplyPlayerDuration(0, 268051)).toBe(true)
  })

  it('浮点尾数级抖动不写回（否则排版缓存键每 250ms 失效一次）', () => {
    expect(shouldApplyPlayerDuration(268051.973, 268052.002)).toBe(false)
  })

  it('音质切换这类秒级修正必须写回', () => {
    expect(shouldApplyPlayerDuration(268051.973, 269500)).toBe(true)
  })

  it('正好等于阈值时写回（边界取等号）', () => {
    expect(shouldApplyPlayerDuration(268000, 268000 + PLAYER_DURATION_EPSILON_MS)).toBe(true)
  })

  it('非法 / 非正的下一时长一律忽略', () => {
    expect(shouldApplyPlayerDuration(268000, Number.NaN)).toBe(false)
    expect(shouldApplyPlayerDuration(268000, 0)).toBe(false)
    expect(shouldApplyPlayerDuration(268000, -1)).toBe(false)
  })
})
