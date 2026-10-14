/**
 * sora 模式的 tuning —— 只有一个 `blank` 开关（规格 §6.5，Folia `src/types.ts:990-993`）。
 *
 * `blank = true` 时**完全不挂 WebGL canvas**，只留一层纯黑（深色）/ 纯白（浅色）底，
 * 这是「关掉动态背景」的廉价做法，也是唯一会跳过整个渲染路径的开关。
 */

export interface SoraBackgroundTuning {
  blank: boolean
}

export const DEFAULT_SORA_BACKGROUND_TUNING: SoraBackgroundTuning = { blank: false }

/** 只接受 boolean，其余回默认（对齐 `resolveStoredSoraBackgroundTuning`）。 */
export function resolveSoraTuning(
  tuning?: Partial<SoraBackgroundTuning> | null
): SoraBackgroundTuning {
  return {
    blank: typeof tuning?.blank === 'boolean' ? tuning.blank : DEFAULT_SORA_BACKGROUND_TUNING.blank
  }
}
