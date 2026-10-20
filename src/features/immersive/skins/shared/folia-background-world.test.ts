import { describe, expect, it } from 'vitest'

import {
  resolveCenteredFoliaBackgroundMatrix,
  resolveFoliaBackgroundBlurGeometry,
  resolveFoliaBackgroundMatrix,
  resolveFoliaBackgroundSurfaceStyle,
  resolveFoliaBackgroundViewportVignette,
  resolveFoliaBackgroundWorldStyle,
  resolveFoliaBackgroundWorld
} from './folia-background-world'

describe('resolveFoliaBackgroundWorld', () => {
  it('有文章时覆盖文章世界，并至少达到视口的 1.2 倍', () => {
    const world = resolveFoliaBackgroundWorld({
      article: {
        width: 1600,
        height: 2400,
        paperBounds: { left: 100, top: 200, right: 1500, bottom: 2200 }
      },
      viewport: { width: 1000, height: 800 }
    })
    expect(world.width).toBe(1600)
    expect(world.height).toBe(2400)
    expect(world.paperBounds).toEqual({ left: 100, top: 200, right: 1500, bottom: 2200 })
    expect(world.paperBounds).not.toBe(
      resolveFoliaBackgroundWorld({
        article: {
          width: 1600,
          height: 2400,
          paperBounds: { left: 100, top: 200, right: 1500, bottom: 2200 }
        },
        viewport: { width: 1000, height: 800 }
      }).paperBounds
    )
  })

  it('文章小于视口时抬到 1.2 倍，不出现裸边', () => {
    const world = resolveFoliaBackgroundWorld({
      article: { width: 600, height: 400 },
      viewport: { width: 1000, height: 800 }
    })
    expect(world.width).toBe(1200)
    expect(world.height).toBe(960)
  })

  it('无文章时使用舞台 1.8 倍临时世界', () => {
    const world = resolveFoliaBackgroundWorld({
      article: null,
      viewport: { width: 1000, height: 800 }
    })
    expect(world.width).toBe(1800)
    expect(world.height).toBe(1440)
  })

  it('非法尺寸会被钳成正数，不产生 NaN / Infinity', () => {
    const world = resolveFoliaBackgroundWorld({
      article: { width: Number.NaN, height: -10 },
      viewport: { width: 0, height: 0 }
    })
    expect(world).toEqual({
      width: 1,
      height: 1,
      viewportWidth: 0,
      viewportHeight: 0
    })
  })
})

describe('resolveFoliaBackgroundMatrix', () => {
  it('按「视口中心 - 相机 × 缩放」生成 matrix，与 canvas 变换同构', () => {
    expect(
      resolveFoliaBackgroundMatrix({
        viewportWidth: 1200,
        viewportHeight: 800,
        cameraX: 400,
        cameraY: 300,
        scale: 0.94
      })
    ).toBe('matrix(0.94, 0, 0, 0.94, 224, 118)')
  })

  it('非法相机与缩放回退到安全值，不生成 NaN', () => {
    expect(
      resolveFoliaBackgroundMatrix({
        viewportWidth: 100,
        viewportHeight: 200,
        cameraX: Number.NaN,
        cameraY: Number.POSITIVE_INFINITY,
        scale: 0
      })
    ).toBe('matrix(1, 0, 0, 1, 50, 100)')
  })

  it('世界重建时的居中兜底使用 scale 1', () => {
    expect(
      resolveCenteredFoliaBackgroundMatrix({
        width: 1800,
        height: 1440,
        viewportWidth: 1000,
        viewportHeight: 800
      })
    ).toBe('matrix(1, 0, 0, 1, -400, -320)')
  })
})

describe('resolveFoliaBackgroundSurfaceStyle', () => {
  it('所有覆盖背景都铺满文章世界（纸张边界不能拿来裁主题底色）', () => {
    const world = {
      width: 2000,
      height: 3000,
      viewportWidth: 1000,
      viewportHeight: 800,
      paperBounds: { left: 100, top: 200, right: 1700, bottom: 2600 }
    }
    expect(resolveFoliaBackgroundSurfaceStyle('common', world)).toEqual({
      left: '0',
      top: '0',
      width: '100%',
      height: '100%'
    })
    expect(resolveFoliaBackgroundSurfaceStyle('sora', world)).toEqual({
      left: '0',
      top: '0',
      width: '100%',
      height: '100%'
    })
  })

  it('Common 没有纸张边界时同样铺满世界', () => {
    const world = {
      width: 2000,
      height: 3000,
      viewportWidth: 1000,
      viewportHeight: 800
    }
    expect(resolveFoliaBackgroundSurfaceStyle('common', world)).toEqual({
      left: '0',
      top: '0',
      width: '100%',
      height: '100%'
    })
  })
})

