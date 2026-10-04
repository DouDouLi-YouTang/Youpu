import { afterEach, describe, expect, it, vi } from 'vitest'

import { RENDERER_SESSION_KEY, takeRendererRecreated } from './renderer-session'

/** 低内存模式跨渲染进程保留 sessionStorage,这里用同一个 Map 模拟两代渲染进程。 */
function installSessionStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        store.set(key, value)
      }
    }
  })
  return store
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('takeRendererRecreated', () => {
  it('冷启动(标记不存在)返回 false 并写入标记', () => {
    const store = installSessionStorage()

    expect(takeRendererRecreated()).toBe(false)
    expect(store.has(RENDERER_SESSION_KEY)).toBe(true)
  })

  it('同一运行期内的第二代渲染进程返回 true', () => {
    installSessionStorage()

    expect(takeRendererRecreated()).toBe(false)
    // 低内存模式回收渲染进程后重建:sessionStorage 内容随会话保留
    expect(takeRendererRecreated()).toBe(true)
  })

  it('应用重启(sessionStorage 被清空)后重新变成 false', () => {
    installSessionStorage()
    takeRendererRecreated()

    installSessionStorage()
    expect(takeRendererRecreated()).toBe(false)
  })

  it('sessionStorage 抛错时按冷启动处理,不向外抛异常', () => {
    vi.stubGlobal('window', {
      get sessionStorage(): Storage {
        throw new Error('access denied')
      }
    })

    expect(takeRendererRecreated()).toBe(false)
  })
})
