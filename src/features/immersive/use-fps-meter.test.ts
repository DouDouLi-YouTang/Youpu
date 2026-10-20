import { describe, expect, it } from 'vitest'

import { clampFps, FPS_CAP, FPS_WINDOW_MS } from './use-fps-meter'

/**
 * 帧率统计的**纯算法**部分单测。
 *
 * `use-fps-meter.ts` 本身依赖 Vue 生命周期与 `requestAnimationFrame`，
 * 在 node 环境里跑不起来；这里用同一套窗口累计逻辑复算一遍，钉住三条约定：
 *  1. 窗口按真实经过时间换算（窗口被长任务撑长时读数会下降，而不是仍显示 60）；
 *  2. 不足一个窗口时不出读数（避免刚打开就闪一个 1 或 0）；
 *  3. 停掉再开时从零开始，不把停掉期间的空档算进去。
 */
function createCounter() {
  let windowStart = 0
  let frames = 0
  let fps = 0
  return {
    get fps() {
      return fps
    },
    push(now: number): void {
      if (windowStart === 0) {
        windowStart = now
        frames = 1
        return
      }
      frames += 1
      const elapsed = now - windowStart
      if (elapsed < FPS_WINDOW_MS) return
      fps = clampFps((frames * 1000) / elapsed)
      windowStart = now
      frames = 0
    },
    reset(): void {
      windowStart = 0
      frames = 0
      fps = 0
    }
  }
}

/**
 * 以 `fps` 的节奏喂帧，持续 `durationMs`。
 *
 * 步长按**整数毫秒**取（60fps → 16ms → 读数 62；30fps → 33ms → 读数 30）：
 * 真实 rAF 的时间戳也不是精确的 16.667ms，窗口换算取整后本来就会落在相邻整数上。
 * 断言因此只要求「接近目标值」，钉住的是**算法口径**而不是浮点巧合。
 */
function feed(counter: ReturnType<typeof createCounter>, fps: number, durationMs: number): void {
  const step = Math.round(1000 / fps)
  for (let now = 0; now <= durationMs; now += step) counter.push(now)
}

describe('useFpsMeter 的窗口统计', () => {
  it('稳定 60fps → 读数落在 60 附近', () => {
    const counter = createCounter()
    feed(counter, 60, FPS_WINDOW_MS * 4)
    expect(counter.fps).toBeGreaterThanOrEqual(58)
    expect(counter.fps).toBeLessThanOrEqual(63)
  })

  it('稳定 30fps → 读数落在 30 附近', () => {
    const counter = createCounter()
    feed(counter, 30, FPS_WINDOW_MS * 4)
    expect(counter.fps).toBeGreaterThanOrEqual(28)
    expect(counter.fps).toBeLessThanOrEqual(32)
  })

  it('不足一个窗口时不出读数（刚开启不会闪一个中间值）', () => {
    const counter = createCounter()
    feed(counter, 60, FPS_WINDOW_MS / 2)
    expect(counter.fps).toBe(0)
  })

  it('窗口被长任务撑长时按真实时间换算，读数下降', () => {
    const counter = createCounter()
    // 先跑满一个窗口，拿到稳定基线
    feed(counter, 60, FPS_WINDOW_MS * 3)
    const baseline = counter.fps
    expect(baseline).toBeGreaterThanOrEqual(58)

    // 随后正常 10 帧（160ms），再卡住 800ms 只出 1 帧：窗口被撑到约 960ms，
    // 期间只有 11 帧 —— 按真实时间换算约 11fps，必须明显低于基线。
    const start = FPS_WINDOW_MS * 3 + 1000
    for (let i = 1; i <= 10; i += 1) counter.push(start + i * 16)
    counter.push(start + 10 * 16 + 800)
    expect(counter.fps).toBeLessThan(baseline / 2)
  })

  it('超出上限的读数被夹到 FPS_CAP（极端空转不会显示四位数）', () => {
    // 无 vsync 约束的环境里 rAF 可能以极高频率回调；按上限夹住即可
    const counter = createCounter()
    feed(counter, 2000, FPS_WINDOW_MS * 4)
    expect(counter.fps).toBe(FPS_CAP)
  })

  it('上限之内的读数原样保留（165 这类偏高的 rAF 频率不被改动）', () => {
    const counter = createCounter()
    feed(counter, 165, FPS_WINDOW_MS * 4)
    expect(counter.fps).toBeGreaterThan(150)
    expect(counter.fps).toBeLessThanOrEqual(FPS_CAP)
  })

  it('clampFps：非有限值归零，正常值取整，超上限夹住', () => {
    expect(clampFps(Number.NaN)).toBe(0)
    expect(clampFps(Number.POSITIVE_INFINITY)).toBe(0)
    expect(clampFps(59.6)).toBe(60)
    expect(clampFps(-3)).toBe(0)
    expect(clampFps(1000)).toBe(FPS_CAP)
  })

  it('停掉再开从零开始（不把空档算成掉帧）', () => {
    const counter = createCounter()
    feed(counter, 60, FPS_WINDOW_MS * 2)
    expect(counter.fps).toBeGreaterThanOrEqual(58)
    counter.reset()
    expect(counter.fps).toBe(0)
    feed(counter, 60, FPS_WINDOW_MS * 2)
    expect(counter.fps).toBeGreaterThanOrEqual(58)
  })
})
