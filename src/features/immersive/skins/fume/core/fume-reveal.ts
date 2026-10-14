/**
 * 逐字揭示（移植规格书 §5）：词区间、已打印字素数、行过场截止时间。
 *
 * **单位一律毫秒**（本仓库契约）：规格书 §5 里所有常数都是秒
 * （0.08 / 0.12 / 0.001），这里逐个乘 1000 变成具名常量，函数体内不再出现秒制数字。
 *
 * ## 为什么「整数版」和「浮点版」要同时存在（§5.6 末尾）
 *
 * 两者算的是同一条时间轴上的同一件事，只差最后的取整口径，但它们**服务于两种相机模式**：
 *
 * - `resolvePrintedGraphemeCount`（整数）→ `cameraTrackingMode: 'stepped'` 的焦点。
 *   相机瞄准「第 N 个字」的**字素边界**，逐字跳 —— 字与字之间镜头是静止的。
 * - `resolvePrintedGraphemeProgress`（浮点）→ `'smooth'` 的焦点。
 *   相机在字**内部**也连续移动，配合 §9.2 的 `glyphAdvance * fractionalOffset` 插值。
 *
 * 用整数版做 smooth 会让镜头逐字一顿一顿；用浮点版做 stepped 则会让「跳字」的节奏消失。
 * 所以两份都要留，且**不能互相调用**（取整时机不同，套一层就错）。
 *
 * ## 与「倾诉」的 `char-timing.ts` 不共用
 *
 * 倾诉的均分只分给**非空白**字素（空白时长恒为 0），浮名是把区间**平均分给所有字素**
 * （含空白）—— 因为浮名的空白由 §5.1 的「吞空白」规则归给前一个词，
 * 两者若混用，词的时间边界会整体漂移。见 `fume-types.ts` 的 `FumeGraphemeTiming` 注释。
 */

import { getLineRenderEndTimeMs, type RenderHintLineLike } from '../../shared/render-hints'
import { clamp, splitGraphemes } from './fume-math'
import type { FumeGraphemeTiming, FumeTimedSpan, FumeWord, FumeWordRange } from './fume-types'

/** 词级揭示的时长下限（规格书 §5.2：`max(endTime - startTime, 0.08)` 秒 → 毫秒） */
export const MIN_WORD_REVEAL_DURATION_MS = 80

/** 无词行摊分的时长下限（规格书 §5.5 / §5.6：`max(..., 0.12)` 秒 → 毫秒） */
export const MIN_LINE_SPREAD_DURATION_MS = 120

/** `resolveVisualProgressWithCutoff` 的时长下限（规格书 §5.4：0.001 秒 → 毫秒） */
export const MIN_VISUAL_PROGRESS_DURATION_MS = 1

/**
 * 取整偏置（规格书 §5.2 的 `+ 0.2`）。
 *
 * 为什么需要它：`floor(progress * length)` 在「词刚开始唱」时会一直是 0 ——
 * 前 `1/length` 的时长里一个字都不出现，听感上像「卡了一下」。
 * 加 0.2 让进度刚过 0 就立刻吐出一个字（配合下限 `progress > 0 ? 1 : 0`）。
 *
 * 为什么不干脆写成 `ceil`：`ceil` 在 progress 恰好为 0 时也会给 1（多印一个字），
 * 而 `+0.2` 在进度接近 1 时仍保留一点「最后一个字等到结尾」的余地。
 * 这是上游原样的细节，不要「优化」。
 */
const PRINT_ROUNDING_BIAS = 0.2

/**
 * 把一个时间区间**平均分给文本的全部字素**（含空白），产出字素级时间片。
 *
 * 与 Folia `graphemeTiming.buildEvenGraphemeTimings` 等价。它是 §5.2 里 `graphemeTimings`
 * 的唯一来源：只用于**有音节**的词（无音节时按词进度直接摊分，根本读不到这些时间片，
 * 见 `resolvePrintedGlyphsInRange`）。
 *
 * 规则：
 * - 空文本 → `[]`
 * - `duration = max(end - start, 0)`：反向区间按 0 长度处理，绝不产生负时长
 * - 每个字素占 `duration / 字素数`；**最后一个字素的结束时间直接取 `endTimeMs`**，
 *   这样浮点误差不会让尾部露出一小段（时长总和精确等于区间长度）
 *
 * `wordIndex` 参与 §2 的类型契约但这里**不填**：上游 `fumeReveal` 调用时也没传
 * （它靠 `FumeWordRange.wordIndex` 记录归属）。空着比填一个猜测的值诚实。
 */
