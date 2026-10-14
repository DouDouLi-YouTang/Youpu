/**
 * **逐词配色**（关键词着色）—— 从这首歌的歌词里挑出情绪词，各自配一个颜色。
 *
 * ## 用户看到的效果是什么
 *
 * 「每一句当中的某一个词颜色也跟随歌曲来」—— 即不是整行同一个颜色在扫，
 * 而是这一行里个别词有自己的颜色。这正是上游 `Theme.wordColors` 的用途。
 *
 * ## 为什么本项目没有照搬上游的做法
 *
 * 上游的 `wordColors` 来自 **AI 主题生成**：把歌词片段发给大模型，让它挑 10–20 个
 * 情绪词并各配一个颜色（见 `utils/aiThemePrompts.ts` 的提示词契约）。
 * 本项目没有 AI 主题这一层（`rg openai|chat/completions src` 无结果），
 * 为了让功能可用，这里用**确定性的本地规则**替代：
 *
 *  1. 从歌词里按出现频次与长度挑出「像实词」的词；
 *  2. 把封面主色按词的序号**散布到一段安全的色相弧上**（见下），
 *     于是同一首歌的关键词彼此有区分、不同歌的关键词整体跟着封面走。
 *
 * 换句话说：**颜色仍然来自这首歌的封面**（用户要的那条），
 * 只是「哪些词算关键词」由规则而不是模型决定。
 *
 * ## 为什么挑词要「确定性」
 *
 * 关键词在整首歌里是固定的：同一首歌重播、切到明暗另一档、窗口 resize，
 * 都不该换一批词（那会让人以为歌词在跳）。所以这里不用 `Math.random`，
 * 全部走排序 + 截断。
 *
 * 纯函数，可在 node 单测。
 */

import type { WordColorEntry } from '../word-coloring'
import { adjustLightnessForContrast, hexToHsl, hslToHex, normalizeHue } from './color-math'

/**
 * 最多给多少个词上色。
 *
 * 上游的提示词要求 10–20 个。这里取 12：太少（如 4 个）在整首歌里几乎看不到效果，
 * 太多（如 40 个）会让每一行都有变色词，反而失去「个别词被点亮」的对比感。
 */
const MAX_KEYWORD_COUNT = 12

/**
 * 一个词至少要有多少字符才可能成为关键词。
 *
 * **1 个字不选**：中文单字（「的」「了」「我」）绝大多数是虚词，
 * 逐一判断词性需要词典，而「短词不选」这条启发式在没有词典的前提下最划算 ——
 * 代价是漏掉「花」「雪」这类单字实词，收益是不会把每个「的」都点亮。
 */
const MIN_KEYWORD_LENGTH = 2

/**
 * 单个关键词的最大字符长度。
 *
 * 超过它的一律不是「词」而是句子 —— 若不设这条上界，没有逐词数据时
 * 「整段连续汉字当一个候选」的兜底会让那一行**每个字**都命中同一个配置项、
 * 全行一个颜色，「个别词被点亮」的效果直接消失。
 */
const MAX_KEYWORD_LENGTH = 8

/**
 * 关键词配色在色相环上铺开的幅度（度）。
 *
 * 围绕封面主色左右各 45°，共 90°：够宽，能让同一行的几个关键词彼此区分；
 * 又不至于宽到跑出「这首歌的色系」——超出这个范围就会开始撞上互补色，
 * 画面上出现一个与封面无关的颜色。
 */
const KEYWORD_HUE_SPREAD = 45

/**
 * 关键词色的最低对比度。
 *
 * 与强调色同一档（3.2）：关键词只是「某些词换了颜色」，
 * 它在未唱状态下的底色也是主题底色，地板必须保证它看得见。
 */
const KEYWORD_MIN_SATURATION = 0.45

/**
 * 关键词色的明度起点区间，**按底色明暗分两档**。
 *
 * 不能只写一组：深色底上「够亮的橙」放到浅色底上会糊成一片（实测对比度只有 2.3，
 * 低于可读线）。分档之后两边各有合适的中调区间，再由
 * `adjustLightnessForContrast` 兜住地板（见下）。
 */
const KEYWORD_LIGHTNESS_DARK_BG: readonly [number, number] = [0.58, 0.72]
const KEYWORD_LIGHTNESS_LIGHT_BG: readonly [number, number] = [0.34, 0.46]

