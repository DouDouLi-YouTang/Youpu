import { describe, expect, it } from 'vitest'

import {
  resolveCenteredFoliaBackgroundMatrix,
  resolveFoliaBackgroundMatrix,
  resolveFoliaBackgroundSurfaceStyle,
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
  it('Common 对齐纸张包围盒，其余模式铺满文章世界', () => {
    const world = {
      width: 2000,
      height: 3000,
      viewportWidth: 1000,
      viewportHeight: 800,
      paperBounds: { left: 100, top: 200, right: 1700, bottom: 2600 }
    }
    expect(resolveFoliaBackgroundSurfaceStyle('common', world)).toEqual({
      left: '100px',
      top: '200px',
      width: '1600px',
      height: '2400px'
    })
    expect(resolveFoliaBackgroundSurfaceStyle('sora', world)).toEqual({
      left: '0',
      top: '0',
      width: '100%',
      height: '100%'
    })
  })

  it('Common 没有纸张边界时回退铺满世界', () => {
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