export function buildEvenGraphemeTimings(
  text: string,
  startTimeMs: number,
  endTimeMs: number
): FumeGraphemeTiming[] {
  const graphemes = splitGraphemes(text)
  if (graphemes.length === 0) return []

  const duration = Math.max(endTimeMs - startTimeMs, 0)
  const unitDuration = duration / graphemes.length

  return graphemes.map((char, index) => ({
    char,
    startTimeMs: startTimeMs + unitDuration * index,
    endTimeMs: index === graphemes.length - 1 ? endTimeMs : startTimeMs + unitDuration * (index + 1)
  }))
}

/**
 * 一个词的字素级时间片（规格书 §5.2 的 `buildWordGraphemeTimings`）。
 *
 * - **有音节**：每个音节各自把 `[音节起, 音节止]` 均分给它的字素，再按顺序拼起来。
 *   于是「一个字一个字打印」的节奏跟着音节走，而不是整词平均。
 * - **无音节**：整词均分（同样含空白）。
 *
 * 本项目没有音节数据（§7.11），所以实际上永远走第二条分支 —— 但分支必须留着：
 * 一旦上游解析器补上音节，这里不用改。
 */
export function buildWordGraphemeTimings(word: FumeWord): FumeGraphemeTiming[] {
  if (!word.syllables?.length) {
    return buildEvenGraphemeTimings(word.text, word.startTimeMs, word.endTimeMs)
  }
  return word.syllables.flatMap((syllable) =>
    buildEvenGraphemeTimings(syllable.text, syllable.startTimeMs, syllable.endTimeMs)
  )
}

/**
 * 从词列表构建词区间（规格书 §5.1）。
 *
 * 关键规则有两条，都是为了**让视觉流连续**：
 *
 * 1. 过滤掉「按字素切开后为空」的词（只有空白的词不参与揭示，但仍会出现在文本里）；
 * 2. `end` 之后**吞掉紧随其后的空白字素**（`while (/\s/) end++`）。
 *    原因是部分歌词数据的 `word.text` 不含词间空格、而 `fullText` 含：
 *    若把空格留给「下一个词」，下一个词的起点就会落在空格之前，整行文字会向左挤。
 *    把空格归给前一个词，每个词的字符区间就是「它自己 + 它后面的空隙」，
 *    打印到第 N 个词时空白也一并算作已打印，视觉上不会缺一个空格。
 *
 * @param words    词列表（时间单位：毫秒）
 * @param graphemes 整块文字的字素数组（必须与 `fullText` 同一口径切分）
 * @returns 词区间数组；`words` 或 `graphemes` 为空时返回 `[]`
 */
export function buildWordRangesFromWords(
  words: readonly FumeWord[],
  graphemes: readonly string[]
): FumeWordRange[] {
  if (words.length === 0 || graphemes.length === 0) return []

  const rangedWords = words.filter((word) => splitGraphemes(word.text).length > 0)
  if (rangedWords.length === 0) return []

  const ranges: FumeWordRange[] = []
  let cursor = 0

  for (let wordIndex = 0; wordIndex < rangedWords.length; wordIndex += 1) {
    const word = rangedWords[wordIndex]
    const wordGraphemeCount = splitGraphemes(word.text).length
    const start = clamp(cursor, 0, graphemes.length)
    let end = clamp(start + wordGraphemeCount, start, graphemes.length)

    while (end < graphemes.length && /\s/.test(graphemes[end] ?? '')) {
      end += 1
    }

    ranges.push({
      wordIndex,
      word,
      start,
      end,
      colorStart: start,
      colorEnd: end,
      graphemeTimings: buildWordGraphemeTimings(word)
    })
    cursor = end
  }

  return ranges
}

/**
 * 单个词的揭示进度（规格书 §5.2 的私有函数，这里导出以便单测与复用）。
 *
 * 退化规则：`endTimeMs <= startTimeMs`（零长 / 反向）时不用除法，直接看「是否已越过终点」，
 * 否则会得到一个 0 长度分母，进度在端点处从 0 跳到 1。
 */
export function resolveWordRevealProgress(range: FumeWordRange, currentTimeMs: number): number {
  if (range.word.endTimeMs <= range.word.startTimeMs) {
    return currentTimeMs >= range.word.endTimeMs ? 1 : 0
  }
  const duration = Math.max(
    range.word.endTimeMs - range.word.startTimeMs,
    MIN_WORD_REVEAL_DURATION_MS
  )
  return clamp((currentTimeMs - range.word.startTimeMs) / duration, 0, 1)
}

