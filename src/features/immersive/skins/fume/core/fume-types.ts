/**
 * 「浮名」数据模型（移植规格书 §2）。
 *
 * ⚠️ **本文件只放类型，不放任何运行时逻辑**。这样 core/ 的依赖图根是纯粹的「形状描述」，
 * 上层（layout / camera / stage / render）可以随便 import 而不会拖进副作用。
 *
 * ## 单位约定（与本仓库契约一致，别改成秒）
 *
 * | 类别 | 单位 | 命名 |
 * | --- | --- | --- |
 * | 时间 | **毫秒** | 一律带 `Ms` 后缀：`startTimeMs` / `endTimeMs` / `currentTimeMs` |
 * | 长度 | CSS px（世界坐标 px） | `x` / `y` / `width` / `fontPx` / `lineHeight` |
 * | 角度 | 弧度 | `rotation` |
 * | 速度 | px/s、1/s、弧度/s | `velocityX` / `velocityScale` / `rotationSpeed` |
 * | 比例 | 无量纲 | `opacity` / `progress` 类字段 |
 *
 * 规格书 §2 里的字段是秒制（Folia 的 `currentTime` 就是秒），这里**逐个改名成 `Ms`**
 * 而不是偷偷在算法里除以 1000：换算只发生在适配层一处（与 `tilt/tilt-adapter.ts` 同款做法），
 * core/ 永远只见到毫秒。
 *
 * ## 坐标系
 *
 * 世界坐标系 = **文章纸张坐标**：原点在文章左上角，x 向右、y 向下，单位 px。
 * 屏幕坐标由相机的 `translate(视口中心) → scale → translate(-camera)` 变换得到
 * （规格书 §10.2 / §8.2）。区块的 `x/y` 是**左上角**，背景形状的 `x/y` 是**中心**，
 * 两处口径不同，已在各自字段上注明。
 *
 * ## 与 Folia 的类型差异（有意为之，不是漏搬）
 *
 * 1. **`FumeBlock.line` 用本文件的 `FumeLine`**，不是领域层的 `LyricLine`（§15.2）：
 *    `LyricLine` 没有 `endTime` / `fullText` / `isChorus` / `renderHints`，
 *    core/ 也不该依赖 `@/domain`。这些字段由适配层补齐后喂进来。
 * 2. **背景形状类型放在这里**（Folia 放在 `FumeBackground.ts`）：§15.1 的硬约束是
 *    「core/ 不许 import render/」，而 §2.7 的 stage 契约要引用背景场景。
 *    把形状数据模型留在 core/types 是唯一不破例的落点，`render/background.ts`
 *    只放「怎么生成 / 怎么画」。
 * 3. **`FumeCameraState` 放在这里**（Folia 放在 `fumeCameraStep.ts`）：同理，
 *    stage 契约要引用它，而 types 必须是依赖图的根（§1.2）。
 * 4. **主题只保留本面板真正读的字段**（`FumeTheme`）：Folia 的 `Theme` 还带 AI 主题、
 *    provider、`lyricsIcons` 等。本项目没有 AI 主题，主题色来自逐歌取色；
 *    多搬字段只会让人以为「这里能调」。
 */

import type { LayoutLinesResult, PreparedTextWithSegments } from '@chenglou/pretext'

// ─────────────────────────────── §2.1 基础形状 ───────────────────────────────

/** 舞台（= 沉浸页可视区）尺寸，px。 */
export interface FumeViewportSize {
  width: number
  height: number
}

/** 一个 pretext 段在整块字素数组里占的区间（尾后下标 exclusive）。 */
export interface FumeSegmentMeta {
  /** 该段首字素在整块字素数组中的下标 */
  graphemeStart: number
  /** 尾后下标（exclusive） */
  graphemeEnd: number
  /** `graphemeEnd - graphemeStart` */
  graphemeCount: number
}

// ─────────────────────────── §2.2 行 / 词 / 字素 ───────────────────────────

