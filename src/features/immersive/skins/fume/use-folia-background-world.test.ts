import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import type { FumeArticleLayout, FumeViewportSize } from './core/fume-types'
import { useFoliaBackgroundWorld } from './use-folia-background-world'

function article(width: number, height: number): FumeArticleLayout {
  return {
    width,
    height,
    paperBounds: { left: 80, top: 120, right: width - 80, bottom: height - 120 }
  } as FumeArticleLayout
}

describe('useFoliaBackgroundWorld', () => {
  it('无文章时使用 1.8 倍舞台的临时世界', () => {
    const articleRef = ref<FumeArticleLayout | null>(null)
    const viewport = ref<FumeViewportSize>({ width: 1000, height: 800 })

    const world = useFoliaBackgroundWorld({ article: articleRef, viewport })

    expect(world.value).toMatchObject({
      width: 1800,
      height: 1440,
      viewportWidth: 1000,
      viewportHeight: 800
    })
  })

  it('有文章时优先采用文章世界与纸张边界', () => {
    const articleRef = ref<FumeArticleLayout | null>(article(1600, 2400))
    const viewport = ref<FumeViewportSize>({ width: 1000, height: 800 })

    const world = useFoliaBackgroundWorld({ article: articleRef, viewport })

    expect(world.value).toMatchObject({
      width: 1600,
      height: 2400,
      viewportWidth: 1000,
      viewportHeight: 800,
      paperBounds: { left: 80, top: 120, right: 1520, bottom: 2280 }
    })
  })

  it('无文章时临时世界跟随舞台尺寸', async () => {
    const articleRef = ref<FumeArticleLayout | null>(null)
    const viewport = ref<FumeViewportSize>({ width: 1000, height: 800 })
    const world = useFoliaBackgroundWorld({ article: articleRef, viewport })

    viewport.value = { width: 1400, height: 1000 }
    await nextTick()

    expect(world.value).toMatchObject({ width: 2520, height: 1800 })
  })

  it('有文章时 resize 等待新文章，旧世界保持到新文章提交后只更新一次', async () => {
    const articleRef = ref<FumeArticleLayout | null>(article(1600, 2400))
    const viewport = ref<FumeViewportSize>({ width: 1000, height: 800 })
    const world = useFoliaBackgroundWorld({ article: articleRef, viewport })
    const initial = world.value

    viewport.value = { width: 1200, height: 900 }
    await nextTick()
    expect(world.value).toBe(initial)

    const nextArticle = article(2000, 3000)
    articleRef.value = nextArticle
    await nextTick()

    expect(world.value).not.toBe(initial)
    expect(world.value).toMatchObject({
      width: 2000,
      height: 3000,
      viewportWidth: 1200,
      viewportHeight: 900
    })

    const committed = world.value
    await nextTick()
    expect(world.value).toBe(committed)
  })
})
