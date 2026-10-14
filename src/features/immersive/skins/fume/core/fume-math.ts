/**
 * 「浮名」纯算法层的地基（移植规格书 §3）：钳制、缓动、字素切分、FNV-1a 种子。
 *
 * **单位**：本文件全部是**单位无关**的纯数值函数 —— 比例、哈希、缓动曲线都不关心
 * 入参是秒还是毫秒。规格书 §3 里唯一带单位的常量在别处（§5 的揭示时长），
 * 那个文件会把单位写进标识符，本文件不出现 `* 1000` / `/ 1000`。
 *
 * **为什么不能直接复用「倾诉」的 seededRandom**：两者算法同源但**不同实现** ——
 * 倾诉是「数值种子 + murmur3 混淆 + 索引」（可按索引随机访问），
 * 浮名是「字符串种子 + FNV-1a + 1/10000 量化」（种子本身就是 `${文本}:${下标}` 这种串）。
 * 两者都是确定性的，但换用会让所有排版/背景形状**整体变位**：
 * `seeded('世界:0') !== seededRandom(0, 0)`。所以必须各留一份，不能互相替代。
 *
 * 字素切分**复用**「倾诉」的 `core/graphemes.ts`（规格书 §15.6 / §17.3 明确要求
 * 「只保留一份 Intl.Segmenter 实例」）：本文件只做一层 `map` 适配，不新建 Segmenter。
 * 代价是 fume → tilt 的一条单向依赖；若将来有第三个皮肤也要切字素，
 * 正确的做法是把 `graphemes.ts` 提到 `skins/shared/`，而不是各抄一份。
 */

import { segmentGraphemes } from '../../tilt/core/graphemes'

/** FNV-1a 32 位偏移基准 */
const FNV_OFFSET_BASIS = 2166136261

/** FNV-1a 32 位质数（必须是 Math.imul 能正确处理的 32 位整数） */
const FNV_PRIME = 16777619

/** `seeded` 的量化档数：规格书 §3 要求粒度是 1/10000，不是浮点全精度 */
const SEED_QUANTIZATION = 10000

/**
 * CJK 判定（规格书 §3）：汉字、假名、韩文谚文。
 *
 * ⚠️ **上界是 `\u9fff`，不是 `\u9fa5`** —— 同一份 Folia 源码里
 * `components/visualizer/wordColoring.ts` 用的是 `\u4e00-\u9fa5`，
 * 两者**故意不一致**（这是上游原样）。本项目的 `shared/word-coloring.ts`
 * 实现的是前者（逐词着色口径），本文件是后者（基线 0.52 / 0.5 的口径）。
 * 区间差异只影响 `\u9fa6-\u9fff` 这一小段兼容汉字，不要「顺手统一」。
 */
const CJK_RE = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/

/**
 * 按字素切分文本（空串 → 空数组）。
 *
 * 语义与 Folia `fumeMath.splitGraphemes` 完全一致，实现复用「倾诉」的切分器：
 * emoji（含 ZWJ 序列、肤色修饰）、组合字符、韩文音节都必须是一个整体。
 */
export function splitGraphemes(text: string): string[] {
  return segmentGraphemes(text).map((grapheme) => grapheme.text)
}

/** 把数值钳到 [min, max]。**不**对 NaN 兜底（规格书 §3 原样，见文件头单位说明）。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** 线性插值：amount = 0 取 from，= 1 取 to。amount 不钳制（调用方自行决定外插）。 */
export function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount
}

/** 二次贝塞尔（相机桥接路径用）。amount 先钳到 [0, 1]，因此端点精确等于 from / to。 */
export function quadraticBezier(from: number, control: number, to: number, amount: number): number {
  const t = clamp(amount, 0, 1)
  const inverse = 1 - t
  return inverse * inverse * from + 2 * inverse * t * control + t * t * to
}

/** 缓出三次曲线：起步快、收尾慢（0 → 1，f'(0) = 3，f'(1) = 0）。 */
export function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - clamp(value, 0, 1), 3)
}

/** 缓入三次曲线：起步慢、收尾快（0 → 1，f'(0) = 0，f'(1) = 3）。 */
export function easeInCubic(value: number): number {
  return Math.pow(clamp(value, 0, 1), 3)
}

/** 缓入缓出三次曲线（相机跨行混合用）：0 → 1，中点为 0.5，两端一阶导为 0。 */
export function easeInOutCubic(value: number): number {
  const t = clamp(value, 0, 1)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * 「迟到的辉光」包络（规格书 §3）：先升后降，在 `peakProgress` 处达到 1，之后回落到 0。
 *
 * 用途是「字刚唱出来时先暗一下、再亮起来」——所以峰值不在起点，
 * 而是拖到进度 0.8（默认）才最亮，然后迅速退掉，避免和后面的字抢注意力。
 *
 * `peakProgress` 被钳到 [0.05, 0.95]：等于 0 或 1 会让某一段被 0 除。
 */
export function resolveDelayedGlowEnvelope(progress: number, peakProgress = 0.8): number {
  const t = clamp(progress, 0, 1)
  const peak = clamp(peakProgress, 0.05, 0.95)
  if (t <= peak) {
    return easeOutCubic(t / peak)
  }
  return 1 - easeInCubic((t - peak) / (1 - peak))
}

/** 文本是否含 CJK 字符（见 CJK_RE 的区间说明）。 */
export function isCjk(text: string): boolean {
  return CJK_RE.test(text)
}

/**
 * FNV-1a 32 位哈希。
 *
 * 为什么用 FNV-1a 而不是 murmur3：浮名的所有随机都绑在**字符串**种子
 * （`${line.fullText}:${index}` 这类）上，FNV-1a 逐字符、无长度前缀、实现 5 行，
 * 且跨引擎结果一致（规格书 §18 只对「跨平台」留了未确认，对同一引擎是确定的）。
 *
 * 返回无符号 32 位整数（`>>> 0`），保证下游取模永远非负。
 */
export function hashString(input: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

/**
 * 字符串种子 → 确定性伪随机值。
 *
 * **粒度是 1/10000**（不是浮点全精度）：先哈希再 `% 10000`。
 * 这一条必须原样保留 —— 布局里好几处拿它跟阈值比大小（如 `random > 0.965`），
 * 换成全精度会让「哪些行被选成 hero」在极少数边界上翻转。
 *
 * 返回值范围是 [0, 0.9999]（**取不到 1**，因为取模结果最大 9999）。
 */
export function seeded(seed: string): number {
  return (hashString(seed) % SEED_QUANTIZATION) / SEED_QUANTIZATION
}