/** 行级时间信息（词与行共用）。时间单位：**毫秒**。 */
export interface FumeTimedSpan {
  startTimeMs: number
  endTimeMs: number
}

/**
 * 音节（Folia 的 `LyricSyllable`）—— 比词更细的时间粒度，驱动「一个字一个字打印」。
 *
 * ⚠️ 本项目**没有**这个数据（`LyricWord` 只有 `word` / `timeMs` / `durationMs` /
 * `trailing`）。保留类型是为了让 §5.2 的「有音节 / 无音节」两条分支都如实表达，
 * 并在适配层显式退化成无音节路径（§7.11），而不是把上游分支悄悄删掉。
 */
export interface FumeSyllable extends FumeTimedSpan {
  text: string
}

/** 一个词（时间单位：毫秒）。 */
export interface FumeWord extends FumeTimedSpan {
  /** 词文本。可能含前导 / 尾随空格（见 §5.1 的「吞空白」规则） */
  text: string
  /** 音节级时间；不存在时该词按整词均分（§5.2） */
  syllables?: FumeSyllable[]
}

/**
 * 一个字素的时间片（Folia 的 `GraphemeTiming`，时间单位：毫秒）。
 *
 * ⚠️ 均分口径与「倾诉」的 `tilt/core/char-timing.ts` **不同**：倾诉把区间只分给
 * **非空白**字素（空白时长为 0 并锚在下一字素起点），浮名是把区间**平均分给所有字素**
 * （含空白）。两者各有单测，不要互相复用。
 */
export interface FumeGraphemeTiming extends FumeTimedSpan {
  char: string
  wordIndex?: number
}

/**
 * 一个词在整块文字里的字素区间（§2.2）。
 *
 * `wordIndex` 是**过滤掉空词之后**的序号；`colorStart/colorEnd` 是着色区间，
 * 当前实现恒等于 `start/end`，单独留字段是因为着色区间理论上可以比揭示区间更窄。
 */
export interface FumeWordRange {
  wordIndex: number
  word: FumeWord
  /** 该词首字素的全局下标 */
  start: number
  /** 尾后下标（**已吞掉紧随其后的空白字素**，见 §5.1） */
  end: number
  colorStart: number
  colorEnd: number
  graphemeTimings: FumeGraphemeTiming[]
}

// ───────────────────────── §2.3 渲染行与渲染片段 ─────────────────────────────

/**
 * 一个区块里「视觉上的一行」——pretext 换行之后的产物，不是歌词行。
 *
 * `left` / `top` 相对**区块左 / 上边缘**，不是世界坐标，也不是行内偏移。
 */
export interface FumeRenderLineSlice {
  /** `${行起始毫秒}-${行在块内的下标}` */
  id: string
  /** 该行的完整文本 */
  text: string
  /** 该行首字素在**区块**字素数组中的全局下标 */
  start: number
  /** 尾后下标（exclusive） */
  end: number
  /** 该行的字素（逐字素绘制与裁剪用） */
  graphemes: string[]
  /** 字素序号 → 相对本行左边缘的 x 偏移，长度 = `graphemes.length`（末字宽度另见 `width`） */
  glyphOffsets: number[]
  /** 该行被拆成的可绘制片段（一个段可能被行边界切开） */
  segments: FumeRenderSegmentSlice[]
  /** 相对区块左边缘的 x。只有 hero 块可能非 0，= `max((blockWidth - lineWidth) * 0.08, 0)` */
  left: number
  /** 相对区块上边缘的 y，= `行下标 * lineHeight` */
  top: number
  /** 该行宽度 px（pretext 换行结果给出的宽度） */
  width: number
}

/**
 * 行内的一段可绘制文本（一个 pretext 段被行边界切开之后的一段）。
 *
 * `measuredGlyphOffsets` 是**打印裁剪**的度量基准：pretext 的宽度是「换行拟合宽度」，
 * 而 `fillText` 裁剪要的是「实际绘制宽度」，两者在有 emoji / 字体回退时并不相等
 * （§4.6），所以每个片段额外用 canvas 逐前缀测一次真实宽度。
 */
