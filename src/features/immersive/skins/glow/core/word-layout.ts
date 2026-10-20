/**
 * 「流光」(Folia classic / Luminous) 的**逐词几何** —— 纯函数，可单测。
 *
 * ## 这一层在算什么
 *
 * Folia 的流光把每一行歌词拆成若干「词」，每个词有自己的 x/y 位移、旋转、缩放，
 * 让整行看起来是"散落着浮起来"的。这些数值必须在**同一行的整个生命周期里保持不变**
 * （时间只驱动动画状态，不该改变基础几何），所以全部由一个确定性种子算出来 ——
 * 种子是**行起始时间**（`activeLine.startTime`）。同一句歌词每次播放位置一致，
 * 不同句 / 不同歌各不相同。
 *
 * ## 与 Folia 源码的对应
 *
 * 移植自 `components/visualizer/classic/Visualizer.tsx` 里那个 `useMemo`
 * （原文用 `seed = activeLine.startTime`，逐词 `wordSeed = seed + i`，
 * 再用 `random(offset) = frac(sin(wordSeed + offset) * 10000)` 取随机数）。
 *
 * ⚠️ **种子必须换算成秒**：入参 `lineStartMs` 是毫秒（本项目契约），但喂进 Folia 那两个公式
 * 之前要除以 1000 —— 因为 `sin(seed)` 与 `seed % 5` 都对数值本身敏感，用毫秒当种子会得到
 * 完全不同的随机序列，同一首歌在两边会散成两个样子。换算收敛在本文件内（唯一一处 `/ 1000`），
 * 下游（渲染 / 动画）只见到算好的几何。
 *
 * 真正需要逐字对齐的是**下面那些系数**（0.15 / 0.03 / 1.4 / 0.05…）：它们决定"散多远、
 * 放大多少"，与种子一起构成完整的还原。
 *
 * ## 为什么不用 `seeded-random.ts` 的 `seededRandom`
 *
 * 那个是「倾诉」的随机源（murmur3 双射，为**按索引随机访问**设计）。
 * 流光这里必须用 Folia 自己的 `frac(sin(...))` 公式：系数虽然一样，但**取到的随机数序列**
 * 不同，逐词的位移 / 旋转就会与 Folia 对不上。既然目标是"一模一样"，
 * 就不能换随机源 —— 这一处是刻意的重复，不是疏忽。
 */

/** 动画强度（对应 Folia `Theme['animationIntensity']`） */
export type AnimationIntensity = 'calm' | 'normal' | 'chaotic'

/** 一个词的几何配置（对齐 Folia `WordLayoutConfig`） */
export interface GlowWordConfig {
  /** 稳定的 React/Vue key 用标识（`词-下标-种子`） */
  id: string
  /** 水平位移（px） */
  x: number
  /** 垂直位移（px） */
  y: number
  /** 基础旋转（deg） */
  rotate: number
  /** 基础缩放 */
  scale: number
  /** 右外边距（CSS 长度字符串） */
  marginRight: string
  /** 交叉轴对齐（CSS align-self 值） */
  alignSelf: string
  /** 「唱过」状态的附加旋转（deg） */
  passedRotate: number
}

/** 整行的容器配置（对齐 Folia `LineLayoutConfig`） */
export interface GlowLineConfig {
  /** CSS 类名后缀：justify-* */
  justifyContent: string
  /** CSS 类名后缀：items-* */
  alignItems: string
  /** 透视距离（px） */
  perspective: number
}

/** 插曲行（Folia 用全角点的行）—— 固定居中、放大、不旋转 */
export const INTERLUDE_TEXT = '......'

/** 插曲行缩放 */
const INTERLUDE_SCALE = 1.5
/** 插曲行右外边距 */
const INTERLUDE_MARGIN_RIGHT = '3rem'
/** 插曲行垂直抖动幅度的一半（`(random - 0.5) * 15`） */
const INTERLUDE_Y_SPREAD = 15

/** 「活跃」状态的最大缩放倍数（Folia `glowWordVariants` 的 `config.scale * 1.4`） */
export const ACTIVE_SCALE_MULTIPLIER = 1.4

