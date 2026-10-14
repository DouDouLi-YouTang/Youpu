/**
 * 文字样式（移植规格书 §6）：唱过样式、渐隐量、渐隐总时长、活动字色。
 *
 * 这一层**不依赖渲染器** —— 它只回答「这一行唱完之后，字应该以什么样子的参数画出来」。
 * 两个消费方：§8.3 的区块时序（拿样式算快照参数）、§10.4 的逐字素绘制（拿字色画渐变）。
 *
 * ## 单位
 *
 * 上游是**秒**，本项目契约是**毫秒**。规格书 §6 里唯一带单位的常量是
 * `clamp(8 * textHoldRatio, 2.4, 130)`（秒），这里乘 1000 变成
 * `clamp(8000 * ratio, 2400, 130000)` 并写进具名常量，函数体内不再出现秒制数字。
 *
 * ## 本项目的形态：唱过的字永不淡出
 *
 * 浮名在本项目**没有设置面板**（见 `skins/types.ts` 的 `hasSettings`），
 * `textHoldRatio` 恒为默认值 1 → `effectiveTextHoldStyle` 恒为 `'standard'`。
 * 于是 §6.2 的 dim 与 §8.4 的双快照交叉淡出在正常路径下**走不到**。
 *
 * 但这两块实现仍然保留，理由有两条：
 * 1. §8.4 的 `resolveFumeStaticLayers` 只有在 dim 分支上才需要第二个快照 ——
 *    删掉它，将来一接设置面板就要重写整条快照链路；
 * 2. 单测要能覆盖 `dimmed` 分支（0.11 / 0.075 这两个数字很容易被打错一位）。
 */

import { resolveWordColor } from '../../shared/word-coloring'
import { getLineRenderEndTimeMs, type RenderHintLineLike } from '../../shared/render-hints'
import { clamp, easeInCubic } from './fume-math'
import type { FumeBlockVariant, FumeTheme } from './fume-types'

/** 唱过文字的保留档：`standard` = 一直留在纸上；`dimmed` = 逐渐退成纸痕 */
export type FumeTextHoldStyle = 'standard' | 'dimmed'

/** 唱过文字的绘制参数（§6.1 的返回值） */
export interface FumePassedTextStyle {
  /** 字色 alpha 倍率（乘进 `colorWithAlpha(primaryColor, …)`） */
  opacity: number
  /** 辉光倍率：`dimmed` 时为 0（纸痕不发光） */
  glowMultiplier: number
  /** 主投影 alpha（`shadowColor` 用） */
  shadowAlphaBase: number
  /** 拖尾投影 alpha（§10.4 的颜色拖尾用） */
  shadowAlphaTrail: number
}

/** 无行可算时的兜底渐隐时长（§6.3 的 `clamp(8 * ratio, 2.4, 130)` 秒 → 毫秒） */
const FALLBACK_FADE_BASE_MS = 8000
/** 渐隐时长下限（2.4 秒） */
const MIN_PASSED_FADE_DURATION_MS = 2400
/** 渐隐时长上限（130 秒） */
const MAX_PASSED_FADE_DURATION_MS = 130_000

/**
 * 渐隐时长的单条缓存（上游就是一个模块级变量，不是 Map）。
 *
 * 为什么只缓存一条就够：调用处每帧问一次，参数在一首歌里除了切歌之外不变 ——
 * 单条缓存命中率接近 100%，用 Map 只是多一层哈希。
 * 为什么缓存键要含整首歌的时间线：切歌 / 改词会让总时长变化，键一变自然重算，
 * 不需要任何失效通知。
 */
let lastPassedFadeDurationCache: { key: string; durationMs: number } | null = null

/**
 * 唱过文字的样式（§6.1）。
 *
 * `dimmed` 的两个数字（hero 0.11 / body 0.075）比 `standard`（0.74 / 0.58）小一个量级：
 * 纸痕要「看得见是字，但读不出内容」。它们**不是**乘出来的关系，
 * 不要试图用系数从 standard 推。
 */
export function resolvePassedTextStyle(
  variant: FumeBlockVariant,
  textHoldStyle: FumeTextHoldStyle
): FumePassedTextStyle {
  if (textHoldStyle === 'dimmed') {
    return {
      opacity: variant === 'hero' ? 0.11 : 0.075,
      glowMultiplier: 0,
      shadowAlphaBase: 0,
      shadowAlphaTrail: 0
    }
  }

  return {
    opacity: variant === 'hero' ? 0.74 : 0.58,
    glowMultiplier: 1,
    shadowAlphaBase: 0.1,
    shadowAlphaTrail: 0.16
  }
}

