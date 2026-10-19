import { describe, expect, it } from 'vitest'

import type { FumeTheme } from './fume-types'
import { resolveFumeThemeFingerprint } from './theme-fingerprint'

function makeTheme(overrides: Partial<FumeTheme> = {}): FumeTheme {
  return {
    name: 'daylight',
    primaryColor: 'rgb(10, 20, 30)',
    accentColor: 'rgb(40, 50, 60)',
    secondaryColor: 'rgb(70, 80, 90)',
    fontStyle: 'serif',
    animationIntensity: 'normal',
    ...overrides
  }
}

describe('resolveFumeThemeFingerprint', () => {
  it('字体族、字体链和字重都参与指纹', () => {
    const base = resolveFumeThemeFingerprint(makeTheme())
    expect(resolveFumeThemeFingerprint(makeTheme({ fontFamily: 'Custom Serif' }))).not.toBe(base)
    expect(resolveFumeThemeFingerprint(makeTheme({ fontFamilyStack: ['Custom Serif'] }))).not.toBe(
      base
    )
    expect(resolveFumeThemeFingerprint(makeTheme({ fontWeight: 500 }))).not.toBe(base)
  })

  it('字体链顺序不同会得到不同指纹', () => {
    const ab = resolveFumeThemeFingerprint(makeTheme({ fontFamilyStack: ['A', 'B'] }))
    const ba = resolveFumeThemeFingerprint(makeTheme({ fontFamilyStack: ['B', 'A'] }))
    expect(ab).not.toBe(ba)
  })

  it('颜色变化参与指纹，完全相同的主题稳定', () => {
    const base = resolveFumeThemeFingerprint(makeTheme())
    expect(resolveFumeThemeFingerprint(makeTheme({ accentColor: 'rgb(1, 2, 3)' }))).not.toBe(base)
    expect(resolveFumeThemeFingerprint(makeTheme())).toBe(base)
  })
})
