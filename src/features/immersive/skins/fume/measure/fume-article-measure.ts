/**
 * 把 `measure/` 的真实测量能力打包成 `core/article-layout` 需要的注入对象。
 *
 * ## 为什么要有这一层
 *
 * §15.1 的边界要求「core 不许 import measure」，于是排版的入参是
 * `FumeArticleMeasure`（接口）。接口的实现只能住在 measure 侧 —— 也就是本文件：
 * 它是**唯一**把「碰 DOM 的四件事」接到排版算法上的地方。组件层因此只需要一行
 * `buildArticleLayout({ ..., measure: FUME_ARTICLE_MEASURE })`，不必自己拼装。
 *
 * 打包成常量而不是每次调用新建对象：排版一秒钟可能被调度多次（§7.9 的防抖），
 * 而它们读的是同一套模块级缓存（片段测量缓存），没有按次保存的状态，
 * 自然也不该按次分配对象。
 */

import type { FumeArticleMeasure } from '../core/article-layout-attempt'
import {
  buildFontSpec,
  buildMeasuredSingleLine,
  buildPreparedSingleLine,
  measureSegmentGlyphOffsets,
  resolveFumeFontFamily
} from './text-measure'

/**
 * 生产环境用的测量实现。
 *
 * 每一项都直接对应 §4 里的一个函数，这里**不做任何额外包装**：多包一层
 * （比如加 try/catch）会把「pretext 在无 canvas 环境抛错」这件事藏起来，
 * 而调用方需要按 §7.9 自己决定怎么降级（本项目是「这一批先不排」）。
 */
export const FUME_ARTICLE_MEASURE: FumeArticleMeasure = {
  resolveFontFamily: resolveFumeFontFamily,
  buildFontSpec,
  prepareSingleLine: buildPreparedSingleLine,
  measureSingleLine: buildMeasuredSingleLine,
  measureSegmentGlyphOffsets
}