/**
 * 一个词区间里已经打印的字素数（规格书 §5.2 的私有函数，这里导出以便单测与复用）。
 *
 * 有音节时按音节派生的字素时间走（每个字有确切起止，判定用 `>= startTimeMs`）；
 * 无音节时按**整词进度**摊，并加 §5.2 的 `+0.2` 取整偏置。
 */
export function resolvePrintedGlyphsInRange(range: FumeWordRange, currentTimeMs: number): number {
  const length = Math.max(range.end - range.start, 0)
  if (length === 0) return 0
  if (currentTimeMs < range.word.startTimeMs) return 0

  const timedGlyphCount = range.word.syllables?.length
    ? Math.min(range.graphemeTimings.length, length)
    : 0

  if (timedGlyphCount > 0) {
    if (currentTimeMs >= range.word.endTimeMs) return length

    // 落在 [0, timedGlyphCount) 中「最后一个已开始」的字素之后
    let printed = 0
    for (let index = 0; index < timedGlyphCount; index += 1) {
      if (currentTimeMs >= range.graphemeTimings[index].startTimeMs) {
        printed = index + 1
      }
    }
    return clamp(printed, 0, length)
  }

  const progress = resolveWordRevealProgress(range, currentTimeMs)
  if (progress >= 1) return length

  return clamp(Math.floor(progress * length + PRINT_ROUNDING_BIAS), progress > 0 ? 1 : 0, length)
}

/**
 * 行过场截止时间（规格书 §5.3）：**这一行的「唱过」判定窗口不会超过下一行的开始时间**。
 *
 * 歌词数据里「下一行提前 0.2s 进来」是常态，若不加这条钳制，当前行的颜色拖尾会跨进
 * 下一行的镜头里（两个块的颜色叠在一起，看起来像脏帧）。
 *
 * 「这一行能留多久」由 `shared/render-hints.ts` 的 `getLineRenderEndTimeMs` 给出
 * （§4.9）：它已经含了行结束时间、过场三件套与 67ms 的极短行地板。本函数只做最后一步
 * 「与下一行起点取 min」。
 *
 * **为什么必须调共享层而不是自己算**：签名的第一版曾把算好的 `renderEndTimeMs` 当参数传进来
 * （当时 renderHints 还没落地，为了不复制一份公式）。现在 hints 层已经存在，参数就还原成
 * 规格书的 `(line, nextLineStartTime)` —— 让「渲染结束时间」永远只有一个实现，
 * 否则 §8.3 的 `hasPassCutoffReached` 与 §9.7 的相机重定位迟早会用上两个不同的值。
 *
 * @param line                本行（时间单位毫秒；`words` 参与算拖尾起点，见 render-hints）
 * @param nextLineStartTimeMs 数组里的下一行起始时间；非有限值（含 `null` / `undefined`）时不钳制
 */
export function resolveLinePassCutoffTime(
  line: RenderHintLineLike,
  nextLineStartTimeMs: number | null | undefined
): number {
  const renderEndTimeMs = getLineRenderEndTimeMs(line)
  if (typeof nextLineStartTimeMs !== 'number' || !Number.isFinite(nextLineStartTimeMs)) {
    return renderEndTimeMs
  }
  return Math.min(renderEndTimeMs, nextLineStartTimeMs)
}

/**
 * 带截止的视觉进度（规格书 §5.4）——整首歌出现次数最多的进度公式
 * （相机、颜色拖尾、打印印章都用它）。
 *
 * 两个下限（`duration` 与 `effectiveEnd - startedAt`）都取 `0.001s` → 本项目 `1ms`：
 * 它们保证分母永不为 0，所以任何时刻都返回有限值，不会把 NaN 传染给 canvas。
 * 截止时间早于 `startedAt` 时会被 `max` 拉回 `startedAt + 1ms`，
 * 于是进度在 `startedAt` 处立即为 1 —— 这正是「下一行已经开始了」时该有的行为。
 */