/** 「等待」状态的基础缩放 */
const WAITING_SCALE = 0.5
/** 「等待」状态的附加旋转（deg） */
const WAITING_ROTATE_OFFSET = 20
/** 「等待」状态的 x/y 附加抖动系数（Folia：x += sin(y)*100，y += cos(x)*50） */
const WAITING_X_SWING = 100
const WAITING_Y_SWING = 50

/** 词间距计算里的固定间隙（`0.05 * pxFontSize`） */
const WORD_GAP_RATIO = 0.05
/** 非混乱强度下的最小间距系数 */
const MIN_MARGIN_RATIO_NORMAL = 0.12
/** 混乱强度下的最小间距系数 */
const MIN_MARGIN_RATIO_CHAOTIC = 0.08
/** 非混乱强度下的固定右外边距 */
const NORMAL_MARGIN_RIGHT = '0.8rem'
/** 混乱强度下右外边距的随机上限（`random * 1.5` rem） */
const CHAOTIC_MARGIN_RIGHT_MAX_REM = 1.5

/** 动画强度 → 散落基准（Folia：chaotic 60 / calm 0 / normal 20） */
function resolveBaseSpread(intensity: AnimationIntensity): number {
  if (intensity === 'chaotic') return 60
  if (intensity === 'calm') return 0
  return 20
}

/** 动画强度 → 旋转基准角（Folia：chaotic 30 / calm 0 / normal 5） */
function resolveBaseRotate(intensity: AnimationIntensity): number {
  if (intensity === 'chaotic') return 30
  if (intensity === 'calm') return 0
  return 5
}

/**
 * Folia 的确定性随机：`frac(sin(n) * 10000)`。
 *
 * 注意 `n` 是 `wordSeed + offset`（种子已含词下标），不是一个独立的下标参数 ——
 * 与 `seeded-random.ts` 的 `seededRandom(seed, index)` 形状不同，别混用。
 */
function randomAt(n: number): number {
  const x = Math.sin(n) * 10000
  return x - Math.floor(x)
}

/** 某一强度下 wordSpacing 的合法范围（Folia：钳到 [0, 2]） */
export function clampWordSpacing(value: number): number {
  if (!Number.isFinite(value)) return 0.7
  return Math.min(2, Math.max(0, value))
}

/** 某一强度下呼吸浮动倍率的合法范围（Folia：钳到 [0, 2]） */
export function clampBreathingFloatMultiplier(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(2, Math.max(0, value))
}

/** 逐词几何的输入 */
export interface BuildWordLayoutInput {
  /** 行起始时间（**毫秒**，本项目契约）—— 内部除以 1000 后才是 Folia 的种子 */
  lineStartMs: number
  /** 逐词文本（已按语义切分，见 `cjk-layout.ts`） */
  words: readonly string[]
  /** 动画强度 */
  intensity: AnimationIntensity
  /** 是否启用逐词旋转（Folia `enableWordRotation`，默认 true） */
  enableWordRotation: boolean
  /** 是否走旧版布局（Folia `useLegacyLayout`，默认 false） */
  useLegacyLayout: boolean
  /** 词间距倍率（Folia `wordSpacing`，默认 0.7） */
  wordSpacing: number
  /** 每个词在**当前视口与字号**下的像素宽度（canvas 测量结果） */
  wordWidths: readonly number[]
  /** 当前视口的像素字号（`clamp(2.25rem, 6vw, 4.5rem)` 的解析值） */
  pxFontSize: number
}

/** 一次布局的完整结果 */
export interface WordLayoutResult {
  line: GlowLineConfig
  words: GlowWordConfig[]
  /** 该行是否是插曲行（全角点）—— 渲染层据此跳过逐词动画 */
  isInterlude: boolean
}

