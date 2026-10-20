/**
 * 「浮名」实时逐字素绘制（移植规格书 §10.4 与 §10.5）。
 *
 * ## 与 `canvas-text.ts` 的分工
 *
 * `canvas-text.ts` 管**静态**那一半（字体串、快照、裁剪运行），本文件管**每帧都在变**
 * 的那一半：整行辉光 → 逐片段逐字素的样式与 run 合并 → 打印印章。
 * 拆成两个文件是因为静态那半已经 400 多行，再塞进实时绘制就没人能一眼看完 ——
 * 而这两半的验证方式也不同（静态靠几何断言，实时靠调用序列断言）。
 *
 * ## 前置：变换已经是「世界坐标 → 设备像素」
 *
 * 调用方（stage，§11.3）在调本函数前已经 `translate(视口中心) → scale → translate(-相机)`。
 * 所以本函数内部**只算世界坐标**，一行 `setTransform` 都没有；也正因如此，
 * 本文件里所有 `fillText` / `fillRect` 的坐标都能直接和区块的 `x`/`y` 相加。
 *
 * ## 每帧零分配（§16.2）
 *
 * 本函数每个字素都要算一组样式，一帧几百上千次。上游用「局部变量 + 每次现包的
 * `flushRun` 闭包」实现，在 60fps 下每秒会产生几千个短命函数与对象 —— 那是 GC 抖动
 * 的直接来源。本项目改成：
 *
 * 1. 所有中间结果写进**模块级复用的容器**（`resolveLive*` 系列的 `out` 参数）；
 * 2. `flushRun` 提成模块级函数，run 状态放在模块级对象里。
 *
 * 前提是本函数**不会被重入**（同一时刻只有一个区块在画），这一点由 stage 的单循环保证。
 * 唯一的例外是 `renderLine.graphemes.slice(...).join('')`：`fillText` 要的是字符串，
 * 这个分配无法避免，上游同样如此。
 *
 * ## 两条红线（§11.3）
 *
 * 1. **不碰 `globalCompositeOperation`** —— 浮名的叠加完全靠 `globalAlpha` 与
 *    `shadowBlur`/`filter` 表达，改合成模式会让下面的背景层跟着变形；
 * 2. **不改裁剪区之外的 context 状态** —— 进出各一次 `save`/`restore`，
 *    中间每次 `fillGlowText` / `drawRenderTextRun` 自己也成对保存。
 */

import {
  clearCanvasTextGlow,
  fillGlowText,
  quantizeShadowBlur,
  setCanvasTextGlow
} from '../../shared/glow-blur-quantize'
import { resolvePrintedGraphemeCount } from '../core/fume-reveal'
import { getActiveColor } from '../core/text-style'
import { resolveSegmentGlyphAdvance } from '../core/text-measure-pure'
import {
  FUME_TEXT_ALIGN,
  FUME_TEXT_BASELINE,
  buildTextStyleKey,
  drawRenderTextRun,
  resolveFumeFontSpec
} from './canvas-text'
import {
  LIVE_MIN_VISIBLE_ALPHA,
  createFumeGraphemeReveal,
  createFumeLiveGraphemeStyle,
  createFumeLiveLineGlow,
  createFumePrintStamp,
  resolveLiveGraphemeReveal,
  resolveLiveGraphemeStyle,
  resolveLiveLineGlow,
  resolvePrintStamp,
  type FumeLiveGraphemeStyleInput
} from './live-style'
import type { FumeBlockTiming } from '../core/block-frame'
import type {
  FumeBlock,
  FumeRenderLineSlice,
  FumeRenderSegmentSlice,
  FumeTheme
} from '../core/fume-types'

/** `drawFumeLiveBlock` 的每帧参数（上游是同名对象；`time` 在本项目里叫 `timeMs`） */
export interface FumeLiveBlockParams {
  /** 播放时间（毫秒） */
  timeMs: number
  theme: FumeTheme
  /** 辉光强度（§14.1 的 `glowIntensity`） */
  glowIntensity: number
  /** 正在打印时的辉光倍率（§8.1） */
  activeGlowBoost: number
  /** 唱过文字的辉光基量（§8.1） */
  passedGlowBase: number
  /** 是否画打印印章（§10.5；关闭后只剩文字，帧率更稳） */
  showPrintStamp: boolean
}

/** 一次「样式相同的连续字素」的运行状态（run 合并的记账本，见文件头第 2 条） */
interface FumeLiveRunState {
  /** 行内起始字素下标；`-1` = 当前没有运行中的 run */
  start: number
  fillStyle: string
  shadowBlur: number
  shadowColor: string
  styleKey: string
}

