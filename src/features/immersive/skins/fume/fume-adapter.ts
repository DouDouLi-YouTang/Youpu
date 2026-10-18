/**
 * 「浮名」的调参适配层 —— 把 Folia 的 `FumeTuning` 与本项目的定案写成常量。
 *
 * ## 为什么需要这一层（与「流光」的 `glow-adapter.ts` 同构）
 *
 * 浮名使用 Folia 三主题共享设置；Folia 那一堆
 * 排版与绘制参数在本项目里内置成常量，但**不能**把它们内联散落到各处：
 *  - 布局缓存键（§7.1）要吃 `heroScale` 与字体栈；
 *  - 每帧绘制要吃 `glowIntensity`、`backgroundObjectOpacity`、`showText` / `staticMode`；
 *  - 时间轴要吃 `cameraTrackingMode` / `cameraSpeed`。
 *
 * 一旦内联，同一个值就有了好几个出处；将来暴露更多调节项时更不知道要改几处。
 * 所以这里集中一份，**唯一**的取值出处，其余模块只引用常量。
 *
 * ## 为什么 `disableGeometricBackground` 不在这里
 *
 * 它描述的是「外壳的几何背景要不要让位」，属于**皮肤与外壳的约定**，不是画布参数
 * （见 §12.6）。浮名自己的做法是「铺纯色底 + 自绘背景」，所以在 `SkinFume.vue`
 * 里直接体现，不进这份调参表。
 */

import type { LyricLine, LyricWord } from '@/domain/lyric'
import { buildLineRenderHints } from '../shared/render-hints'
import { resolveLineEndTimeMs } from '../shared/line-timing'
import { resolveSubtitleClampSize } from '../shared/subtitle-tracks'
import type { FumeCameraTrackingMode, FumeLine, FumeWord } from './core/fume-types'

/** 浮名在本项目里的内置调参（§14.1 的默认列，全部照抄上游默认值） */
export const FUME_TUNING = Object.freeze({
  /**
   * `true` = 不画「打印印章」方块（§10.5）。
   * 默认 **false**：印章是浮名的招牌视觉之一（字落下时砸一个方块），不能默认关掉。
   */
  hidePrintSymbols: false,
  /** 相机跟随模式：`smooth` = 按浮点打印进度连续滑动（上游默认） */
  cameraTrackingMode: 'smooth' as FumeCameraTrackingMode,
  /** 相机速度倍率（1 = 上游默认；运行时钳在 [0.55, 1.85]） */
  cameraSpeed: 1,
  /** 辉光强度（1 = 上游默认；运行时钳在 [0, 1.8]） */
  glowIntensity: 1,
  /**
   * 背景形状不透明度倍率（0.5 = 上游默认）。
   *
   * ⚠️ 用法是**再乘 2**（§11.3 的每帧流程），所以 0.5 等效系数 1.0。
   * 这一层额外乘 2 是上游的历史行为，照抄即可 —— 直接传 0.5 给绘制层
   * 会让所有背景形状暗一半。
   */
  backgroundObjectOpacity: 0.5,
  /**
   * 唱过文字的保留比例（1 = 永不淡出）。
   *
   * 本项目恒为 1：§14.1 的定案里 `textHoldRatio >= 1` 会让
   * 「已唱过 = dimmed 与快照交叉淡出」这两条路径**永不进入**。
   */
  textHoldRatio: 1
})

/** `true` = 画打印印章（`hidePrintSymbols` 取反；调用方读这个更直观） */
export const FUME_SHOW_PRINT_STAMP = !FUME_TUNING.hidePrintSymbols

/** 背景不透明度倍率的**实际**系数（`backgroundObjectOpacity * 2`，见上） */
export const FUME_BACKGROUND_OPACITY_MULTIPLIER = FUME_TUNING.backgroundObjectOpacity * 2

/**
 * 全局字号倍率（§14.1：当前不暴露经典排版滑杆，一律取默认值）。
 *
 * 它与 `heroScale` 都参与 §7.1 的缓存键与 §4.10 的字号二分，所以**必须**是常量而不是
 * 内联的 `1`：将来暴露字号设置时只有这一处要改（与 `FUME_HERO_SCALE` 同一考虑）。
 */
export const FUME_LYRICS_FONT_SCALE = 1

/**
 * hero 块的字号倍率（§14.1：默认 1，运行时钳在 `[0.82, 1.32]`）。
 *
 * ⚠️ 它是**唯一**参与排版的调参（§7.9 第 2 条）：其余调参（相机速度、辉光、透明度）
 * 改了不该让整首诗重排。所以它单独存在这里，而不是混进 `FUME_TUNING` 之外的对象。
 */
export const FUME_HERO_SCALE = 1

