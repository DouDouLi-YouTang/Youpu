import { describe, expect, it } from 'vitest'

import { stepClock, type ClockState } from './clock-core'

/**
 * 逐帧时钟核心的不变量。这一层的正确性靠**性质**保证，不靠"看着差不多"：
 * 时间长了会偏、seek 了不跟、暂停了还在走 —— 三类故障都只在真实播放里才暴露，
 * 所以每条规则都在这里钉死。
 */

/** 模拟连续帧：返回最后一帧状态，便于断言收敛结果。 */
function runFrames(
  frames: { targetMs: number; deltaMs: number; isPlaying?: boolean; playbackRate?: number }[],
  start: ClockState | null = null
): ClockState {
  let state = start
  for (const frame of frames) {
    state = stepClock({
      previous: state,
      targetMs: frame.targetMs,
      deltaMs: frame.deltaMs,
      isPlaying: frame.isPlaying ?? true,
      playbackRate: frame.playbackRate ?? 1
    })
  }
  // 首帧不可能为空（frames 非空时循环至少跑一次）
  return state as ClockState
}

describe('首帧', () => {
  it('没有上一状态时直接落到真值，不从 0 爬', () => {
    // 从 0 开始平滑会看到"歌词从头飞快滚到当前位置"
    const state = runFrames([{ targetMs: 42_000, deltaMs: 16 }])
    expect(state.timeMs).toBe(42_000)
    expect(state.lastTargetMs).toBe(42_000)
  })

  it('真值非有限时也不产生 NaN 时钟', () => {
    const state = stepClock({
      previous: null,
      targetMs: Number.NaN,
      deltaMs: 16,
      isPlaying: true,
      playbackRate: 1
    })
    expect(Number.isFinite(state.timeMs)).toBe(true)
    expect(state.timeMs).toBe(0)
  })
})

describe('外推', () => {
  it('播放中按帧间隔推进，不等离散快照', () => {
    // 真值 250ms 才更新一次，但时钟必须每帧都在走 —— 这正是本层存在的理由
    const start = runFrames([{ targetMs: 10_000, deltaMs: 16 }])
    const next = stepClock({
      previous: start,
      targetMs: 10_000, // 真值还没变（下一个 timeupdate 未到）
      deltaMs: 16,
      isPlaying: true,
      playbackRate: 1
    })
    expect(next.timeMs).toBeGreaterThan(start.timeMs)
  })

  it('两个样本之间是纯外推：不因"超前了过期真值"而被回拉', () => {
    // 这是最容易写错的一处：真值 250ms 才来一次，中间的每帧都在外推。
    // 若每帧都朝旧真值收敛，时钟会以约 87% 的速度前进（系统性跑慢）。
    let state = runFrames([{ targetMs: 0, deltaMs: 0 }], { timeMs: 0, lastTargetMs: 0 })
    const startTime = state.timeMs
    for (let i = 0; i < 15; i++) {
      state = stepClock({
        previous: state,
        targetMs: 0, // 样本没变
        deltaMs: 16,
        isPlaying: true,
        playbackRate: 1
      })
    }
    // 15 帧 × 16ms = 240ms 外推，必须全额保留（不得被收敛项吃掉任何一点）
    expect(state.timeMs - startTime).toBeCloseTo(240, 5)
  })

  it('倍速参与外推：0.5x 走得慢、1.5x 走得快', () => {
    const previous: ClockState = { timeMs: 10_000, lastTargetMs: 10_000 }
    const base = { previous, targetMs: 10_000, deltaMs: 100 }
    const slow = stepClock({ ...base, isPlaying: true, playbackRate: 0.5 })
    const normal = stepClock({ ...base, isPlaying: true, playbackRate: 1 })
    const fast = stepClock({ ...base, isPlaying: true, playbackRate: 1.5 })

    expect(slow.timeMs).toBeLessThan(normal.timeMs)
    expect(fast.timeMs).toBeGreaterThan(normal.timeMs)
    // 外推量本身就是 delta × rate（此处误差为 0，收敛项不参与）
    expect(slow.timeMs).toBeCloseTo(10_050, 5)
    expect(normal.timeMs).toBeCloseTo(10_100, 5)
    expect(fast.timeMs).toBeCloseTo(10_150, 5)
  })

  it('暂停时时间停住（不外推）', () => {
    const paused = stepClock({
      previous: { timeMs: 10_000, lastTargetMs: 10_000 },
      targetMs: 10_000,
      deltaMs: 100,
      isPlaying: false,
      playbackRate: 1
    })
    expect(paused.timeMs).toBe(10_000)
  })

  it('帧间隔非法（NaN / 负数）时按 0 处理，不推飞时钟', () => {
    for (const deltaMs of [Number.NaN, -16, Number.NEGATIVE_INFINITY]) {
      const state = stepClock({
        previous: { timeMs: 5_000, lastTargetMs: 5_000 },
        targetMs: 5_000,
        deltaMs,
        isPlaying: true,
        playbackRate: 1
      })
      expect(state.timeMs).toBe(5_000)
    }
  })

  it('单帧墙上时间被钳到 250ms —— 后台标签页恢复时不跳一大段', () => {
    const state = stepClock({
      previous: { timeMs: 0, lastTargetMs: 0 },
      targetMs: 0,
      deltaMs: 30_000, // 标签页被挂起 30 秒
      isPlaying: true,
      playbackRate: 1
    })
    expect(state.timeMs).toBe(250)
  })

  it('倍速非法（0 / 负数 / NaN）时按 1 处理，不把时钟钉死', () => {
    for (const playbackRate of [0, -1, Number.NaN]) {
      const state = stepClock({
        previous: { timeMs: 1_000, lastTargetMs: 1_000 },
        targetMs: 1_000,
        deltaMs: 100,
        isPlaying: true,
        playbackRate
      })
      expect(state.timeMs).toBe(1_100)
    }
  })
})

