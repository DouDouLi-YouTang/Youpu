import type { LyricWord } from '@/domain/lyric'

/**
 * YRC 逐字歌词解析 —— 移植参考项目 refined-now-playing-netease 的
 * liblyric/index.ts parsePureDynamicLyric。
 *
 * YRC 格式(网易云 /api/song/lyric/v1 的 yrc.lyric):
 *   每行 `[lineTime,lineDuration](wordTime,wordDuration,flag)word(wordTime,wordDuration,flag)word...`
 * 时间单位均为毫秒。flag 一般为 0。
 *
 * 一个 word 字段可能含多个空格分隔的子词(英文歌词),参考项目将 wordDuration
 * 均分到各子词,并按原 word 的首尾空格补回,使 words.map(w=>w.word).join('') 还原原文。
 * 这里逐字移植该拆分行为,以保证逐字动画对英文也按词逐个亮起。
 */

const LINE_RE = /^\[(?<time>[0-9]+),(?<duration>[0-9]+)\](?<line>.*)/
const WORD_RE = /^\((?<time>[0-9]+),(?<duration>[0-9]+),(?<flag>[0-9]+)\)(?<word>[^(]*)/
const TRAILING_MIN_DURATION_MS = 1000
const TRAILING_BREAK_RE = /[,，.。!?？、；：…—~～·‘’“”ﾞ]/
const ENGLISH_WORD_RE = /^\s*[a-zA-Z]+(?:['‘’][a-zA-Z]+)*\s*$/
const PUNCT_OR_SYMBOL_ONLY_RE = /^[\p{P}\p{S}]+$/u
const SPACE_ONLY_RE = /^\s*$/

export interface YrcLine {
  /** 行开始时间 ms */
  timeMs: number
  /** 行总时长 ms */
  durationMs: number
  /** 由 words 拼接还原的原文(与 LRC 行文本一致) */
  text: string
  /** 逐字时间戳 */
  words: LyricWord[]
}

/**
 * 标记句末/分段末尾拖长音 —— 移植参考项目 liblyric/index.ts:344-382。
 *
 * 规则:以行尾和空格/标点作为分段边界;每段从后向前找第一个非标点、非空白词;
 * 该词 duration >= 1000ms 时标记 trailing=true。后续「长音发光动画」只对 trailing 词生效。
 */
function markTrailingWords(words: LyricWord[]): void {
  const searchIndexes: number[] = [-1]
  for (let i = 0; i < words.length - 1; i++) {
    const word = words[i].word
    const endsWithSpace = /\s$/.test(word)
    const hasBreakPunctuation = TRAILING_BREAK_RE.test(word)
    const isPureEnglishWordBoundary =
      endsWithSpace && !hasBreakPunctuation && ENGLISH_WORD_RE.test(word)
    if ((endsWithSpace || hasBreakPunctuation) && !isPureEnglishWordBoundary) {
      searchIndexes.push(i)
    }
  }
  searchIndexes.push(words.length - 1)

  for (let i = searchIndexes.length - 1; i >= 1; i--) {
    let targetIndex: number | null = null
    for (let j = searchIndexes[i]; j > searchIndexes[i - 1]; j--) {
      const text = words[j].word.trim()
      if (SPACE_ONLY_RE.test(text)) continue
      if (PUNCT_OR_SYMBOL_ONLY_RE.test(text)) continue
      targetIndex = j
      break
    }
    if (targetIndex === null) continue
    if (words[targetIndex].durationMs >= TRAILING_MIN_DURATION_MS) {
      words[targetIndex].trailing = true
    }
  }
}

/**
 * 解析 YRC 字符串为逐字行数组。输入为空或无匹配行时返回 []。
 * 输出按 timeMs 升序(对齐参考 result.sort)。
 */
export function parseYrc(yrc: string): YrcLine[] {
  if (!yrc) return []
  const result: YrcLine[] = []
  for (const rawLine of yrc.trim().split(/\r?\n/)) {
    const lineMatch = rawLine.match(LINE_RE)
    if (!lineMatch) continue
    const timeMs = parseInt(lineMatch.groups?.time ?? '0', 10)
    const durationMs = parseInt(lineMatch.groups?.duration ?? '0', 10)
    let rest = lineMatch.groups?.line ?? ''
    const words: LyricWord[] = []

    while (rest.length > 0) {
      const wordMatch = rest.match(WORD_RE)
      if (!wordMatch) break
      const wordTime = parseInt(wordMatch.groups?.time ?? '0', 10)
      const wordDuration = parseInt(wordMatch.groups?.duration ?? '0', 10)
      const rawWord = wordMatch.groups?.word ?? ''
      rest = rest.slice(wordMatch[0].length)

      // 拆分空格子词并均分时长(对齐参考 splitedWords 逻辑)
      const subWords = rawWord.split(/\s+/).filter((s) => s.length > 0)
      if (subWords.length === 0) {
        // 纯空格间隔词:保留原文,不拆分
        words.push({ timeMs: wordTime, durationMs: wordDuration, word: rawWord })
        continue
      }
      const startsWithSpace = /^\s/.test(rawWord)
      const endsWithSpace = /\s$/.test(rawWord)
      const subDur = wordDuration / subWords.length
      subWords.forEach((sub, i) => {
        let w: string
        if (subWords.length === 1) {
          w = (startsWithSpace ? ' ' : '') + sub + (endsWithSpace ? ' ' : '')
        } else if (i === 0) {
          w = (startsWithSpace ? ' ' : '') + sub + ' '
        } else if (i === subWords.length - 1) {
          w = sub + (endsWithSpace ? ' ' : '')
        } else {
          w = sub + ' '
        }
        words.push({
          timeMs: Math.round(wordTime + i * subDur),
          durationMs: subDur,
          word: w
        })
      })
    }

    if (words.length === 0) continue
    markTrailingWords(words)
    result.push({
      timeMs,
      durationMs,
      text: words.map((w) => w.word).join(''),
      words
    })
  }

  result.sort((a, b) => a.timeMs - b.timeMs)
  return result
}
