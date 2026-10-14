/**
 * monet 的「呼吸漂移」轨道 —— 规格 §4.4 的算法重写。
 *
 * ## 为什么用 Web Animations API 而不是每帧写 style
 *
 * 漂移是一条**周期噪声**（AE wiggle 那类的分形值噪声）采样出来的长关键帧轨道：
 * 一次生成 157 个关键帧交给合成器播 240 秒，之后主线程零成本。
 * 如果用 rAF 每帧算噪声写 transform，就变成一个永不停歇的主线程任务 ——
 * 这个背景是纯装饰，不该和歌词滚动抢帧。
 *
 * ## 为什么噪声必须是「周期」的
 *
 * 每条轨道要无缝循环：噪声的格点坐标先对格点数取模再哈希，于是
 * `t` 与 `t + 76` 落在同一格点上，首尾关键帧自动接上。
 * 直接用 `sin(t * 127.1)` 这类非周期哈希的话，每次循环回跳都会看到一个明显的「顿挫」。
 *
 * ## 预放大的由来（不要把 `minScale` 简化掉）
 *
 * 元素同时做平移与缩放：平移最多 `travel%`，所以元素必须预先放大到
 * `1 + 2 * travel` 才不会有任何一帧把图像边缘拖进可视区，
 * 再加上 `DRIFT_OVERSCAN_MARGIN` 吃掉浮点舍入（关键帧的 transform 是字符串化的，有舍入）。
 * 亮度呼吸 `breath` 是**叠加**在这个下限之上的，只会更大、不会破坏遮盖。
 */

/** 一圈噪声格点走完的时长。够长，肉眼不会把它读成「循环」。 */
const DRIFT_LOOP_SECONDS = 240
/** 每圈的格点数。间距约 4.6s，即约每 9s 一次摆动。 */
const DRIFT_LATTICE_POINTS = 76
/** 每圈采样数。每格约 3 个采样点，分段线性播放看不出折角。 */
const DRIFT_SAMPLE_COUNT = 156
/** strength = 1 时的最大位移（元素自身宽/高的百分比）。 */
const DRIFT_MAX_TRAVEL_PERCENT = 3.4
/** strength = 1 时的缩放呼吸幅度。 */
const DRIFT_BREATH_AMPLITUDE = 0.035
/** 几何下限之上的余量，防止舍入把边缘露出来。 */
const DRIFT_OVERSCAN_MARGIN = 0.01
/** 三个通道各用一套格点，否则 x/y/scale 会同步运动（看起来像整体平移而不是蠕动）。 */
const DRIFT_SEED_X = 12.9898
const DRIFT_SEED_Y = 78.233
const DRIFT_SEED_SCALE = 39.425

export interface MonetDriftTrack {
  keyframes: Keyframe[]
  durationMs: number
  /** 关键帧里最大的 |translate|（元素自身盒子的百分比） */
  maxTravelPercent: number
  /** 关键帧里最小的缩放；必须大于 `1 + 2 * maxTravelPercent` 才能遮住边缘 */
  minScale: number
}

const wrap = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus

/** 与 GLSL 常见写法同构的哈希：取小数部分，避免相邻格点相关。 */
const hash = (lattice: number, seed: number): number => {
  const value = Math.sin(lattice * 127.1 + seed * 311.7) * 43758.5453
  return value - Math.floor(value)
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t)

/** 值噪声，每 `points` 个格点精确重复一次，所以轨道能无缝循环。 */
const periodicNoise = (t: number, points: number, seed: number): number => {
  const cell = Math.floor(t)
  const from = hash(wrap(cell, points), seed)
  const to = hash(wrap(cell + 1, points), seed)
  return from + (to - from) * smoothstep(t - cell)
}

/** 两个八度的周期噪声，中心化到 0。第二个八度提供更细的抖动。 */
const periodicFbm = (t: number, seed: number): number => {
  const base = periodicNoise(t, DRIFT_LATTICE_POINTS, seed)
  const detail = periodicNoise(t * 2, DRIFT_LATTICE_POINTS * 2, seed + 17.31)
  return (base * 0.68 + detail * 0.32) * 2 - 1
}

/**
 * 把每个通道的极值归一化到 ±1 —— 这样「位移预算」是精确的：
 * `travelPercent` 就是轨道真正能达到的最大位移，不用为了保守再猜一个系数。
 * 峰值恰好为 0（参数被极端值污染）时原样返回，避免整条轨道除以 0 变成 NaN（transform 会整条失效）。
 */
const normalize = (samples: number[]): number[] => {
  const peak = samples.reduce((acc, value) => Math.max(acc, Math.abs(value)), 0)
  return peak > 0 ? samples.map((value) => value / peak) : samples
}

/**
 * 按 strength（0–1）生成漂移轨道。关键帧数量恒为 `DRIFT_SAMPLE_COUNT + 1`
 * （首尾各取一次，索引 0..156 —— 少一个都会让循环接缝处跳动）。
 */
export function buildMonetDriftTrack(strength: number): MonetDriftTrack {
  const safeStrength = Number.isFinite(strength) ? strength : 0
  const clamped = Math.min(1, Math.max(0, safeStrength))
  const travelPercent = DRIFT_MAX_TRAVEL_PERCENT * clamped
  const minScale = 1 + (travelPercent / 100) * 2 + DRIFT_OVERSCAN_MARGIN
  const breath = DRIFT_BREATH_AMPLITUDE * clamped

  const rawX: number[] = []
  const rawY: number[] = []
  const rawScale: number[] = []
  for (let index = 0; index <= DRIFT_SAMPLE_COUNT; index += 1) {
    const t = (DRIFT_LATTICE_POINTS * index) / DRIFT_SAMPLE_COUNT
    rawX.push(periodicFbm(t, DRIFT_SEED_X))
    rawY.push(periodicFbm(t, DRIFT_SEED_Y))
    rawScale.push(periodicFbm(t, DRIFT_SEED_SCALE))
  }

  const x = normalize(rawX)
  const y = normalize(rawY)
  const scale = normalize(rawScale)

  // 精度（4 / 5 位小数）与 Folia 一致：再多只是让轨道字符串变长，播放结果没有区别。
  const keyframes = x.map((offsetX, index) => ({
    transform:
      `translate3d(${(offsetX * travelPercent).toFixed(4)}%, ${(y[index] * travelPercent).toFixed(4)}%, 0) ` +
      `scale(${(minScale + breath * ((scale[index] + 1) / 2)).toFixed(5)})`
  }))

  return {
    keyframes,
    durationMs: DRIFT_LOOP_SECONDS * 1000,
    maxTravelPercent: travelPercent,
    minScale
  }
}

/** 导出常量给单测用，避免测试里重复字面量。 */
export const MONET_DRIFT_CONSTANTS = Object.freeze({
  loopSeconds: DRIFT_LOOP_SECONDS,
  latticePoints: DRIFT_LATTICE_POINTS,
  sampleCount: DRIFT_SAMPLE_COUNT,
  maxTravelPercent: DRIFT_MAX_TRAVEL_PERCENT,
  breathAmplitude: DRIFT_BREATH_AMPLITUDE,
  overscanMargin: DRIFT_OVERSCAN_MARGIN
})