/**
 * 无文章（前奏 / 加载中）时背景自转的墙钟漂移系数（§12.7）。
 *
 * 上游是 `time + now * 0.00018`，`now` 是墙钟毫秒。**数值照抄**：
 * 这一项目的是让背景在前奏里也缓慢转动 —— 严格跟播放进度会让前奏期间完全静止。
 */
export const FUME_IDLE_TIME_DRIFT = 0.00018

// ─────────────────────────── §14.2 底部副字幕的字号档 ───────────────────────────

/**
 * 浮名自己的副字幕 clamp 三锚点（§14.2 的表格）。
 *
 * ⚠️ **不是**流光的 `subtitleFontSizes.ts` 那一套：上游 `VisualizerFume.tsx:239`
 * 自己拼了这组数（`clamp(1.05rem, 2.2vw, 1.2rem)`），两个面板的字幕字号在 Folia 里
 * 本来就不一样。共用的是"三项都乘倍率"这条规则（`resolveSubtitleClampSize`），
 * 不是锚点数值 —— 合并数值必然让其中一个面板与上游对不上。
 */
export const FUME_SUBTITLE_CLAMP_REM_MIN = 1.05
export const FUME_SUBTITLE_CLAMP_VW = 2.2
export const FUME_SUBTITLE_CLAMP_REM_MAX = 1.2

/** 下一句预览的三锚点：`clamp(0.875rem, 1.8vw, 1rem)`（§14.2 表格第二行） */
export const FUME_UPCOMING_CLAMP_REM_MIN = 0.875
export const FUME_UPCOMING_CLAMP_VW = 1.8
export const FUME_UPCOMING_CLAMP_REM_MAX = 1

/** 副字幕字号（倍率固定 1，见 `FUME_LYRICS_FONT_SCALE`） */
export function resolveFumeSubtitleFontSize(scale = FUME_LYRICS_FONT_SCALE): string {
  return resolveSubtitleClampSize(
    FUME_SUBTITLE_CLAMP_REM_MIN,
    FUME_SUBTITLE_CLAMP_VW,
    FUME_SUBTITLE_CLAMP_REM_MAX,
    scale
  )
}

/** 「下一句预览」字号（倍率固定 1） */
export function resolveFumeUpcomingFontSize(scale = FUME_LYRICS_FONT_SCALE): string {
  return resolveSubtitleClampSize(
    FUME_UPCOMING_CLAMP_REM_MIN,
    FUME_UPCOMING_CLAMP_VW,
    FUME_UPCOMING_CLAMP_REM_MAX,
    scale
  )
}

/**
 * 空态字号 —— `clamp(1.5rem, 3.5vw, 2.25rem)`。
 *
 * 与「流光」的 `resolveGlowEmptyFontSize` 同值：上游的空态是外壳（`VisualizerShell`）
 * 提供的通用层，不分面板。浮名自己没有空态，本项目沿用同一条口径 —— 三个面板的
 * 空态在切换时不该突然跳一下大小。
 */
export const FUME_EMPTY_FONT_CLAMP_REM_MIN = 1.5
export const FUME_EMPTY_FONT_CLAMP_VW = 3.5
export const FUME_EMPTY_FONT_CLAMP_REM_MAX = 2.25

/** 空态字号（倍率固定 1） */
export function resolveFumeEmptyFontSize(scale = FUME_LYRICS_FONT_SCALE): string {
  return resolveSubtitleClampSize(
    FUME_EMPTY_FONT_CLAMP_REM_MIN,
    FUME_EMPTY_FONT_CLAMP_VW,
    FUME_EMPTY_FONT_CLAMP_REM_MAX,
    scale
  )
}

/**
 * 背景场景种子：`${seed ?? 'fume'}:${theme.name}`（§7.10）。
 *
 * ⚠️ 种子**含主题名**：换主题时背景会重掷一套形状，与上游一致。
 * 不带主题名会让「切主题后背景不变」，看起来像没生效。
 */
export function resolveFumeBackgroundSeed(
  seed: string | number | undefined,
  themeName: string
): string {
  return `${seed === undefined ? 'fume' : String(seed)}:${themeName}`
}

// ─────────────────────── §15.2 数据形状适配（LyricLine → FumeLine） ───────────────────────

/**
 * 行结束时间未知时的兜底时长（§15.2）。
 *
 * 从共享层转发（**唯一出处**在 `shared/line-timing`）：皮肤之间不许横向依赖
 * （`fume/` import `glow/` 会让两个面板的打包与重构耦合），但**共享层**正是为
 * 这种"三个面板口径必须一致"的量准备的 —— 各自写一份字面量时，
 * 改一处忘另两处不会有任何测试发现。
 */
export { FALLBACK_LINE_DURATION_MS as FUME_FALLBACK_LINE_DURATION_MS } from '../shared/line-timing'

