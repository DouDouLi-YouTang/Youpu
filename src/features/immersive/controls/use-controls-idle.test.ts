import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { holdIdle, resetIdle } from './use-controls-idle'
import { useImmersivePlayer } from '../use-immersive-player'

/**
 * 只测「持有」这条契约：**持有期间控制条不许自动隐藏**（2026-10-20 用户要求：
 * 拖动倍速、调音量、看播放列表时控制条不能自己跑掉）。
 *
 * 要钉住的正是拖动场景：指针按住一动不动、没有任何 mousemove —— `resetIdle()` 那套
 * 「把 1.5s 计时推后」完全没用武之地，只有持有挡得住。
 *
 * ⚠️ 环境：vitest 是 node 环境。模块里用 `window.setTimeout`，故把 window 转发到
 * globalThis（假时钟才接管得到）；`resetIdle` 会读设置 store，故每个用例给一份 pinia。
 *
 * ⚠️ 持有计数是模块级、跨用例存活的：用例里的断言若失败会跳过释放，把计数漏给下一条，
 * 表现为「后面所有用例一起红」。所以每条用例都用 try/finally 释放。
 */
const IDLE_THRESHOLD_MS = 1500
const { idle } = useImmersivePlayer()

describe('控制条 idle 的「持有」', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('window', {
      setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
      clearTimeout: (id?: Parameters<typeof clearTimeout>[0]) => globalThis.clearTimeout(id)
    })
    vi.useFakeTimers()
    idle.value = false
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('持有期间即使一直没有任何鼠标事件，也不会隐藏', () => {
    resetIdle()
    const release = holdIdle()
    try {
      vi.advanceTimersByTime(IDLE_THRESHOLD_MS * 4)
      expect(idle.value).toBe(false)
    } finally {
      release()
    }
  })

  it('释放后重新开始计时，到点照常隐藏', () => {
    const release = holdIdle()
    try {
      vi.advanceTimersByTime(IDLE_THRESHOLD_MS * 2)
      expect(idle.value).toBe(false)
    } finally {
      release()
    }

    vi.advanceTimersByTime(IDLE_THRESHOLD_MS + 50)
    expect(idle.value).toBe(true)
  })

  it('已经隐没时开始持有，会立刻把控制条唤出', () => {
    resetIdle()
    vi.advanceTimersByTime(IDLE_THRESHOLD_MS + 50)
    expect(idle.value).toBe(true)

    const release = holdIdle()
    try {
      expect(idle.value).toBe(false)
    } finally {
      release()
    }
  })

  it('可重入：多处持有要全部释放才恢复计时', () => {
    const releaseA = holdIdle()
    const releaseB = holdIdle()

    releaseA()
    vi.advanceTimersByTime(IDLE_THRESHOLD_MS * 2)
    expect(idle.value).toBe(false) // B 还持有着

    releaseB()
    vi.advanceTimersByTime(IDLE_THRESHOLD_MS + 50)
    expect(idle.value).toBe(true)
  })

  it('同一个释放函数重复调用不会把计数扣成负数', () => {
    const release = holdIdle()
    release()
    release()
    vi.advanceTimersByTime(IDLE_THRESHOLD_MS + 50)
    expect(idle.value).toBe(true)

    // 计数没被扣坏：下一次持有仍然生效
    const again = holdIdle()
    try {
      vi.advanceTimersByTime(IDLE_THRESHOLD_MS * 2)
      expect(idle.value).toBe(false)
    } finally {
      again()
    }
  })
})
