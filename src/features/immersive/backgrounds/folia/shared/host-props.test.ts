import { describe, expect, it } from 'vitest'

import type { FoliaBackgroundConfig, FoliaTheme } from '../types'
import {
  DEFAULT_COMMON_BACKGROUND_OPACITY,
  resolveCommonOverrides,
  resolveFoliaChildProps,
  type FoliaChildPropOptions
} from './host-props'

const theme: FoliaTheme = {
  backgroundColor: '#101010',
  primaryColor: '#ffffff',
  accentColor: '#ff8800',
  secondaryColor: '#00aaff'
}

function options(overrides: Partial<FoliaChildPropOptions> = {}): FoliaChildPropOptions {
  return {
    mode: 'latent',
    theme,
    coverUrl: 'https://cover.test/a.jpg',
    isDaylight: false,
    paused: false,
    staticMode: false,
    seed: 'song-1',
    useCoverColorBg: false,
    coverColorOpacity: DEFAULT_COMMON_BACKGROUND_OPACITY,
    disableGeometricBackground: false,
    disableVignette: false,
    audioPower: () => 128,
    audioBands: () => ({ bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 }),
    ...overrides
  }
}

describe('resolveFoliaChildProps 名字表', () => {
  it('latent：吃音频、paused、staticMode 与 tuning', () => {
    const props = resolveFoliaChildProps(options({ mode: 'latent' }))
    expect(Object.keys(props).sort()).toEqual([
      'audioBands',
      'audioPower',
      'coverUrl',
      'isDaylight',
      'paused',
      'staticMode',
      'theme',
      'tuning'
    ])
    expect(props.tuning).toBeUndefined()
  })

  it('nomand：不吃 paused / staticMode / 音频（Folia 的事实），tuning 透传', () => {
    const props = resolveFoliaChildProps(
      options({
        mode: 'nomand',
        config: { nomand: { tuning: { effect: 'fluted-glass' } } }
      })
    )
    expect(Object.keys(props).sort()).toEqual([
      'coverUrl',
      'customImageUrl',
      'isDaylight',
      'theme',
      'tuning'
    ])
    expect(props).not.toHaveProperty('paused')
    expect(props).not.toHaveProperty('staticMode')
    expect(props).not.toHaveProperty('audioPower')
    expect(props.tuning).toEqual({ effect: 'fluted-glass' })
  })

  it('sora：staticMode 合并进 paused，且不吃封面 / 音频', () => {
    const paused = resolveFoliaChildProps(options({ mode: 'sora', paused: true }))
    const frozen = resolveFoliaChildProps(options({ mode: 'sora', staticMode: true }))
    expect(paused.paused).toBe(true)
    expect(frozen.paused).toBe(true)
    expect(Object.keys(paused).sort()).toEqual(['isDaylight', 'paused', 'theme', 'tuning'])
  })

  it('url：只吃 items / selectedId', () => {
    const props = resolveFoliaChildProps(
      options({
        mode: 'url',
        config: { url: { items: [{ id: 'a', url: 'https://a.test/', note: 'A' }] } }
      })
    )
    expect(Object.keys(props).sort()).toEqual(['items', 'selectedId'])
    expect(props.selectedId).toBeNull()
  })

  it('monet：staticMode 进（只停漂移），paused 不进', () => {
    const props = resolveFoliaChildProps(options({ mode: 'monet', staticMode: true }))
    expect(props.staticMode).toBe(true)
    expect(props).not.toHaveProperty('paused')
    expect(props).not.toHaveProperty('audioPower')
  })

  it('common：几何层四个开关落到独立 prop 名上', () => {
    const props = resolveFoliaChildProps(
      options({
        mode: 'common',
        useCoverColorBg: true,
        coverColorOpacity: 0.5,
        disableGeometricBackground: true,
        disableVignette: true
      })
    )
    expect(props.useCoverColorBg).toBe(true)
    expect(props.coverColorOpacity).toBe(0.5)
    expect(props.disableGeometricBackground).toBe(true)
    expect(props.disableVignette).toBe(true)
    expect(props.seed).toBe('song-1')
  })

  it('customImage 只在有配置时给出 URL，否则 null（monet / nomand 共用同一张图）', () => {
    const empty = resolveFoliaChildProps(options({ mode: 'monet' }))
    expect(empty.customImageUrl).toBeNull()
    const config: FoliaBackgroundConfig = {
      customImage: { id: 'x', name: 'x', url: 'https://upload.test/x.jpg' }
    }
    expect(resolveFoliaChildProps(options({ mode: 'monet', config })).customImageUrl).toBe(
      'https://upload.test/x.jpg'
    )
    expect(resolveFoliaChildProps(options({ mode: 'nomand', config })).customImageUrl).toBe(
      'https://upload.test/x.jpg'
    )
  })
})

describe('resolveCommonOverrides', () => {
  it('默认：不开取色、opacity 0.75、几何层与暗角都开', () => {
    expect(resolveCommonOverrides()).toEqual({
      useCoverColorBg: false,
      coverColorOpacity: DEFAULT_COMMON_BACKGROUND_OPACITY,
      disableGeometricBackground: false,
      disableVignette: false
    })
    expect(DEFAULT_COMMON_BACKGROUND_OPACITY).toBe(0.75)
  })

  it('opacity = 0 时不被 ?? 吃掉（0 是合法值）', () => {
    expect(resolveCommonOverrides({ common: { opacity: 0 } }).coverColorOpacity).toBe(0)
  })

  it('非布尔开关一律当关（持久化脏值不该把几何层打开）', () => {
    const overrides = resolveCommonOverrides({
      common: {
        useCoverColorBg: 1 as never,
        disableGeometricBackground: 'true' as never,
        disableVignette: null as never
      }
    })
    expect(overrides.useCoverColorBg).toBe(false)
    expect(overrides.disableGeometricBackground).toBe(false)
    expect(overrides.disableVignette).toBe(false)
  })
})