export function resolveVisualProgressWithCutoff(
  startedAtMs: number,
  durationMs: number,
  currentTimeMs: number,
  cutoffTimeMs: number
): number {
  const nominalEndTime = startedAtMs + Math.max(durationMs, MIN_VISUAL_PROGRESS_DURATION_MS)
  const effectiveEndTime = Math.max(
    startedAtMs + MIN_VISUAL_PROGRESS_DURATION_MS,
    Math.min(nominalEndTime, cutoffTimeMs)
  )

  return clamp(
    (currentTimeMs - startedAtMs) /
      Math.max(effectiveEndTime - startedAtMs, MIN_VISUAL_PROGRESS_DURATION_MS),
    0,
    1
  )
}

/**
 * 行级已打印字素数（整数版，规格书 §5.5）——给 `'stepped'` 相机用。
 *
 * ⚠️ 注意三个**不同**的时间判据，别合并（§17.3 第 7 条）：
 * - `currentTimeMs < startTimeMs` → 0（还没开始）
 * - `currentTimeMs >= endTimeMs` → 全部（**用 `endTimeMs`，不是渲染结束时间**：
 *   一行唱到结尾就该把所有字都算作已打印，哪怕它的颜色拖尾还要再留一会儿）
 * - 截止时间只影响 §5.3 的拖尾窗口，不影响这里的字数
 */
export function resolvePrintedGraphemeCount(
  line: FumeTimedSpan,
  wordRanges: readonly FumeWordRange[],
  graphemeCount: number,
  currentTimeMs: number
): number {
  if (graphemeCount === 0) return 0
  if (currentTimeMs < line.startTimeMs) return 0
  if (currentTimeMs >= line.endTimeMs) return graphemeCount

  if (wordRanges.length === 0) {
    const duration = Math.max(line.endTimeMs - line.startTimeMs, MIN_LINE_SPREAD_DURATION_MS)
    const progress = clamp((currentTimeMs - line.startTimeMs) / duration, 0, 1)
    // 这里的偏置是「+1」（不是 §5.2 的 +0.2）：整行摊分没有词边界可依附，
    // 起点后必须立刻补一个字，否则第一段静默期长度等于 1/字素数。
    return clamp(Math.floor(progress * graphemeCount + (progress > 0 ? 1 : 0)), 0, graphemeCount)
  }

  // 逐词累加：一旦遇到「没打印完」的词就立刻返回（后面的词更晚，不可能已打印）
  let printed = 0
  for (let index = 0; index < wordRanges.length; index += 1) {
    const range = wordRanges[index]
    const partial = resolvePrintedGlyphsInRange(range, currentTimeMs)
    printed = range.start + partial

    if (partial < range.end - range.start) {
      return clamp(printed, 0, graphemeCount)
    }
  }

  return clamp(printed, 0, graphemeCount)
}

/**
 * 行级已打印进度（浮点版，规格书 §5.6）——给 `'smooth'` 相机用。
 *
 * 与整数版同构，只有两处口径不同：
 * 1. 用 `resolveWordRevealProgress` 的**浮点**进度乘字素数，不做取整；
 * 2. 遇到「还没开始的词」（`currentTimeMs < word.startTimeMs`）要**提前返回** ——
 *    浮点路径下 `resolveWordRevealProgress` 会返回 0（分母被 80ms 地板抬起），
 *    若不提前返回，`printed` 会被重置成该词的 `start`，相机反而向前跳到词首。
 */
export function resolvePrintedGraphemeProgress(
  line: FumeTimedSpan,
  wordRanges: readonly FumeWordRange[],
  graphemeCount: number,
  currentTimeMs: number
): number {
  if (graphemeCount === 0) return 0
  if (currentTimeMs < line.startTimeMs) return 0
  if (currentTimeMs >= line.endTimeMs) return graphemeCount

  if (wordRanges.length === 0) {
    const duration = Math.max(line.endTimeMs - line.startTimeMs, MIN_LINE_SPREAD_DURATION_MS)
    const progress = clamp((currentTimeMs - line.startTimeMs) / duration, 0, 1)
    return clamp(progress * graphemeCount, 0, graphemeCount)
  }

  let printed = 0
  for (let index = 0; index < wordRanges.length; index += 1) {
    const range = wordRanges[index]
    if (currentTimeMs < range.word.startTimeMs) {
      return clamp(printed, 0, graphemeCount)
    }

    const progress = resolveWordRevealProgress(range, currentTimeMs)
    const length = Math.max(range.end - range.start, 0)
    printed = range.start + progress * length

    if (progress < 1) {
      return clamp(printed, 0, graphemeCount)
    }
  }

  return clamp(printed, 0, graphemeCount)
}
