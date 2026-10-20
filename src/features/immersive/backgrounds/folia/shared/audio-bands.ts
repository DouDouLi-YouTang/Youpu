import type { AudioBands } from '../../../use-audio-bands'
import type { FoliaAudioBands } from '../types'

/**
 * 音频量纲换算 —— Folia 六频带（0–255）↔ 本项目四频带（0–1）的**唯一**转换点。
 *
 * 为什么必须集中在一处（§11 风险 3）：Folia 的音频公式里有 `(cur - prev) * 7` 这种
 * **帧间差分**与 `pow(x, 0.55)` 这种非线性环节，量纲换错不会报错，只会表现为
 * 「音频反应开关没效果」或「背景一直顶在最大速度」，极难 debug。
 *
 * 映射表（左：本项目 `AudioBands`；右：Folia 六频带）—— 取色/频段都对不上原始 FFT，
 * 这是**刻意近似**，不是等价还原：
 *  - bass    = low                （20–150Hz 落在 low 区间 20–250Hz 的低频半区）
 *  - lowMid  = low*0.6 + mid*0.4  （150–400Hz 横跨 low 高频半区与 mid 起始段）
 *  - mid     = mid                （400–1200Hz 基本就是 mid 区间 250–2000Hz）
 *  - vocal   = mid*0.65 + high*0.35（1000–3500Hz 从 mid 尾段跨到 high 首段）
 *  - treble  = high               （3500Hz+ 对应 high 区间 2000–8000Hz）
 *
 * 上游若改成真六频带，删掉 `toFoliaBands` 直接透传即可，调用点不用动。
 */

/** Folia 音频量纲上限（`normalizeAudio = v / 255` 就是这个 255）。 */
export const FOLIA_AUDIO_MAX = 255

/**
 * 宿主可选的音频量纲。
 *
 * 为什么要有这个开关（而不是「只接受 0–1」或「只接受 0–255」）：
 *  - 本项目 `use-audio-bands.ts` 给的是 **0–1**，Folia 的公式吃 **0–255**，
 *    两者混用不会报错，只会让背景「要么一直顶在最大速度、要么完全没反应」（§11 风险 3）；
 *  - 上游将来若换成真六频带（0–255 桶能量），宿主不该被迫改接口。
 * 所以量纲做成显式参数，默认 `'0-1'`，转换只发生在这一层。
 */
export type FoliaAudioScale = '0-1' | '0-255'

/**
 * 宿主可以喂进来的频带形状：
 *  - 本项目四频带 `{ low, mid, high, power }`（0–1）
 *  - Folia 五频带 `{ bass, lowMid, mid, vocal, treble }`（0–255）
 *  - 两者的混合（例如自定义上游把 `power` 与 `bass` 一起给出）
 *
 * 判定方式是**看出现了哪些键**，不是看数值大小 —— 数值判定在静音时会把
 * 一路静音的四频带误当成「五频带缺键」。
 */
export type FoliaAudioBandsInput = Partial<AudioBands> & Partial<FoliaAudioBands>

/** 把任意输入夹进 0–255；NaN → 0（NaN 在 shader uniform 里会让整个背景消失）。 */
export function clampFoliaAudio(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(FOLIA_AUDIO_MAX, Math.max(0, value))
}

/** 本项目 0–1 的通道值 → Folia 0–255（越界与 NaN 都被夹住）。 */
export function toFoliaScale(value01: number): number {
  if (!Number.isFinite(value01)) return 0
  return clampFoliaAudio(Math.min(1, Math.max(0, value01)) * FOLIA_AUDIO_MAX)
}

/** 本项目四频带 → Folia 五频带，全部换算到 0–255。 */
export function toFoliaBands(bands: AudioBands): FoliaAudioBands {
  return {
    bass: toFoliaScale(bands.low),
    lowMid: toFoliaScale(bands.low * 0.6 + bands.mid * 0.4),
    mid: toFoliaScale(bands.mid),
    vocal: toFoliaScale(bands.mid * 0.65 + bands.high * 0.35),
    treble: toFoliaScale(bands.high)
  }
}

/** 整条链路都没数据时的静默值（不播放 / 图没建起来）。 */
export function silentFoliaBands(): FoliaAudioBands {
  return { bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 }
}

