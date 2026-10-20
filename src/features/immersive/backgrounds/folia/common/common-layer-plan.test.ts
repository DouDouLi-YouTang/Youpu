import { describe, expect, it } from 'vitest'

import {
  resolveCommonGeometryStyle,
  resolveCommonLayerPlan,
  resolveCommonVignettePlacement
} from './common-layer-plan'

const base = {
  useCoverColorBg: false,
  coverColorOpacity: 0.75,
  staticMode: false,
  disableGeometricBackground: false,
  disableVignette: false
}

describe('resolveCommonLayerPlan', () => {
  it('默认（不开取色）：只有主题底色 + 几何层，底色完全不透明', () => {
    expect(resolveCommonLayerPlan(base)).toEqual({
      showFluid: false,
      backgroundOpacity: 1,
      showGeometric: true,
      vignette: 'geometry'
    })
  })

  it('开取色：流体层出现，主题底色改用配置的不透明度压在上面', () => {
    expect(resolveCommonLayerPlan({ ...base, useCoverColorBg: true })).toEqual({
      showFluid: true,
      backgroundOpacity: 0.75,
      showGeometric: true,
      vignette: 'geometry'
    })
  })

  it('opacity = 0 必须生效（被 `||` 吃成 0.75 就永远盖住流体底）', () => {
    expect(
      resolveCommonLayerPlan({ ...base, useCoverColorBg: true, coverColorOpacity: 0 })
        .backgroundOpacity
    ).toBe(0)
  })

  it('opacity = 1 也是合法值（等于把流体底完全盖住，但仍挂在 DOM 里）', () => {
    expect(
      resolveCommonLayerPlan({ ...base, useCoverColorBg: true, coverColorOpacity: 1 })
        .backgroundOpacity
    ).toBe(1)
  })

  it('staticMode 移除整个几何层（不是暂停它）', () => {
    const plan = resolveCommonLayerPlan({ ...base, staticMode: true })
    expect(plan.showGeometric).toBe(false)
    // 暗角也一起消失：它是几何层内部的一部分，层都没了就不该单独讨论暗角
    expect(plan.showFluid).toBe(false)
  })

  it('disableGeometricBackground 只关几何层', () => {
    const plan = resolveCommonLayerPlan({
      ...base,
      useCoverColorBg: true,
      disableGeometricBackground: true
    })
    expect(plan.showGeometric).toBe(false)
    expect(plan.showFluid).toBe(true)
  })

  it('disableVignette 独立：关暗角不影响几何层与流体层', () => {
    const plan = resolveCommonLayerPlan({ ...base, useCoverColorBg: true, disableVignette: true })
    expect(plan.vignette).toBe('none')
    expect(plan.showGeometric).toBe(true)
    expect(plan.showFluid).toBe(true)
  })

  it('三个开关同时打开：只剩主题底色层', () => {
    const plan = resolveCommonLayerPlan({
      useCoverColorBg: false,
      coverColorOpacity: 0.75,
      staticMode: true,
      disableGeometricBackground: true,
      disableVignette: true
    })
    expect(plan).toEqual({
      showFluid: false,
      backgroundOpacity: 1,
      showGeometric: false,
      vignette: 'none'
    })
  })
})

describe('resolveCommonGeometryStyle', () => {
  it('把纸张边界换算成独立几何层', () => {
    expect(resolveCommonGeometryStyle({ left: 120, top: 80, right: 920, bottom: 1680 })).toEqual({
      left: '120px',
      top: '80px',
      width: '800px',
      height: '1600px',
      right: 'auto',
      bottom: 'auto'
    })
  })

  it('反向边界先归正', () => {
    expect(resolveCommonGeometryStyle({ left: 920, top: 1680, right: 120, bottom: 80 })).toEqual({
      left: '120px',
      top: '80px',
      width: '800px',
      height: '1600px',
      right: 'auto',
      bottom: 'auto'
    })
  })

  it('退化的边界仍保留至少 1px 的可渲染尺寸', () => {
    expect(resolveCommonGeometryStyle({ left: 40, top: 50, right: 40, bottom: 50 })).toMatchObject({
      width: '1px',
      height: '1px'
    })
  })

  it('没有边界时回退到外壳的 inset 铺满', () => {
    expect(resolveCommonGeometryStyle(undefined)).toEqual({ inset: '0' })
    expect(resolveCommonGeometryStyle(null)).toEqual({ inset: '0' })
  })
})

describe('resolveCommonVignettePlacement', () => {
  const paperBounds = { left: 120, top: 80, right: 920, bottom: 1680 }
  const base = {
    staticMode: false,
    disableGeometricBackground: false,
    disableVignette: false
  }
  /** `resolveCommonLayerPlan` 还要流体底的两个开关，这里补齐 */
  const planBase = { ...base, useCoverColorBg: false, coverColorOpacity: 0.75 }

  it('几何层铺满时暗角留在几何层内（既有行为）', () => {
    expect(resolveCommonVignettePlacement(base)).toBe('geometry')
    expect(resolveCommonVignettePlacement({ ...base, paperBounds: null })).toBe('geometry')
  })

  it('几何层收窄到纸张时暗角改由视口层绘制（不被裁在纸张边界上）', () => {
    expect(resolveCommonVignettePlacement({ ...base, paperBounds })).toBe('viewport')
  })

  it('关暗角 / 关几何层 / staticMode 都让暗角整体消失', () => {
    expect(resolveCommonVignettePlacement({ ...base, paperBounds, disableVignette: true })).toBe(
      'none'
    )
    expect(
      resolveCommonVignettePlacement({ ...base, paperBounds, disableGeometricBackground: true })
    ).toBe('none')
    expect(resolveCommonVignettePlacement({ ...base, paperBounds, staticMode: true })).toBe('none')
  })

  it('plan 与落位函数同源', () => {
    expect(resolveCommonLayerPlan({ ...planBase, paperBounds }).vignette).toBe('viewport')
    expect(resolveCommonLayerPlan(planBase).vignette).toBe('geometry')
  })
})
