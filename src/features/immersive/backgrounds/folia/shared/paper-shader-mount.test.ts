import { describe, expect, it, vi } from 'vitest'

import type { ShaderMount } from '@paper-design/shaders'

import {
  RESIZE_SETTLE_MS,
  createResizeCoalescer,
  installCoalescedResize,
  updatePaperShaderUniforms,
  type PaperShaderHandle,
  type ResizeCoalescerClock
} from './paper-shader-mount'

/**
 * 这两组用例守的都是**性能缺陷**，不是视觉：
 *  1. 逐帧 uniform 更新必须走 `setUniformValues`（只写值），否则每帧多画一遍全屏；
 *  2. 连续 resize 必须合并，否则拖动窗口时每个 ResizeObserver 回调都同步重设
 *     drawing buffer 并立即重绘（实测单次约 12ms）。
 *
 * 用假时钟而不是真 rAF：resize 合并的正确性全在「哪一帧执行、静默期怎么推迟」上，
 * 真定时器只能靠 sleep 猜，测不稳。
 */

function createFakeHandle() {
  const setUniforms = vi.fn()
  const setUniformValues = vi.fn()
  const handle = {
    canvas: {},
    setUniforms,
    setUniformValues,
    setSpeed: vi.fn(),
    setFrame: vi.fn(),
    getCurrentFrame: () => 0,
    dispose: vi.fn()
  } as unknown as PaperShaderHandle
  return { handle, setUniforms, setUniformValues }
}

interface FakeClock {
  clock: ResizeCoalescerClock
  /** 执行当前已排队的 rAF 回调（模拟「到了下一帧」）。 */
  runFrames: () => void
  /** 把虚拟时钟推进 ms，并触发所有到期的定时器。 */
  advance: (ms: number) => void
  pendingFrames: () => number
}

function createFakeClock(): FakeClock {
  let current = 0
  let nextId = 1
  const frames = new Map<number, () => void>()
  const timers = new Map<number, { at: number; callback: () => void }>()

  return {
    clock: {
      requestFrame: (callback) => {
        const id = nextId++
        frames.set(id, callback)
        return id
      },
      cancelFrame: (id) => {
        frames.delete(id)
      },
      startTimer: (callback, delayMs) => {
        const id = nextId++
        timers.set(id, { at: current + delayMs, callback })
        return id
      },
      clearTimer: (id) => {
        timers.delete(id)
      }
    },
    runFrames() {
      const queued = [...frames.values()]
      frames.clear()
      for (const callback of queued) callback()
    },
    advance(ms) {
      current += ms
      for (const [id, timer] of [...timers.entries()]) {
        if (timer.at > current) continue
        timers.delete(id)
        timer.callback()
      }
    },
    pendingFrames: () => frames.size
  }
}

/** 假的 `ShaderMount`：只实现被 installCoalescedResize 用到的那部分。 */
function createFakeMount() {
  const applied: number[] = []
  const mount = {
    /** 模拟 ResizeObserver 写进实例字段的最新尺寸 */
    latestWidth: 0,
    handleResize: (): void => {
      applied.push(mount.latestWidth)
    }
  }
  return { mount, applied }
}

describe('updatePaperShaderUniforms', () => {
  it('动画中走 setUniformValues：只写值，不触发第二次全屏绘制', () => {
    const { handle, setUniforms, setUniformValues } = createFakeHandle()

    updatePaperShaderUniforms(handle, { u_distortion: 0.4 }, true)

    expect(setUniformValues).toHaveBeenCalledTimes(1)
    expect(setUniformValues).toHaveBeenCalledWith({ u_distortion: 0.4 })
    expect(setUniforms).not.toHaveBeenCalled()
  })

  it('静态档（speed = 0）走 setUniforms：没有帧循环，必须立刻画一次', () => {
    const { handle, setUniforms, setUniformValues } = createFakeHandle()

    updatePaperShaderUniforms(handle, { u_swirl: 0.2 }, false)

    expect(setUniforms).toHaveBeenCalledTimes(1)
    expect(setUniformValues).not.toHaveBeenCalled()
  })

  it('paper 版本变更导致 setUniformValues 缺失时退回 setUniforms（宁可多画一屏，不能丢更新）', () => {
    const { handle, setUniforms, setUniformValues } = createFakeHandle()
    // 模拟旧版 paper：handle 上没有 setUniformValues
    ;(handle as { setUniformValues?: unknown }).setUniformValues = undefined

    updatePaperShaderUniforms(handle, { u_pxSize: 2 }, true)

    expect(setUniforms).toHaveBeenCalledTimes(1)
    expect(setUniformValues).not.toHaveBeenCalled()
  })
})

