/**
 * 「浮名」字号二分用的**宽度模型**（性能修复，2026-10-17）。
 *
 * ## 它替掉了什么
 *
 * §4.10 的字号二分对**每一行**都要试 8 个候选字号（外加上一次兜底），每个候选都要
 * 走一遍 `prepare()` + `layout()`。而 pretext 的片段宽度缓存键里含**完整字体串（含字号）**
 * —— 字号一变，这首歌的所有片段都要在 canvas 上重新量一遍。
 *
 * 实测（Chromium + 随包衬线字体，29 行歌词、32 次顶层尝试）：
 *
 * | 指标 | 实测 |
 * | --- | --- |
 * | `measureText` 调用 | **21776 次** |
 * | 花在 `measureText` 上 | **1662ms / 整次排版 2047ms** |
 * | 被量的**不同片段** | 150 个 |
 * | 被量的**不同字号** | **240 个** |
 *
 * 也就是说：真正的信息量只有 150 个宽度，却按 240 个字号量了 21776 次。
 *
 * ## 模型：宽度随字号**线性**缩放
 *
 * canvas 的字宽是「设计单位 ×（字号 / unitsPerEm）」，所以同一段文本在字号 f 下的
 * 宽度就是参考字号下宽度 × `f / 参考字号`。于是「这段文字在 f 下多宽」不必再量：
 * **在参考字号下量一次**，之后只做乘法。
 *
 * 实测缩放偏差（29 行日文歌词 × 17 个字号 × 两种字重，Chromium）：
 * **最大 0.000244px**，均值 0.0001px 量级 —— 那是浮点噪声，与字号无关。
 *
 * ## 判据：为什么是「内容宽度和 ≤ 块宽」
 *
 * 单行走线器（`simpleLineWalkFastPath`）在累计宽度超过 `fitLimit = 块宽 + ε` 时**必然**
 * 断行，因此「内容宽度和 ≤ 块宽」是「排成一行」的充要条件。两个例外都被吸收进来：
 * - **行末空白**挂到行外、不触发断行 → 内容宽度和里剔除行末的空白片段；
 * - **行首空白**被跳过、不占宽度 → 同样剔除。
 *
 * 实测（151844 组：真实歌词 × 17 个字号 × 65 档块宽）：这条判据与
 * `layout(prepared, 块宽, 行高).lineCount === 1` **零分歧**。
 *
 * ## 不确定区（`unsure`）：不猜
 *
 * 线性缩放不是逐位相等（见上的 0.000244px），所以判据只在**离阈值足够远**时才下结论：
 * 余量落在 `±FUME_WIDTH_MODEL_SAFETY_BAND_PX` 之内一律返回 `unsure`，由调用方用真实的
 * `prepare() + layout()` 复核。安全带宽取 0.5px，是实测最大偏差的 **2000 倍**；而在真实
 * 歌词上它只命中千分之几的候选 —— 也就是几乎每次都能省下一次完整测量。
 *
 * ## 什么时候**不**用模型（返回 `null`，退化成逐候选精确测量）
 *
 * - **含 emoji**：pretext 会按字号做 emoji 宽度校正（`emojiCorrection`），那条路径
 *   不是线性的；
 * - **含硬换行 / 制表符 / 软连字符**：走线器不是 `simpleLineWalkFastPath`，判据的前提
 *   不存在（`chunks.length !== 1` 也包含这种文本）；
 * - **内容宽度和为 0**（空串 / 纯空白）：`layout()` 会给 0 行，与判据的「1 行」不符；
 * - **读不到 pretext 的内部字段**（将来升级改字段名）：一律退化，不抛错。
 *
 * 本模块**只**碰 pretext 与纯换算，不碰 Vue / DOM 之外的任何东西，可在 node 单测里
 * 用假 pretext 覆盖全部分支。
 */

import { prepare } from '@chenglou/pretext'
import { rememberBounded } from '../../shared/bounded-cache'
import { FUME_PRETEXT_OPTIONS } from './pretext-options'

