/**
 * 插曲行（interlude）合成 —— 「流光」与「浮名」共享的一层。
 *
 * ## 为什么要有插曲行
 *
 * 歌词里存在**没有任何一句在唱**的空窗：前奏、间奏、尾奏。这些空窗短则几秒，
 * 长则几十秒。上游 Folia 的处理是：在超过 3 秒的空窗里**补一行六个半角句点**
 * （`......`），并让它逐点地"唱"过去 —— 于是长间奏时舞台不是一片空白，
 * 而是缓缓浮现一串放大的点。
 *
 * 上游出处：`src/utils/lyrics/parserCore.ts` 的 `attachInterludes` 与
 * `INTERLUDE_FULL_TEXT`。本模块逐条对齐它的判定与切分，只把秒制换成毫秒制。
 *
 * ## 为什么放在 shared 而不是各皮肤自己合成
 *
 * 插曲行**参与行下标**：它进了行数组，`useSkinActiveLine` 算出来的下标就会把它
 * 算进去，相机、逐词揭示、副字幕回退全都跟着它走。若两个皮肤各合成一份，
 * 同一首歌在两个皮肤里的行下标会在间奏处错开 —— 而「倾诉」的经典歌词列表也读
 * 同一份 store 行数组。**插曲行必须只有一个出处**，就是这里。
 *
 * ## 三个判定逐条对齐上游
 *
 * 1. **首行之前**：`lines[0].timeMs > 3000` 时补一行，区间是
 *    `[500, lines[0].timeMs - 500]` —— 两端各留 500ms，避免插曲行与首行贴在一起；
 * 2. **行与行之间**：相邻两行的空隙（下一行起始 − 当前行**真实**结束）`> 3000` 时补一行，
 *    区间是 `[当前行结束 + 50, 下一行起始 - 50]`；
 * 3. **尾奏不补**：上游只在前奏与行间补，末尾之后不再造行。这不是遗漏 ——
 *    尾奏时上游的相机停在最后一句上，多造一行反而会把画面推走。
 *
 * ## ⚠️ 行间空隙只能靠「音源自带的行时长」判断
 *
 * 上游的 `gap = next.startTime - current.endTime` 里的 `endTime` 是**解析器给出的**
 * 行结束时间，它有两个来源（见 `shared/line-timing` 的文件头）：YRC / TTML 这类带
 * 行时长的音源给真实值；只有起始时间戳的老 LRC 则退化成"下一行的起始"。
 *
 * 后者代入上面那个式子，`gap` 恒等于 0 —— **老 LRC 歌曲不会补行间插曲行**，
 * 这不是本项目漏做，而是上游本来就这样（没有真实时长就不可能知道空窗有多长）。
 * 所以这里必须走 `resolveLineEndTimeMs`（真实时长优先），不能图省事直接写
 * 「下一行起始」——那样行间插曲永远补不出来，且没有任何报错。
 *
 * ## 六个点的切分
 *
 * 上游把插曲区间**六等分**，每份一个 `.`，所以 `words` 是六个词。
 * 「流光」的 `core/word-layout` 靠这个逐词结构走插曲专用的几何
 * （居中 / 放大 1.5 / `3rem` 间距），「浮名」的排版则把它当普通一行处理。
 * 六等分是上游的硬编码，不是"按字数平均" —— 别改成按字数。
 */

import type { LyricLine, LyricWord } from '@/domain/lyric'
import { resolveLineEndTimeMs } from './line-timing'

/** 插曲行的整行文本：六个**半角**句点（上游 `INTERLUDE_FULL_TEXT`） */
export const INTERLUDE_FULL_TEXT = '......'

/** 插曲行里的点数 —— 与 {@link INTERLUDE_FULL_TEXT} 的字符数一致（上游硬编码 6） */
export const INTERLUDE_DOT_COUNT = 6

/** 空隙阈值：只有长于它的空窗才补插曲行（上游 `gap > 3` 秒） */
export const INTERLUDE_MIN_GAP_MS = 3000

/** 插曲行与相邻真行之间的留白（上游首行前的 0.5s 与行间的 0.05s 是**两个**值，见下） */
const LEADING_INTERLUDE_EDGE_MARGIN_MS = 500
const INTERNAL_INTERLUDE_EDGE_MARGIN_MS = 50

/** 该行是否是插曲行（逐字比较，与上游 `isInterludeLine` 同式） */
export function isInterludeLine(line: Pick<LyricLine, 'text'>): boolean {
  return line.text === INTERLUDE_FULL_TEXT
}

/** 造一行插曲：把 `[startMs, endMs]` 六等分，每份一个点 */
function createInterludeLine(startMs: number, endMs: number): LyricLine {
  const durationMs = endMs - startMs
  const wordDurationMs = durationMs / INTERLUDE_DOT_COUNT

  const words: LyricWord[] = []
  for (let index = 0; index < INTERLUDE_DOT_COUNT; index += 1) {
    words.push({
      timeMs: startMs + index * wordDurationMs,
      durationMs: wordDurationMs,
      word: '.'
    })
  }

  /**
   * ⚠️ 必须带 `endTimeMs`：插曲行的起止是**已知**的，若让它退回"下一行起始"，
   * 它的 `renderEndTime` 会一路盖到下一行开头 —— 于是插曲与下一句之间那几十毫秒的
   * 空窗消失，行下标永远不会回到 -1。上游的插曲行有真实 `endTime`
   * （官方文档的样例 JSON 里是 `endTime: 27.74`、`renderEndTime: 28.12`，
   * 而下一句从 28.24 开始 —— 那 120ms 的空窗是真实存在的）。
   */
  return { timeMs: startMs, endTimeMs: endMs, text: INTERLUDE_FULL_TEXT, words }
}

/**
 * 在长空窗里补插曲行（上游 `attachInterludes`）。
 *
 * 行结束时间走共享的 {@link resolveLineEndTimeMs}（真实行时长优先，见文件头）。
 * **不要**在这里另写一份"下一行起始"——那会让行间插曲行永远补不出来。
 *
 * ⚠️ 传进来的行**必须是按时间升序**的（store 的行数组在解析阶段已保证）。
 * 本函数不排序：排序会让"原行顺序"与"调用方看到的顺序"不一致，
 * 而下游的下标语义全部建立在原顺序上。
 */
export function attachInterludeLines(
  lines: readonly LyricLine[],
  playerDurationMs: number
): LyricLine[] {
  if (lines.length === 0) return []

  const result: LyricLine[] = []
  const first = lines[0]

  // 首行之前的空窗：两端各留 500ms
  if (first.timeMs > INTERLUDE_MIN_GAP_MS) {
    result.push(
      createInterludeLine(
        LEADING_INTERLUDE_EDGE_MARGIN_MS,
        first.timeMs - LEADING_INTERLUDE_EDGE_MARGIN_MS
      )
    )
  }

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index]
    result.push(current)

    const next = lines[index + 1]
    if (!next) continue

    // 本行的真实结束时间（见文件头：老 LRC 会退化成"下一行起始"，此时空隙为 0）
    const currentEndMs = resolveLineEndTimeMs(current, next, playerDurationMs)
    const gapMs = next.timeMs - currentEndMs
    if (gapMs > INTERLUDE_MIN_GAP_MS) {
      result.push(
        createInterludeLine(
          currentEndMs + INTERNAL_INTERLUDE_EDGE_MARGIN_MS,
          next.timeMs - INTERNAL_INTERLUDE_EDGE_MARGIN_MS
        )
      )
    }
  }

  return result
}
