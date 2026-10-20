/**
 * 逐字脉冲（移植笔记 §6）：正在唱的字鼓一下，唱完留一点余晖。
 *
 * **本文件全部是「归一化量」的函数**：输入 progress（已唱进度，比例），
 * 输出强度（0–1）。与时间单位无关 —— 秒、毫秒都成立，本层只做比例运算，
 * 不做 ms↔s 换算。
 *
 * 移植笔记 §6 里的 `duration = clamp(endTime - startTime, 0.2, 0.9)` 是**带单位的**
 * （在 Folia 里是秒），所以在这里拆成两半：
 * - 时长钳制的上下界由调用方按自己的单位传入（秒：0.2 / 0.9；毫秒：200 / 900）
 * - 曲线本身只看 progress，与单位无关
 *
 * 曲线（移植笔记 §6 原样，progress = elapsed / 钳制后的 duration）：
 *   progress <= 0            → 0（还没唱到）
 *   0 < progress <= 1        → sin(progress * π)          // 0→1→0 的钟形，峰值在 progress = 0.5
 *   1 < progress             → after = progress - 1
 *                              ramp = 1.2（即 1.2 倍时长）
 *                              after >= ramp → 0.25      // 余晖地板
 *                              否则          → 0.25 * (after / ramp)
 *
 * 纯函数，可在 node 环境单测。
 */

/** 余晖地板值（移植笔记 §6） */
export const AFTERGLOW_FLOOR = 0.25

/** 余晖过渡倍率：ramp = duration * 1.2（移植笔记 §6） */
const AFTERGLOW_RAMP_FACTOR = 1.2

/** 字脉冲放大倍率（移植笔记 §6）：倾斜段 0.18，非倾斜段 0.15 */
const TILT_PULSE_SCALE = 0.18
const PLAIN_PULSE_SCALE = 0.15

/** 把数值钳到 [min, max]；min > max 时退化到 min（不产生抖动区间） */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * 时长钳制：避免极短/极长音（移植笔记 §6 的 clamp(endTime - startTime, 0.2, 0.9)）。
 * 单位由调用方决定：传秒就用 0.2 / 0.9，传毫秒就用 200 / 900。
 *
 * 退化输入：duration 为 NaN → minDuration（无从判断，取保守值）；±Infinity 照常钳制；
 * minDuration/maxDuration 非有限值 → 退化为 0；min > max 时退化为 min（不产生抖动区间）。
 */
export function clampPulseDuration(
  duration: number,
  minDuration: number,
  maxDuration: number
): number {
  const min = Number.isFinite(minDuration) ? minDuration : 0
  const max = Number.isFinite(maxDuration) ? Math.max(maxDuration, min) : min
  if (Number.isNaN(duration)) return min
  return clamp(duration, min, max)
}

/**
 * 归一化进度：progress = elapsed / 钳制后的时长（移植笔记 §6 的分母）。
 *
 * @param currentTime 当前播放时间
 * @param startTime   该字素开始时间
 * @param endTime     该字素结束时间
 * @param minDuration 时长下限（本项目的毫秒口径：200）
 * @param maxDuration 时长上限（本项目的毫秒口径：900）
 * @returns 已唱进度比例（可为负，表示还没唱到；曲线里 negative → 0）
 */
export function resolveCharPulseProgress(
  currentTime: number,
  startTime: number,
  endTime: number,
  minDuration: number,
  maxDuration: number
): number {
  const duration = clampPulseDuration(endTime - startTime, minDuration, maxDuration)
  if (!Number.isFinite(currentTime) || !Number.isFinite(startTime)) return 0
  if (duration <= 0) return currentTime >= startTime ? AFTERGLOW_RAMP_FACTOR : 0
  return (currentTime - startTime) / duration
}

/**
 * 脉冲强度曲线（移植笔记 §6）。
 *
 * @param progress 已唱进度比例（elapsed / 钳制后时长）
 * @returns [0, 1]；峰值 1 出现在 progress = 0.5；唱完很久恒为余晖地板 0.25
 *
 * 退化输入：NaN → 0（不污染动画）；+Infinity → 余晖地板（视为早已唱完）；
 * -Infinity/负数 → 0（还没唱到）。
 */
export function getCharPulseIntensity(progress: number): number {
  if (Number.isNaN(progress) || progress <= 0) return 0
  if (progress <= 1) return Math.sin(progress * Math.PI)
  const afterElapsed = progress - 1
  if (afterElapsed >= AFTERGLOW_RAMP_FACTOR) return AFTERGLOW_FLOOR
  return AFTERGLOW_FLOOR * (afterElapsed / AFTERGLOW_RAMP_FACTOR)
}

/** 一步到位：由时间与区间直接算强度（内部先做时长钳制，再取曲线） */
export function getCharPulseAtTime(
  currentTime: number,
  startTime: number,
  endTime: number,
  minDuration: number,
  maxDuration: number
): number {
  return getCharPulseIntensity(
    resolveCharPulseProgress(currentTime, startTime, endTime, minDuration, maxDuration)
  )
}

/**
 * 脉冲放大倍率（移植笔记 §6）：倾斜段 `1 + intensity * 0.18`，
 * 非倾斜段 `1 + intensity * 0.15`。
 *
 * @param intensity 脉冲强度（getCharPulseIntensity 的输出，超出 [0,1] 会被钳制）
 * @param isTilted  该字/该段是否为倾斜段
 */
export function getCharPulseScale(intensity: number, isTilted: boolean): number {
  const value = Number.isFinite(intensity) ? clamp(intensity, 0, 1) : 0
  return 1 + value * (isTilted ? TILT_PULSE_SCALE : PLAIN_PULSE_SCALE)
}