/** 数值 → 目标量纲：`'0-1'` 原样（夹 0–1），`'0-255'` 只夹区间不换算。 */
function normalizeValue(value: number | undefined, scale: FoliaAudioScale): number {
  if (scale === '0-255') return clampFoliaAudio(value ?? 0)
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** 0–1 → 0–255；已经是 0–255 就原样夹住。 */
function normalizeToFolia(value: number | undefined, scale: FoliaAudioScale): number {
  if (scale === '0-255') return clampFoliaAudio(value ?? 0)
  return toFoliaScale(value ?? 0)
}

/**
 * 四频带 → Folia 五频带，**输入量纲由 `scale` 决定**（`toFoliaBands` 的通用版）。
 *
 * 两条注意事项：
 *  1. `lowMid` 与 `vocal` 的加权（0.6/0.4、0.65/0.35）是**近似映射**，见
 *     `toFoliaBands` 的说明；这里只是把它扩展到「输入允许已经是 0–255」。
 *  2. `power` 不参与五频带 —— Folia 的 `audioPower` 是独立的一路（`readFoliaPower` 管）。
 */
export function toFoliaBandsFromInput(
  bands: FoliaAudioBandsInput,
  scale: FoliaAudioScale = '0-1'
): FoliaAudioBands {
  const low = normalizeValue(bands.low, scale)
  const mid = normalizeValue(bands.mid, scale)
  const high = normalizeValue(bands.high, scale)
  return {
    bass: normalizeToFolia(low, scale),
    lowMid: normalizeToFolia(low * 0.6 + mid * 0.4, scale),
    mid: normalizeToFolia(mid, scale),
    vocal: normalizeToFolia(mid * 0.65 + high * 0.35, scale),
    treble: normalizeToFolia(high, scale)
  }
}

/** 是否给的是 Folia 五频带（出现任一五频带专属键即算）。 */
export function isFoliaBandShape(bands: FoliaAudioBandsInput): boolean {
  return (
    bands.bass !== undefined ||
    bands.lowMid !== undefined ||
    bands.vocal !== undefined ||
    bands.treble !== undefined
  )
}

/**
 * 宿主的频带回调结果 → Folia 五频带（0–255）。
 *
 * 自动识别形状：给四频带就走近似映射；给了任一五频带键就直接用该键，
 * **缺的键才拿四频带的映射结果补**。这样上游平滑地从四频带迁到六频带时两边都不用改。
 */
export function normalizeAudioBandsInput(
  bands: FoliaAudioBandsInput | null | undefined,
  scale: FoliaAudioScale = '0-1'
): FoliaAudioBands {
  if (!bands) return silentFoliaBands()
  if (!isFoliaBandShape(bands)) return toFoliaBandsFromInput(bands, scale)

  const mapped = toFoliaBandsFromInput(bands, scale)
  const pick = (value: number | undefined, fallback: number): number =>
    value === undefined ? fallback : normalizeToFolia(value, scale)
  return {
    bass: pick(bands.bass, mapped.bass),
    lowMid: pick(bands.lowMid, mapped.lowMid),
    mid: pick(bands.mid, mapped.mid),
    vocal: pick(bands.vocal, mapped.vocal),
    treble: pick(bands.treble, mapped.treble)
  }
}

/** 宿主的整体能量回调结果 → Folia 0–255（`audioPower` 的通用版）。 */
export function normalizeAudioPowerInput(
  value: number | null | undefined,
  scale: FoliaAudioScale = '0-1'
): number {
  return normalizeToFolia(value ?? 0, scale)
}

/** Folia `normalizeAudio(v) = min(1, max(0, v / 255))`。 */
export function normalizeAudio(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value / FOLIA_AUDIO_MAX))
}

/** 读取面：给宿主用的两个便捷包装（回调可能返回 undefined / 半截对象）。 */
export function readFoliaBands(
  provider: (() => FoliaAudioBandsInput) | undefined,
  scale: FoliaAudioScale = '0-1'
): FoliaAudioBands {
  return normalizeAudioBandsInput(provider?.(), scale)
}

/** 读取面：整体能量，量纲同 `normalizeAudioPowerInput`。 */
export function readFoliaPower(
  provider: (() => number) | undefined,
  scale: FoliaAudioScale = '0-1'
): number {
  return normalizeAudioPowerInput(provider?.(), scale)
}
