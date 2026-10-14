/**
 * 「浮名」实时逐字素绘制的**纯参数层**（移植规格书 §10.4b / §10.4c / §10.5）。
 *
 * ## 为什么要把参数算在绘制之外
 *
 * §10.4 的绘制本体有四个分支（唱过截止 / 词未开始 / 正在打印 / 颜色拖尾）与一个
 * 打印印章窗口，全部是**纯数值**。把它们留在 `canvas-text-live.ts` 里和 canvas 调用
 * 缠在一起，就只能靠「看截图」验证；拆到本文件后，每一个分支的 alpha / 半径 / 混色
 * 比例都能在 node 里逐条断言 —— 而这层最容易错，且错了都很难肉眼归因：
 * 拖尾起点差 0.18 → 唱过的字立刻发白；揭示提前量少 0.16 → 字会「先暗一下再亮」。
 *
 * ## 为什么不返回新对象（§16.2）
 *
 * 本层每个字素被调用一次，一帧就是几百上千次。`return { alpha, fillStyle, ... }`
 * 会制造同等数量的短命对象，60fps 下每秒几万个 —— GC 抖动直接表现为掉帧。
 * 所以所有函数都是**写入调用方给的 `out` 对象**（上游用局部变量 + 闭包，本项目
 * 改成显式 out 参数，因为闭包同样是每次分配）。调用方复用一个实例即可，
 * 语义仍是纯的：输出只由入参决定，不读任何外部状态。
 *
 * ## 单位
 *
 * 全部是**毫秒**（上游是秒）。上游的 `0.08` / `0.001` / `0.04` / `0.055` / `0.2`
 * 等秒制常量在下面逐个换成毫秒，函数体内不再出现秒制数字。
 */

import { colorWithAlpha, mixColors } from '../../shared/color-mix'
import {
  clamp,
  easeInOutCubic,
  easeOutCubic,
  isCjk,
  mix,
  resolveDelayedGlowEnvelope
} from '../core/fume-math'
import {
  MIN_VISUAL_PROGRESS_DURATION_MS,
  MIN_WORD_REVEAL_DURATION_MS,
  resolveVisualProgressWithCutoff
} from '../core/fume-reveal'
import type { FumeBlockTiming } from '../core/block-frame'
import type { FumeBlock, FumeWordRange } from '../core/fume-types'

// ───────────────────────── §10.4b 整行辉光 ─────────────────────────

/** 整行辉光的绘制参数（§10.4b 的四个量，`blur` 是**未量化**值） */
export interface FumeLiveLineGlow {
  /** 字色 alpha（喂给 `colorWithAlpha(accentColor, …)`） */
  alpha: number
  /** 阴影半径（px）；调用方负责按 §16 量化后再设给 canvas */
  blur: number
  /** 字色（accentColor + alpha） */
  fillStyle: string
  /** 阴影色（alpha × 1.35，让光晕比字本身更亮一圈） */
  shadowColor: string
}

/** 辉光包络的峰值位置（§10.4b）：不在起点最亮，而是拖到进度 0.8 */
const LINE_GLOW_ENVELOPE_PEAK = 0.8
/** 阴影色相对字色 alpha 的倍率（§10.4b 的 1.35） */
const LINE_GLOW_SHADOW_ALPHA_SCALE = 1.35

/**
 * 整行辉光的参数（§10.4b）。
 *
 * 这一层辉光是**整行**的、颜色恒为 `accentColor`，与逐字主体色（`getActiveColor`）
 * 是两套：主体色负责「这个字唱到哪了」，整行辉光负责「这一行现在是活的」。
 * 所以它只在 `time` 落在 `[行起点, 行截止]` 内时画（是否画由调用方判），且不随字素变化。
 *
 * 两个基量（0.16 / 0.12 与 12 / 8）都是 hero 更大：标题字大，需要更强的光晕才
 * 看得出「在发光」，而正文块数量多，光晕一大就互相糊成一片。
 */
export function resolveLiveLineGlow(
  out: FumeLiveLineGlow,
  block: Pick<FumeBlock, 'variant' | 'fontPx' | 'line'>,
  timing: FumeBlockTiming,
  timeMs: number,
  glowIntensity: number,
  accentColor: string
): FumeLiveLineGlow {
  const isHero = block.variant === 'hero'
  const lineProgress = resolveVisualProgressWithCutoff(
    block.line.startTimeMs,
    timing.lineDurationMs,
    timeMs,
    timing.linePassCutoffTimeMs
  )
  const envelope = resolveDelayedGlowEnvelope(lineProgress, LINE_GLOW_ENVELOPE_PEAK)

  out.alpha = ((isHero ? 0.16 : 0.12) + envelope * (isHero ? 0.26 : 0.2)) * glowIntensity
  out.blur = ((isHero ? 12 : 8) + envelope * (block.fontPx * (isHero ? 0.7 : 0.52))) * glowIntensity
  out.fillStyle = colorWithAlpha(accentColor, out.alpha)
  out.shadowColor = colorWithAlpha(accentColor, out.alpha * LINE_GLOW_SHADOW_ALPHA_SCALE)

  return out
}