/**
 * 构建一整行的逐词几何。
 *
 * 流程（逐步对齐 Folia）：
 *  1. 容器 just/align 按种子从强度对应的候选里取（calm 只有一个候选，等于固定居中）；
 *  2. 每个词的 `wordSeed = seed + i`，四个独立偏移量由 `random(1..8)` 取；
 *  3. 缩放：chaotic 为 `0.8 + r*0.6`，其余为 `1.1 + r*0.2`；
 *  4. x/y：`(r - 0.5) * baseSpread * 2`；
 *  5. marginRight：旧布局用固定 rem / 随机 rem；新布局按前后两个词的
 *     **半溢出宽度 + 位移差 + 固定间隙** 算精确像素值（避免缩放 / 位移时视觉重叠）；
 *  6. 旋转：启用时 `(r - 0.5) * baseRotate * 2`；
 *  7. alignSelf：仅 chaotic 且 `random(6) > 0.7` 时随机到 flex-start / flex-end。
 *
 * `wordWidths` 只在新布局路径用到；缺项（长度不足）按 0 处理 —— Folia 的 `?? 0` 同理。
 */
export function buildWordLayout(input: BuildWordLayoutInput): WordLayoutResult {
  const {
    lineStartMs,
    words,
    intensity,
    enableWordRotation,
    useLegacyLayout,
    wordSpacing,
    wordWidths,
    pxFontSize
  } = input

  // ⚠️ 秒制种子（见文件头）：Folia 的 `seed = activeLine.startTime` 是秒。
  // 非有限值退回 0，绝不把 NaN 灌进下面任何一个公式。
  const seed = Number.isFinite(lineStartMs) ? lineStartMs / 1000 : 0
  const isChaotic = intensity === 'chaotic'
  const isCalm = intensity === 'calm'

  // 容器：calm 只有一个候选（等于居中）；其余从五个 just / 三个 align 里取
  const justifyOptions = isCalm
    ? ['justify-center']
    : ['justify-start', 'justify-center', 'justify-end', 'justify-around', 'justify-between']
  const alignOptions = isCalm ? ['items-center'] : ['items-start', 'items-center', 'items-end']

  // 该行是否是插曲行（Folia 用整行等于 "......" 判定）
  let fullText = ''
  for (const word of words) fullText += word
  const isInterlude = fullText === INTERLUDE_TEXT

  // `Math.floor(seed % n)`：浮点取模，seed 带小数时结果也带小数（Folia 原样）。
  // 负种子（理论上不该有）会让下标为负，故用 Math.abs 兜底 —— Folia 没有这一步，
  // 但它依赖"时间戳非负"这个前提，本项目在适配层已保证，这里只是防御。
  const justifyIndex = Math.abs(Math.floor(seed % justifyOptions.length))
  const alignIndex = Math.abs(Math.floor((seed * 2) % alignOptions.length))

  const line: GlowLineConfig = {
    justifyContent: isInterlude ? 'justify-center' : justifyOptions[justifyIndex],
    alignItems: alignOptions[alignIndex],
    perspective: isChaotic ? 500 + (seed % 500) : 1000
  }

  const baseSpread = resolveBaseSpread(intensity)
  const baseRotate = resolveBaseRotate(intensity)
  const spacingMultiplier = clampWordSpacing(wordSpacing)

  const configs: GlowWordConfig[] = words.map((word, index) => {
    const wordSeed = seed + index
    const random = (offset: number): number => randomAt(wordSeed + offset)

    if (isInterlude) {
      return {
        id: `${word}-${index}-${seed}`,
        x: 0,
        y: (random(2) - 0.5) * INTERLUDE_Y_SPREAD,
        rotate: 0,
        scale: INTERLUDE_SCALE,
        marginRight: INTERLUDE_MARGIN_RIGHT,
        alignSelf: 'center',
        passedRotate: 0
      }
    }

    const wordConfigScale = isChaotic ? 0.8 + random(4) * 0.6 : 1.1 + random(4) * 0.2
    const xVal = (random(1) - 0.5) * baseSpread * 2
    const yVal = (random(2) - 0.5) * baseSpread * 2

    let marginRight = isChaotic
      ? `${random(5) * CHAOTIC_MARGIN_RIGHT_MAX_REM}rem`
      : NORMAL_MARGIN_RIGHT

    if (!useLegacyLayout) {
      // 精确右边距：把「自身半溢出 + 下一个词半溢出 + 位移差 + 固定间隙」加起来，
      // 再乘词间距倍率。目的是让**最大缩放（active 的 1.4 倍）**时两词不重叠。
      const currentWidth = wordWidths[index] ?? 0
      const currentScaled = wordConfigScale * ACTIVE_SCALE_MULTIPLIER

      let nextWidth = 0
      let nextScaled = 1
      let nextX = 0

      if (index + 1 < words.length) {
        const nextSeed = seed + (index + 1)
        const nextRandom = (offset: number): number => randomAt(nextSeed + offset)
        const nextConfigScale = isChaotic ? 0.8 + nextRandom(4) * 0.6 : 1.1 + nextRandom(4) * 0.2
        nextScaled = nextConfigScale * ACTIVE_SCALE_MULTIPLIER
        nextX = (nextRandom(1) - 0.5) * baseSpread * 2
        nextWidth = wordWidths[index + 1] ?? 0
      }

      const gap = WORD_GAP_RATIO * pxFontSize
      const halfOverflowCurrent = (currentWidth * (currentScaled - 1)) / 2
      const halfOverflowNext = (nextWidth * (nextScaled - 1)) / 2
      const xOffsetDiff = xVal - nextX

      const calculatedMargin =
        (halfOverflowCurrent + halfOverflowNext + xOffsetDiff + gap) * spacingMultiplier
      const minMargin =
        (isChaotic ? MIN_MARGIN_RATIO_CHAOTIC : MIN_MARGIN_RATIO_NORMAL) *
        pxFontSize *
        spacingMultiplier
      const finalMargin = Math.max(minMargin, calculatedMargin)
      // `.toFixed(1)`：Folia 把它写成 CSS 字符串，抹掉浮点尾巴
      marginRight = `${finalMargin.toFixed(1)}px`
    }

    return {
      id: `${word}-${index}-${seed}`,
      x: xVal,
      y: yVal,
      rotate: enableWordRotation ? (random(3) - 0.5) * baseRotate * 2 : 0,
      scale: wordConfigScale,
      marginRight,
      alignSelf:
        isChaotic && random(6) > 0.7 ? (random(7) > 0.5 ? 'flex-start' : 'flex-end') : 'auto',
      passedRotate: enableWordRotation ? (random(8) - 0.5) * 45 : 0
    }
  })

  return { line, words: configs, isInterlude }
}