// ── 模块级复用容器：本函数不重入，见文件头「每帧零分配」 ──────────────────
const scratchLineGlow = createFumeLiveLineGlow()
const scratchReveal = createFumeGraphemeReveal()
const scratchStyle = createFumeLiveGraphemeStyle()
const scratchStamp = createFumePrintStamp()
const scratchStyleInput: FumeLiveGraphemeStyleInput = {
  timeMs: 0,
  primaryColor: '',
  reveal: null,
  activeColor: '',
  isPrinted: false,
  isFrontier: false,
  passedGlowBase: 0,
  activeGlowBoost: 0
}
const scratchStampInput = {
  timeMs: 0,
  grapheme: '',
  glyphAdvance: 0,
  anchorX: 0,
  anchorY: 0,
  activeColor: '',
  activeGlowBoost: 0,
  reveal: scratchReveal
}
const runState: FumeLiveRunState = {
  start: -1,
  fillStyle: '',
  shadowBlur: 0,
  shadowColor: 'transparent',
  styleKey: ''
}

/**
 * 收尾一个 run：把攒下的字素一次性画出来（§10.4c 的 `flushRun`）。
 *
 * **合并 run 是这一层帧率的主要来源**：稳定状态下相邻字素的 `fillStyle` /
 * `shadowBlur` / `shadowColor` 完全相同，合并后「一字一次绘制」退化成「一串字一次绘制」。
 * 判据用 {@link buildTextStyleKey} 而不是逐字段比较：三个量里 `shadowBlur` 是浮点，
 * 逐字段比较既啰嗦又容易漏掉一处。
 *
 * 早退的两个条件都不能省：
 * - `start < 0`：本段一个可见字素都没有（整段都是空白或全被跳过）；
 * - `runText` 为空或**全空白且没有字色**：空白字素画不出东西，但 `setCanvasTextGlow`
 *   会留下阴影状态，等于给后面的绘制白加一层光。
 */
function flushLiveRun(
  context: CanvasRenderingContext2D,
  renderLine: FumeRenderLineSlice,
  segment: FumeRenderSegmentSlice,
  segmentEnd: number,
  baseX: number,
  baseY: number
): void {
  if (runState.start < 0 || !runState.styleKey || segmentEnd <= runState.start) return

  const localStart = runState.start - renderLine.start
  const localEnd = segmentEnd - renderLine.start
  const runText = renderLine.graphemes.slice(localStart, localEnd).join('')

  if (!runText || (runText.trim().length === 0 && runState.fillStyle === '')) {
    runState.start = -1
    runState.styleKey = ''
    return
  }

  context.fillStyle = runState.fillStyle
  setCanvasTextGlow(context, runState.shadowBlur, runState.shadowColor)
  drawRenderTextRun(context, renderLine, segment, localStart, localEnd, baseX, baseY)
  clearCanvasTextGlow(context)

  runState.start = -1
  runState.styleKey = ''
}

/**
 * 画一个正在打印 / 刚唱过的区块（§10.4）。
 *
 * 三个阶段严格按序，顺序换了都会有肉眼可见的差别：
 *
 * 1. **整行辉光**（§10.4b）：整行一个颜色（`accentColor`），只在行活跃窗口内画；
 *    它画在正文**下面**，所以先画 —— 后画会把字压暗；
 * 2. **逐片段逐字素**（§10.4c）：每个字素按自己的词区间算揭示进度与颜色；
 * 3. **打印印章**（§10.5）：方块压在字上，所以必须最后画。
 *
 * 注意第 3 步在**每个字素的循环内部**（每个字的窗口不同），不是整行画一次。
 */