// ───────────────────────── §10.4c 逐字素揭示 ─────────────────────────

/** 揭示提前量（§10.4c 明确点名的三个常量之一）：字还没到点就先亮起来 16% */
export const LIVE_REVEAL_LEAD = 0.16
/** 拖尾起点相对字素时长的比例（§10.4c 的 0.18） */
export const LIVE_GLYPH_TRAIL_START_RATIO = 0.18
/** 拖尾进度的指数（§10.4c 的 1.35）：前慢后快，颜色先在字上停一会儿再退掉 */
export const LIVE_COLOR_TRAIL_EXPONENT = 1.35
/** 低于这个 alpha 就不画（§10.4c 的 0.002）：省掉不可见的绘制与状态切换 */
export const LIVE_MIN_VISIBLE_ALPHA = 0.002

/**
 * 一个字素的时间进度（§10.4c 的 `range` 分支前半段）。
 *
 * 有音节（`word.syllables`）时用音节给的起止时间；没有时按「词内均分」推算 ——
 * 两条路径都必须保留：本项目适配层不产出音节，但上游数据里存在，
 * 一旦将来接上带音节的歌词源，这条分支就是现成的。
 */
export interface FumeGraphemeReveal {
  /** 词时长（已过 80ms 地板） */
  wordDurationMs: number
  /** 词内字素数（至少 1，避免除零） */
  glyphCount: number
  /** 本字素在词内的下标 */
  glyphIndexInRange: number
  wordStartTimeMs: number
  glyphStartTimeMs: number
  glyphEndTimeMs: number
  /** 字素时长（已过 1ms 地板） */
  glyphDurationMs: number
  /** 带 +0.16 提前量并钳到 [0,1] 的进度 */
  glyphProgress: number
  /** `glyphProgress` 的 easeOutCubic 结果（正在打印时的混色权重） */
  easedGlyphProgress: number
  /** 拖尾起点 = 字素起点 + 字素时长 × 0.18 */
  glyphTrailStartMs: number
  /** 拖尾进度 = `pow(phase, 1.35)` */
  colorTrailProgress: number
}

export function resolveLiveGraphemeReveal(
  out: FumeGraphemeReveal,
  range: FumeWordRange,
  globalOffset: number,
  timeMs: number,
  colorTrailDurationMs: number,
  linePassCutoffTimeMs: number
): FumeGraphemeReveal {
  const word = range.word
  const wordDurationMs = Math.max(word.endTimeMs - word.startTimeMs, MIN_WORD_REVEAL_DURATION_MS)
  const wordProgress = clamp((timeMs - word.startTimeMs) / wordDurationMs, 0, 1)
  const glyphCount = Math.max(range.end - range.start, 1)
  const glyphIndexInRange = globalOffset - range.start

  // 音节表只有「有音节」的词才用；下标越界钳到最后一项（上游用 Math.min/Math.max 两层）
  const syllableTiming = word.syllables?.length
    ? range.graphemeTimings[
        Math.min(glyphIndexInRange, Math.max(range.graphemeTimings.length - 1, 0))
      ]
    : undefined

  const glyphStartTimeMs =
    syllableTiming?.startTimeMs ??
    word.startTimeMs + (glyphIndexInRange / glyphCount) * wordDurationMs
  const glyphEndTimeMs =
    syllableTiming?.endTimeMs ??
    word.startTimeMs + ((glyphIndexInRange + 1) / glyphCount) * wordDurationMs
  const glyphDurationMs = Math.max(
    glyphEndTimeMs - glyphStartTimeMs,
    MIN_VISUAL_PROGRESS_DURATION_MS
  )

  // 两条进度公式的差别不只是「有没有音节」：无音节时用「词进度 × 字素数 - 下标」，
  // 这样整词的进度能连续摊到每个字上，不会出现字与字之间的空档。
  const glyphProgress = syllableTiming
    ? clamp((timeMs - glyphStartTimeMs) / glyphDurationMs + LIVE_REVEAL_LEAD, 0, 1)
    : clamp(wordProgress * glyphCount - glyphIndexInRange + LIVE_REVEAL_LEAD, 0, 1)

  out.wordDurationMs = wordDurationMs
  out.glyphCount = glyphCount
  out.glyphIndexInRange = glyphIndexInRange
  out.wordStartTimeMs = word.startTimeMs
  out.glyphStartTimeMs = glyphStartTimeMs
  out.glyphEndTimeMs = glyphEndTimeMs
  out.glyphDurationMs = glyphDurationMs
  out.glyphProgress = glyphProgress
  out.easedGlyphProgress = easeOutCubic(glyphProgress)
  out.glyphTrailStartMs = glyphStartTimeMs + glyphDurationMs * LIVE_GLYPH_TRAIL_START_RATIO
  out.colorTrailProgress = Math.pow(
    resolveVisualProgressWithCutoff(
      out.glyphTrailStartMs,
      colorTrailDurationMs,
      timeMs,
      linePassCutoffTimeMs
    ),
    LIVE_COLOR_TRAIL_EXPONENT
  )

  return out
}