/**
 * 参考字号（px）。
 *
 * 取 32 而不是候选区间的端点（18 / 58）：缩放倍数越接近 1，浮点误差越小，而 32 落在
 * hero（18..58）与 body（10..30）**两个区间都在意**的中段。它也**不参与**任何输出 ——
 * 换掉它只改变浮点末位，不改变判据结论。
 */
export const FUME_WIDTH_MODEL_REFERENCE_FONT_PX = 32

/**
 * 判定「单行 / 换行」的安全带宽（px）。
 *
 * 余量落在这条带子里就返回 `unsure`，交给真实测量复核。取 0.5px 的理由：
 * - 它必须**远大于**模型误差（实测 0.000244px，这里给了 2000 倍）；
 * - 它必须**远小于**相邻候选字号的宽度差（块宽 500px 上相邻候选差约 20~60px），
 *   否则会把大量本来能判定的候选推进精确路径，白白丢掉这次优化的全部收益。
 */
export const FUME_WIDTH_MODEL_SAFETY_BAND_PX = 0.5

/** 宽度模型缓存上限：远大于一首歌的行数 × 两种字重，又给长会话设了上界 */
export const FUME_WIDTH_MODEL_CACHE_LIMIT = 1024

/**
 * 行首会被走线器跳过的片段类型（`line-break.ts` 的 `consumesAtLineStart`）。
 *
 * ⚠️ 这里**没有** `preserved-space`：`pre-wrap` 下的行首空格是**保留**的，它会占宽度、
 * 也会成为行首内容。把它当成「可跳过」会让含行首空格的行判轻。
 */
const LEADING_HANG_KINDS = new Set(['space', 'zero-width-break', 'soft-hyphen'])

/**
 * 行末会挂到行外、不触发断行的片段类型（`line-break.ts` 的 `breaksAfter`）。
 *
 * 与行首不同，这一组**包含** `preserved-space`：行末的保留空格确实会挂出纸边。
 */
const TRAILING_HANG_KINDS = new Set([
  'space',
  'preserved-space',
  'tab',
  'zero-width-break',
  'soft-hyphen'
])

/**
 * pretext 判定是否可能含 emoji 的正则（与它的 `maybeEmojiRe` 同源）。
 *
 * 不复用 pretext 的导出：包只导出 `.` 与 `./rich-inline` 两个入口，`measurement.js`
 * 拿不到。这份副本只用于「**保守地**决定不走模型」—— 多判一点只是少省一次测量，
 * 判漏才会算错宽度，所以这里刻意保持与上游一致的字符类。
 */
const MAYBE_EMOJI_RE =
  /[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u20E3]/u

/** 一次宽度模型的产物 */
export interface FumeLineWidthModel {
  /** 参考字号（`fontSpec` 里的那个），缩放系数的分母 */
  referenceFontPx: number
  /** 参考字号下的「内容宽度和」（已剔除行首 / 行末会挂出的空白） */
  contentWidth: number
}

/** 一次候选判定的结论：`unsure` 表示「模型不敢下结论，请精确测量」 */
export type FumeLineWidthFit = 'fit' | 'overflow' | 'unsure'

const modelCache = new Map<string, FumeLineWidthModel | null>()

/**
 * 内容宽度和：`widths` 去掉行首可跳过片段与行末会挂出的片段之后的和。
 *
 * 单独导出是为了让单测能直接钉住「剔除规则」本身 —— 它是整个判据的地基，
 * 混在 `buildWidthModel` 里就只能靠跑一首歌间接观察。
 */
export function sumLineContentWidth(widths: readonly number[], kinds: readonly string[]): number {
  let start = 0
  while (start < kinds.length && LEADING_HANG_KINDS.has(kinds[start])) start += 1

  let end = kinds.length
  while (end > start && TRAILING_HANG_KINDS.has(kinds[end - 1])) end -= 1

  let total = 0
  for (let index = start; index < end; index += 1) total += widths[index]
  return total
}

/**
 * 取 `(文本, 参考字体串)` 的宽度模型；不适用时返回 `null`（**也会被缓存**）。
 *
 * `null` 同样进缓存是有意的：含 emoji 的歌词每次候选都要跑一遍正则与 `prepare`，
 * 不缓存的话「不适用」这条路径反而变成最贵的。
 */
