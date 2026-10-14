/**
 * 逐帧时钟的**纯算法核心** —— 与 Vue / DOM 无关，可在 node 环境单测。
 *
 * ## 要解决的问题
 *
 * Folia 的可视化每帧读 `audioElement.currentTime`（见它的
 * `usePlaybackVisualizerBridge`），所以拿到的时间是连续的。本项目拿不到同样干净的时间：
 *
 *  - `player.currentTimeMs` 来自 `timeupdate`，被 `THROTTLE_MS = 250` 节流 → 约 4Hz；
 *  - `audioElement.currentTime` 虽然随时可读，但 Chromium 的官方播放位置同样是**分级
 *    更新**的（不是逐帧亚毫秒推进），直接喂给动画仍会看到台阶。
 *
 * 「流光」的逐词状态是区间判定（`start - lookahead <= t <= activeEnd`），台阶会让词
 * 成批地跳亮；「浮名」的相机跟随打印光标，台阶会让镜头一顿一顿。所以本层做两件事：
 *  **按墙上时间外推** + **朝音频真值收敛**。
 *
 * ## 算法
 *
 * 每帧：
 *  1. **吸附判定** —— 本地时钟与音频真值的距离超过 `snapThresholdMs` 就直接对齐。
 *     这一步负责 seek、切歌、以及长时间挂起（标签页被节流）后的重新同步：
 *     这些情况下"平滑地追上去"是错的，会看到进度条拖着一秒的尾巴。
 *  2. **外推** —— 本地时钟 += 帧间隔 × 倍速。倍速必须参与，否则 0.5x/1.5x 下
 *     时钟会稳定地跑快或跑慢（外推与音频不同步）。
 *  3. **收敛** —— 把剩余误差按 `correctionGain` 的比例回灌，且单次回灌量不超过
 *     `maxCorrectionPerSampleMs`。这一步负责消化两台时钟速率上的细微差异，
 *     同时保证收敛是**渐进的**：误差不会被一次性抹平（那等于又制造了一个台阶）。
 *
 * 暂停时不外推（时间必须停住），但仍允许吸附 —— 暂停期间 seek 要立刻反映出来。
 *
 * ## ⚠️ 收敛只做在「新的真值样本到达」那一帧（本文件最容易写错的地方）
 *
 * 第一版实现每帧都朝当前真值收敛，结果是**时钟系统性跑慢**：真值 250ms 才更新一次，
 * 而外推每帧都在往前跑，于是每帧都产生一个"我们超前了"的误差，每帧都被往回拉一点。
 * 外推 +2ms/帧、回拉 -2ms/帧，稳态变成以约 87% 速度前进，最后靠吸附跳一下 —— 比不做
 * 平滑还难看。根因是把**过期的真值**当成了"现在的真值"：样本带着最多一个采样周期的
 * 延迟，它描述的不是当下，而是过去。
 *
 * 所以：**只有当真值真的变了（新样本到达）才做一次收敛**。两次样本之间是纯外推，
 * 与外推互不干扰。这也让收敛自然变成相位锁定 —— 时钟落后时误差为正、回灌为正（加速），
 * 超前时反向；稳态下外推速率恰好等于音频速率，回灌量趋于 0。
 *
 * ## 为什么不用单纯的平均 / 低通滤波
 *
 * 低通把台阶抹平的同时也把**真实的时间变化**一起抹平：词已经唱到下一段了，
 * 时钟还在上一段徘徊。本算法外推的是"音频时间应当走到的位置"，滤波器只用于消化
 * 两钟之间的漂移，误差不会累积。
 */

/** 时钟状态（不可变；每帧由 `stepClock` 产出新状态）。 */
export interface ClockState {
  /** 本地平滑时钟（毫秒，**已含歌词偏移**，可直接与歌词时间戳比较） */
  timeMs: number
  /**
   * 上一帧看到的音频真值。用来判断"这一帧是不是拿到了新样本" ——
   * 收敛只在新样本到达时做一次（见文件头）。调用方不要依赖它的语义。
   */
  lastTargetMs: number
}

export interface StepClockOptions {
  /** 上一帧的时钟状态；首帧传 null（直接吸附到 `targetMs`） */
  previous: ClockState | null
  /** 音频真值（毫秒，已含歌词偏移） */
  targetMs: number
  /** 距上一帧的墙上时间（毫秒）。首帧 / 异常值会被钳到合法范围 */
  deltaMs: number
  /** 是否正在播放。false 时时间停住（不外推），但仍可吸附 */
  isPlaying: boolean
  /** 播放倍速（0.5–1.5）。参与外推 */
  playbackRate: number
}