/** 造一个空的揭示量容器（调用方复用一个实例，见文件头） */
export function createFumeGraphemeReveal(): FumeGraphemeReveal {
  return {
    wordDurationMs: 0,
    glyphCount: 1,
    glyphIndexInRange: 0,
    wordStartTimeMs: 0,
    glyphStartTimeMs: 0,
    glyphEndTimeMs: 0,
    glyphDurationMs: MIN_VISUAL_PROGRESS_DURATION_MS,
    glyphProgress: 0,
    easedGlyphProgress: 0,
    glyphTrailStartMs: 0,
    colorTrailProgress: 0
  }
}

// ───────────────────────── §10.4c 逐字素样式 ─────────────────────────

/** 一个字素最终要设给 canvas 的四个样式量 */
export interface FumeLiveGraphemeStyle {
  alpha: number
  fillStyle: string
  /** 阴影半径（px，**未量化**；量化由绘制层统一做） */
  shadowBlur: number
  shadowColor: string
}

/**
 * 逐字素样式的输入。
 *
 * ⚠️ 调用方**复用一个实例**并逐字段改写（§16.2）：这些量每个字素都不同，
 * 但每个字素都新建一个对象就是一帧上千个短命对象。
 */
export interface FumeLiveGraphemeStyleInput {
  timeMs: number
  /** 主字色（只取这一个字段，不把整个主题拖进本层） */
  primaryColor: string
  /** 该字素的词区间揭示量；`null` = 不属于任何词（只用基础 alpha） */
  reveal: FumeGraphemeReveal | null
  /** 该字素着色区间对应的活动色（`getActiveColor` 的结果） */
  activeColor: string
  isPrinted: boolean
  isFrontier: boolean
  /** 唱过文字的辉光基量（§8.1） */
  passedGlowBase: number
  /** 正在打印时的辉光倍率（§8.1） */
  activeGlowBoost: number
}

/** 还没打印到的字素的 alpha（§10.4c）：比 waiting 亮一点，标出「下一个就是它」 */
const FRONTIER_ALPHA = 0.82

/** 造一个空的样式容器（调用方复用一个实例，见文件头） */
export function createFumeLiveGraphemeStyle(): FumeLiveGraphemeStyle {
  return { alpha: 0, fillStyle: '', shadowBlur: 0, shadowColor: 'transparent' }
}

/**
 * 算出一个字素的绘制样式（§10.4c）。
 *
 * ## 四分支（上游写四个，这里合并成三个）
 *
 * 上游的「已过行截止」与「颜色拖尾」两个分支**公式逐字相同**，只有触发条件不同
 * （前者是整行的窗口结束了，后者是这个字的拖尾走完了）。合并成一条
 * `hasPassCutoffReached || time > glyphTrailStart` 不改变任何取值 —— 但要注意
 * 判据顺序**不能**换：截止优先，否则「行已经翻页」时字会退回去走正在打印的分支，
 * 表现为翻页瞬间整行突然亮一下。
 *
 * 剩余两条是「词还没开始」（等主色，不发光）与「正在打印」（从主色混向活动色，
 * 辉光随进度长出来）。正在打印的混色起点是 0.22 而不是 0：直接从主色起步会让
 * 字在打印的第一帧几乎看不见。
 */