export function resolveLineWidthModel(
  text: string,
  fontSpec: string,
  referenceFontPx: number
): FumeLineWidthModel | null {
  const cacheKey = `${fontSpec}\u0000${text}`
  const cached = modelCache.get(cacheKey)
  if (cached !== undefined) return cached

  return rememberBounded(
    modelCache,
    cacheKey,
    buildWidthModel(text, fontSpec, referenceFontPx),
    FUME_WIDTH_MODEL_CACHE_LIMIT
  )
}

/**
 * 清空宽度模型缓存。
 *
 * 与 `text-measure.ts` 的 `clearSegmentMeasureCache()` **必须同时**被调用：字体文件
 * 加载完成时字体栈字符串一个字都没变，但字形换了、宽度也变了，模型里存的参考宽度
 * 就过期了。调用点已经把它们合成一条路径（见 `text-measure.ts`）。
 */
export function clearLineWidthModelCache(): void {
  modelCache.clear()
}

/**
 * 一次候选判定：`fontPx` 下这段文字还排得成一行吗？
 *
 * 只做乘法与比较 —— 这正是这次优化的全部收益来源。
 */
export function resolveLineWidthFit(
  model: FumeLineWidthModel,
  fontPx: number,
  width: number
): FumeLineWidthFit {
  const scaledWidth = model.contentWidth * (fontPx / model.referenceFontPx)
  const slack = width - scaledWidth

  if (slack > FUME_WIDTH_MODEL_SAFETY_BAND_PX) return 'fit'
  if (slack < -FUME_WIDTH_MODEL_SAFETY_BAND_PX) return 'overflow'
  return 'unsure'
}

/** pretext 预制产物里本模块真正读的字段（读不到就退化，见文件头） */
interface PretextPreparedInternals {
  widths?: unknown
  kinds?: unknown
  chunks?: unknown
  simpleLineWalkFastPath?: unknown
}

interface LineWidthInternals {
  widths: number[]
  kinds: string[]
  chunkCount: number
  simpleLineWalkFastPath: boolean
}

/**
 * 受保护地读 pretext 的内部字段。
 *
 * `prepare()` 的返回类型是**带 brand 的不透明类型**，字段是运行时事实而不是契约：
 * 只要形状不对就返回 `null`（调用方退化成逐候选精确测量），绝不抛错 ——
 * 一个依赖升级不该让整首诗排不出来。
 */
function readPreparedInternals(prepared: unknown): LineWidthInternals | null {
  const candidate = prepared as PretextPreparedInternals | null | undefined
  if (!candidate) return null

  const { widths, kinds, chunks, simpleLineWalkFastPath } = candidate
  if (!Array.isArray(widths) || !Array.isArray(kinds) || widths.length === 0) return null
  if (widths.length !== kinds.length || !Array.isArray(chunks)) return null
  if (typeof simpleLineWalkFastPath !== 'boolean') return null

  for (const width of widths) {
    if (typeof width !== 'number' || !Number.isFinite(width)) return null
  }
  for (const kind of kinds) {
    if (typeof kind !== 'string') return null
  }

  return {
    widths: widths as number[],
    kinds: kinds as string[],
    chunkCount: chunks.length,
    simpleLineWalkFastPath
  }
}

function buildWidthModel(
  text: string,
  fontSpec: string,
  referenceFontPx: number
): FumeLineWidthModel | null {
  if (text.length === 0 || MAYBE_EMOJI_RE.test(text)) return null

  const internals = readPreparedInternals(prepare(text, fontSpec, FUME_PRETEXT_OPTIONS))
  if (!internals) return null
  // 硬换行会把文本切成多块，每块独立走线 —— 判据不再成立
  if (!internals.simpleLineWalkFastPath || internals.chunkCount !== 1) return null

  const contentWidth = sumLineContentWidth(internals.widths, internals.kinds)
  // 纯零宽文本（内容宽度为 0）会让 `layout()` 给出 0 行，与判据的「1 行」不符
  if (!(contentWidth > 0)) return null

  return { referenceFontPx, contentWidth }
}
