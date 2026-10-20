import { shallowRef, watch, type Ref } from 'vue'

import type { FumeArticleLayout, FumeViewportSize } from './core/fume-types'
import {
  resolveFoliaBackgroundWorld,
  type FoliaBackgroundWorld
} from '../shared/folia-background-world'

export interface UseFoliaBackgroundWorldOptions {
  article: Ref<FumeArticleLayout | null>
  viewport: Ref<FumeViewportSize>
}

/**
 * 浮名覆盖背景的世界锁存。
 *
 * - 文章引用变化时才按新文章重建世界；
 * - 有文章时，窗口拖动期间的中间视口**不改世界**，等新文章提交后一次更新，
 *   避免世界中心连续变化导致背景跳；
 * - 无文章时，临时世界跟随舞台尺寸（首屏与空态需要铺满）。
 */
export function useFoliaBackgroundWorld(
  options: UseFoliaBackgroundWorldOptions
): Ref<FoliaBackgroundWorld> {
  const world = shallowRef(
    resolveFoliaBackgroundWorld({
      article: options.article.value,
      viewport: options.viewport.value
    })
  )

  watch(
    options.article,
    (article) => {
      world.value = resolveFoliaBackgroundWorld({
        article,
        viewport: options.viewport.value
      })
    },
    { immediate: true, flush: 'sync' }
  )

  watch(
    options.viewport,
    (viewport) => {
      if (options.article.value) return
      world.value = resolveFoliaBackgroundWorld({ article: null, viewport })
    },
    { flush: 'sync' }
  )

  return world
}
