import { afterEach, describe, expect, it, vi } from 'vitest'

import { effectScope, nextTick, ref } from 'vue'

import { useWebglFallback } from './use-webgl-fallback'
import {
  isWebgl2Unavailable,
  markWebgl2Unavailable,
  resetWebglSupportStateForTests
} from './webgl-support'

/**
 * WebGL 降级链的挂载侧判定。
 *
 * 这两个函数是「画面上会不会只剩一块纯色」的唯一开关，所以用例都围着
 * 「什么时候该显示兜底渐变、什么时候不该」展开。
 *
 * 用 `effectScope` 而不是挂一个 Vue app：这里要验证的是**响应式依赖收集**本身
 * （`watchEffect` 要追踪 `hasMount()` 里读到的 ref），不需要真实 DOM。
 * 挂 app 会要求 jsdom，而本仓库的测试环境是 node（见 vitest.config.ts）。
 */

afterEach(() => {
  resetWebglSupportStateForTests()
  vi.restoreAllMocks()
})

/**
 * 兜底路径必然要 `console.warn` 一次（这是设计的一部分），用例里把它静音，
 * 免得测试输出被几十行预期内的告警淹没。
 */
function silenceExpectedWarn(): void {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
}

function runFallback(hasMount: () => boolean): { show: () => boolean; stop: () => void } {
  const scope = effectScope()
  const state = scope.run(() => useWebglFallback({ hasMount }))!
  return {
    show: () => state.showFallback.value,
    stop: () => scope.stop()
  }
}

describe('webgl-support 全局标记', () => {
  it('初始为可用；置位后单向保持，只能由测试重置', () => {
    expect(isWebgl2Unavailable()).toBe(false)
    silenceExpectedWarn()
    markWebgl2Unavailable('test', new Error('boom'))
    expect(isWebgl2Unavailable()).toBe(true)
    resetWebglSupportStateForTests()
    expect(isWebgl2Unavailable()).toBe(false)
  })
})

describe('useWebglFallback', () => {
  it('挂载成功 + 标记未置位 → 不显示兜底', () => {
    const mounted = ref(true)
    const fallback = runFallback(() => mounted.value)
    expect(fallback.show()).toBe(false)
    fallback.stop()
  })

  it('挂载失败 + 全局标记已置位 → 显示兜底（这是默认模式的最后一道防线）', async () => {
    silenceExpectedWarn()
    markWebgl2Unavailable('latent', new Error('no webgl2'))
    const fallback = runFallback(() => false)
    await nextTick()
    expect(fallback.show()).toBe(true)
    fallback.stop()
  })

  it('标记已置位但这次挂上了 → 不显示兜底（失败的旧结论不覆盖成功的现状）', () => {
    silenceExpectedWarn()
    markWebgl2Unavailable('latent', new Error('no webgl2'))
    const mounted = ref(true)
    const fallback = runFallback(() => mounted.value)
    expect(fallback.show()).toBe(false)
    fallback.stop()
  })

  it('挂载过程中（尚未成功、标记也未置位）不闪渐变', () => {
    const mounted = ref(false)
    const fallback = runFallback(() => mounted.value)
    expect(fallback.show()).toBe(false)
    fallback.stop()
  })

  it('挂载态翻转时自动重算（异步挂载失败后不用手动同步）', async () => {
    const mounted = ref(true)
    const fallback = runFallback(() => mounted.value)
    expect(fallback.show()).toBe(false)

    silenceExpectedWarn()
    markWebgl2Unavailable('latent', new Error('no webgl2'))
    mounted.value = false
    await nextTick()
    expect(fallback.show()).toBe(true)

    // 重新挂上（例如换了 shader key 后重建成功）→ 收掉兜底
    mounted.value = true
    await nextTick()
    expect(fallback.show()).toBe(false)
    fallback.stop()
  })
})