describe('吸附（结构性偏差）', () => {
  it('seek 跳变（超过阈值）立刻对齐，不滑过去', () => {
    const state = stepClock({
      previous: { timeMs: 10_000, lastTargetMs: 10_000 },
      targetMs: 90_000, // 用户拖了进度条
      deltaMs: 16,
      isPlaying: true,
      playbackRate: 1
    })
    expect(state.timeMs).toBe(90_000)
  })

  it('向后 seek 同样立刻对齐', () => {
    const state = stepClock({
      previous: { timeMs: 90_000, lastTargetMs: 90_000 },
      targetMs: 10_000,
      deltaMs: 16,
      isPlaying: true,
      playbackRate: 1
    })
    expect(state.timeMs).toBe(10_000)
  })

  it('暂停中 seek 也要立刻反映（吸附不受 isPlaying 限制）', () => {
    const state = stepClock({
      previous: { timeMs: 10_000, lastTargetMs: 10_000 },
      targetMs: 30_000,
      deltaMs: 16,
      isPlaying: false,
      playbackRate: 1
    })
    expect(state.timeMs).toBe(30_000)
  })

  it('恰好等于阈值时吸附（边界含等号）', () => {
    const state = stepClock({
      previous: { timeMs: 0, lastTargetMs: 0 },
      targetMs: 120,
      deltaMs: 0,
      isPlaying: true,
      playbackRate: 1
    })
    expect(state.timeMs).toBe(120)
  })
})

describe('暂停中的小范围重定位', () => {
  it('暂停中 50ms 的 seek 直接对齐（不是渐进收敛）', () => {
    // 暂停时快照只来一次，若走渐进收敛，时钟会**永久**差着这 50ms。
    const state = stepClock({
      previous: { timeMs: 10_000, lastTargetMs: 10_000 },
      targetMs: 10_050,
      deltaMs: 16,
      isPlaying: false,
      playbackRate: 1
    })
    expect(state.timeMs).toBe(10_050)
  })
})