/**
 * 关键词色的对比度地板。与强调色同档（3.2）。
 *
 * ⚠️ 光有明度区间不够：区间只是「起点」，真正决定能不能读的是它与**这首歌的底色**
 * 的搭配。底色可能带色相、可能偏亮偏暗，起点区间整个落在不可读的一侧时只有
 * 求解才能拉回来。
 */
const KEYWORD_MIN_CONTRAST = 3.2

/** 中文虚词表的**头部**：出现频次最高的那几十个，命中直接淘汰 */
const STOP_WORDS = new Set([
  '的',
  '了',
  '和',
  '是我',
  '在',
  '有',
  '就',
  '不',
  '人',
  '都',
  '一',
  '一个',
  '上',
  '也',
  '很',
  '到',
  '说',
  '要',
  '去',
  '你',
  '会',
  '着',
  '没有',
  '看',
  '好',
  '自己',
  '这',
  '这样',
  '那',
  '那么',
  '什么',
  '怎么',
  '因为',
  '所以',
  '但是',
  '如果',
  '还是',
  '然后',
  '现在',
  '已经',
  '可以',
  '不能',
  '不会',
  '一样',
  '时候',
  '这里',
  '那里',
  // 日语高频功能词（假名为主）
  'こと',
  'もの',
  'ため',
  'よう',
  'そう',
  'これ',
  'それ',
  'あれ',
  'どこ',
  'いつ',
  'でも',
  'そして',
  'だから',
  'それでも',
  'こんな',
  'そんな',
  'あんな',
  // 英语虚词
  'the',
  'and',
  'you',
  'that',
  'was',
  'for',
  'are',
  'with',
  'his',
  'they',
  'this',
  'have',
  'from',
  'one',
  'had',
  'but',
  'not',
  'what',
  'all',
  'were',
  'when',
  'your',
  'can',
  'said',
  'there',
  'use',
  'each',
  'which',
  'she',
  'how',
  'their',
  'will',
  'other',
  'about',
  'out',
  'them',
  'then',
  'these',
  'some',
  'her',
  'would',
  'make',
  'like',
  'him',
  'into',
  'time',
  'has',
  'look',
  'two',
  'more',
  'write',
  'see',
  'number',
  'way',
  'could',
  'people',
  'than',
  'first',
  'been',
  'call',
  'who',
  'its',
  'now',
  'find',
  'long',
  'down',
  'day',
  'did',
  'get',
  'come',
  'made',
  'may',
  'part',
  'am',
  'is',
  'it',
  'to',
  'of',
  'in',
  'on',
  'at',
  'as',
  'be',
  'by',
  'my',
  'we',
  'he',
  'me',
  'do',
  'so',
  'no',
  'up',
  'if',
  'or',
  'an',
  'i'
])

/**
 * 传给 `pickKeywords` 的一行歌词。
 *
 * ⚠️ **只有一个字段，且刻意如此**：这里曾经还有一个可选的 `words`
 * （把 `LyricLine.words` 的文本传进来当候选词）。那个设计在 2026-10-15 被证明
 * 是错的 —— 网易云 YRC 的 `words` 是按字符切的，传进来只会让每个候选词都撞上
 * 「长度 ≥ 2」的闸门，关键词列表恒为空。切分口径收进本模块之后，
 * 调用方**不需要**（也不能）再传词边界，见 `tokenize` 的说明。
 */
export interface KeywordSourceLine {
  /** 整行歌词文本 */
  text: string
}

/**
 * CJK 连续文本的**兜底切分**：按 3 字与 2 字窗口滑出短片段。
 *
 * ⚠️ **只有在 `Intl.Segmenter` 也不可用时才轮到它**（见 `tokenize`）：
 * 滑窗切出来的碎片（「れ落ち」「ちそう」）没有词边界含义，只能靠
 * `MIN_REQUIRED_OCCURRENCES` 把只出现一次的碎片筛掉。
 *
 * 用 Intl.Segmenter 得到的真实词边界（「零れ落ち」「暗巷」）替代它之后，
 * 关键词质量会有量级差别 —— 见 `tokenize` 的说明。
 */
function slidingCjkWindows(run: string): string[] {
  if (run.length <= 3) return [run]

  const windows: string[] = []
  for (const size of [3, 2]) {
    for (let start = 0; start + size <= run.length; start += 1) {
      windows.push(run.slice(start, start + size))
    }
  }
  return windows
}

