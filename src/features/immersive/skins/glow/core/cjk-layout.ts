/**
 * 「流光」的**显示词切分** —— 把解析器给的逐词时间戳，整理成"适合当一行歌词来读"的词。
 *
 * 移植自 Folia `utils/lyrics/cjkSemanticLayout.ts`（264 行）。**只搬本项目用得到的部分**：
 *
 *  - **保留**：CJK 语义合并（`Intl.Segmenter` 词粒度）+ 粘性标点（`It` / `’` / `s`
 *    → 一个视觉词 `It's`）+ 逐字素时间戳的映射规则。
 *  - **不搬**：用户自定义切分（`wordSegments` / `autoWordSegments` / `segmentLyricWords`）。
 *    本项目没有"让用户保存断词"的功能，那份复杂度在这里没有对应物 ——
 *    搬过来就是一段永远走不到的代码。将来若接入断词编辑，再把那一层补上即可。
 *
 * ## 为什么需要这一层
 *
 * YRC / QRC 这类逐字歌词会把一行切成**很碎的片段**，例如
 * `["It", "’", "s", "unbelievable"]` 或 `["世", "界", "。"]`。
 * 直接把碎片当"词"渲染，流光会把它们各自套上一份位移 / 旋转 / 缩放 ——
 * `It` 和 `s` 会被甩到两处，`。` 会自己浮起来。
 *
 * 所以：**时间戳仍按最细的解析结果保留**（逐字素动画要用），
 * 但**视觉分组**先合并成"读得出来"的词。
 *
 * ## 单位
 *
 * 全部毫秒（本项目契约）。Folia 那一层是秒，换算是调用方（`glow-adapter`）的事。
 */

import { isCjk } from '../../shared/word-coloring'

/** 一个显示词：文本 + 起止时间（毫秒）。渲染与测量都只看这个形状。 */
export interface DisplayWord {
  text: string
  startTime: number
  endTime: number
}

/** 输入：一个词及其时间（由 `glow-adapter` 从 `LyricWord[]` 映射而来） */
export interface TimedWord {
  text: string
  startTime: number
  endTime: number
}

/** 一个布局单元：显示文本 + 它覆盖的时间范围 + 是否由 CJK 语义合并而来 */
interface LayoutUnit {
  text: string
  /**
   * 该单元覆盖的**原始解析器词**（时间戳的真源）。
   *
   * 为什么要留着：CJK 语义单元虽然把多个词合并成了 `世界。`，
   * 但**渲染时仍要拆回 `世` / `界` / `。` 三个词**——逐字时间戳必须保住，
   * 否则逐字动画会退化成"一个词一起亮"。见 `buildDisplayWords` 的分支说明。
   */
  words: TimedWord[]
  startTime: number
  endTime: number
  /** 该单元是否由多个解析器词合并成的 CJK 语义单元 */
  isSemantic: boolean
  /** 是否由非语义的粘性合并（标点 / 缩写）而来 */
  isSticky?: boolean
}