describe('resolveFoliaBackgroundViewportVignette', () => {
  const paperBounds = { left: 100, top: 200, right: 1700, bottom: 2600 }

  it('浮名 Common 有纸张边界时由视口层补画暗角', () => {
    expect(resolveFoliaBackgroundViewportVignette({ mode: 'common', paperBounds })).toBe(true)
  })

  it('没有纸张边界（其它皮肤 / 原生档）不补，暗角仍在几何层内', () => {
    expect(resolveFoliaBackgroundViewportVignette({ mode: 'common' })).toBe(false)
  })

  it('非 common 模式不补', () => {
    for (const mode of ['latent', 'nomand', 'monet', 'sora', 'url']) {
      expect(resolveFoliaBackgroundViewportVignette({ mode, paperBounds })).toBe(false)
    }
  })

  it('关暗角 / 关几何层时不补（暗角是几何层的一部分）', () => {
    expect(
      resolveFoliaBackgroundViewportVignette({
        mode: 'common',
        paperBounds,
        config: { common: { disableVignette: true } }
      })
    ).toBe(false)
    expect(
      resolveFoliaBackgroundViewportVignette({
        mode: 'common',
        paperBounds,
        config: { common: { disableGeometricBackground: true } }
      })
    ).toBe(false)
  })
})

describe('resolveFoliaBackgroundBlurGeometry', () => {
  it('关闭模糊时完全不生成外扩层', () => {
    expect(resolveFoliaBackgroundBlurGeometry(0)).toEqual({ blurPx: 0, insetPx: 0 })
  })

  it('外扩距离按模糊半径三倍向上取整，覆盖 Chromium 的模糊核支持范围', () => {
    expect(resolveFoliaBackgroundBlurGeometry(1)).toEqual({ blurPx: 1, insetPx: 3 })
    expect(resolveFoliaBackgroundBlurGeometry(7.5)).toEqual({ blurPx: 7.5, insetPx: 23 })
    // 设置面板上限 40px → 120px 外扩，实测可完全消除四边半透明残留
    expect(resolveFoliaBackgroundBlurGeometry(40)).toEqual({ blurPx: 40, insetPx: 120 })
  })

  it('非法或负数模糊值按关闭处理，不产生负外扩', () => {
    expect(resolveFoliaBackgroundBlurGeometry(-4)).toEqual({ blurPx: 0, insetPx: 0 })
    expect(resolveFoliaBackgroundBlurGeometry(Number.NaN)).toEqual({
      blurPx: 0,
      insetPx: 0
    })
    expect(resolveFoliaBackgroundBlurGeometry(Number.POSITIVE_INFINITY)).toEqual({
      blurPx: 0,
      insetPx: 0
    })
  })
})

describe('resolveFoliaBackgroundWorldStyle', () => {
  it('模糊外扩时把 world 原点补偿回视口左上角', () => {
    const world = {
      width: 1800,
      height: 1440,
      viewportWidth: 1000,
      viewportHeight: 800
    }
    expect(resolveFoliaBackgroundWorldStyle(world, 20)).toEqual({
      left: '20px',
      top: '20px',
      width: '1800px',
      height: '1440px'
    })
  })

  it('不含 transform：相机矩阵由绘制循环命令式写入，Vue 不能重置它', () => {
    const world = { width: 1800, height: 1440, viewportWidth: 1000, viewportHeight: 800 }
    expect(resolveFoliaBackgroundWorldStyle(world, 0)).not.toHaveProperty('transform')
  })

  it('非法或负数外扩值按 0 补偿，不产生负位移', () => {
    const world = {
      width: 1800,
      height: 1440,
      viewportWidth: 1000,
      viewportHeight: 800
    }
    expect(resolveFoliaBackgroundWorldStyle(world, -5).left).toBe('0px')
    expect(resolveFoliaBackgroundWorldStyle(world, Number.NaN).top).toBe('0px')
    expect(resolveFoliaBackgroundWorldStyle(world, Number.POSITIVE_INFINITY).left).toBe('0px')
  })
})