/** 「等待」状态的位移 / 缩放 / 旋转（渲染层与单测共用同一组公式） */
export function resolveWaitingPose(
  config: Pick<GlowWordConfig, 'x' | 'y' | 'rotate'>,
  enableRotation: boolean
) {
  return {
    opacity: 0,
    scale: WAITING_SCALE,
    x: config.x + Math.sin(config.y) * WAITING_X_SWING,
    y: config.y + Math.cos(config.x) * WAITING_Y_SWING,
    rotate: enableRotation ? config.rotate + WAITING_ROTATE_OFFSET : 0
  }
}

/** 「唱过」状态的不透明度（Folia：chaotic 0.9，其余 0.82） */
export function resolvePassedOpacity(intensity: AnimationIntensity): number {
  return intensity === 'chaotic' ? 0.9 : 0.82
}

/**
 * 整行容器浮动（Folia 的 `lyricContainerFloat`）。
 *
 * 按强度取基准距离与周期，再乘呼吸倍率。`multiplier <= 0` 时返回 null（不浮动）。
 */
export function buildLineFloat(
  intensity: AnimationIntensity,
  breathingMultiplier: number
): { distance: number; duration: number; multiplier: number } | null {
  const multiplier = clampBreathingFloatMultiplier(breathingMultiplier)
  if (multiplier <= 0) return null
  const config = {
    calm: { distance: 10, duration: 8.5 },
    normal: { distance: 14, duration: 7 },
    chaotic: { distance: 18, duration: 5.8 }
  } as const
  const { distance, duration } = config[intensity]
  return { distance: distance * multiplier, duration, multiplier }
}