const WHITESPACE_ONLY_RE = /^\s+$/
/** 单独的撇号（`'` 或 `’`，可带尾随空白） */
const APOSTROPHE_ONLY_RE = /^['’]\s*$/
/** 缩写后缀：`s` / `t` / `m` / `d` / `ll` / `re` / `ve` / `em` */
const CONTRACTION_SUFFIX_RE = /^(s|t|m|d|ll|re|ve|em)\s*$/i
/** 带撇号的缩写：`'s` / `’re` */
const DIRECT_CONTRACTION_RE = /^['’](s|t|m|d|ll|re|ve|em)\s*$/i
/** 结尾是撇号 */
const TRAILING_APOSTROPHE_RE = /['’]\s*$/
/** 结尾是文字或数字（可承接标点） */
const TRAILING_WORD_CHAR_RE = /[\p{L}\p{N}]$/u
/** 文本内部已有缩写（判断是否该整单元视作粘性） */
const INLINE_CONTRACTION_RE = /[\p{L}\p{N}]+['’](s|t|m|d|ll|re|ve|em)/iu
/** 可粘到前一个词尾的标点（中英文都算） */
const STICKY_TRAILING_PUNCTUATION_RE = /^[,.;:!?，。！？、：；）】》」』〉〕］)}\]"'’”’]+$/u

/**
 * 词粒度切分器。`Intl.Segmenter` 是标准内建对象；缺失时（极老环境）返回 null，
 * 调用方退回"一个解析器词 = 一个显示词"。
 */
const WORD_SEGMENTER =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : null

/** 整行是否含 CJK —— 决定要不要为了"分词"额外跑一次 Segmenter */
function hasCjkText(text: string): boolean {
  return isCjk(text)
}

function createSingleWordUnits(words: readonly TimedWord[]): LayoutUnit[] {
  return words.map((word) => ({
    text: word.text,
    words: [word],
    startTime: word.startTime,
    endTime: word.endTime,
    isSemantic: false
  }))
}

/**
 * 把 `Intl.Segmenter` 的分段结果映射回解析器词。
 *
 * 对齐不上（分段文本与解析器词拼不出同样的字符）就返回 null，
 * 调用方退回"一个词一个单元"—— **绝不猜**。猜错会让逐字素时间戳整体错位。
 */
function mapSegmentsToWords(
  segments: readonly { segment: string; isWordLike?: boolean }[],
  words: readonly TimedWord[]
): LayoutUnit[] | null {
  const units: LayoutUnit[] = []
  let wordIndex = 0

  for (const segment of segments) {
    const segmentText = segment.segment
    if (!segmentText || WHITESPACE_ONLY_RE.test(segmentText)) continue

    const startWordIndex = wordIndex
    let collected = ''

    while (wordIndex < words.length && collected.length < segmentText.length) {
      collected += words[wordIndex].text
      wordIndex += 1
      if (!segmentText.startsWith(collected)) return null
    }
    if (collected !== segmentText) return null

    const segmentWords = words.slice(startWordIndex, wordIndex)
    const firstWord = segmentWords[0]
    const lastWord = segmentWords[segmentWords.length - 1]
    if (!firstWord || !lastWord) return null

    // 非"词"性质的分段（空格、孤立标点）：粘到上一个单元上。
    // 它是首个单元时无处可粘，按原样成为一个单元。
    if (!segment.isWordLike && units.length > 0) {
      const previous = units[units.length - 1]
      previous.text += segmentText
      previous.words.push(...segmentWords)
      previous.endTime = lastWord.endTime
      continue
    }

    units.push({
      text: segmentText,
      words: segmentWords,
      startTime: firstWord.startTime,
      endTime: lastWord.endTime,
      // 只有「是词性 + 含 CJK + 由多个解析器词拼成」才算语义合并：
      // 单个解析器词已经是完整的词，标成语义会让下游多做一次无意义的判断
      isSemantic: Boolean(segment.isWordLike && hasCjkText(segmentText) && segmentWords.length > 1)
    })
  }

  // 必须**完全消费**解析器词：只在 wordIndex !== words.length 时判失败，
  // 因为 "末尾有个词没被任何分段覆盖" 意味着时间戳会丢，那是必须退回的硬错误。
  if (wordIndex !== words.length || units.length === 0) return null
  return units
}

/** CJK 语义分组（不做粘性标点） */
function buildCjkSemanticUnits(lineText: string, words: readonly TimedWord[]): LayoutUnit[] {
  if (words.length === 0) return []
  const fallback = createSingleWordUnits(words)

  // CJK 之外的语言（英文等）里，Segmenter 对"解析器词"没有增量信息，
  // 多跑一次只会引入不一致的风险 —— 直接退回。
  // 注意：这里与 Folia 略有不同 —— 它还有"用户自定义切分"要跳过这道门，
  // 本项目没有那个功能，所以条件就是纯粹的 hasCjkText。
  if (!hasCjkText(lineText)) return fallback
  if (!WORD_SEGMENTER) return fallback

  const segments: { segment: string; isWordLike?: boolean }[] = []
  for (const part of WORD_SEGMENTER.segment(lineText)) {
    // Segmenter 的 isWordLike 在部分实现里缺失，缺了当 false（与"非词性"同义）
    segments.push({
      segment: part.segment,
      isWordLike: (part as { isWordLike?: boolean }).isWordLike === true
    })
  }
  if (segments.length === 0) return fallback

  return mapSegmentsToWords(segments, words) ?? fallback
}

function cloneUnit(unit: LayoutUnit): LayoutUnit {
  return { ...unit, words: [...unit.words] }
}

/** 能否把当前单元粘到上一个单元尾部（上一个单元以文字 / 数字结尾） */
function canAttachToPrevious(text: string): boolean {
  return TRAILING_WORD_CHAR_RE.test(text.trimEnd())
}

function endsWithApostrophe(text: string): boolean {
  return TRAILING_APOSTROPHE_RE.test(text.trimEnd())
}

function isApostropheOnlyUnit(unit: LayoutUnit): boolean {
  return APOSTROPHE_ONLY_RE.test(unit.text.trim())
}

function isContractionSuffixUnit(unit: LayoutUnit): boolean {
  return CONTRACTION_SUFFIX_RE.test(unit.text.trim())
}

function isDirectContractionUnit(unit: LayoutUnit): boolean {
  return DIRECT_CONTRACTION_RE.test(unit.text.trim())
}

function isStickyTrailingPunctuationUnit(unit: LayoutUnit): boolean {
  return STICKY_TRAILING_PUNCTUATION_RE.test(unit.text.trim())
}

/** 把 unit 追加到 target 上（target 变成粘性单元） */
function appendUnit(target: LayoutUnit, unit: LayoutUnit): void {
  target.text += unit.text
  target.words.push(...unit.words)
  target.endTime = unit.endTime
  target.isSticky = true
}

/**
 * 粘性标点：把 `It` + `’` + `s` 合成 `It's`，把尾随标点粘到前一个词上。
 *
 * 五种情形逐条对齐 Folia（顺序也是）：
 *  1. 单独的撇号 + 下一个是缩写后缀 + 上一个以文字结尾 → 三个合成一个；
 *  2. 带撇号的缩写（`'s`）+ 上一个以文字结尾 → 粘上去；
 *  3. 纯粹的缩写后缀 + 上一个以撇号结尾 → 粘上去；
 *  4. 可粘的尾随标点 + 上一个以文字结尾 → 粘上去；
 *  5. 其余：独立成一个单元。
 */
function applyStickyPunctuation(units: readonly LayoutUnit[]): LayoutUnit[] {
  const merged: LayoutUnit[] = []

  for (let index = 0; index < units.length; index += 1) {
    const current = units[index]
    const previous = merged[merged.length - 1]
    if (!previous) {
      merged.push(cloneUnit(current))
      continue
    }

    const next = units[index + 1]
    if (
      isApostropheOnlyUnit(current) &&
      next &&
      canAttachToPrevious(previous.text) &&
      isContractionSuffixUnit(next)
    ) {
      appendUnit(previous, current)
      appendUnit(previous, next)
      index += 1 // next 已被吞掉，跳过
      continue
    }

    if (isDirectContractionUnit(current) && canAttachToPrevious(previous.text)) {
      appendUnit(previous, current)
      continue
    }

    if (isContractionSuffixUnit(current) && endsWithApostrophe(previous.text)) {
      appendUnit(previous, current)
      continue
    }

    if (isStickyTrailingPunctuationUnit(current) && canAttachToPrevious(previous.text)) {
      appendUnit(previous, current)
      continue
    }

    merged.push(cloneUnit(current))
  }

  // 合并完成后**再补一次粘性标记** —— 这一步不能省（省了 `あ、` 会散成两个显示词）：
  //  1. `hasAttachedTrailingPunctuation`：单元内已粘上尾随标点（`你好。` 这种，
  //     mapSegmentsToWords 把 `。` 追加进来了，但只改了 text/words，没标 isSticky）；
  //  2. `hasInlineContraction`：单元文本内部含缩写（`It’s` 在 Segmenter 眼里本就是
  //     一整段，没有走到上面那些逐条分支，只能在这里认出来）。
  // 两者任一成立，该单元就该作为**一个视觉词**渲染，内部不再断开。
  return merged.map((unit) => {
    const lastWord = unit.words[unit.words.length - 1]
    const hasAttachedTrailingPunctuation = Boolean(
      unit.words.length > 1 &&
      lastWord &&
      isStickyTrailingPunctuationUnit({
        text: lastWord.text,
        words: [lastWord],
        startTime: lastWord.startTime,
        endTime: lastWord.endTime,
        isSemantic: false
      })
    )
    const hasInlineContraction =
      unit.words.length > 1 && !unit.isSemantic && INLINE_CONTRACTION_RE.test(unit.text)
    return hasAttachedTrailingPunctuation || hasInlineContraction
      ? { ...unit, isSticky: true }
      : unit
  })
}

/**
 * 把解析器词切成**显示词**（「流光」渲染直接消费的形状）。
 *
 * 顺序是刻意的：先 CJK 语义分组，再粘性标点 —— 反过来会让标点先粘到碎片上，
 * 语义分组就再也对不齐。
 *
 * 返回的每个词：`text` 用于渲染与测量，`startTime` / `endTime`（毫秒）用于逐词状态机。
 *
 * ⚠️ 传入的 `words` 必须与 `lineText` **自洽**（拼起来等于整行）。
 * 不自洽（上游数据异常）时直接退回 `words` 原样 —— 硬分组会让时间戳与文本错位，
 * 那比"不分组"难查得多。
 */
export function buildDisplayWords(lineText: string, words: readonly TimedWord[]): DisplayWord[] {
  if (words.length === 0) return []

  let joined = ''
  for (const word of words) joined += word.text
  const isSelfConsistent = joined === lineText

  // 不自洽（上游数据异常）时退回原样：硬分组会让时间戳与文本错位，
  // 那比"不分组"难查得多。
  if (!isSelfConsistent) {
    return words.map(toDisplayWord)
  }

  const units = applyStickyPunctuation(buildCjkSemanticUnits(lineText, words))

  // ⚠️ 分支规则逐字对齐 Folia 的 `buildDisplayWordsFromLayoutUnits`，别"顺手统一"：
  //  - **CJK 语义单元** → 返回它包含的原始词（`世`/`界`/`。` 仍各自成一个词），
  //    这样逐字素 / 逐字时间戳完整保留，流光会给每个字一份独立的位移与旋转；
  //  - **粘性的非语义单元** → 返回合并后的一个词（`It`+`’`+`s` → `It's`），
  //    否则缩写会被甩成三份；
  //  - 其余（普通单元）→ 原样一个词。
  return units.flatMap((unit) =>
    !unit.isSticky || unit.isSemantic ? unit.words.map(toDisplayWord) : [toUnitDisplayWord(unit)]
  )
}

function toDisplayWord(word: TimedWord): DisplayWord {
  return { text: word.text, startTime: word.startTime, endTime: word.endTime }
}

/** 把一个（已合并的）布局单元当成单个显示词 */
function toUnitDisplayWord(unit: LayoutUnit): DisplayWord {
  return { text: unit.text, startTime: unit.startTime, endTime: unit.endTime }
}
