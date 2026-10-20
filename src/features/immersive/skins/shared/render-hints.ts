/**
 * 行渲染提示（render hints）—— 「浮名」与「流光」共用的行级时序档位。
 *
 * 来源：Folia `src/utils/lyrics/renderHints.ts`；规格书 §4.9（时间派生量）与 §7.11
 * （本项目缺 `endTime` / `renderHints` 时的适配口径）。
 *
 * ## 这一层解决什么
 *
 * 歌词里有一类「一闪而过」的行：间奏的 `...`、气口、单个语气词。它们的
 * `endTime - startTime` 只有几十毫秒 —— 若照样走正常过场（进场 0.22s + 出场 0.18s），
 * 动画还没进场，下一行就已经把镜头抢走了。所以整条链路（相机重定位、逐词揭示、
 * 颜色拖尾、快照切换）都按**同一张档位表**降级：
 *
 * | 原始行时长 | timingClass | lineTransitionMode | wordRevealMode |
 * | --- | --- | --- | --- |
 * | < 100ms | micro  | none   | instant |
 * | < 180ms | short  | fast   | fast    |
 * | 其它     | normal | normal | normal  |
 *
 * 档位一旦分叉（例如相机按 normal 走、揭示按 micro 走），就会出现「镜头慢慢地推过去、
 * 字却瞬间蹦出来」。所以这张表是两个皮肤唯一的真源，调用处不要再自行分档。
 *
 * ## 单位
 *
 * 上游是**秒**，本项目契约是**毫秒**，所以这里每个标量都进标识符或后缀（`Ms`）。
 * 换算只在常量定义处发生一次，函数体内部不再出现 `* 1000`。
 *
 * ## 本项目的 `LyricLine` 没有 `endTime`（§7.11）
 *
 * 领域层的 `LyricLine` 只有 `timeMs`，没有行结束时间，也没有烘焙好的 `renderHints`。
 * 各皮肤的适配层负责先把结束时间补齐（口径与「倾诉」的 `resolveLineEndMs` 一致：
 * 下一行起始 → 播放总时长 → 固定 5 秒兜底），再构造出满足
 * {@link RenderHintLineLike} 的行对象喂给本模块。**不要**在这里重新实现那套推算：
 * 两个皮肤的行结束时间必须来自同一个来源，否则同一首歌在两个皮肤里的
 * `renderEndTime` 会不同，相机与拖尾的节奏也会跟着漂。
 *
 * ## 与 `fume/core/fume-types.ts` 的关系
 *
 * `FumeLineRenderHints` / `FumeLineTimingClass` 等类型是本文件同名类型的**结构等价副本**
 * （字段名逐字相同，只有注释更详细）。它们靠 TypeScript 的结构化类型互相赋值，
 * 不需要 import。之所以保留副本而不是让 core 反向依赖 shared 的类型名：core 是
 * 「可以整体搬走的一块」，类型名跟着 core 自己的命名（`Fume*`）更好读。
 * 若将来两份定义出现字段增减，**以本文件为准**（两个皮肤都读它）。
 */

/** 极短行阈值：低于它的行跳过一切过场动画（上游 `MICRO_LINE_DURATION_THRESHOLD`） */
export const MICRO_LINE_DURATION_THRESHOLD_MS = 100

/** 短行阈值：低于它的行用过场与揭示都加速（上游 `SHORT_LINE_DURATION_THRESHOLD`） */
export const SHORT_LINE_DURATION_THRESHOLD_MS = 180

/** 极短行的最小「留在屏幕上」时长（上游 `MICRO_LINE_RENDER_FLOOR = 0.067`） */
export const MICRO_LINE_RENDER_FLOOR_MS = 67

/** 逐词提前进入 active 的提前量：normal（上游 0.15s） */
export const WORD_LOOKAHEAD_NORMAL_MS = 150
/** 逐词提前进入 active 的提前量：fast（上游 0.08s） */
export const WORD_LOOKAHEAD_FAST_MS = 80
/** 逐词提前进入 active 的提前量：instant（上游 0.03s） */
export const WORD_LOOKAHEAD_INSTANT_MS = 30

/** 行时长档位（见文件头的档位表） */
export type LineTimingClass = 'normal' | 'short' | 'micro'
/** 行容器的过场档位：none = 不加过场，fast/normal 只影响时长 */
export type LineTransitionMode = 'normal' | 'fast' | 'none'
/** 逐词揭示档位：instant = 整行一起亮；fast/normal 影响 lookahead 与 active 窗口 */
export type WordRevealMode = 'normal' | 'fast' | 'instant'