/**
 * 推算行结束时间（毫秒，§15.2）。优先级与 `tilt-adapter.resolveLineEndMs` /
 * `glow-adapter.resolveLineEndMs` **完全一致**，刻意不另立一套口径：
 *  1. 有下一行 → 下一行起始（歌词时间戳天然就是上一行的结束）；
 *  2. 最后一行 → 播放时长（覆盖到曲末，避免末行拖太久）；
 *  3. 都不行（时长未知 / 时间戳乱序）→ 固定 5 秒。
 *
 * ⚠️ 这个值**不是**「字幕显示多久」那么简单：§5.3 的行过场截止时间
 * （`resolveLinePassCutoffTime`）与 §6.3 的颜色拖尾都直接读它，
 * 而 `renderEndTime` 又是 §8.3 `staticState` 从 `null` 翻到 `'passed'` 的判据。
 * 三个皮肤的行结束时间必须同源，否则同一首歌在三个面板里的镜头节奏会漂。
 */
export function resolveFumeLineEndMs(
  line: Pick<LyricLine, 'timeMs'> & Pick<LyricLine, 'endTimeMs'>,
  nextLine: Pick<LyricLine, 'timeMs'> | null | undefined,
  playerDurationMs: number
): number {
  // 实现与口径的唯一出处是共享层（真实行时长优先 → 下一行起始 → 播放时长 → 5 秒）。
  // 三个皮肤各写一份的后果是同一首歌在三个面板里的镜头节奏会漂，见那边的文件头。
  return resolveLineEndTimeMs(line, nextLine, playerDurationMs)
}

/**
 * `LyricWord[]` → `FumeWord[]`（词级时间戳路径）。
 *
 * 返回**空数组**表示「不能用词级时间戳」，调用方按 §5.5 走整行摊分 ——
 * 两种情况都会退化：
 *  - 没有 `words`（老歌只有行级 LRC）；
 *  - `words.map(w => w.word).join('') !== lineText`（数据不自洽）。
 *
 * 第二条为什么必须拦：§5.1 的 `buildWordRangesFromWords` 是**按词的字素数顺序**
 * 往前推 cursor 的，它不看词文本本身。若词拼接与整行对不上，cursor 会算到错误的
 * 字素区间上 —— 表现是「某些字永远不亮、某些字提前亮」，且没有任何报错。
 * 宁可不做逐词揭示，也不要错位。（与 `tilt-adapter.toWordSpans` 返回 null 同理。）
 *
 * 时间戳做单调化：起点不早于上一个词的起点。上游偶见的乱序数据不至于让揭示倒退
 * （§5.2 的进度公式在 `end < start` 时会退化成「到点才亮」，视觉上是卡顿而不是错误）。
 */
export function toFumeWords(words: readonly LyricWord[] | undefined, lineText: string): FumeWord[] {
  if (!words || words.length === 0) return []

  let joined = ''
  for (const word of words) joined += word.word
  if (joined !== lineText) return []

  const result: FumeWord[] = []
  let lastStart: number | null = null
  for (const word of words) {
    const rawStart = Number.isFinite(word.timeMs) ? word.timeMs : (lastStart ?? 0)
    const start: number = lastStart === null ? rawStart : Math.max(rawStart, lastStart)
    const duration = Number.isFinite(word.durationMs) && word.durationMs > 0 ? word.durationMs : 0
    result.push({ text: word.word, startTimeMs: start, endTimeMs: start + duration })
    lastStart = start
  }
  return result
}

/**
 * 整个歌词数组 → `FumeLine[]`（§15.2）。**逐行**补齐 `endTimeMs` 与 `renderHints`。
 *
 * 为什么整体转换而不是「用到哪行转哪行」：§7.7 的排版要一次性看到全部行
 * （列高装箱、字号二分、变体选择都依赖整篇），而 §7.1 的缓存键又要逐行指纹，
 * 所以转换必须在**进入排版之前**完成，且结果要被缓存键和排版同时复用。
 *
 * `isChorus` 来自 `/song/chorus` 的副歌区间（数据层在 `lyric.mapper.applyChorusRanges`
 * 里按"行与区间是否重叠"打标，见 §7.11）。它是 hero 变体的一档加权
 * （`article-blocks` 的 `chorusScore`），没有标记的行照常参与选择。
 * **不要**用「有没有译文」之类的旁证去补 —— 那会让 hero 的分布随时间线数据质量漂移。
 */
export function toFumeLines(lines: readonly LyricLine[], playerDurationMs: number): FumeLine[] {
  return lines.map((line, index) => {
    const startTimeMs = line.timeMs
    const endTimeMs = resolveFumeLineEndMs(line, lines[index + 1] ?? null, playerDurationMs)
    const words = toFumeWords(line.words, line.text)
    return {
      words,
      startTimeMs,
      endTimeMs,
      fullText: line.text,
      translation: line.translation,
      romanization: line.romaji,
      isChorus: line.isChorus === true,
      renderHints: buildLineRenderHints({ startTimeMs, endTimeMs, words })
    }
  })
}
