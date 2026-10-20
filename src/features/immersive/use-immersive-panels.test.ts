import { beforeEach, describe, expect, it } from 'vitest'

import { useImmersivePanels } from './use-immersive-panels'

/**
 * 模块级单例，用例之间会互相影响 —— 每个用例前先清空。
 *
 * 契约只有一条真正重要：**任何时刻最多一个弹层开着**（用户 2026-10-20 提的需求）。
 * 其余用例都是这条的边界（先开后开、关别人、重复开）。
 */
describe('沉浸页顶部弹层的互斥开关', () => {
  const panels = useImmersivePanels()

  beforeEach(() => {
    panels.closeAll()
  })

  it('打开一个，另一个自动关掉（后开的赢）', () => {
    panels.open('settings')
    expect(panels.isOpen('settings').value).toBe(true)

    panels.open('skins')
    expect(panels.isOpen('skins').value).toBe(true)
    expect(panels.isOpen('settings').value).toBe(false)
  })

  it('反方向同样互斥', () => {
    panels.open('skins')
    panels.open('settings')
    expect(panels.isOpen('settings').value).toBe(true)
    expect(panels.isOpen('skins').value).toBe(false)
  })

  it('toggle：关着就开、开着就关', () => {
    panels.toggle('skins')
    expect(panels.isOpen('skins').value).toBe(true)
    panels.toggle('skins')
    expect(panels.isOpen('skins').value).toBe(false)
  })

  it('toggle 另一个：直接接管，不会两个都开着', () => {
    panels.toggle('settings')
    panels.toggle('skins')
    expect(panels.isOpen('skins').value).toBe(true)
    expect(panels.isOpen('settings').value).toBe(false)
  })

  it('close 只关自己：已经被别人接管时不误伤', () => {
    panels.open('settings')
    panels.open('skins') // settings 已被顶掉
    panels.close('settings') // 迟到的「关闭设置」不该把 skins 也关掉
    expect(panels.isOpen('skins').value).toBe(true)
  })

  it('closeAll 收干净（沉浸层关闭时用）', () => {
    panels.open('settings')
    panels.closeAll()
    expect(panels.isOpen('settings').value).toBe(false)
    expect(panels.isOpen('skins').value).toBe(false)
  })

  it('重复 open 同一个 id 幂等', () => {
    panels.open('settings')
    panels.open('settings')
    expect(panels.isOpen('settings').value).toBe(true)
  })

  it('anyOpen：ESC 分层关闭要先知道「有没有弹层开着」', () => {
    expect(panels.anyOpen.value).toBe(false)
    panels.open('skins')
    expect(panels.anyOpen.value).toBe(true)
    panels.close('skins')
    expect(panels.anyOpen.value).toBe(false)
  })
})