/**
 * 本模块只需要词级时间戳里的一件事：**最后一个词的结束时间**。
 *
 * 为什么需要它：`renderEndTime` 要让「颜色拖尾」在**最后一个字唱完**之后才开始算，
 * 而不是在行 `endTime` 之后。有的谱面里 `endTime` 比最后一个词的结束时间更早
 * （数据来源不同），取词的结束时间才不会把拖尾截断。
 */
export interface RenderHintWordLike {
  endTimeMs: number
}

/** 行渲染提示（毫秒口径，字段与上游一一对应） */
export interface LineRenderHints {
  /** 原始行时长：`max(endTimeMs - startTimeMs, 0)` */
  rawDurationMs: number
  timingClass: LineTimingClass
  /**
   * 这一行**允许留在屏幕上**的最晚时刻（含出场补白）。
   *
   * 注意它不是「这一行独占的时间轴」：若下一行更早开始，渲染方要用
   * `resolveLinePassCutoffTime` 把它截短（见 §5.3）。
   */
  renderEndTimeMs: number
  lineTransitionMode: LineTransitionMode
  wordRevealMode: WordRevealMode
}

/**
 * 能被本模块接受的行对象：只需要三个时间字段。
 *
 * `words` 与 `renderHints` 可选 —— 没有 `words` 时用行结束时间当最后一个词的结束时间；
 * 已经烘好 `renderHints` 的行（上游歌单管线会预计算）直接复用，不重算。
 */
export interface RenderHintLineLike {
  startTimeMs: number
  endTimeMs: number
  words?: readonly RenderHintWordLike[]
  renderHints?: LineRenderHints
}

/** 过场时长三件套（毫秒） */
export interface LineTransitionTimingMs {
  enterDurationMs: number
  exitDurationMs: number
  /** 唱完最后一个字之后、开始退场之前按住不动的时间 */
  linePassHoldMs: number
}

/** 把数值钳到 [min, max]；不处理 NaN（输入来自时间戳，调用方保证有限） */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** 最后一个词的结束时间；没有词时退回行结束时间 */
function resolveLastWordEndTimeMs(line: Pick<RenderHintLineLike, 'endTimeMs' | 'words'>): number {
  const lastWord = line.words?.[line.words.length - 1]
  return lastWord?.endTimeMs ?? line.endTimeMs
}

/** 原始行时长 → 档位（阈值是**严格小于**，边界值落进下一档） */
export function resolveLineTimingClass(rawDurationMs: number): LineTimingClass {
  if (rawDurationMs < MICRO_LINE_DURATION_THRESHOLD_MS) return 'micro'
  if (rawDurationMs < SHORT_LINE_DURATION_THRESHOLD_MS) return 'short'
  return 'normal'
}

/** 档位 → 行容器过场档位 */
export function resolveLineTransitionMode(timingClass: LineTimingClass): LineTransitionMode {
  if (timingClass === 'micro') return 'none'
  if (timingClass === 'short') return 'fast'
  return 'normal'
}

/** 档位 → 逐词揭示档位 */
export function resolveWordRevealMode(timingClass: LineTimingClass): WordRevealMode {
  if (timingClass === 'micro') return 'instant'
  if (timingClass === 'short') return 'fast'
  return 'normal'
}

/** 揭示档位 → 逐词提前量（毫秒）。流光用它决定词何时由 waiting 转为 active */
export function resolveWordLookaheadMs(wordRevealMode: WordRevealMode): number {
  if (wordRevealMode === 'instant') return WORD_LOOKAHEAD_INSTANT_MS
  if (wordRevealMode === 'fast') return WORD_LOOKAHEAD_FAST_MS
  return WORD_LOOKAHEAD_NORMAL_MS
}

/**
 * 过场时长（§9.3 的相机重定位与 §8.3 的拖尾窗口都读它）。
 *
 * 三档的差别不只是「变短」：
 * - `none` 全为 0 —— 极短行不该有任何过场，否则进场动画会吃掉整行；
 * - `fast` 的进场有 45..60ms 的地板，即使行只有 100ms 也还看得见一点淡入；
 * - `normal` 的进场按 `max(rawDuration, 120) * 0.34` 缩放，再用 220..420ms 钳制。
 *
 * `linePassHold` 只在 `instant` 揭示时为 0：字是瞬间全亮的，没有「最后一个字唱完」的
 * 那一刻可以按住，留着 hold 只会让拖尾白等。
 */
