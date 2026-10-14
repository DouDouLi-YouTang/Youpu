/**
 * `FumeBlockMeasure` 的生产实现（§4.4 / §4.5）。
 *
 * ## 为什么需要这一层
 *
 * 相机焦点要问两个问题：「从第 a 个字素到第 b 个字素有多宽」与「第 i 个字素多宽」。
 * 两个答案都在 `core/text-measure-pure.ts` 里（那里的换算只依赖 `prepared` 的数据形状，
 * 不碰 DOM），但 §15.1 的边界要求 `core/camera.ts` **不许**直接 import 它们 ——
 * 否则 F1 的单测就没法注入假度量了。于是 `camera.ts` 声明接口、本文件提供实现。
 *
 * ## 为什么不是 `FUME_ARTICLE_MEASURE` 的一部分
 *
 * 两者服务的调用点不同、生命周期也不同：
 * - `FUME_ARTICLE_MEASURE` 只在**排版时**被调用（每秒最多几次，且被 §7.9 防抖）；
 * - 本对象在**每一帧**被相机调用（最多每块三次）。
 *
 * 合成一个对象会让「排版接口的实现换了」与「相机度量换了」两件事绑在一起。
 * 分开之后，本文件的两个方法都是**一层薄包装**，没有任何状态、也不分配对象。
 */

import type { FumeBlockMeasure } from '../core/camera'
import { resolveGlyphAdvance, widthBetweenOffsets } from '../core/text-measure-pure'
import type { FumeBlock } from '../core/fume-types'

/**
 * 生产用的字素度量。
 *
 * ⚠️ `resolveGlyphAdvance` 的第二个参数是**渲染行在块内的下标**，不是全局字素下标：
 * `core/camera.ts` 传进来的 `lineIndex` 已经是从 `block.renderLines` 里定位好的行号，
 * 这里不要再拿 `block.renderLines[0]` 兜底 —— 那会让多行块的第 2 行之后的焦点全部
 * 落到第一行上（表现是「镜头总盯着块的开头」）。
 * 拿不到那一行时返回 0（宽度 0 = 焦点不前进，比抛错安全：相机会退化成停在块中心）。
 */
export const FUME_BLOCK_MEASURE: FumeBlockMeasure = {
  widthBetweenOffsets(block: FumeBlock, startOffset: number, endOffset: number): number {
    return widthBetweenOffsets(block.prepared, block.segmentMetas, startOffset, endOffset)
  },

  resolveGlyphAdvance(block: FumeBlock, renderLineIndex: number, graphemeIndex: number): number {
    const renderLine = block.renderLines[renderLineIndex]
    if (!renderLine) return 0
    return resolveGlyphAdvance(renderLine, graphemeIndex)
  }
}