export function resolveLiveGraphemeStyle(
  out: FumeLiveGraphemeStyle,
  block: Pick<FumeBlock, 'fontPx'>,
  timing: FumeBlockTiming,
  input: FumeLiveGraphemeStyleInput
): FumeLiveGraphemeStyle {
  const { primaryColor, reveal } = input

  out.alpha = input.isPrinted
    ? timing.activeOpacity
    : input.isFrontier
      ? FRONTIER_ALPHA
      : timing.waitingOpacity
  out.shadowBlur = 0
  out.shadowColor = 'transparent'
  out.fillStyle = colorWithAlpha(primaryColor, out.alpha)

  if (!reveal) return out

  const passedStyle = timing.transitionPassedStyle

  if (timing.hasPassCutoffReached || input.timeMs > reveal.glyphTrailStartMs) {
    const trail = reveal.colorTrailProgress
    out.alpha = mix(timing.activeOpacity, passedStyle.opacity, trail)
    out.fillStyle = mixColors(input.activeColor, primaryColor, 0.18 + trail * 0.82, out.alpha)
    out.shadowBlur =
      (2 + block.fontPx * 0.1) *
      (1 - trail * 0.35) *
      input.passedGlowBase *
      passedStyle.glowMultiplier
    out.shadowColor = colorWithAlpha(
      mixColors(input.activeColor, primaryColor, 0.55 + trail * 0.45),
      passedStyle.shadowAlphaBase + (1 - trail) * passedStyle.shadowAlphaTrail
    )
    return out
  }

  if (input.timeMs < reveal.wordStartTimeMs) {
    out.alpha = timing.waitingOpacity
    out.fillStyle = colorWithAlpha(primaryColor, out.alpha)
    return out
  }

  const eased = reveal.easedGlyphProgress
  out.alpha = mix(timing.waitingOpacity, timing.activeOpacity, eased)
  out.fillStyle = mixColors(primaryColor, input.activeColor, 0.22 + eased * 0.78, out.alpha)
  out.shadowBlur = (4 + block.fontPx * 0.22) * eased * input.activeGlowBoost
  out.shadowColor = colorWithAlpha(input.activeColor, 0.4 + eased * 0.44)

  return out
}

// ───────────────────────── §10.5 打印印章 ─────────────────────────

/** 打印印章的绘制参数（`x` / `y` 已是 `fillRect` 的左上角） */
export interface FumePrintStamp {
  /** `fillRect` 的 x（上游算的是中心，这里已经减掉半宽，省得每个字素再算一次） */
  x: number
  /** `fillRect` 的 y（同上） */
  y: number
  width: number
  height: number
  fillStyle: string
  /** 印章的辉光半径（**不量化**：方块不是字形，不参与字形 strike 缓存） */
  shadowBlur: number
  shadowColor: string
}

/**
 * 打印印章的输入（同样由调用方复用，见 §16.2）。
 *
 * `anchorX` / `anchorY` 是**字素左边界与基线**的世界坐标：印章以字素为锚点，
 * 而字素的横向位置要用实测推进量（`resolveSegmentGlyphOffset`）算，不能用字宽均分。
 */
export interface FumePrintStampInput {
  timeMs: number
  /** 字素本身：CJK 与拉丁的字面宽度不同，决定方块的最小宽度 */
  grapheme: string
  /** 该字素的实测推进量（`resolveSegmentGlyphAdvance`） */
  glyphAdvance: number
  anchorX: number
  anchorY: number
  activeColor: string
  activeGlowBoost: number
  reveal: FumeGraphemeReveal
}

/** 印章窗口的最小时长（§10.5 的 0.04 秒）：字素再快也要看得见方块落下 */
const STAMP_MIN_GLYPH_WINDOW_MS = 40
/** 提前量的下限（§10.5 的 0.055 秒） */
const STAMP_MIN_LEAD_MS = 55
/** 提前量的上限：hero 0.2 秒 / body 0.16 秒（§10.5） */
const STAMP_MAX_LEAD_MS = { hero: 200, body: 160 } as const

/** 造一个空的印章容器（调用方复用一个实例，见文件头） */
export function createFumePrintStamp(): FumePrintStamp {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    fillStyle: 'transparent',
    shadowBlur: 0,
    shadowColor: 'transparent'
  }
}

