import { describe, expect, it } from 'vitest'

import {
  resolvePlayerShortcut,
  resolveSeekTarget,
  resolveVolumeTarget,
  SEEK_STEP_MS,
  VOLUME_STEP
} from './player-shortcuts'

describe('resolvePlayerShortcut', () => {
  it('四个方向键各自映射到一个动作', () => {
    expect(resolvePlayerShortcut('ArrowLeft')).toBe('seek-back')
    expect(resolvePlayerShortcut('ArrowRight')).toBe('seek-forward')
    expect(resolvePlayerShortcut('ArrowUp')).toBe('volume-up')
    expect(resolvePlayerShortcut('ArrowDown')).toBe('volume-down')
  })

  it('其它键一律放行（返回 null，调用方不拦截默认行为）', () => {
    for (const key of ['Escape', 'Enter', 'a', ' ', 'Home', 'End', 'PageUp', 'ArrowLeftX']) {
      expect(resolvePlayerShortcut(key)).toBeNull()
    }
  })
})

describe('resolveSeekTarget', () => {
  it('按 ±5 秒跳，步长是常量', () => {
    expect(SEEK_STEP_MS).toBe(5000)
    expect(resolveSeekTarget(30_000, 200_000, 'forward')).toBe(35_000)
    expect(resolveSeekTarget(30_000, 200_000, 'back')).toBe(25_000)
  })

  it('两端都钳住：开头不越 0，结尾不越时长', () => {
    expect(resolveSeekTarget(2_000, 200_000, 'back')).toBe(0)
    expect(resolveSeekTarget(198_000, 200_000, 'forward')).toBe(200_000)
    // 正好压在边界上：再往前也不动
    expect(resolveSeekTarget(0, 200_000, 'back')).toBe(0)
    expect(resolveSeekTarget(200_000, 200_000, 'forward')).toBe(200_000)
  })

  it('时长未知时不跳（返回原值），而不是跳到 0 或 NaN', () => {
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveSeekTarget(12_345, duration, 'forward')).toBe(12_345)
    }
  })

  it('当前进度为非有限值时按 0 起算，不产生 NaN', () => {
    expect(resolveSeekTarget(Number.NaN, 200_000, 'forward')).toBe(5_000)
    expect(resolveSeekTarget(Number.NaN, 200_000, 'back')).toBe(0)
  })
})

describe('resolveVolumeTarget', () => {
  it('按 ±5% 调，步长是常量', () => {
    expect(VOLUME_STEP).toBe(0.05)
    expect(resolveVolumeTarget(0.5, 'up')).toBeCloseTo(0.55, 10)
    expect(resolveVolumeTarget(0.5, 'down')).toBeCloseTo(0.45, 10)
  })

  it('钳进 [0, 1]', () => {
    expect(resolveVolumeTarget(0.98, 'up')).toBe(1)
    expect(resolveVolumeTarget(0.02, 'down')).toBe(0)
    expect(resolveVolumeTarget(1, 'up')).toBe(1)
    expect(resolveVolumeTarget(0, 'down')).toBe(0)
  })

  it('非有限值按 0 起算（不把音量永久写成 NaN）', () => {
    expect(resolveVolumeTarget(Number.NaN, 'up')).toBeCloseTo(0.05, 10)
  })
})