/**
 * 只有滑窗兜底路径才生效：一个候选片段至少要在整首歌里出现**两次**才算关键词。
 *
 * 这条门槛是滑窗的质量闸门：滑窗会切出「么是这」这类碎片，而它们的特点是
 * **只出现在一个地方**；真正的情绪词（副歌里的「零れ落ち」「星も」）天然会重复。
 * 用「重复」换「准确」，代价是**一首完全不重复用词的歌在极端环境里不会有
 * 关键词着色** —— 那比满屏随机碎片好。
 */
const MIN_REQUIRED_OCCURRENCES = 2

/**
 * 词粒度切分器。**与 `glow/core/cjk-layout` 用同一套标准内建对象** ——
 * 官方文档「字符时间轴」一节把 `Intl.Segmenter` 定为取显示字符 / 词的入口
 * （「可以为了布局用 Intl.Segmenter 或 Array.from 取得显示字符」）。
 *
 * 缺失时（极老环境）返回 null，调用方退回滑窗。
 */
const WORD_SEGMENTER =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : null

/**
 * 一行歌词 → 候选词。
 *
 * ## ⚠️ 为什么不直接用 `line.words`
 *
 * 这是 2026-10-15 修掉的一个真 bug。原先的实现把 `LyricLine.words` 里的
 * **原始解析器词**直接当候选词，理由是「那些 word 就是解析器认定的词边界」。
 * 但网易云 YRC 的 `words` 是**按字符**切的：
 *
 * ```
 * "爱你孤身走暗巷" → ["爱","你","孤","身","走","暗","巷"]
 * ```
 *
 * 而候选词要求长度 ≥ {@link MIN_KEYWORD_LENGTH}（2），于是**每一个候选词都被
 * 长度闸门拒掉，关键词列表恒为空** —— 逐词配色在真实歌曲上从来没有生效过。
 * 实测：`孤勇者` / `ロスト・シルフィード` / `Lemon` 全部返回 `[]`。
 *
 * 官网文档对这件事有两句直接的话：
 *  - 「words 不保证是单字符；……**words 的切分粒度依赖歌词内容和来源**」；
 *  - 「可以为了布局用 `Intl.Segmenter` 或 `Array.from` 取得显示字符」。
 *
 * 所以候选词走 `Intl.Segmenter` 的**词粒度**切分：它与 YRC 的真实词边界一致
 * （`爱你孤身走暗巷` → `爱/你/孤身/走/暗巷`），且不依赖某个音源恰好给的是词。
 * `line.words` 仍然保留在类型里（调用方不必改），但**不再作为候选来源** ——
 * 两种来源混用会让「有词数据的歌」和「没词数据的歌」走进两条不同的候选表。
 */
