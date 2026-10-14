import { describe, expect, it } from 'vitest'

import { SUBTITLE_BOTTOM_HIDDEN_PX, SUBTITLE_BOTTOM_VISIBLE_PX } from './use-subtitle-bottom'

/**
 * 只测常量契约。
 *
 * 插值本身是 rAF + 墙上时间的函数，测它要把 `requestAnimationFrame` 与
 * `performance.now` 都换成假时钟 —— 那份复杂度换来的断言（"中途某一帧是 87.3px"）
 * 对行为没有任何约束力。真正需要钉住的是**两档数值**：它们直接来自上游
 * （基线 32px / 字幕净空 80px），改动它们就是改动观感。
 */
describe('副字幕底距的两档取值', () => {
  it('控制条在场 = 112px（上游基线 32 + 字幕净空 80）', () => {
    expect(SUBTITLE_BOTTOM_VISIBLE_PX).toBe(112)
  })

  it('控制条隐藏 = 32px（上游基线，净空不再需要）', () => {
    expect(SUBTITLE_BOTTOM_HIDDEN_PX).toBe(32)
  })

  it('在场档必须高于隐藏档，否则过渡方向反了也看不出来', () => {
    expect(SUBTITLE_BOTTOM_VISIBLE_PX).toBeGreaterThan(SUBTITLE_BOTTOM_HIDDEN_PX)
  })
})
