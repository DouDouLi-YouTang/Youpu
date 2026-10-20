import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 注册表单测。
 *
 * ⚠️ `registry.ts` 静态 import 了各模式的 `.vue`，而 vitest 配置**没有** `@vitejs/plugin-vue`
 * （测的都是纯 TS，node 环境）。所以这里必须把 `.vue` 全部 mock 掉 —— 这不是权宜之计：
 * 注册表的职责是「mode / order / 回退」三件事，组件本体由各自的模式测试负责。
 * 新增模式时**记得在这里补一行 mock**，否则测试会因为无法解析 .vue 而整体失败。
 */
vi.mock('../folia/shared/FoliaFallbackGradient.vue', () => ({
  default: { name: 'FoliaFallbackGradientStub' }
}))
vi.mock('../folia/latent/LatentBackground.vue', () => ({
  default: { name: 'LatentBackgroundStub' }
}))
vi.mock('../folia/nomand/NomandBackground.vue', () => ({
  default: { name: 'NomandBackgroundStub' }
}))
vi.mock('../folia/monet/MonetBackground.vue', () => ({
  default: { name: 'MonetBackgroundStub' }
}))
vi.mock('../folia/sora/SoraBackground.vue', () => ({
  default: { name: 'SoraBackgroundStub' }
}))
vi.mock('../folia/url/UrlBackground.vue', () => ({
  default: { name: 'UrlBackgroundStub' }
}))
vi.mock('../folia/common/CommonBackground.vue', () => ({
  default: { name: 'CommonBackgroundStub' }
}))

import {
  appendFoliaBackgroundEntry,
  foliaBackgroundEntries,
  getFoliaBackgroundModeLabel,
  removeFoliaBackgroundEntry,
  resolveFoliaBackgroundEntry
} from './registry'
import { DEFAULT_FOLIA_BACKGROUND_MODE, FOLIA_BACKGROUND_MODES } from './types'

afterEach(() => {
  // 追加通道有全局状态，逐个清干净（内置 6 条移不掉，见 removeFoliaBackgroundEntry）
  for (const entry of foliaBackgroundEntries()) removeFoliaBackgroundEntry(entry.mode)
})

describe('folia 背景注册表', () => {
  it('6 个模式齐全，且按 order 升序（同 order 按 mode）', () => {
    const entries = foliaBackgroundEntries()
    expect(entries.map((entry) => entry.mode).sort()).toEqual([...FOLIA_BACKGROUND_MODES].sort())
    expect(entries.map((entry) => entry.order)).toEqual([10, 20, 30, 35, 40, 50])
    expect(entries.map((entry) => entry.mode)).toEqual([
      'common',
      'monet',
      'nomand',
      'latent',
      'url',
      'sora'
    ])
  })

  it('order 与 mode 的对应逐字对齐 Folia', () => {
    const byMode = new Map(foliaBackgroundEntries().map((entry) => [entry.mode, entry]))
    expect(byMode.get('common')?.order).toBe(10)
    expect(byMode.get('monet')?.order).toBe(20)
    expect(byMode.get('nomand')?.order).toBe(30)
    expect(byMode.get('latent')?.order).toBe(35)
    expect(byMode.get('url')?.order).toBe(40)
    expect(byMode.get('sora')?.order).toBe(50)
  })

  it('url 的兜底文案是 Embed（不是 Url）', () => {
    expect(resolveFoliaBackgroundEntry('url').labelFallback).toBe('Embed')
  })

  it('未命中回退默认模式，不抛错也不返回空', () => {
    expect(resolveFoliaBackgroundEntry('unknown-mode').mode).toBe(DEFAULT_FOLIA_BACKGROUND_MODE)
    expect(resolveFoliaBackgroundEntry(null).mode).toBe(DEFAULT_FOLIA_BACKGROUND_MODE)
    expect(resolveFoliaBackgroundEntry(undefined).mode).toBe(DEFAULT_FOLIA_BACKGROUND_MODE)
    // 默认模式 = latent（Folia `visualizerModes.ts:42`）
    expect(DEFAULT_FOLIA_BACKGROUND_MODE).toBe('latent')
  })

  it('命中时返回对应 entry，且每个 entry 都带组件', () => {
    for (const mode of FOLIA_BACKGROUND_MODES) {
      const entry = resolveFoliaBackgroundEntry(mode)
      expect(entry.mode).toBe(mode)
      expect(entry.component).toBeTruthy()
      expect(entry.labelFallback).not.toBe('')
    }
    expect(resolveFoliaBackgroundEntry('latent').component).toEqual({
      name: 'LatentBackgroundStub'
    })
  })

  it('标签：无翻译用兜底，空串 / 原样 key 也算没翻译', () => {
    const entry = resolveFoliaBackgroundEntry('latent')
    expect(getFoliaBackgroundModeLabel(entry)).toBe('Latent')
    expect(getFoliaBackgroundModeLabel(entry, () => '')).toBe('Latent')
    expect(getFoliaBackgroundModeLabel(entry, (key) => key)).toBe('Latent')
    expect(getFoliaBackgroundModeLabel(entry, () => '潜在的')).toBe('潜在的')
  })

  it('追加通道：追加进列表、移除后回到原样，内置 entry 移不掉', () => {
    const before = foliaBackgroundEntries()
    const dispose = appendFoliaBackgroundEntry({
      mode: 'common' as never,
      order: 99,
      labelKey: 'mod:test',
      labelFallback: 'Test',
      component: { name: 'ModStub' }
    })
    // 追加项 order = 99 排在最后；mode 与内置 common 重名（mod 注入的真实形态），
    // 所以这里断言长度与末位，而不是断言 mode 唯一
    const appended = foliaBackgroundEntries()
    expect(appended).toHaveLength(before.length + 1)
    expect(appended.at(-1)?.labelFallback).toBe('Test')

    dispose()
    expect(foliaBackgroundEntries()).toHaveLength(before.length)

    // 内置 mode 的名字在追加表里找不到时不能误删内置项
    removeFoliaBackgroundEntry('latent')
    expect(resolveFoliaBackgroundEntry('latent').component).toEqual({
      name: 'LatentBackgroundStub'
    })
    expect(foliaBackgroundEntries()).toHaveLength(before.length)
  })
})