export function getLineTransitionTimingMs(
  rawDurationMs: number,
  lineTransitionMode: LineTransitionMode,
  wordRevealMode: WordRevealMode
): LineTransitionTimingMs {
  if (lineTransitionMode === 'none') {
    return { enterDurationMs: 0, exitDurationMs: 0, linePassHoldMs: 0 }
  }

  if (lineTransitionMode === 'fast') {
    return {
      enterDurationMs: clamp(rawDurationMs * 0.45, 45, 60),
      exitDurationMs: clamp(rawDurationMs * 0.22, 30, 40),
      linePassHoldMs: wordRevealMode === 'instant' ? 0 : 30
    }
  }

  return {
    enterDurationMs: Math.min(420, Math.max(220, Math.max(rawDurationMs, 120) * 0.34)),
    exitDurationMs: Math.min(320, Math.max(180, Math.max(rawDurationMs, 120) * 0.18)),
    linePassHoldMs: wordRevealMode === 'instant' ? 0 : 60
  }
}

/**
 * 计算 `renderEndTime`（上游 `buildLineRenderEndTime`）。
 *
 * 语义：**这一行可以留在屏幕上的最晚时刻**，用于「出场补白」与颜色拖尾。它不是
 * 独立时间轴 —— 后一行提前出现时要用 `resolveLinePassCutoffTime` 截短。
 *
 * 三条分支：
 * 1. `none`（极短行）→ `max(endTimeMs, startTimeMs + 67ms)`：极短行也要在屏幕上
 *    停留至少 67ms，否则它会在一帧内出现又消失，看起来像漏印；
 * 2. `fast` → 出场起点取三者的 `max`：进场刚结束的位置（`start + enter + 10ms`，
 *    +10ms 是为了避免「进场那一刻就退场」的零窗口）、拖尾结束位置、以及
 *    「行结束前 exitDuration」的位置；
 * 3. `normal` → 与 fast 相同，只是去掉进场那一项（正常行的进场足够长，不会撞上）。
 *
 * 最后都要与 `endTimeMs` 取 `max`：渲染结束时间绝不能早于行结束。
 */
export function buildLineRenderEndTimeMs(
  line: Pick<RenderHintLineLike, 'startTimeMs' | 'endTimeMs' | 'words'>,
  rawDurationMs: number,
  lineTransitionMode: LineTransitionMode,
  wordRevealMode: WordRevealMode
): number {
  if (lineTransitionMode === 'none') {
    return Math.max(line.endTimeMs, line.startTimeMs + MICRO_LINE_RENDER_FLOOR_MS)
  }

  const transitionTiming = getLineTransitionTimingMs(
    rawDurationMs,
    lineTransitionMode,
    wordRevealMode
  )
  const linePassStart =
    Math.max(resolveLastWordEndTimeMs(line), line.startTimeMs) + transitionTiming.linePassHoldMs
  const exitStart =
    lineTransitionMode === 'fast'
      ? Math.max(
          line.startTimeMs + transitionTiming.enterDurationMs + 10,
          linePassStart,
          line.endTimeMs - transitionTiming.exitDurationMs
        )
      : Math.max(linePassStart, line.endTimeMs - transitionTiming.exitDurationMs)

  return Math.max(line.endTimeMs, exitStart + transitionTiming.exitDurationMs)
}

/** 由行对象一次性算出全部提示（档位 → 时间 → 渲染结束时间） */
export function buildLineRenderHints(line: RenderHintLineLike): LineRenderHints {
  const rawDurationMs = Math.max(line.endTimeMs - line.startTimeMs, 0)
  const timingClass = resolveLineTimingClass(rawDurationMs)
  const lineTransitionMode = resolveLineTransitionMode(timingClass)
  const wordRevealMode = resolveWordRevealMode(timingClass)

  return {
    rawDurationMs,
    timingClass,
    renderEndTimeMs: buildLineRenderEndTimeMs(
      line,
      rawDurationMs,
      lineTransitionMode,
      wordRevealMode
    ),
    lineTransitionMode,
    wordRevealMode
  }
}

/** 已烘好的提示优先；没有就现算。`line` 为空 → `null` */
export function getLineRenderHints(
  line: RenderHintLineLike | null | undefined
): LineRenderHints | null {
  if (!line) return null
  return line.renderHints ?? buildLineRenderHints(line)
}

/**
 * 渲染结束时间（毫秒）。`line` 为空 → `-Infinity`。
 *
 * 上游对「没有行」用 `-Infinity` 而不是 0：调用处（如 `article.lastChronologicalRenderEndTime`）
 * 会拿它做 `time >= value` 的比较，0 会在播放一开始就判真，导致「最后一块」被误选中。
 */
export function getLineRenderEndTimeMs(line: RenderHintLineLike | null | undefined): number {
  if (!line) return Number.NEGATIVE_INFINITY
  return getLineRenderHints(line)?.renderEndTimeMs ?? line.endTimeMs
}