function tokenize(line: KeywordSourceLine): string[] {
  if (WORD_SEGMENTER) {
    const tokens: string[] = []
    for (const part of WORD_SEGMENTER.segment(line.text)) {
      // `isWordLike` 在部分实现里缺失，缺了当 false（与「非词性」同义），
      // 与 `glow/core/cjk-layout` 的口径一致。
      if ((part as { isWordLike?: boolean }).isWordLike !== true) continue
      const text = part.segment.trim()
      if (text) tokens.push(text)
    }
    if (tokens.length > 0) return tokens
  }

  const tokens: string[] = []
  const cjkRuns = line.text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g) ?? []
  for (const run of cjkRuns) tokens.push(...slidingCjkWindows(run))

  // 拉丁文按词切开：它自带词边界，不需要滑窗
  const latinWords = line.text.match(/[A-Za-z][A-Za-z'-]*/g) ?? []
  for (const word of latinWords) tokens.push(word)

  return tokens
}

/**
 * 候选词是否合格。
 *
 * ⚠️ CJK 长句**不再往下切**：这里的输入是整行歌词切出来的连续汉字/假名段，
 * 不做分词就无法知道「零れ落ち」是一个词还是三个。所以按长度截取一段
 * （见 `buildKeywordEntries`）时也保持「原样是一个连续片段」——
 * 逐词渲染的匹配是「配置项包含词」或「词包含配置项」，片段本身够用。
 */
function isCandidate(token: string): boolean {
  const trimmed = token.trim()
  if (trimmed.length < MIN_KEYWORD_LENGTH || trimmed.length > MAX_KEYWORD_LENGTH) return false
  if (STOP_WORDS.has(trimmed.toLowerCase())) return false
  return true
}

/**
 * 从歌词里挑关键词。
 *
 * 排序规则（**依次比较，越靠前越优先**）：
 *  1. 出现次数多；
 *  2. 词更长；
 *  3. 首次出现更早。
 *
 * 第二条是这套启发式的关键：在频次相同时，长词比短词更可能是实词
 * （「零れ落ち」vs「それ」）。第三条只是为了让结果**稳定** ——
 * 没有它，同频次词的顺序会随 `Map` 的插入序变化，重播时可能换一批。
 */
export function pickKeywords(
  lines: readonly (KeywordSourceLine | string)[],
  limit = MAX_KEYWORD_COUNT
): string[] {
  const stats = new Map<string, { count: number; firstIndex: number }>()
  let order = 0
  /**
   * 候选词是否来自**真实词边界**（`Intl.Segmenter`）。
   *
   * 整首歌级别判断：只要切分器可用，候选词就全部是词粒度的，
   * `MIN_REQUIRED_OCCURRENCES` 那条为滑窗碎片设的质量闸门就没有必要。
   * 与逐行判断的区别在于「有没有混进滑窗碎片」—— 混进来就整体收紧。
   */
  const hasWordBoundaries = WORD_SEGMENTER !== null

  for (const line of lines) {
    const source: KeywordSourceLine = typeof line === 'string' ? { text: line } : line
    for (const token of tokenize(source)) {
      if (!isCandidate(token)) continue
      const key = token.trim()
      const existing = stats.get(key)
      if (existing) {
        existing.count += 1
      } else {
        stats.set(key, { count: 1, firstIndex: order })
      }
      order += 1
    }
  }

  return (
    [...stats.entries()]
      // 滑窗兜底路径才要求重复出现；词边界可信时直接放行
      .filter(([, stat]) => hasWordBoundaries || stat.count >= MIN_REQUIRED_OCCURRENCES)
      .sort((a, b) => {
        if (b[1].count !== a[1].count) return b[1].count - a[1].count
        if (b[0].length !== a[0].length) return b[0].length - a[0].length
        return a[1].firstIndex - b[1].firstIndex
      })
      .slice(0, Math.max(0, limit))
      .map(([word]) => word)
  )
}

/**
 * 关键词 → 逐词配色表。
 *
 * 色相围绕封面强调色铺开：第 `i` 个词从 `-KEYWORD_HUE_SPREAD` 到
 * `+KEYWORD_HUE_SPREAD` 之间取一个位置（词只有一个时取中点）。
 * 于是「同一首歌的关键词互不撞色」与「关键词整体跟着封面」两条同时成立。
 */
export function buildKeywordColors(
  keywords: readonly string[],
  accentColor: string,
  backgroundColor: string
): WordColorEntry[] {
  if (keywords.length === 0) return []

  const accentHsl = hexToHsl(accentColor)
  if (!accentHsl) return []

  const saturation = Math.max(KEYWORD_MIN_SATURATION, accentHsl.s)
  const backgroundIsLight = (hexToHsl(backgroundColor)?.l ?? 0) > 0.5
  const [minLightness, maxLightness] = backgroundIsLight
    ? KEYWORD_LIGHTNESS_LIGHT_BG
    : KEYWORD_LIGHTNESS_DARK_BG

  return keywords.map((word, index) => {
    const position = keywords.length === 1 ? 0.5 : index / (keywords.length - 1)
    const hue = normalizeHue(accentHsl.h + (position * 2 - 1) * KEYWORD_HUE_SPREAD)

    // 明度在区间内按同一个 position 反向排布，让相邻关键词不只靠色相区分
    // （色相接近时，明度差是第二道区分手段）
    const lightness = backgroundIsLight
      ? maxLightness - (position * (maxLightness - minLightness)) / 2
      : minLightness + (position * (maxLightness - minLightness)) / 2

    // 起点区间只保证「好看」，这里再保证「读得出来」：底色的实际明度可能与区间假设
    // 不符（浅底上的浅色字就是这种），所以每个颜色都过一遍对比度求解
    const color = adjustLightnessForContrast(
      hslToHex({ h: hue, s: saturation, l: lightness }),
      backgroundColor,
      KEYWORD_MIN_CONTRAST
    )

    return { word, color }
  })
}