describe('渐进收敛（漂移）', () => {
  it('新样本带来的小误差按比例收敛，一次不抹平', () => {
    // 时钟落后真值 100ms（低于吸附阈值 120），必须平滑追上而不是一帧对齐
    const first = stepClock({
      previous: { timeMs: 9_900, lastTargetMs: 9_900 },
      targetMs: 10_000, // 新样本
      deltaMs: 0,
      isPlaying: true,
      playbackRate: 1
    })
    expect(first.timeMs).toBeGreaterThan(9_900)
    expect(first.timeMs).toBeLessThan(10_000) // 一次没追平

    // 后续样本持续推进，最终必须收敛（相位锁定）
    let state = first
    let target = 10_000
    for (let i = 0; i < 400; i++) {
      target += 250 // 每个样本前进 250ms（4Hz）
      state = stepClock({
        previous: state,
        targetMs: target,
        deltaMs: 250,
        isPlaying: true,
        playbackRate: 1
      })
    }
    expect(Math.abs(state.timeMs - target)).toBeLessThan(30)
  })

  it('单次收敛量不超过上限（大误差也不会一步跳一大截）', () => {
    // 误差 110ms（低于吸附阈值），单次回灌最多 25ms
    const state = stepClock({
      previous: { timeMs: 9_890, lastTargetMs: 9_890 },
      targetMs: 10_000,
      deltaMs: 0,
      isPlaying: true,
      playbackRate: 1
    })
    expect(state.timeMs).toBeLessThanOrEqual(9_915)
    expect(state.timeMs).toBeGreaterThan(9_890)
  })

  it('收敛方向是双向的：时钟超前真值时往回收', () => {
    const state = stepClock({
      previous: { timeMs: 10_100, lastTargetMs: 10_100 },
      targetMs: 10_000,
      deltaMs: 0,
      isPlaying: true,
      playbackRate: 1
    })
    expect(state.timeMs).toBeLessThan(10_100)
    expect(state.timeMs).toBeGreaterThanOrEqual(10_000)
  })
})

describe('真实播放序列（4Hz 快照 + 60fps 外推）', () => {
  it('相邻两次 timeupdate 之间时钟连续推进，且不会跑在真值前面太多', () => {
    // 250ms 一次真值更新（每次 +250），中间按 16ms 帧推进
    let state: ClockState | null = null
    const samples: number[] = []

    // 真值序列 250 / 500 / ... / 5250，每个真值保持 16 帧（≈250ms）。
    // 真值在整个窗口内**不变**，窗口切换时它才变 —— 这正是真实 timeupdate 的形态：
    // 样本是阶梯状的，而"样本变了"这个事件在整个窗口里只发生一次（窗口第一帧）。
    for (let sample = 1; sample <= 21; sample++) {
      const targetMs = sample * 250
      for (let frame = 0; frame < 16; frame++) {
        const deltaMs = state === null ? 0 : 16
        state = stepClock({
          previous: state,
          targetMs,
          deltaMs,
          isPlaying: true,
          playbackRate: 1
        })
        samples.push(state.timeMs)
      }
    }

    // 单调不减：时钟不允许倒退（否则动画会回跳）
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1])
    }

    // 关键断言：时钟要跟住**音频真值**，不是跟住最后一个样本。
    // 样本是过期的测量值（窗口结束时它已经旧了 240ms），时钟领先它是对的；
    // 拿时钟去比样本值会得出"超前太多"的错误结论。
    //
    // 最后一个窗口：样本 5250 到达后又推进了 15 帧 × 16ms = 240ms，
    // 因此窗口结束时音频真值约为 5490。时钟应当贴在它附近（容差 50ms）。
    const finalState = state as ClockState
    const lastSampleMs = 5_250
    const truePositionMs = lastSampleMs + 15 * 16
    expect(Math.abs(finalState.timeMs - truePositionMs)).toBeLessThan(50)

    // 且全程没有出现过吸附（误差始终小于阈值）：一次跳变都没有
    const jumps = samples.filter((sample, index) => index > 0 && sample - samples[index - 1] > 100)
    expect(jumps).toHaveLength(0)
  })
})