/**
 * 渐隐量（§6.2）：0 = 还是正常样式，1 = 完全变成纸痕。
 *
 * **任何非有限输入都返回 1**（立刻完全 dim）。这条规则不是防御性编程，而是必需：
 * `resolveFumePassedFadeDuration` 在 `textHoldRatio >= 1` 时返回 `+Infinity`，
 * 而 `passedAge / Infinity = 0` → `easeInCubic(0) = 0` 会得到「一点都不 dim」——
 * 恰好与 `standard` 档的语义重复，但会让上游那套「`>= 1` 就用 standard」的短路逻辑
 * 变成死代码。返回 1 让两条路径都收敛到同一个可见结果。
 *
 * 用 `easeInCubic`（不是线性）：纸痕是「很久以后才突然明显」的 —— 前 30% 的时长里
 * 几乎看不出变化，最后一段迅速退掉，读起来才不会像「字在慢慢消失」。
 */
export function resolvePassedDimAmount(
  currentTimeMs: number,
  passedAtMs: number,
  fadeDurationMs: number
): number {
  if (
    !Number.isFinite(currentTimeMs) ||
    !Number.isFinite(passedAtMs) ||
    !Number.isFinite(fadeDurationMs) ||
    fadeDurationMs <= 0
  ) {
    return 1
  }

  const passedAge = Math.max(currentTimeMs - passedAtMs, 0)
  return easeInCubic(clamp(passedAge / fadeDurationMs, 0, 1))
}

/**
 * 整首歌的「唱过文字渐隐总时长」（§6.3）。
 *
 * 语义：从**第一行开始唱**到**最后一行渲染结束**这段跨度，按 `textHoldRatio` 缩放，
 * 于是「一张纸上的字全部退干净」的节奏跟整首歌的长度成比例 ——
 * 短歌退得快、长歌退得慢，而不是固定 30 秒。
 *
 * 三条规则：
 * 1. `textHoldRatio >= 1` → `+Infinity`：本项目恒走这条（永不淡出）；
 * 2. 可用的行**少于 2**（含 0 行）→ `clamp(8000 * ratio, 2400, 130000)`：
 *    没有跨度可缩放时给一个 8 秒的基准；
 * 3. 其余 → `clamp(总跨度 * ratio, 2400, 130000)`。
 *
 * 过滤条件是**三重**的（有限、`end >= start`）：歌词数据里偶见 `endTime` 缺失
 * 或乱序，一条 `NaN` 进来会让 `Math.max` 整体变成 `NaN`，渐隐就再也不动了。
 * 排序是为了「第一个 / 最后一个」稳定 —— 上游也是先排序再取首尾，不能省。
 */
export function resolveFumePassedFadeDurationMs(
  lines: readonly RenderHintLineLike[],
  textHoldRatio: number
): number {
  if (textHoldRatio >= 1) {
    return Number.POSITIVE_INFINITY
  }

  const timedLines = lines
    .map((line) => ({
      startTimeMs: line.startTimeMs,
      endTimeMs: getLineRenderEndTimeMs(line)
    }))
    .filter(
      (line) =>
        Number.isFinite(line.startTimeMs) &&
        Number.isFinite(line.endTimeMs) &&
        line.endTimeMs >= line.startTimeMs
    )
    .sort((left, right) => left.startTimeMs - right.startTimeMs)

  // 缓存键含整条时间线 + ratio：上游用的是「秒 + toFixed(3)」，这里换成毫秒口径
  // （数值上等于秒 ×1000，精度反而更细），键的**结构**保持一致。
  const cacheKey = `${timedLines
    .map((line) => `${line.startTimeMs.toFixed(3)}:${line.endTimeMs.toFixed(3)}`)
    .join('|')}:${textHoldRatio.toFixed(3)}`

  if (lastPassedFadeDurationCache?.key === cacheKey) {
    return lastPassedFadeDurationCache.durationMs
  }

  const durationMs =
    timedLines.length <= 1
      ? clamp(
          FALLBACK_FADE_BASE_MS * textHoldRatio,
          MIN_PASSED_FADE_DURATION_MS,
          MAX_PASSED_FADE_DURATION_MS
        )
      : clamp(
          Math.max(timedLines[timedLines.length - 1].endTimeMs - timedLines[0].startTimeMs, 0) *
            textHoldRatio,
          MIN_PASSED_FADE_DURATION_MS,
          MAX_PASSED_FADE_DURATION_MS
        )

  lastPassedFadeDurationCache = { key: cacheKey, durationMs }
  return durationMs
}

/**
 * 一个词在「活动状态」下该用的颜色（§6.4）。
 *
 * 关键差异：浮名用 `bidirectional-contains`（互含），而默认口径是 `target-contains-token`
 * （配置项包含词）。默认口径会漏掉「词比配置项长」的场景，例如配置写「零れ落ち」、
 * 词是「零れ落ちて」—— 浮名的逐字素上色要求这种也命中，否则关键词在长词里会漏掉。
 *
 * 本项目没有主题级 `wordColors`（沉浸设置里没有这个入口），所以实际上总是回退到
 * `theme.accentColor`。保留这条调用链是为了让「词色从哪来」只有一个答案。
 */
export function getActiveColor(wordText: string, theme: FumeTheme): string {
  return resolveWordColor(wordText, theme.wordColors, theme.accentColor, {
    cjkMatchMode: 'bidirectional-contains'
  })
}