/**
 * 超过这个误差就直接对齐，不再平滑追赶。
 *
 * 取值理由：正常播放时两钟的差应该在**几十毫秒**量级（外推精度 + 事件延迟）。
 * 一旦超过 120ms，就基本是结构性事件（seek / 切歌 / 缓冲恢复）而不是漂移 ——
 * 这类事件必须立刻反映，否则用户会看到"seek 之后进度条自己滑过去"。
 */
const SNAP_THRESHOLD_MS = 120

/**
 * 单次（= 单个新样本）最多回灌的误差（毫秒）。
 *
 * 取值理由：收敛只在样本到达时发生（约 4Hz），所以上限可以比"每帧"大得多。
 * 25ms 小于 60fps 两帧的时长（33ms），歌词时间轴上更远小于任何 renderHints 档位的
 * 最小行时长（0.067s = 67ms），不会让词提前或延后跳亮。
 */
const MAX_CORRECTION_PER_SAMPLE_MS = 25

/**
 * 单个新样本回灌的误差比例。与上面的上限共同生效：小误差按比例慢慢收，
 * 大误差按上限匀速收。
 *
 * 取值理由：0.2 配合 4Hz 采样，等价于约 0.8×实时的追赶速度 ——
 * 100ms 的相位偏差约 0.6 秒收敛完，且每步不超过 25ms，全程无可见跳动。
 */
const CORRECTION_GAIN = 0.2

/** 单帧墙上时间上限（毫秒）。标签页被后台节流后 `deltaMs` 可能是几秒，必须先钳掉。 */
const MAX_DELTA_MS = 250

/** 非有限 / 负的 delta 一律当 0：宁可不外推，也不能把时钟推飞。 */
function sanitizeDelta(deltaMs: number): number {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0
  return Math.min(deltaMs, MAX_DELTA_MS)
}

/** 倍速非法（NaN / 0 / 负）时按 1 处理：外推速度为 0 会让时钟钉死。 */
function sanitizeRate(playbackRate: number): number {
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) return 1
  return playbackRate
}

/**
 * 推进一帧时钟。返回新的状态与**诊断信息**（诊断只用于单测与调试，不影响渲染）。
 */
export function stepClock(options: StepClockOptions): ClockState {
  const { previous, isPlaying } = options

  // 非有限的真值（NaN / ±Infinity）会把时钟永久污染，此时保持上一帧的值
  const rawTargetMs = Number.isFinite(options.targetMs)
    ? options.targetMs
    : (previous?.lastTargetMs ?? previous?.timeMs ?? 0)

  // 首帧没有可参考的上一状态：直接落到真值，不做平滑
  if (!previous || !Number.isFinite(previous.timeMs)) {
    return { timeMs: rawTargetMs, lastTargetMs: rawTargetMs }
  }

  // 1. 外推：暂停时不推进时间
  const delta = sanitizeDelta(options.deltaMs)
  const rate = sanitizeRate(options.playbackRate)
  const advanced = isPlaying ? previous.timeMs + delta * rate : previous.timeMs

  // 2. 只在**新样本**到达时收敛一次；样本没变的那些帧是纯外推（见文件头）。
  // 每帧都收敛会让时钟系统性跑慢 —— 那是拿过期真值去否定外推。
  if (rawTargetMs === previous.lastTargetMs) {
    return { timeMs: advanced, lastTargetMs: previous.lastTargetMs }
  }

  const error = rawTargetMs - advanced

  // 结构性偏差（seek / 切歌 / 长挂起）直接吸附，不做渐进收敛
  if (Math.abs(error) >= SNAP_THRESHOLD_MS) {
    return { timeMs: rawTargetMs, lastTargetMs: rawTargetMs }
  }

  // 暂停中：真值是**权威且静止**的，不存在"样本过期"的问题（音频没在走），
  // 所以任何差异都是真实的重定位，直接对齐 —— 收敛它是错的：
  // 暂停时 seek 50ms 若走渐进收敛，快照只来一次，时钟会永久差着那 50ms。
  if (!isPlaying) {
    return { timeMs: rawTargetMs, lastTargetMs: rawTargetMs }
  }

  // 收敛：比例 + 单次上限双钳制，方向跟随剩余误差
  const proportional = error * CORRECTION_GAIN
  const clamped = Math.max(
    -MAX_CORRECTION_PER_SAMPLE_MS,
    Math.min(MAX_CORRECTION_PER_SAMPLE_MS, proportional)
  )
  return { timeMs: advanced + clamped, lastTargetMs: rawTargetMs }
}
