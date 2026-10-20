/**
 * 播放时长的「实质变化」判定。
 *
 * ## 为什么需要它
 *
 * `HTMLMediaElement.duration` 在部分内核里**不是常量**：流式 / 转码源会以小数
 * 反复向上爬（实测 `268051.973`），每次 `durationchange` 都带一点尾数变化。
 * 对行结束时间、末行拖尾这类消费方来说，1 毫秒的差值没有任何视觉意义；但若把它
 * 当成新输入写回 store，所有依赖 `durationMs` 的 computed 都会重算 —— 「浮名」的
 * 排版缓存键包含它，于是 96ms 防抖被无限重置，表现是「歌词早已显示，排版加载卡
 * 却一直挂着」。
 *
 * 取 1 秒：远大于浮点噪声，又小于「用户听得出来的时长修正」（音质切换后整首歌的
 * 时长差通常是秒级），因此不会挡住真正需要重算的那一类变化。
 *
 * 放在 `utils/` 而不是某个皮肤目录下：store 是数据层，不能反过来依赖
 * `features/immersive` 的皮肤实现。
 */

/** 播放时长的「实质变化」阈值（毫秒） */
export const PLAYER_DURATION_EPSILON_MS = 1000

/**
 * 新时长是否**值得**写回 store。
 *
 * `current <= 0` 视为「还没有时长」—— 第一次拿到真实值必须写回，否则末行会一直
 * 按固定 5 秒兜底。
 */
export function shouldApplyPlayerDuration(currentMs: number, nextMs: number): boolean {
  if (!Number.isFinite(nextMs) || nextMs <= 0) return false
  if (!Number.isFinite(currentMs) || currentMs <= 0) return true
  return Math.abs(nextMs - currentMs) >= PLAYER_DURATION_EPSILON_MS
}
