/**
 * 逐词着色 —— 按主题的 `wordColors` 把某个词染成指定颜色，否则用回退色。
 *
 * 来源：Folia `components/visualizer/wordColoring.ts` 的 `resolveWordColor`
 * （「流光」「云阶」用它给关键词上色；「浮名」唱过的词也走同一套判定）。
 *
 * ## 本项目为什么只需要一半
 *
 * Folia 那个文件有 218 行，大部分是**按行文本切色块**的一套机制（`buildWordColorRanges`
 * / `resolveTokenColorMap`：给一行的每个 token 算出落在哪个色块里，供"整行一次绘制"的
 * 渲染器用）。本项目的两个 Folia 系皮肤都是**逐词渲染**（每个词自己算颜色），
 * 用不到色块表 —— 所以这里只保留 `resolveWordColor` 那一个函数，其余不搬。
 * 少搬一份没用的代码，也少一份要维护的一致性。
 *
 * ## 匹配规则（逐字对齐 Folia，不要"顺手优化"）
 *
 *  - 词文本先 `trim()`；空串直接回退色。
 *  - 判断**词**是否 CJK（含假名 / 韩文），**不是**判断配置项：
 *      · 词是 CJK → `配置项.includes(词)`（配置更宽，例如配置"零れ落ち"匹配词"零れ"）
 *      · 词不是 CJK → 把配置项按空白拆词、去掉非 `\w` 字符后比较，命中任一即匹配
 *  - 命中第一个配置项就返回，**不做优先级排序**（Folia 用 `find`，语义就是"按数组顺序首个命中"）。
 *  - 配置项或颜色为空 → 跳过该项（不视为命中）。
 *
 * ## 与本项目的字段差异
 *
 * 本项目**没有**主题的 `wordColors` 字段（沉浸设置面板里也没有这个入口）。
 * 所以本函数目前总是走回退分支 —— 保留它是因为：
 *  1. 它是两个 Folia 系皮肤共用的**着色口径**，将来若接入主题的逐词配色，
 *     改的只有调用处传入的数组，渲染层一行不用动；
 *  2. 让"词为什么是这个颜色"在本项目里也有一个唯一答案。
 */

/** 主题的逐词配色项（对应 Folia `Theme['wordColors']` 的元素形状）。 */
export interface WordColorEntry {
  /** 要匹配的目标文本（可含多词，如 "零れ落ち"） */
  word: string
  /** 命中后使用的 CSS 颜色 */
  color: string
}

/** CJK：汉字、假名、韩文（Folia 的口径，含扩展 A 区之外的常用区） */
const CJK_RE = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/

/** 词文本是否含 CJK 字符 */
export function isCjk(text: string): boolean {
  return CJK_RE.test(text)
}

/** 归一化英文词：转小写 + 去掉非 `\w`（空格、连字符、撇号、标点全部抹掉） */
function normalizeToken(text: string): string {
  return text.toLowerCase().replace(/[^\w]/g, '')
}

/** 从配置项里读出目标文本；形状不对（缺字段 / 非字符串）时返回空串 */
function readEntryText(entry: unknown): string {
  if (!entry || typeof entry !== 'object' || !('word' in entry)) return ''
  const word = (entry as { word?: unknown }).word
  return typeof word === 'string' ? word.trim() : ''
}

/** 从配置项里读出颜色；形状不对时返回空串 */
function readEntryColor(entry: unknown): string {
  if (!entry || typeof entry !== 'object' || !('color' in entry)) return ''
  const color = (entry as { color?: unknown }).color
  return typeof color === 'string' ? color : ''
}

/**
 * 解析一个词的颜色。`wordColors` 为空 / 未命中 / 形状不对时返回 `fallbackColor`。
 *
 * @param wordText     词文本（本项目的 `LyricWord.word`，可能含前导 / 尾随空格）
 * @param wordColors   主题的逐词配色（本项目目前恒为空数组）
 * @param fallbackColor 未命中时的颜色（通常是主题的 accentColor / primaryColor）
 */
export function resolveWordColor(
  wordText: string,
  wordColors: readonly WordColorEntry[] | undefined,
  fallbackColor: string
): string {
  if (!wordColors || wordColors.length === 0) return fallbackColor

  const cleanCurrent = wordText.trim()
  if (!cleanCurrent) return fallbackColor

  for (const entry of wordColors) {
    const target = readEntryText(entry)
    if (!target) continue

    if (isCjk(cleanCurrent)) {
      // CJK：配置项包含词即可（配置可以比词长）
      if (!target.includes(cleanCurrent)) continue
    } else {
      // 非 CJK：按空白拆配置项，归一化后逐一比较
      const targetWords = target.split(/\s+/).map(normalizeToken).filter(Boolean)
      const normalizedCurrent = normalizeToken(cleanCurrent)
      if (!normalizedCurrent || !targetWords.includes(normalizedCurrent)) continue
    }

    const color = readEntryColor(entry)
    if (color) return color
  }

  return fallbackColor
}