export interface FumeRenderSegmentSlice {
  /** 该片段的文本（可能只是原段的一段） */
  text: string
  /** 全局字素起点 */
  start: number
  /** 全局字素尾后（exclusive） */
  end: number
  /** 相对**本渲染行**的字素起点 */
  localStart: number
  /** 相对**本渲染行**的字素尾后 */
  localEnd: number
  /** 相对**本行左边缘**的 x（用 pretext 宽度算，不是实测宽度） */
  x: number
  /** 该片段宽度 px（同上） */
  width: number
  /** 是否完整覆盖原段（决定能不能整段 `fillText`） */
  isFullSegment: boolean
  /** canvas 逐字素前缀宽度，长度 = 字素数 + 1（最后一项 == 整段宽） */
  measuredGlyphOffsets: number[]
}

/** 区块变体：hero = 大标题块（可跨列），body = 正文块。 */
export type FumeBlockVariant = 'body' | 'hero'

// ───────────────────────────── §2.4 区块 ─────────────────────────────

/**
 * 一个歌词行对应的一座「区块」——排版后的最终产物，也是每帧绘制的单位。
 *
 * `prepared` / `layout` 是 pretext 的对象（引用身份参与缓存，不要复制或重建）。
 */
export interface FumeBlock {
  /** `fume-${行起始毫秒}-${sourceLineIndex}`，同时是快照缓存的键前缀 */
  id: string
  /**
   * 在**原始 lines 数组**中的下标（不是过滤后顺序）。
   *
   * 为什么必须保留：§17.1 第 6 条 —— 「下一行」用的就是 `lines[sourceLineIndex + 1]`，
   * 与时间上的下一行无关。
   */
  sourceLineIndex: number
  /** 上游行对象（含词级时间戳与 renderHints） */
  line: FumeLine
  variant: FumeBlockVariant
  /** 世界坐标**左上角** x */
  x: number
  /** 世界坐标**左上角** y */
  y: number
  /** 世界尺寸宽 px */
  width: number
  /** 世界尺寸高 px */
  height: number
  /** 文本可用宽度 px（= `max(blockWidth - paddingX * 2, 120)`，当前 paddingX = 0） */
  innerWidth: number
  /** 字号 px（字号二分的结果） */
  fontPx: number
  /** 行高 px（= `round(fontPx * (hero ? 1.02 : 1.06))`，**必须取整**，见 §17.3 第 4 条） */
  lineHeight: number
  /** pretext 预制对象（含 segments / widths / breakableFitAdvances） */
  prepared: PreparedTextWithSegments
  /** pretext 换行结果（含 lines / lineCount / height） */
  layout: LayoutLinesResult
  /** 全块字素（所有段拼起来） */
  graphemes: string[]
  /** 每个 pretext 段的字素区间 */
  segmentMetas: FumeSegmentMeta[]
  /** 词区间（§5.1 的产物） */
  wordRanges: FumeWordRange[]
  /** 字素偏移 → 词区间下标（-1 = 无），长度 = `graphemes.length` */
  wordRangeIndexByOffset: number[]
  /** 字素偏移 → 着色区间下标（同上） */
  colorRangeIndexByOffset: number[]
  /** 该块的视觉行切片 */
  renderLines: FumeRenderLineSlice[]
}

// ───────────────────────────── §2.5 文章 ─────────────────────────────