describe('createResizeCoalescer', () => {
  it('空闲时收到请求：下一帧立刻落地一次，之后不再重复落地', () => {
    const fake = createFakeClock()
    const coalescer = createResizeCoalescer(fake.clock)
    const run = vi.fn()

    coalescer.request(run)
    expect(run).not.toHaveBeenCalled()

    fake.runFrames()
    expect(run).toHaveBeenCalledTimes(1)

    fake.advance(RESIZE_SETTLE_MS)
    fake.runFrames()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('连续请求（拖动窗口）只在首帧与静默期结束各落地一次', () => {
    const fake = createFakeClock()
    const coalescer = createResizeCoalescer(fake.clock)
    const run = vi.fn()

    for (let step = 0; step < 30; step += 1) {
      coalescer.request(run)
      fake.runFrames()
      fake.advance(20)
    }

    expect(run).toHaveBeenCalledTimes(1)

    fake.advance(RESIZE_SETTLE_MS)
    fake.runFrames()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('dispose 后不再执行挂起的任务', () => {
    const fake = createFakeClock()
    const coalescer = createResizeCoalescer(fake.clock)
    const run = vi.fn()

    coalescer.request(run)
    coalescer.dispose()
    fake.runFrames()
    fake.advance(RESIZE_SETTLE_MS)
    fake.runFrames()

    expect(run).not.toHaveBeenCalled()
    expect(fake.pendingFrames()).toBe(0)
  })
})

describe('installCoalescedResize', () => {
  it('首次回调保持同步（首屏不能停在 canvas 默认尺寸）', () => {
    const fake = createFakeClock()
    const { mount, applied } = createFakeMount()
    installCoalescedResize(mount as unknown as ShaderMount, fake.clock)

    mount.latestWidth = 1600
    mount.handleResize()

    expect(applied).toEqual([1600])
  })

  it('拖动期间只落地「首屏同步 + 前沿一帧」，中间尺寸全跳过，停手后按最新尺寸补一次', () => {
    const fake = createFakeClock()
    const { mount, applied } = createFakeMount()
    installCoalescedResize(mount as unknown as ShaderMount, fake.clock)

    mount.latestWidth = 800
    mount.handleResize()
    expect(applied).toEqual([800])

    for (let width = 810; width <= 1100; width += 10) {
      mount.latestWidth = width
      mount.handleResize()
      fake.runFrames()
      fake.advance(16)
    }
    // 30 次尺寸变化只重设了 2 次 drawing buffer（12ms/次的来源被砍掉 28 次）
    expect(applied).toEqual([800, 810])

    fake.advance(RESIZE_SETTLE_MS)
    fake.runFrames()
    // 最终尺寸精确落在最后一次请求上，不会停在中间尺寸
    expect(applied).toEqual([800, 810, 1100])
  })

  it('返回的清理函数让组件卸载后不再重设尺寸', () => {
    const fake = createFakeClock()
    const { mount, applied } = createFakeMount()
    const dispose = installCoalescedResize(mount as unknown as ShaderMount, fake.clock)

    mount.latestWidth = 500
    mount.handleResize()
    mount.latestWidth = 600
    mount.handleResize()
    dispose()

    fake.advance(RESIZE_SETTLE_MS)
    fake.runFrames()
    expect(applied).toEqual([500])
  })
})