/**
 * 算一个字的打印印章（§10.5）。返回 `true` 表示这一帧要画。
 *
 * 调用方负责「只在 `showPrintStamp` 为真、且字素不是空白时」调它 ——
 * 那两条是绘制策略，不是几何。
 *
 * ## 视觉含义
 *
 * 每个字被「打印」出来之前，有一个实心方块**从上方落下**再淡出 —— 像活字印刷的印模。
 * 所以时间轴被切成两段：
 *
 * | 段 | 判据 | 方块 |
 * | --- | --- | --- |
 * | 落下 | `trailPhase <= 0`（还没到拖尾起点） | 位置从上方 `dropDistance` 归零，同时从 0.18 涨到 1 倍不透明度 |
 * | 淡出 | 之后 | 位置固定在基线上方，不透明度按 `(1 - fade)^1.2` 退掉 |
 *
 * 只在 `0 < stampProgress < 1` 时画：等于 0 是还没进窗口（画了会提前露馅），
 * 等于 1 是窗口已过（方块该消失了，再画就会在字上留一块彩色）。
 *
 * ## 为什么方块不量化模糊半径
 *
 * §16 的整像素量化是为了字形 strike 缓存；印章是 `fillRect`，不经过字形缓存，
 * 量化它只会让光晕一跳一跳。
 */
export function resolvePrintStamp(
  out: FumePrintStamp,
  block: Pick<FumeBlock, 'variant' | 'fontPx' | 'lineHeight'>,
  timing: FumeBlockTiming,
  input: FumePrintStampInput
): boolean {
  const isHero = block.variant === 'hero'
  const reveal = input.reveal

  // 字素窗口时长：词内均分的窗口，地板 40ms（快歌里方块不能一闪就没）
  const glyphWindowMs = Math.max(
    reveal.wordDurationMs / reveal.glyphCount,
    STAMP_MIN_GLYPH_WINDOW_MS
  )
  // 提前量同时受「字素窗口的 86%」与「行时长的 16%」约束：前者保证方块不会跨到上一个字，
  // 后者保证长行不会让方块提前太久出现
  const leadMs = clamp(
    Math.min(glyphWindowMs * 0.86, timing.lineDurationMs * 0.16),
    STAMP_MIN_LEAD_MS,
    STAMP_MAX_LEAD_MS[isHero ? 'hero' : 'body']
  )
  const releaseMs = leadMs * 0.42
  const windowStartMs = reveal.glyphTrailStartMs - leadMs
  const windowEndMs = reveal.glyphTrailStartMs + releaseMs

  const stampProgress = resolveVisualProgressWithCutoff(
    windowStartMs,
    windowEndMs - windowStartMs,
    input.timeMs,
    timing.linePassCutoffTimeMs
  )
  if (stampProgress <= 0 || stampProgress >= 1) return false

  const trailPhase = resolveVisualProgressWithCutoff(
    reveal.glyphTrailStartMs,
    Math.max(windowEndMs - reveal.glyphTrailStartMs, MIN_VISUAL_PROGRESS_DURATION_MS),
    input.timeMs,
    timing.linePassCutoffTimeMs
  )
  const isDropping = trailPhase <= 0
  const dropProgress = isDropping
    ? easeOutCubic(
        resolveVisualProgressWithCutoff(
          windowStartMs,
          Math.max(reveal.glyphTrailStartMs - windowStartMs, MIN_VISUAL_PROGRESS_DURATION_MS),
          input.timeMs,
          timing.linePassCutoffTimeMs
        )
      )
    : 1
  const fadeProgress = isDropping ? 0 : easeInOutCubic(trailPhase)
  const blockPulse = isDropping
    ? mix(0.18, 1, Math.pow(dropProgress, 0.78))
    : Math.pow(1 - fadeProgress, 1.2)

  // 方块至少和字一样宽：拉丁字母很窄，只按推进量算会让方块看起来像个点
  const glyphVisualWidth = Math.max(
    input.glyphAdvance * 0.88,
    isCjk(input.grapheme) ? block.fontPx * 0.56 : block.fontPx * 0.38
  )
  const dropDistance = block.lineHeight * (isHero ? 0.24 : 0.2)
  const width = glyphVisualWidth + block.fontPx * (isHero ? 0.18 : 0.12)
  const height = block.fontPx * (isHero ? 0.72 : 0.62)
  const centerY = input.anchorY - block.fontPx * 0.38 - mix(dropDistance, 0, dropProgress)

  out.x = input.anchorX + input.glyphAdvance * 0.5 - width * 0.5
  out.y = centerY - height * 0.5
  out.width = width
  out.height = height
  out.fillStyle = colorWithAlpha(input.activeColor, blockPulse * (isHero ? 0.82 : 0.72))
  out.shadowBlur = (8 + block.fontPx * 0.24) * blockPulse * input.activeGlowBoost
  out.shadowColor = colorWithAlpha(input.activeColor, 0.56 * blockPulse)

  // 宽度为 0 时 fillRect 什么都不画，但已经算出的阴影会留在 context 上 —— 直接不画
  return out.width > 0
}