/** 纸张内边界（世界坐标 px），给背景锚点用（§12.4 / §12.6）。 */
export interface FumePaperBounds {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * 整篇文章（= 排版结果）。
 *
 * ⚠️ `blocks` 与 `chronologicalBlocks` **必须分开**（§17.3 第 8 条）：
 * 绘制用 `blocks`（顺序 = 按种子打乱后的装箱顺序，影响遮挡），
 * 相机与「最后一块」判定用 `chronologicalBlocks`（时间序）。
 *
 * ⚠️ 本对象含 `Map`，放进 Vue 的 `ref` 会被深层代理（§17.3 第 10 条）：
 * 必须用 `shallowRef` 或 `markRaw`。
 */
export interface FumeArticleLayout {
  /** 世界宽 = `paperWidth + horizontalMargin * 2` */
  width: number
  /** 世界高 = `max(columnHeights) + verticalMargin` */
  height: number
  /** 生成时的视口高（仅记录，用于缓存键与调试） */
  viewportHeight: number
  /** 最终列数 */
  columns: number
  /** 列间距 px */
  gap: number
  paperBounds: FumePaperBounds
  /** 放置顺序（按随机排序后依次装箱，**不是**时间序） */
  blocks: FumeBlock[]
  blockBySourceLineIndex: Map<number, FumeBlock>
  /** 按 `sourceLineIndex` 升序 */
  chronologicalBlocks: FumeBlock[]
  /** 时间序第一块的行起始时间（毫秒）；无块时 `+Infinity` */
  firstRenderableStartTimeMs: number
  /** 最后一块的渲染结束时间（毫秒）；无块时 `-Infinity` */
  lastChronologicalRenderEndTimeMs: number
}

/** `measure` 模式只产出这些（不建 renderLines）——用于列数 / 纸宽的候选搜索。 */
export interface FumeArticleLayoutMetrics {
  width: number
  height: number
  viewportHeight: number
  columns: number
  gap: number
  paperBounds: FumePaperBounds
}

/** 单次排版尝试的性能采样（§7.9 的 timing 日志，用于和 Folia 对比量级）。 */
export interface FumeLayoutAttemptTiming {
  lines: number
  prepareLayoutMs: number
  placementMs: number
  renderDetailsMs: number
}

export type FumeLayoutAttemptMode = 'measure' | 'render'

export interface FumeLayoutAttemptOptions {
  paperWidth: number
  viewportHeight: number
  columns: number
  gap: number
  /** 文本密度缩放（影响列高估值得分，见 §7.8） */
  densityScale: number
  /** 决定区块变体与打乱顺序的字符串种子 */
  seedKey: string
  mode?: FumeLayoutAttemptMode
  timing?: FumeLayoutAttemptTiming
}

/**
 * 「已唱过 / 还没轮到」的区块离屏快照。
 *
 * `canvas` 是离屏画布（含 `padding` 圈的辉光余量），每帧只 `drawImage`（§11.1）。
 * 类型放在 core 只是因为它是 §2 契约的一部分；真正的创建实现在 `render/canvas-text.ts`。
 */
export interface FumeStaticBlockSnapshot {
  canvas: HTMLCanvasElement
  /** 画布四周预留给辉光的 pad（px） */
  padding: number
}

// ─────────────────────── §2.3 行输入 / §1.1 渲染提示 ──────────────────────

/**
 * 行时序分类（`utils/lyrics/renderHints.ts`）：极短行必须跳过过场动画，
 * 否则「一行只唱 80ms」时动画还没进场就已经结束了。
 */
export type FumeLineTimingClass = 'normal' | 'short' | 'micro'
export type FumeLineTransitionMode = 'normal' | 'fast' | 'none'
export type FumeWordRevealMode = 'normal' | 'fast' | 'instant'

/**
 * 预计算的行渲染提示（Folia 在歌单载入时烘焙一次，见 §1.1 / §17.1）。
 *
 * 本项目**没有**烘焙流程（适配层按需现算，见 §7.11），所以这个类型只描述形状：
 * `renderEndTimeMs` 是「这一行允许留在屏幕上的最晚时刻」，用来算相机重定位与拖尾窗口；
 * 它与 `endTimeMs` 的区别见 §17.3 第 7 条（`hasRevealCompleted` 用后者，
 * `hasPassCutoffReached` 用前者）。
 */
export interface FumeLineRenderHints {
  /** 原始行时长（毫秒，= `max(endTimeMs - startTimeMs, 0)`） */
  rawDurationMs: number
  timingClass: FumeLineTimingClass
  /** 允许留在屏幕上的最晚时刻（毫秒） */
  renderEndTimeMs: number
  lineTransitionMode: FumeLineTransitionMode
  wordRevealMode: FumeWordRevealMode
}

/**
 * 「浮名」内部归一化后的歌词行。
 *
 * 字段名沿用 Folia 的 `Line`（`fullText` 等），但时间字段一律是**毫秒**且带 `Ms` 后缀。
 * 由适配层从领域层的 `LyricLine` + 推算的结束时间构造（§15.2）。
 */
export interface FumeLine {
  words: FumeWord[]
  startTimeMs: number
  /** 行结束时间（毫秒）。领域层没有该字段，由「下一行起始 / 播放时长 / 固定 5 秒」推算 */
  endTimeMs: number
  /** 整行文本（渲染与排序的键；与 `words.map(w => w.text).join('')` 可能不同，见 §5.1） */
  fullText: string
  translation?: string
  /** 罗马音 / 音译（本项目 `LyricLine.romaji`） */
  romanization?: string
  /**
   * 是否副歌行。本项目**没有**这个元数据（§7.11）：适配层恒传 `false`，
   * 于是 hero 变体全靠「每 6 行一个 + 种子阈值」与 fallback 规则决定。
   */
  isChorus?: boolean
  renderHints?: FumeLineRenderHints
}

// ───────────────────────────── §2.6 相机 ─────────────────────────────

/**
 * 相机状态（世界坐标 + 弹簧速度）。
 *
 * 为什么是**可变对象**而不是每帧新对象：`stepFumeCamera` 原地积分（§9.7），
 * 且相机必须跨 stage 重建存活（§17.1 第 1 条）。在 Vue 里它是 `setup` 作用域的
 * **普通对象**，绝不能放进 `reactive`（§15.3）。
 */
export interface FumeCameraTarget {
  /** 世界坐标注视点 x */
  x: number
  /** 世界坐标注视点 y */
  y: number
  /** 弹簧速度，世界单位/秒 */
  velocityX: number
  /** 弹簧速度，世界单位/秒 */
  velocityY: number
  /** 一阶跟随的「软焦点」x（弹簧的输入，不是输出） */
  focusX: number
  /** 一阶跟随的「软焦点」y */
  focusY: number
  /** 屏幕 px / 世界 px */
  scale: number
  /** 缩放速度，1/秒（与尺度无关） */
  velocityScale: number
  /** 一阶跟随的「软缩放」 */
  focusScale: number
}

/** 桥接模式：none = 直接弹簧；direct = 走一个中途点；overview = 拉远再落回（§9.6）。 */
export type FumeCameraBridgeMode = 'none' | 'direct' | 'overview'

/**
 * 一次「重定位」的状态（相机从哪来、要飞多久、要不要绕路）。
 *
 * `sourceLineIndex` 用两个哨兵值：`-1` = 无目标，`-2` = 总览镜头
 * （Folia 的 `OVERVIEW_CAMERA_SOURCE`，见 §9.1）。
 */
export interface FumeCameraRetargetState {
  /** 当前目标：区块的行下标 / -1 无目标 / -2 总览 */
  sourceLineIndex: number
  /** 播放时间（毫秒）开始重定位的时刻 */
  startedAtMs: number
  /** 重定位时长（毫秒） */
  durationMs: number
  /** 起始相机，捕获于重定位那一刻（不是每帧读当前值） */
  fromX: number
  /** 起始相机 y */
  fromY: number
  /** 起始缩放 */
  fromScale: number
  bridgeMode: FumeCameraBridgeMode
  bridgeWaypointX: number
  bridgeWaypointY: number
  bridgeWaypointScale: number
  /** 桥接分段比例 0..1（在中途点之前走一段、之后走另一段） */
  bridgeWaypointPhase: number
}

/** 相机的可变状态容器（`initialized` 只在 `article === null` 时被清掉，§17.1）。 */
export interface FumeCameraState {
  camera: FumeCameraTarget
  retarget: FumeCameraRetargetState
  initialized: boolean
}

/** 一个「看向哪里」的纯数据视图（总览镜头、桥接端点都用它）。 */
export interface FumeCameraViewTarget {
  x: number
  y: number
  scale: number
}

// ────────────────────────── §12.1 浮名自带背景 ──────────────────────────

export type FumeBackgroundShapeKind = 'ring' | 'square' | 'cross' | 'spark'

/** 背景形状能被哪条频带驱动（**只有 spark 有**，且不含 `power`，见 §13.1）。 */
export type FumeBackgroundAudioBand = 'bass' | 'lowMid' | 'mid' | 'vocal' | 'treble'

/** 形状取色：secondary = 次要色，accent = 主色。 */
export type FumeBackgroundShapeColor = 'secondary' | 'accent'

/**
 * 一个背景形状。
 *
 * ⚠️ `x/y` 是**世界坐标中心**（区块的 `x/y` 是左上角，两者口径不同）。
 * `rotationSpeed` 是弧度 / 秒，绘制时乘播放时间。
 */
export interface FumeBackgroundShape {
  /** `fume-bg-${i}` / `fume-spark-${i}` */
  id: string
  kind: FumeBackgroundShapeKind
  /** 世界坐标中心 x */
  x: number
  /** 世界坐标中心 y */
  y: number
  /** 基础尺寸 px（音频 / 视差会在绘制时再缩放，本字段不变） */
  width: number
  /** 基础尺寸 px（同上） */
  height: number
  /** 基础旋转，弧度 */
  rotation: number
  /** 弧度 / 秒（绘制时乘时间） */
  rotationSpeed: number
  strokeWidth: number
  opacity: number
  color: FumeBackgroundShapeColor
  /** 0..1：决定视差响应强度与绘制顺序（小的先画） */
  depth: number
  /** 只有 spark 有：驱动它的频带 */
  audioBand?: FumeBackgroundAudioBand
  /** 只有 ring 有：缺口起始角（弧度），缺省 `-PI * 0.18` */
  ringGapStart?: number
  /** 只有 ring 有：缺口张开角（弧度），会被钳到 `[0.18, PI * 0.6]` */
  ringGapSize?: number
}

/** 背景场景（随「视口 / 文章尺寸 / 主题种子」重建，见 §18 第 7 条）。 */
export interface FumeBackgroundScene {
  width: number
  height: number
  shapes: FumeBackgroundShape[]
}

/**
 * 每帧读到的频带能量，量纲是 Folia 的 **0..255**（不是本项目 `AudioBands` 的 0..1）。
 *
 * 换算与噪声门在适配层完成（§13.2）：`ours * 255`，再 `clamp((v - 10) / 190, 0, 1)`。
 * `power` / `bass` 会被传进来但**浮名从不读取**（§13.1 表格已确认），保留字段是为了
 * 让「传了但没用」这个事实看得见，而不是让人以为漏了。
 */
export type FumeAudioLevels = Partial<
  Record<'bass' | 'lowMid' | 'mid' | 'vocal' | 'treble', number>
> & {
  power?: number
}

// ─────────────────────────── §2.7 Stage 契约 ───────────────────────────

/** 相机跟随模式：stepped = 按「已打印字数」整数跳；smooth = 按浮点进度滑动（§9.2）。 */
export type FumeCameraTrackingMode = 'stepped' | 'smooth'

/**
 * 本面板渲染时真正读到的主题参数（Folia `Theme` 的子集 + 本项目口径）。
 *
 * 本项目没有主题对象：`primaryColor` 等来自沉浸层注入的 CSS 变量
 * （`--rnp-accent-color` 系列，见 `use-color-extraction.ts`），`fontStyle` 是内定值。
 * 适配层负责把 CSS 变量读成这个形状 —— 一旦视觉要跟主题走，只需要改适配层一处。
 */
export interface FumeTheme {
  /** 主题标识（参与背景种子 `${seed}:${theme.name}` 与排版缓存键） */
  name: string
  /** 正文 / 纸面文字色（本项目 = 外壳注入的正文色） */
  primaryColor: string
  /** 强调色（唱过的字、火花、关键词着色） */
  accentColor: string
  /** 次要色（背景基础形状） */
  secondaryColor: string
  /** 字体风格档，决定字体栈与默认字重 */
  fontStyle: 'sans' | 'serif' | 'mono'
  /** 自定义字体族（当前由 Folia 字体设置写入；缺省时使用内置衬线族） */
  fontFamily?: string
  /** 自定义字体族链，按优先级排序；内置衬线族由测量层追加 */
  fontFamilyStack?: string[]
  /** 自定义字重覆盖。给定后 hero / body 的默认 780 / 640 失效（§4.8） */
  fontWeight?: number
  /** 动画强度档，决定辉光基量（§8.1） */
  animationIntensity: 'calm' | 'normal' | 'chaotic'
  /** 逐词着色（本项目恒为空数组，见 `shared/word-coloring.ts`） */
  wordColors?: { word: string; color: string }[]
}

/**
 * Stage 场景：**随「歌词 / 主题 / 调参 / 视口」变化而重建**的对象。
 *
 * 与 `FumeStageDriver` 的分工是浮名性能设计的关键（§1.1 的 `fumeStage.ts`）：
 * 场景里全是「一段时间内不变」的输入，驱动里全是「每帧都在变」的引用。
 * 把会变的塞进场景 = 每帧重建文章 / 背景；把不变的塞进驱动 = 白读。
 */
export interface FumeStageScene {
  article: FumeArticleLayout | null
  lines: FumeLine[]
  theme: FumeTheme
  viewport: FumeViewportSize
  backgroundScene: FumeBackgroundScene
  /** 总览镜头；`article === null` 时为 null */
  overviewCamera: FumeCameraViewTarget | null
  /** 总览开始时刻（毫秒）；`+Infinity` = 永不 */
  overviewStartTimeMs: number
  /** 唱过文字的渐隐总时长（毫秒），可 `+Infinity`（`textHoldRatio >= 1` 时） */
  passedFadeDurationMs: number
  /** 相机速度倍率，运行时钳在 [0.55, 1.85]（§14.1） */
  cameraSpeed: number
  cameraTrackingMode: FumeCameraTrackingMode
  /** 辉光强度，运行时钳在 [0, 1.8]（§14.1） */
  glowIntensity: number
  /** 背景形状不透明度倍率，运行时钳在 [0, 1]；使用时**再乘 2**（§14.1） */
  backgroundObjectOpacity: number
  /** = `!hidePrintSymbols`：是否画「打印印章」方块（§10.5） */
  showPrintStamp: boolean
  /** 唱过文字保留比例，钳在 [0, 1]；本项目恒为 1（永不淡出） */
  textHoldRatio: number
  /** `false` = 不画任何文字块（背景照画） */
  showText: boolean
  /** `true` = 连背景都不画（静态截图 / 演示模式） */
  staticMode: boolean
}

/**
 * Stage 驱动：每帧读取的可变引用。
 *
 * 全部是**方法**而不是字段 —— 本项目的 `SkinContext` 就是 getter 契约（§15.3）：
 * 一旦把 `currentTimeMs()` 缓存成常量，整帧就会用旧时间，相机与揭示全部跟错。
 */
export interface FumeStageDriver {
  /** 播放时间（**毫秒**），每帧读一次（本项目由逐帧时钟外推，见 `shared/clock-core.ts`） */
  currentTimeMs(): number
  /** 频带能量（0..255 量纲），每帧读一次 */
  audioLevels(): FumeAudioLevels
  /** 相机状态。**由组件持有**，stage 重跑时保留运动（§17.1 第 1 条） */
  cameraState: FumeCameraState
  /** 当前高亮歌词行下标（-1 = 尚未到首行），每帧读一次 */
  currentLineIndex(): number
  /** 第一个区块开始打印时回调一次（触发入场动画），切歌时必须重置标志 */
  onPrintedContent(): void
}