export function drawFumeLiveBlock(
  context: CanvasRenderingContext2D,
  block: FumeBlock,
  timing: FumeBlockTiming,
  params: FumeLiveBlockParams
): void {
  const { timeMs, theme } = params
  const primaryColor = theme.primaryColor
  const printedCount = resolvePrintedGraphemeCount(
    block.line,
    block.wordRanges,
    block.graphemes.length,
    timeMs
  )
  const totalGraphemeCount = block.graphemes.length

  context.save()
  context.font = resolveFumeFontSpec(block, theme)
  context.textAlign = FUME_TEXT_ALIGN
  context.textBaseline = FUME_TEXT_BASELINE

  // ── ① 整行辉光（§10.4b）：只有这一行是「活的」时候才画 ──────────────────
  if (timeMs >= block.line.startTimeMs && timeMs <= timing.linePassCutoffTimeMs) {
    const glow = resolveLiveLineGlow(
      scratchLineGlow,
      block,
      timing,
      timeMs,
      params.glowIntensity,
      theme.accentColor
    )

    context.save()
    context.fillStyle = glow.fillStyle
    setCanvasTextGlow(context, quantizeShadowBlur(glow.blur), glow.shadowColor)

    for (const renderLine of block.renderLines) {
      const glowBaseX = block.x + renderLine.left
      const glowBaseY = block.y + renderLine.top + timing.baselineOffset

      for (const segment of renderLine.segments) {
        // 纯空白段没有字形，画了只是白设一次 filter（§10.4b 的判据）
        if (segment.text.trim().length === 0) continue
        fillGlowText(context, segment.text, glowBaseX + segment.x, glowBaseY)
      }
    }

    // restore 会连 fillStyle 与 shadow/filter 一起复位（filter 也是 canvas 状态的一部分），
    // 所以这里不需要再手动 clearCanvasTextGlow
    context.restore()
  }

  // ── ② 逐片段逐字素（§10.4c） ─────────────────────────────────────────
  for (const renderLine of block.renderLines) {
    const baseX = block.x + renderLine.left
    const baseY = block.y + renderLine.top + timing.baselineOffset

    for (const segment of renderLine.segments) {
      runState.start = -1
      runState.styleKey = ''

      for (let globalOffset = segment.start; globalOffset < segment.end; globalOffset += 1) {
        const grapheme = renderLine.graphemes[globalOffset - renderLine.start] ?? ''
        const rangeIndex = block.wordRangeIndexByOffset[globalOffset] ?? -1
        const range = rangeIndex >= 0 ? (block.wordRanges[rangeIndex] ?? null) : null
        const colorRangeIndex = block.colorRangeIndexByOffset[globalOffset] ?? -1
        const colorRange =
          colorRangeIndex >= 0 ? (block.wordRanges[colorRangeIndex] ?? range) : range

        const isPrinted = timing.hasRevealCompleted || globalOffset < printedCount
        // 「前沿」= 下一个即将打印的字：比等待态亮一点，让眼睛有落点
        const isFrontier =
          printedCount > 0 &&
          globalOffset === printedCount &&
          printedCount < totalGraphemeCount &&
          !timing.hasRevealCompleted &&
          !timing.hasPassCutoffReached

        // 揭示量只在有词区间时才算：没有词区间的字素没有时间可依附，
        // 上游同样是「range 存在才进这个分支」
        const reveal = range
          ? resolveLiveGraphemeReveal(
              scratchReveal,
              range,
              globalOffset,
              timeMs,
              timing.colorTrailDurationMs,
              timing.linePassCutoffTimeMs
            )
          : null
        const activeColor = range ? getActiveColor((colorRange ?? range).word.text, theme) : ''

        scratchStyleInput.timeMs = timeMs
        scratchStyleInput.primaryColor = primaryColor
        scratchStyleInput.reveal = reveal
        scratchStyleInput.activeColor = activeColor
        scratchStyleInput.isPrinted = isPrinted
        scratchStyleInput.isFrontier = isFrontier
        scratchStyleInput.passedGlowBase = params.passedGlowBase
        scratchStyleInput.activeGlowBoost = params.activeGlowBoost
        const style = resolveLiveGraphemeStyle(scratchStyle, block, timing, scratchStyleInput)

        // ③ 打印印章（§10.5）。⚠️ 位置刻意在「本字素的 run 收尾之前」：
        // 上游就是这样排的，于是印模先落在纸上，紧接着这个字的 run 才盖上去 ——
        // 视觉上才是「印模落下 → 字浮现」。反过来先写字再画方块，方块会糊在字面上。
        if (params.showPrintStamp && reveal && grapheme.trim().length > 0) {
          scratchStampInput.timeMs = timeMs
          scratchStampInput.grapheme = grapheme
          scratchStampInput.glyphAdvance = resolveSegmentGlyphAdvance(segment, globalOffset)
          scratchStampInput.anchorX = baseX + segment.x
          scratchStampInput.anchorY = baseY
          scratchStampInput.activeColor = activeColor
          scratchStampInput.activeGlowBoost = params.activeGlowBoost

          if (resolvePrintStamp(scratchStamp, block, timing, scratchStampInput)) {
            // 印章自带一层辉光，画完必须复位 —— 否则会跟着后面的字一起发光
            context.save()
            context.fillStyle = scratchStamp.fillStyle
            context.shadowBlur = scratchStamp.shadowBlur
            context.shadowColor = scratchStamp.shadowColor
            context.fillRect(
              scratchStamp.x,
              scratchStamp.y,
              scratchStamp.width,
              scratchStamp.height
            )
            context.restore()
          }
        }

        // 低于可见阈值：结束当前 run 并跳过。**不能**只是 continue ——
        // 那会把不可见的字素并进相邻 run，让这一串字整体带上错误的裁剪范围
        if (style.alpha <= LIVE_MIN_VISIBLE_ALPHA) {
          flushLiveRun(context, renderLine, segment, globalOffset, baseX, baseY)
          continue
        }

        // 整像素量化（§16）：不量化时半径每帧都变，Chromium 会为每个半径铸一个
        // 字形 strike，Linux 上约 35 分钟耗尽软限制
        const shadowBlur = quantizeShadowBlur(style.shadowBlur)
        const styleKey = buildTextStyleKey(style.fillStyle, shadowBlur, style.shadowColor)

        if (runState.start < 0) {
          runState.start = globalOffset
          runState.fillStyle = style.fillStyle
          runState.shadowBlur = shadowBlur
          runState.shadowColor = style.shadowColor
          runState.styleKey = styleKey
          continue
        }

        if (styleKey !== runState.styleKey) {
          flushLiveRun(context, renderLine, segment, globalOffset, baseX, baseY)
          runState.start = globalOffset
          runState.fillStyle = style.fillStyle
          runState.shadowBlur = shadowBlur
          runState.shadowColor = style.shadowColor
          runState.styleKey = styleKey
        }
      }

      flushLiveRun(context, renderLine, segment, segment.end, baseX, baseY)
    }
  }

  context.restore()
}
