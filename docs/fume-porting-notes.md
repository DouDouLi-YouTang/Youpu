# 「浮名」面板移植笔记（算法还原规格书）

> **许可说明**：Folia 源码是 AGPL-3.0，本项目是 MIT。本文件记录的是从阅读其源码后提炼的
> **算法结构、参数与公式**；若后续实现直接复制 Folia 的源码片段（包括 GLSL），本项目必须整体
> 重许可为 AGPL-3.0。参考仓库：`chthollyphile/folia-major`（commit `7701347`，版本 0.7.19）。
>
> 参考文件统一写作 `…/fume/<名字>.ts`，指 `F:\Work\_refs\folia-major\src\components\visualizer\fume\`；
> 背景指 `F:\Work\_refs\folia-major\src\components\visualizer\FumeBackground.ts`。
> 行号引用的是本次阅读的这份工作副本（与 commit `7701347` 对应）。
>
> 单位约定：**时间一律是秒**（Folia 的 `currentTime` 是秒），**长度一律是 CSS px**（世界坐标 px），
> **旋转是弧度**。本项目内部是毫秒，换算点在适配层，见 §15.2。
> 凡本次阅读无法从源码确认的推断，均显式标注「**未确认**」。

---

## 0. 一句话概括

浮名不是「一行一行滚动的歌词」，而是**把所有歌词排成一张纸（多栏文章），再用一台会呼吸的相机
在纸上巡航**：纸上的每一行是一座「区块（block）」，唱到哪一行，相机就飞过去，区块里的字逐个
被“打印”出来，唱过的字留下颜色拖尾与渐隐的纸痕，最后唱完时相机拉回整页做一次「总览」。

与「倾诉」（纯 CSS 动画、单行排版）的根本差别：

- 浮名**需要一个每帧重绘的全视口 canvas**（`useFumeCanvasStage.ts:12-14`）；
- 浮名**需要每帧的真实播放时间**（相机跟随打印光标），倾诉那种「CSS 动画 + 负延迟」的做法
  在这里不适用；
- 浮名**自带一层 canvas 背景**（`FumeBackground.ts`），默认还会**关掉外壳的几何背景**。

---

## 1. 模块清单与依赖图

### 1.1 文件清单（按职责）

| 文件 | 行数 | 职责 | 导出符号（关键） |
| --- | --- | --- | --- |
| `fume/VisualizerFume.tsx` | 400 | React 组装层：视口观测、文章布局调度与缓存、背景场景、总览时刻、把 scene/driver 交给 stage、外层 shell + 字幕 | `VisualizerFume`（default） |
| `fume/useFumeCanvasStage.ts` | 298 | 每帧绘制循环：相机步进 → 背景 → 各区块（快照 / 逐字实时） | `useFumeCanvasStage(canvasRef, scene, driver, paused)`、`SNAPSHOT_IDLE_MS = 15_000` |
| `fume/fumeArticleLayout.ts` | 581 | 把 `Line[]` 排成多栏文章：区块变体、字号二分、列高装箱、渲染细节 | `buildLayoutCacheKey`、`buildArticleLayout` |
| `fume/fumeTypes.ts` | 159 | 全部数据结构（区块 / 渲染行 / 片段 / 相机 / 快照） | 见 §2 |
| `fume/fumeMath.ts` | 59 | 数值、缓动、字素切分、FNV-1a 种子 | `splitGraphemes`、`clamp`、`mix`、`quadraticBezier`、`easeOutCubic`、`easeInCubic`、`easeInOutCubic`、`resolveDelayedGlowEnvelope`、`isCJK`、`hashString`、`seeded` |
| `fume/fumeReveal.ts` | 217 | 逐字揭示：字词区间、已打印字素数、行过场截止时间 | `buildWordRangesFromWords`、`resolveLinePassCutoffTime`、`resolveVisualProgressWithCutoff`、`resolvePrintedGraphemeCount`、`resolvePrintedGraphemeProgress` |
| `fume/fumeTextMeasure.ts` | 327 | 文本测量：pretext 分段、字素偏移、片段（segment）切分、字号二分 | `buildSegmentMetas`、`cursorToGlobalOffset`、`widthBetweenOffsets`、`buildGlyphOffsets`、`resolveGlyphAdvance`、`buildRenderSegments`、`buildFontSpec`、`buildWordRangeIndexByOffset`、`countRenderableGraphemes`、`buildPreparedSingleLine`、`resolveRenderLineOffset`、`resolveSegmentGlyphOffset`、`resolveSegmentGlyphAdvance` |
| `fume/fumeTextStyle.ts` | 88 | 与渲染器无关的文字样式：唱过样式、渐隐量、拖尾总时长、活动字色 | `resolvePassedTextStyle`、`resolvePassedDimAmount`、`resolveFumePassedFadeDuration`、`getActiveColor` |
| `fume/fumeBlockFrame.ts` | 175 | 单区块的逐帧判定：在屏、时序、静态层（快照）清单 | `resolveFumeGlowBases`、`isFumeBlockOnScreen`、`resolveFumeBlockTiming`、`resolveFumeStaticLayers` |
| `fume/fumeCamera.ts` | 341 | 相机「看哪」：焦点点、缩放、重定位时长、总览镜头、长距离桥接路径 | `CAMERA_SCALE_MIN`、`CAMERA_SCALE_MAX`、`OVERVIEW_CAMERA_SOURCE`、`resolveSteppedBlockFocusPoint`、`resolveSmoothBlockFocusPoint`、`resolveBlockEntryFocusPoint`、`resolveCameraScaleForBlock`、`resolveCameraRetargetDuration`、`resolveOverviewRetargetDuration`、`resolveOverviewFlightBridge`、`resolveArticleOverviewCamera`、`resolveFocusBlock` |
| `fume/fumeCameraStep.ts` | 412 | 相机「怎么动」：状态机 + 弹簧积分 + 背景视差视图 | 见 §9 |
| `fume/fumeCanvasText.ts` | 408 | Canvas 2D 文字：字体串、裁剪文本运行、静态快照、逐字素实时绘制、打印印章 | `buildCanvasFont`、`buildTextStyleKey`、`drawRenderTextRun`、`createStaticBlockSnapshot`、`drawFumeLiveBlock` |
| `fume/fumeLiveRaster.ts` | 119 | 量化栅格：把「正在打印」的区块画进自己的 canvas，再缩放贴回舞台 | `resolveLiveRasterScale`、`FumeLiveRaster` |
| `fume/FumeBackground.ts` | 482 | 浮名自带背景：环形/方块/十字/火花场景生成 + 每帧绘制 | `buildFumeBackgroundScene`、`drawFumeBackground`、类型 `FumeBackgroundScene` / `FumeBackgroundAudioLevels` |
| `fume/entry.tsx` | 24 | 模式注册（`mode:'fume'`、`order:60`、预览种子 `fume`、预览偏移 18.4s） | `defineVisualizer({...})` |
| `fume/tuning.ts` | 4 | 把强类型 tuning 注入渲染边界 | `defineVisualizerTuning({ mode:'fume', settingsKey:'fumeTuning', … })` |
| `fume/../FumeBackground.ts`（背景壳） | — | 同上，被 `VisualizerFume` 与 stage 共用 | — |

外部依赖（Folia 侧）：

| 依赖 | 用途 | 本仓库状态 |
| --- | --- | --- |
| `@chenglou/pretext@0.0.9` | `prepareWithSegments` / `layoutWithLines`（换行与宽度测量） | **已安装**（`package.json` `^0.0.9`） |
| `framer-motion` | `MotionValue`（时间 / 频带）、`motion.div`（容器与加载卡） | 本仓库无；用 Vue 的 `ref` + CSS transition 等价替代 |
| `lucide-react` 的 `Hourglass` | 「正在排版」加载卡图标 | 本仓库用 `@ant-design/icons-vue` |
| `@paper-design/shaders*` | **与本模式无关**（那是外壳背景 latent/nomand 用的）；浮名的背景是纯 canvas 2D（§12） | 本仓库已在 `package.json` 里加了 `@paper-design/shaders`（那是给「流光」的 latent 背景准备的） |

上游工具（非 fume 目录，但被 fume 依赖）：

| 文件 | 被谁用 | 作用 |
| --- | --- | --- |
| `src/utils/lyrics/renderHints.ts` | `fumeReveal`、`fumeCamera`、`fumeBlockFrame`、`fumeTextStyle` | `getLineRenderEndTime`、`getLineRenderHints`、`getLineTransitionTiming`、`buildLineRenderHints` |
| `src/utils/lyrics/graphemeTiming.ts` | `fumeReveal` | `buildWordGraphemeTimings`、`splitLyricGraphemes` |
| `src/utils/fontStacks.ts` | `fumeArticleLayout`、`fumeTextMeasure`、`fumeCanvasText` | `resolveThemeFontStack`、`resolveThemeFontWeight`（字重回退） |
| `src/components/visualizer/colorMix.ts` | `fumeBlockFrame`、`fumeCanvasText`、`FumeBackground` | `colorWithAlpha`、`mixColors` |
| `src/components/visualizer/textMeasureCache.ts` | `fumeTextMeasure`、`FumeBackground` | `rememberBounded`、`measurePrefixOffsets` |
| `src/components/visualizer/wordColoring.ts` | `fumeTextStyle` | `resolveWordColor`（`cjkMatchMode:'bidirectional-contains'`） |
| `src/utils/glowBlurQuantize.ts` | `fumeCanvasText`、`useFumeCanvasStage` | `setCanvasTextGlow`、`clearCanvasTextGlow`、`fillGlowText`、`quantizeShadowBlur`、`isGlowBlurQuantized` |
| `src/components/visualizer/runtime.ts` | `VisualizerFume` | `getRecentCompletedLine`、`getUpcomingLines` |
| `src/components/visualizer/VisualizerShell.tsx` | `VisualizerFume` | 外壳背景（含 `common.disableGeometricBackground`） |
| `src/components/visualizer/VisualizerSubtitleOverlay.tsx` | `VisualizerFume` | 底部字幕（译文/音译/下一句预览） |

### 1.2 依赖图（→ 表示「被依赖」）

```
fumeTypes ──────────────► 被 fumeArticleLayout / fumeReveal / fumeCamera / fumeCameraStep /
                          fumeBlockFrame / fumeCanvasText / fumeLiveRaster / useFumeCanvasStage / VisualizerFume 引用
fumeMath ───────────────► 被上面几乎全部引用（除 fumeTextStyle/fumeTypes）
fumeTextMeasure ────────► fumeArticleLayout, fumeCamera, fumeCanvasText
fumeReveal ─────────────► fumeArticleLayout, fumeCamera, fumeCameraStep, fumeBlockFrame, fumeCanvasText
fumeTextStyle ──────────► fumeBlockFrame, fumeCanvasText
fumeBlockFrame ─────────► useFumeCanvasStage（+ fumeCanvasText 仅类型）
fumeCamera ─────────────► fumeCameraStep, VisualizerFume
fumeCameraStep ─────────► useFumeCanvasStage, VisualizerFume（类型）
fumeCanvasText ─────────► fumeLiveRaster, useFumeCanvasStage
fumeLiveRaster ─────────► useFumeCanvasStage
FumeBackground ─────────► fumeStage（类型）, useFumeCanvasStage（绘制）, VisualizerFume（场景构建）
useFumeCanvasStage ─────► VisualizerFume
```

注意方向：**`fumeTypes` 不 import 任何 fume 模块**（只 import `pretext` 与上游类型），是依赖图的根。
移植时应保持同样的分层，否则会出现循环依赖与「纯算法无法单测」。

---

## 2. 数据模型（逐字段）

`fumeTypes.ts` 的全部类型定义如下（坐标系：**世界坐标 = 文章纸张坐标，原点在文章左上角，x 向右、
y 向下，单位 px**；屏幕坐标由相机的 `translate(viewport/2) → scale → translate(-camera)` 变换得到，
见 §10.2）。

### 2.1 基础形状

```ts
interface ViewportSize { width: number; height: number }   // 舞台（= 沉浸页可视区）尺寸，px

interface SegmentMeta {
  graphemeStart: number      // 该段首字素在整行字素数组中的下标
  graphemeEnd: number        // 尾后下标（exclusive）
  graphemeCount: number      // graphemeEnd - graphemeStart
}
```

### 2.2 词区间

```ts
interface WordRange {
  wordIndex: number                  // 在 line.words 过滤空词之后的序号
  word: Word                         // 上游 Word { text, startTime, endTime, syllables? }，单位秒
  start: number                      // 该词首字素的全局下标
  end: number                        // 尾后下标（会吞掉紧随其后的空白字素）
  colorStart: number                 // 着色区间起点（当前实现 = start）
  colorEnd: number                   // 着色区间终点（当前实现 = end）
  graphemeTimings: GraphemeTiming[]  // 来自 buildWordGraphemeTimings（秒）
}
```

`GraphemeTiming` 来自上游：`{ char: string; startTime: number; endTime: number; wordIndex?: number }`。

### 2.3 渲染行与片段

```ts
interface RenderLineSlice {          // 一个区块里「视觉上的一行」（pretext 换行后的行）
  id: string                         // `${line.startTime}-${lineIndex}`
  text: string                       // 该行的完整文本
  start: number                      // 该行首字素在区块字素数组中的全局下标
  end: number                        // 尾后下标
  graphemes: string[]                // 该行的字素
  glyphOffsets: number[]             // 随字索引 → 相对本行左边缘的 x 偏移（长度 = graphemes.length）
  segments: RenderSegmentSlice[]     // 该行被拆成的可绘制片段（见下）
  left: number                       // 相对区块左边缘的 x（hero 才可能非 0，= max((blockWidth - lineWidth)*0.08, 0)）
  top: number                        // 相对区块上边缘的 y（= lineIndex * lineHeight）
  width: number                      // 该行宽度（pretext 给出）
}

interface RenderSegmentSlice {
  text: string                       // 该片段的文本（可能只是原段的一段）
  start: number                      // 全局字素起点
  end: number                        // 全局字素尾后
  localStart: number                 // 相对本渲染行的字素下标
  localEnd: number
  x: number                          // 相对本行左边缘的 x（用 pretext 宽度算）
  width: number                      // 该片段宽度（同上）
  isFullSegment: boolean             // 是否完整覆盖原段（决定能否整段 fillText）
  measuredGlyphOffsets: number[]     // canvas 逐字素前缀宽度（长度 = 字素数 + 1，偏移 [n-1] == 整段宽）
}
```

> `measuredGlyphOffsets` 是「打印裁剪」的度量基准：绘制时用它在片段内二次裁剪，
> 这样即使一个字被拆在两次 fillText 里，也只在字素边界处截断（§10.3）。

### 2.4 区块

```ts
interface FumeBlock {
  id: string                          // `fume-${line.startTime}-${sourceLineIndex}`
  sourceLineIndex: number             // 在**原始 lines 数组**中的下标（不是过滤后顺序）
  line: Line                          // 上游行对象（含 words/fullText/startTime/endTime/isChorus…）
  variant: 'body' | 'hero'            // 区块变体
  x: number; y: number                // 世界坐标左上角
  width: number; height: number       // 世界尺寸 px
  innerWidth: number                  // 文本可用宽度（= max(blockWidth - paddingX*2, 120)，当前 paddingX = 0）
  fontPx: number                      // 字号 px（二分结果）
  lineHeight: number                  // 行高 px（= round(fontPx * (hero ? 1.02 : 1.06))）
  prepared: PreparedTextWithSegments  // pretext 预制对象（含 segments/widths/breakableFitAdvances）
  layout: LayoutLinesResult           // pretext 换行结果（含 lines/lineCount/height）
  graphemes: string[]                 // 全文素（所有段拼起来）
  segmentMetas: SegmentMeta[]         // 每个 pretext 段的字素区间
  wordRanges: WordRange[]             // 词区间
  wordRangeIndexByOffset: number[]    // 字素偏移 → 词区间下标（-1 = 无），长度 = graphemes.length
  colorRangeIndexByOffset: number[]   // 字素偏移 → 着色区间下标（同上）
  renderLines: RenderLineSlice[]
}
```

### 2.5 文章

```ts
interface FumePaperBounds { left: number; top: number; right: number; bottom: number }

interface FumeArticleLayout {
  width: number                       // 世界宽 = paperWidth + horizontalMargin * 2
  height: number                      // 世界高 = max(columnHeights) + verticalMargin
  viewportHeight: number              // 生成时的视口高（仅记录）
  columns: number                     // 最终列数
  gap: number                         // 列间距 px
  paperBounds: FumePaperBounds        // 纸张内边界（给背景的锚点用）
  blocks: FumeBlock[]                 // 放置顺序（按随机排序后依次装箱，非时间序）
  blockBySourceLineIndex: Map<number, FumeBlock>
  chronologicalBlocks: FumeBlock[]    // 按 sourceLineIndex 升序
  firstRenderableStartTime: number    // 时间序第一块的行起始时间（秒）；无块时 +Infinity
  lastChronologicalRenderEndTime: number // 最后一块的 getLineRenderEndTime；无块时 -Infinity
}

interface FumeArticleLayoutMetrics {   // measure 模式只产出这些（不建 renderLines）
  width: number; height: number; viewportHeight: number;
  columns: number; gap: number; paperBounds: FumePaperBounds
}

interface FumeLayoutAttemptOptions {
  paperWidth: number; viewportHeight: number; columns: number; gap: number;
  densityScale: number; seedKey: string;
  mode?: 'measure' | 'render';
  timing?: FumeLayoutAttemptTiming
}

interface FumeLayoutAttemptTiming {
  lines: number; prepareLayoutMs: number; placementMs: number; renderDetailsMs: number
}

interface StaticBlockSnapshot { canvas: HTMLCanvasElement; padding: number }
```

### 2.6 相机

```ts
interface CameraTarget {
  x: number; y: number                 // 世界坐标注视点
  velocityX: number; velocityY: number // 世界单位/秒（弹簧速度）
  focusX: number; focusY: number       // 一阶跟随的「软焦点」
  scale: number                        // 屏幕 px / 世界 px
  velocityScale: number                // 缩放速度（世界无关，1/秒）
  focusScale: number                   // 一阶跟随的软缩放
}

interface CameraRetargetState {
  sourceLineIndex: number              // 当前目标：区块的行下标 / -1 无目标 / -2 总览（OVERVIEW_CAMERA_SOURCE）
  startedAt: number                    // 播放时间（秒）开始重定位的时刻
  duration: number                     // 重定位时长（秒）
  fromX: number; fromY: number; fromScale: number  // 起始相机（捕获于重定位那一刻）
  bridgeMode: 'none' | 'direct' | 'overview'       // 桥接模式
  bridgeWaypointX: number; bridgeWaypointY: number; bridgeWaypointScale: number
  bridgeWaypointPhase: number          // 桥接分段比例 0..1
}

interface CameraViewTarget { x: number; y: number; scale: number }
```

`FumeCameraState`（定义在 `fumeCameraStep.ts:13-17`）：`{ camera: CameraTarget; retarget: CameraRetargetState; initialized: boolean }`。

### 2.7 Stage 契约

`fumeStage.ts:11-39`：

```ts
interface FumeStageScene {             // 随「歌词 / 主题 / 调参 / 视口」变化而重建
  article: FumeArticleLayout | null
  lines: Line[]; theme: Theme; viewport: ViewportSize
  backgroundScene: FumeBackgroundScene
  overviewCamera: CameraViewTarget | null
  overviewStartTime: number            // 总览开始（秒）；+Infinity = 永不
  passedFadeDuration: number           // 唱过文字的渐隐总时长（秒），可 +Infinity
  cameraSpeed: number                  // 0.55..1.85
  cameraTrackingMode: 'stepped' | 'smooth'
  glowIntensity: number                // 0..1.8
  backgroundObjectOpacity: number      // 0..1
  showPrintStamp: boolean              // = !hidePrintSymbols
  textHoldRatio: number                // 0..1
  showText: boolean
  staticMode: boolean
}

interface FumeStageDriver {            // 每帧读取的可变引用
  currentTime: MotionValue<number>     // 播放时间（秒）
  audioPower: MotionValue<number>      // 0..255 量纲
  audioBands: AudioBands               // bass/lowMid/mid/vocal/treble，0..255 量纲
  cameraState: FumeCameraState         // 由组件持有（stage 重跑时保留运动）
  getLineIndex: () => number
  onPrintedContent: () => void         // 首个区块开始打印时回调一次
}
```

---

## 3. 数学与工具层（`fumeMath.ts`）

全部是纯函数，**可 1:1 搬进本项目的 `core/*.ts` 并写 vitest 单测**：

```ts
const graphemeSegmenter = typeof Intl !== 'undefined'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null

export const splitGraphemes = (text: string) =>
  !text ? [] : graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment)
    : Array.from(text)

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
export const mix = (from, to, amount) => from + (to - from) * amount

export const quadraticBezier = (from, control, to, amount) => {
  const t = clamp(amount, 0, 1); const u = 1 - t
  return u * u * from + 2 * u * t * control + t * t * to
}

export const easeOutCubic = (v) => 1 - Math.pow(1 - clamp(v, 0, 1), 3)
export const easeInCubic  = (v) => Math.pow(clamp(v, 0, 1), 3)
export const easeInOutCubic = (v) => {
  const t = clamp(v, 0, 1)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** 先升后降的「迟到的辉光」包络：peakProgress 处达到 1，之后用 easeInCubic 回落 */
export const resolveDelayedGlowEnvelope = (progress, peakProgress = 0.8) => {
  const t = clamp(progress, 0, 1)
  const peak = clamp(peakProgress, 0.05, 0.95)
  return t <= peak ? easeOutCubic(t / peak) : 1 - easeInCubic((t - peak) / (1 - peak))
}

/** 含 CJK/假名/谚文即算 CJK（只影响基线 0.52 vs 0.5 的取整） */
export const isCJK = (text) => /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text)

/** FNV-1a 32 位 */
export const hashString = (input) => {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** 由字符串种子得到 [0,1) 的确定性伪随机（粒度 1/10000） */
export const seeded = (seed) => (hashString(seed) % 10000) / 10000
```

**移植要点**：`seeded` 的粒度是 **1/10000**，不是浮点全精度；所有「随机」都靠它，
因此同一首歌每次播放布局一致（可复现）。`Intl.Segmenter` 在本项目已用于
`skins/tilt/core/graphemes.ts`，可直接复用同一份实现，不要另起一套切分口径。

---

## 4. 文本测量层（`fumeTextMeasure.ts`）

### 4.1 pretext 预制参数

```ts
const FUME_PRETEXT_OPTIONS = { whiteSpace: 'pre-wrap' } satisfies PrepareOptions
```

### 4.2 段落元信息

```ts
buildSegmentMetas(prepared) => { graphemes: string[], segmentMetas: SegmentMeta[] }
```

遍历 `prepared.segments`，对每个段用 `splitGraphemes` 数出字素数，累加得到
`graphemeStart/graphemeEnd/graphemeCount`，同时把所有段字素拼成全局 `graphemes`。

> `prepared.segments` 是 pretext 的**分段单位**（连续可断行的一段，通常是一串 CJK 或一个西文词），
> 不是视觉行；视觉行来自 `layoutWithLines`，两者靠 §4.3 的光标换算对应。

### 4.3 光标 → 全局字素偏移

```ts
cursorToGlobalOffset(cursor: LayoutCursor, segmentMetas) => number
```

- `segmentMetas` 为空 → `0`
- `segmentMetas[cursor.segmentIndex]` 不存在（游标越界）→ **最后一段的 `graphemeEnd`**
- 否则 `clamp(segment.graphemeStart + cursor.graphemeIndex, segment.graphemeStart, segment.graphemeEnd)`

### 4.4 区间宽度

```ts
getPartialSegmentWidth(prepared, segmentIndex, segmentMeta, startOffset, endOffset)  // 私有
```

1. `localStart = clamp(startOffset - meta.graphemeStart, 0, meta.graphemeCount)`，`localEnd` 同理；
2. `localEnd <= localStart` → `0`；
3. 整个段被覆盖（`localStart === 0 && localEnd === meta.graphemeCount`）→ 直接返回 `prepared.widths[segmentIndex] ?? 0`；
4. 有 `prepared.breakableFitAdvances[segmentIndex]`（非空数组）→ 累加 `[localStart, localEnd)` 的 advances；
5. 否则按字素比例摊：`fullWidth * ((localEnd - localStart) / meta.graphemeCount)`。

```ts
widthBetweenOffsets(prepared, segmentMetas, startOffset, endOffset) => number
```

`endOffset <= startOffset` → `0`；否则线性扫所有段，跳过完全在左侧（`startOffset >= meta.graphemeEnd`）
的段，遇到完全在右侧（`endOffset <= meta.graphemeStart`）就 break，把与区间有交的段按上式相加。

> **性能注意**：这是 O(段数) 的扫描，被相机（每帧多次）、相机步进（每个区块）反复调用。
> 移植时若发现长歌词掉帧，这里是第一个该加记忆化的地方（按 `(blockId, startOffset, endOffset)` 缓存），
> 但注意它依赖 `prepared` 对象身份，缓存要跟随机型/字号的生命周期一起失效。

### 4.5 逐字偏移与字宽

```ts
buildGlyphOffsets(prepared, segmentMetas, startOffset, graphemeCount) => number[]
  // offsets[i] = widthBetweenOffsets(prepared, segmentMetas, startOffset, startOffset + i)

resolveGlyphAdvance(renderLine, graphemeIndex) => number
  // 下一个偏移 − 当前偏移；最后一个字素用 renderLine.width 兜底；最小 0
```

### 4.6 渲染片段

```ts
buildRenderSegments(prepared, segmentMetas, lineStart, lineEnd, fontSpec) => RenderSegmentSlice[]
```

对每个段：

- 若 `lineEnd <= meta.graphemeStart` → break（后面的段更靠右，不可能相交）；
- 若 `lineStart >= meta.graphemeEnd` → continue；
- `start = max(lineStart, meta.graphemeStart)`，`end = min(lineEnd, meta.graphemeEnd)`；
  `end <= start` → 跳过；
- `localStart = start - lineStart`，`localEnd = end - lineStart`；
- `text`：整段被覆盖时直接用 `prepared.segments[i]`，否则用
  `splitGraphemes(segmentText).slice(start - meta.graphemeStart, end - meta.graphemeStart).join('')`；
- `measuredGlyphOffsets = measureSegmentGlyphOffsets(text, fontSpec)`（见 §4.7）；
- `x = widthBetweenOffsets(prepared, segmentMetas, lineStart, start)`，
  `width = widthBetweenOffsets(prepared, segmentMetas, start, end)`；
- `isFullSegment = start === meta.graphemeStart && end === meta.graphemeEnd`。

**为什么要有 `measuredGlyphOffsets`**：pretext 的宽度是**换行拟合宽度**，而 fillText 的裁剪需要
**实际绘制宽度**。这两者（尤其在有 emoji / 字体回退时）不完全一致，所以每个片段额外用 canvas
逐前缀测一次真实宽度。

### 4.7 片段逐字素测量（缓存）

```ts
const SEGMENT_MEASURE_CACHE_LIMIT = 2048
let segmentMeasureCanvas: HTMLCanvasElement | null = null
const segmentMeasureCache = new Map<string, number[]>()

measureSegmentGlyphOffsets(text, fontSpec) => number[]   // 私有
  // cacheKey = `${fontSpec}__${text}`
  // 命中直接返回；否则 splitGraphemes(text)，用 measurePrefixOffsets 逐前缀
  //   context.measureText(prefix).width 求 offsets（长度 = 字素数 + 1）
  // 结果写进 rememberBounded(segmentMeasureCache, cacheKey, measured, 2048)
```

- **无 DOM 时**（`typeof document === 'undefined'`）返回全 0 数组（长度仍正确）；
- canvas 取不到 context 时同样返回全 0；
- `context.font = fontSpec` 每次都设，防止别的测量改动字体。

> 缓存键**包含 fontSpec（字重 + 字号 + 字体栈）**，所以字号一变自然就是新键；
> 上限 2048 是为了长会话不无限增长（一首歌的片段数远小于此）。

### 4.8 字体串

```ts
buildFontSpec(fontPx, variant, fontFamily, theme) =>
  `${fontWeight} ${fontPx}px ${fontFamily}`
  // fontWeight = resolveThemeFontWeight(theme, variant === 'hero' ? 780 : 640)
```

**默认字重：hero 780 / body 640**（在主题没给 `fontWeight` 时）。主题一旦指定 `fontWeight`
（Folia 是 100..900 的 10 的倍数，`normalizeFontWeight` 会四舍五入）就覆盖这两个默认值。

### 4.9 其他小工具

```ts
buildWordRangeIndexByOffset(graphemeCount, wordRanges, rangeKind = 'timing') => number[]
  // 初始填 -1；rangeKind==='color' 时用 colorStart/colorEnd，否则 start/end

countRenderableGraphemes(text) => splitGraphemes(text).filter(v => v.trim().length > 0).length
  // 注意：按字素数算，空白不算，标点**算**

resolveRenderLineOffset(renderLine, localOffset)
  // <=0 → 0；>= 字素数 → renderLine.width；否则 glyphOffsets[localOffset]

resolveSegmentGlyphOffset(segment, globalOffset)
  // localOffset = clamp(globalOffset - segment.start, 0, measuredGlyphOffsets.length - 1)

resolveSegmentGlyphAdvance(segment, globalOffset)
  // localOffset = clamp(globalOffset - segment.start, 0, measuredGlyphOffsets.length - 2)
  // return max(offsets[localOffset + 1] - offsets[localOffset], 0)
```

### 4.10 字号二分（`buildPreparedSingleLine`）

```ts
buildPreparedSingleLine(text, fontFamily, width, variant, lyricsFontScale, densityScale, heroScale, theme)
  => { fontPx, prepared, layout }
```

```
low  = variant === 'hero' ? 18 : 10
high = variant === 'hero' ? 58 : 30
best = null

重复 8 次：
  candidateFontPx = ((low + high) / 2) * lyricsFontScale * densityScale * (hero ? heroScale : 1)
  fontSpec = buildFontSpec(candidateFontPx, variant, fontFamily, theme)
  prepared = prepareWithSegments(text, fontSpec, FUME_PRETEXT_OPTIONS)
  layout   = layoutWithLines(prepared, width, round(candidateFontPx * (hero ? 1.02 : 1.06)))
  若 layout.lineCount <= 1：best = { fontPx: candidateFontPx, prepared, layout }；low = (low + high) / 2
  否则：high = (low + high) / 2

若 best 有值 → 返回 best
否则（8 次都没能排成单行）→ 用最小字号兜底：
  fallbackFontPx = (hero ? 18 : 10) * lyricsFontScale * densityScale * (hero ? heroScale : 1)
  重建 prepared / layout 并返回
```

> 关键点：**浮名的字号不是「算出来的」而是「二分搜出来的」**，判据是「这一行能不能塞进
> 区块宽度成为一行」。上限 58/30、下限 18/10 是搜索区间，不是结果钳制；
> 结果字号可以**超出** `[low, high]` 之外的钳制，因为还要乘三个倍率（这也是为什么它在本项目
> 里需要按音符数量控制布局成本）。

---

## 5. 逐字揭示（`fumeReveal.ts`）

### 5.1 词区间

```ts
buildWordRangesFromWords(line, graphemes) => WordRange[]
```

1. `line.words.length === 0 || graphemes.length === 0` → `[]`
2. `rangedWords = line.words.filter(w => splitGraphemes(w.text).length > 0)`；为空 → `[]`
3. `cursor = 0`，逐个词：
   - `start = clamp(cursor, 0, graphemes.length)`
   - `end = clamp(start + 该词字素数, start, graphemes.length)`
   - **吞掉紧随其后的空白字素**：`while (end < len && /\s/.test(graphemes[end])) end++`
     （原因注释在源码 `fumeReveal.ts:28-30`：有些歌词数据的 `word.text` 不含词间空格，
     而 `fullText` 含；把空格归给前一个词，视觉流才不会整体左移）
   - push `{ wordIndex, word, start, end, colorStart: start, colorEnd: end,
     graphemeTimings: buildWordGraphemeTimings(word) }`
   - `cursor = end`

### 5.2 单字进度

```ts
resolveWordRevealProgress(range, t) => number   // 私有
  if (range.word.endTime <= range.word.startTime) return t >= range.word.endTime ? 1 : 0
  duration = max(range.word.endTime - range.word.startTime, 0.08)
  return clamp((t - range.word.startTime) / duration, 0, 1)
```

```ts
resolvePrintedGlyphsInRange(range, t) => number   // 私有
  length = max(range.end - range.start, 0)；length === 0 → 0
  t < range.word.startTime → 0
  // 有音节（syllables）时用音节派生的字素时间
  timedGlyphCount = range.word.syllables?.length ? min(graphemeTimings.length, length) : 0
  if (timedGlyphCount > 0):
      if (t >= range.word.endTime) return length
      落在 [0, timedGlyphCount) 中最后一个 graphemeTimings[i].startTime <= t 的 i，printed = i + 1
      return clamp(printed, 0, length)
  // 无音节：按词进度摊
  progress = resolveWordRevealProgress(range, t)
  if (progress >= 1) return length
  return clamp(floor(progress * length + 0.2), progress > 0 ? 1 : 0, length)
```

> `+ 0.2` 是**取整偏置**：进度刚过 0 就立刻显示第一个字（配合下限 1），避免「词开始了但一个字都还没出现」。

### 5.3 行过场截止时间

```ts
resolveLinePassCutoffTime(line, nextLineStartTime) => number
  renderEndTime = getLineRenderEndTime(line)
  若 nextLineStartTime 不是有限数字 → renderEndTime
  否则 min(renderEndTime, nextLineStartTime)
```

即：**「唱过」的判定窗口不会超过下一行的开始时间**。歌词数据里下一行提前 0.2s 进来是常态，
这条规则保证当前行的颜色拖尾不会跨到下一行的镜头里。

### 5.4 带截止的视觉进度

```ts
resolveVisualProgressWithCutoff(startedAt, duration, t, cutoffTime) => number
  nominalEnd  = startedAt + max(duration, 0.001)
  effectiveEnd = max(startedAt + 0.001, min(nominalEnd, cutoffTime))
  return clamp((t - startedAt) / max(effectiveEnd - startedAt, 0.001), 0, 1)
```

这是整首歌里出现次数最多的进度公式（相机、拖尾、印章都用它）。

### 5.5 行级已打印字素数

```ts
resolvePrintedGraphemeCount(line, wordRanges, graphemeCount, t) => number
  graphemeCount === 0 → 0
  t < line.startTime → 0
  t >= line.endTime → graphemeCount           // 注意：判据是 line.endTime，不是 renderEndTime
  wordRanges.length === 0  →  时长 = max(line.endTime - line.startTime, 0.12)
                              progress = clamp((t - line.startTime) / 时长, 0, 1)
                              return clamp(floor(progress * graphemeCount + (progress > 0 ? 1 : 0)), 0, graphemeCount)
  否则逐词累加：
      printed = range.start + resolvePrintedGlyphsInRange(range, t)
      若 partial < range.end - range.start → 立刻返回 clamp(printed, 0, graphemeCount)
  全部走完 → clamp(printed, 0, graphemeCount)
```

### 5.6 行级已打印进度（浮点）

```ts
resolvePrintedGraphemeProgress(line, wordRanges, graphemeCount, t) => number
  // 与 §5.5 同构，但用 resolveWordRevealProgress 的浮点值：
  //   printed = range.start + progress * length；progress < 1 立即返回
  //  无词时：progress = clamp((t - line.startTime) / max(line.endTime - line.startTime, 0.12), 0, 1)
  //           return clamp(progress * graphemeCount, 0, graphemeCount)
```

**两者必须同时实现**：`stepped` 相机模式用整数版（§9.2），`smooth` 模式用浮点版，
这样「相机跟随打印光标」在两种模式下都不会跳。

---

## 6. 文字样式（`fumeTextStyle.ts`）

### 6.1 唱过样式

```ts
resolvePassedTextStyle(variant, textHoldStyle) =>
  textHoldStyle === 'dimmed'
    ? { opacity: hero ? 0.11 : 0.075, glowMultiplier: 0, shadowAlphaBase: 0,  shadowAlphaTrail: 0 }
    : { opacity: hero ? 0.74 : 0.58,  glowMultiplier: 1, shadowAlphaBase: 0.1, shadowAlphaTrail: 0.16 }
```

- `standard`：歌词一直留在纸上（本项目默认 `textHoldRatio = 1` 时走这条）；
- `dimmed`：歌词逐渐「退成纸痕」（`textHoldRatio < 1`）。

### 6.2 渐隐量

```ts
resolvePassedDimAmount(t, passedAt, fadeDuration) => number
  // 任一非有限 / fadeDuration <= 0 → 1
  passedAge = max(t - passedAt, 0)
  return easeInCubic(clamp(passedAge / fadeDuration, 0, 1))
```

### 6.3 渐隐总时长

```ts
resolveFumePassedFadeDuration(lines, textHoldRatio) => number
  textHoldRatio >= 1 → Number.POSITIVE_INFINITY     // 永不渐隐

  timedLines = lines.map(l => ({ start: l.startTime, end: getLineRenderEndTime(l) }))
                    .filter(有限且 end >= start)
                    .sort(按 start 升序)
  cacheKey = 各 `start.toFixed(3):end.toFixed(3)` 用 '|' 连接 + `:${textHoldRatio.toFixed(3)}`
  （模块级单条缓存：lastFumePassedFadeDurationCache，命中直接返回）

  timedLines.length <= 1 → clamp(8 * textHoldRatio, 2.4, 130)
  否则 totalDuration = max(最后.end - 第一.start, 0)
       return clamp(totalDuration * textHoldRatio, 2.4, 130)
```

> 注意 `textHoldRatio >= 1` 时返回 `+Infinity`：这个值一路传到 `resolvePassedDimAmount`，
> 被「非有限 → 1」的规则吸收，等价于「立刻完全 dim」；而 `resolveFumeBlockTiming` 里
> `textHoldRatio >= 1` 会把 `effectiveTextHoldStyle` 定成 `'standard'`，所以实际上永不渐隐。

### 6.4 活动字色

```ts
getActiveColor(wordText, theme) =>
  resolveWordColor(wordText, theme.wordColors, theme.accentColor, { cjkMatchMode: 'bidirectional-contains' })
```

> 与经典模式的差别：浮名用的是 **`bidirectional-contains`**（关键词与词互相包含都算命中），
> 默认的 `target-contains-token` 会漏掉「词是关键词子串」的情形。移植时别用错模式。

---

## 7. 文章布局（`fumeArticleLayout.ts`）—— 最重要的一步

### 7.1 布局缓存键

```ts
buildLayoutCacheKey(lines, viewport, layoutTheme, lyricsFontScale, fumeTuning) => string
```

```ts
let linesHash = 2166136261
for (const line of lines) {
  const lineKey = `${line.startTime}:${line.endTime}:${line.fullText}:${line.words.length}:${line.isChorus ? 1 : 0}`
  linesHash ^= hashString(lineKey)
  linesHash = Math.imul(linesHash, 16777619)
}
return [
  Math.round(viewport.width), Math.round(viewport.height),
  layoutTheme.fontStyle, layoutTheme.fontFamily ?? '',
  layoutTheme.fontFamilyStack?.join(',') ?? '', layoutTheme.fontWeight ?? 'auto',
  layoutTheme.name,
  lyricsFontScale.toFixed(4), fumeTuning.heroScale.toFixed(4),
  lines.length, linesHash >>> 0,
].join('|')
```

**缓存键故意忽略播放状态**（源码注释 `fumeArticleLayout.ts:145-146`）：只有影响几何的输入才该
让整篇文章重排。`layoutTheme` 只取 `Pick<Theme, 'name'|'fontStyle'|'fontFamily'|'fontFamilyStack'|'fontWeight'>`，
**颜色 / 动画强度改了不会重排**。

### 7.2 区块变体选择

```ts
chooseNaturalBlockVariant(line, index, total) => 'body' | 'hero'   // 私有
  graphemeCount = countRenderableGraphemes(line.fullText)
  graphemeCount === 0 → 'body'
  line.isChorus && graphemeCount <= 22 → 'hero'                // 副歌肯定给 hero
  shortEnough = graphemeCount >= 4 && graphemeCount <= 28
  centered = |index - total / 2| / max(total, 1)
  random = seeded(`${line.fullText}:${index}`)
  return shortEnough && centered < 0.72 && ((index + 1) % 6 === 0 || random > 0.965)
    ? 'hero' : 'body'
```

```ts
chooseFallbackHeroBlockIndex(entries) => number   // 私有；-1 = 不需要强制
  空 → -1
  若已有任何自然 hero（对过滤后的下标做同一次判断）→ -1
  否则给每块打分，取最高：
    graphemeCount === 0 → 跳过
    comfortable = 4..28；acceptable = <= 36；两者都不是 → 跳过
    centered = |i - n/2| / max(n,1)；centerScore = 1 - centered
    lengthScore = 6..22 ? 1 : (<= 28 ? 0.72 : 0.36)
    chorusScore = line.isChorus ? 0.28 : 0
    jitter = seeded(`${line.fullText}:${i}:fallback-hero`) * 0.04
    score = centerScore * 0.62 + lengthScore * 0.34 + chorusScore + jitter
  若一个都没选上 → 退化为「字素数最少且 > 0 的那块」的下标；都没有 → -1

chooseBlockVariant(line, index, total, forcedHeroIndex) =>    // 私有
  index === forcedHeroIndex ? 'hero' : chooseNaturalBlockVariant(line, index, total)
```

**语义**：如果整首歌没有一行「天然够格」当 hero（全都太长 / 太短），就强制把某一块提升为 hero，
保证整张纸**至少有一个大标题块**，否则视觉上全是小字、没有节奏。

### 7.3 区块宽度与 hero 跨列

```
heroSpanColumns = variant === 'hero' ? min(columns, columns <= 1 ? 1 : 2) : 1
heroSpanWidth   = heroSpanColumns > 1
  ? columnWidth * heroSpanColumns + gap * (heroSpanColumns - 1)
  : paperWidth

blockWidth =
  hero  ? (heroSpanColumns === 1 ? paperWidth
         : columns === 2 ? columnWidth * 1.5 + gap * 0.5
         : heroSpanWidth)
        : columnWidth

paddingX = 0；paddingY = 0
innerWidth = max(blockWidth - paddingX * 2, 120)
```

> 2 列时 hero 用 `columnWidth * 1.5 + gap * 0.5`：**不跨满两列，而是 1.5 列**；3/4 列时跨两列满宽。

### 7.4 列高装箱

```
columnHeights = Array(columns).fill(verticalMargin)
bodyColumnTieCursor = 0；heroPlacementTieCursor = 0

hero:
  heroSpanColumns === 1：
      y = max(...columnHeights)          // 跨整纸：必须等所有列都到那儿
      x = horizontalMargin
      columnHeights[0] = y + blockHeight + blockGap
  heroSpanColumns > 1：
      在 startColumn ∈ [0, columns - heroSpanColumns] 里找「覆盖高度」最小的起点：
        coveredHeight = max(columnHeights[startColumn .. startColumn + heroSpanColumns - 1])
      并列时用 heroPlacementTieCursor % candidateStarts.length 轮转，然后 cursor++
      y = bestHeight
      x = horizontalMargin + targetStart * (columnWidth + gap)
          + max((heroSpanWidth - blockWidth) * 0.5, 0)
      区间内每列 columnHeights 都设为 y + blockHeight + blockGap

body:
  找最低的列；并列时用 bodyColumnTieCursor % candidateColumns.length 轮转，然后 cursor++
  x = horizontalMargin + targetColumn * (columnWidth + gap)
  y = columnHeights[targetColumn]
  columnHeights[targetColumn] = y + blockHeight + blockGap
```

**为什么有 tie cursor**：高度并列是常态（歌曲开头所有列都在 `verticalMargin`），
固定取第 0 列会把块全堆在左边；轮转游标让并列时自动铺开。

### 7.5 垂直间距与块高

```
fontPx     = preparedSingleLine.fontPx
lineHeight = round(fontPx * (hero ? 1.02 : 1.06))
blockGap   = hero ? max(round(lineHeight * 0.2), 6) : max(round(lineHeight * 0.08), 2)
blockHeight = paddingY * 2 + layout.lines.length * lineHeight
```

### 7.6 渲染行细节

```ts
renderLines = layout.lines.map((layoutLine, lineIndex) => {
  const start = cursorToGlobalOffset(layoutLine.start, segmentMetas)
  const end   = cursorToGlobalOffset(layoutLine.end,   segmentMetas)
  const lineGraphemes = splitGraphemes(layoutLine.text)
  return {
    id: `${line.startTime}-${lineIndex}`,
    text: layoutLine.text, start, end, graphemes: lineGraphemes,
    glyphOffsets: buildGlyphOffsets(prepared, segmentMetas, start, lineGraphemes.length),
    segments: buildRenderSegments(prepared, segmentMetas, start, end, fontSpec),
    left: hero ? Math.max((blockWidth - layoutLine.width) * 0.08, 0) : 0,
    top: paddingY + lineIndex * lineHeight,
    width: layoutLine.width,
  }
})
```

> **hero 的缩进系数是 0.08**：让 hero 行整体右移一点（最多 8% 剩余宽度），制造「标题块不齐左」的观感；
> body 恒为 0。

### 7.7 一次「尝试」（`buildArticleLayoutAttempt`）

两个重载 + 一个实现（`fumeArticleLayout.ts:169-192`）：

```
入参守卫：viewport.width <= 0 || viewport.height <= 0 || lines.length === 0 → null

读 options：paperWidth, viewportHeight, columns, gap, densityScale, seedKey, mode='render', timing
shouldBuildRenderDetails = (mode === 'render')

horizontalMargin = max(viewport.width * 0.86, 280)
verticalMargin   = max(viewport.height * 0.82, 220)
columnWidth      = (paperWidth - gap * (columns - 1)) / columns
fontFamily       = resolveThemeFontStack(layoutTheme)

filteredLines = lines.map((line, index) => ({ line, index }))
                     .filter(entry => entry.line.fullText.trim().length > 0)
                     .sort((a, b) => seeded(`${seedKey}:${a.index}:${a.line.fullText}`)
                                   - seeded(`${seedKey}:${b.index}:${b.line.fullText}`))
```

**为什么要排序**：源码注释（`…:212-213`）——「空行对排版没有帮助；同时确定性地打乱放置顺序，
让纸面像是被『编排』过，而不是严格按时间顺序堆叠」。注意 `sort` 的比较函数每次调用都会重算
`seeded`（O(n log n) 次哈希），这是可以预计算再排的小优化点。

随后逐块（`filteredLines.forEach`，下标即 `blockIndex`）：

1. `variant = chooseBlockVariant(line, blockIndex, filteredLines.length, forcedHeroIndex)`
2. 按 §7.3 求 `blockWidth / innerWidth`，`preparedSingleLine = buildPreparedSingleLine(...)`
   （`densityScale`、`lyricsFontScale`、`fumeTuning.heroScale` 都传进去）
3. 按 §7.5 求尺寸，按 §7.4 装箱得到 `x / y`
4. `mode === 'render'` 时才构建 §7.6 的 `renderLines`，并 push 完整 `FumeBlock`

循环结束后：

```
articleHeight = max(0, ...columnHeights) + verticalMargin
metrics = {
  width: paperWidth + horizontalMargin * 2,
  height: articleHeight,
  viewportHeight, columns, gap,
  paperBounds: {
    left: horizontalMargin,
    top: verticalMargin,
    right: horizontalMargin + paperWidth,
    bottom: max(articleHeight - verticalMargin, verticalMargin),
  },
}
```

`mode === 'measure'` 到此返回 `metrics`；否则再补：

```
chronologicalBlocks = [...blocks].sort((a, b) => a.sourceLineIndex - b.sourceLineIndex)
blockBySourceLineIndex = Map(sourceLineIndex → block)
firstRenderableStartTime = chronologicalBlocks[0]?.line.startTime ?? +Infinity
lastChronologicalRenderEndTime =
    chronologicalBlocks.length > 0 ? getLineRenderEndTime(最后一块.line) : -Infinity
```

> `paperBounds.bottom` 用的是 `articleHeight - verticalMargin`（= 最后一列的底），
> 而不是 `articleHeight`：背景里的形状锚定在**纸张内容区**周围，不是整张世界图。

### 7.8 顶层：选列数与密度（`buildArticleLayout`）

```
public buildArticleLayout(lines, viewport, layoutTheme, lyricsFontScale, fumeTuning) => FumeArticleLayout | null

守卫：viewport 非正 或 lines 为空 → null

paperWidth = clamp(max(viewport.width * 1.95, viewport.width + 520), 920, 2400)
viewportHeight = max(viewport.height, 240)
maxColumns = paperWidth >= 1120 ? 4 : paperWidth >= 760 ? 3 : paperWidth >= 500 ? 2 : 1
targetHeight = viewportHeight * 2.45
layoutSeedKey = layoutTheme.name

bestScore = +Infinity；bestOptions = null

for (let columns = maxColumns; columns >= 1; columns -= 1) {
  gap = clamp(round(paperWidth * (columns >= 4 ? 0.0065 : columns === 3 ? 0.0085 : 0.0115)), 6, 14)
  low = 0.82；high = 1.42
  for (let iteration = 0; iteration < 8; iteration += 1) {
    densityScale = (low + high) / 2
    layout = buildArticleLayoutAttempt(..., { mode:'measure', densityScale,
      seedKey: `${layoutSeedKey}:${columns}:${paperWidth}` })
    if (!layout) continue
    coveragePenalty = |layout.height - targetHeight|
    overflowPenalty = layout.height < targetHeight ? 0 : (layout.height - targetHeight) * 0.14
    score = coveragePenalty + overflowPenalty
    if (score < bestScore) { bestScore = score; bestHeight = layout.height; bestOptions = { ...同参数, mode:'render' } }
    if (layout.height < targetHeight) low = densityScale
    else high = densityScale
  }
}

article = bestOptions ? buildArticleLayoutAttempt(..., bestOptions) : null
```

要点：

- **纸张比视口宽 1.95 倍**（且至少宽 520px），钳在 `[920, 2400]` —— 这是「多栏文章」的来源；
- **目标高度 = 视口高 × 2.45**：理想情况下整页要滚 2.45 屏；
- 列数从 `maxColumns` **递减到 1**；列间距按 `paperWidth` 比例取值（3 档系数 0.0065 / 0.0085 / 0.0115），
  钳在 `[6, 14]`；
- 每列做 **8 次二分**（`densityScale` 从 `[0.82, 1.42]`），目标函数是
  `|height - targetHeight| + (height > targetHeight ? (height - targetHeight) * 0.14 : 0)`；
  **偏高只加 14% 的惩罚**（允许略高，因为超出部分只是多滚一点），**偏低是全额惩罚**（缺内容会显得空）；
- 二分方向：`height < targetHeight` → 增大密度（`low = densityScale`），否则 `high = densityScale`；
- 最后用**选中的参数再跑一次 `mode:'render'`**，这一次才真正构建所有区块与渲染行。

`import.meta.env.DEV` 下会打印一段 `[VisualizerFume] layout timing` 汇总（`…:542-578`），
包含 attempts / measuredLines / renderedLines / blocks / heroBlocks / viewport / paperWidth /
targetHeight / bestHeight / heightDelta / bestColumns / bestDensityScale 与三段耗时拆解。
**移植时建议保留同类日志**（本项目用 `import.meta.env.DEV` 门控），它排布局问题的效率极高。

### 7.9 调度与缓存（`VisualizerFume.tsx`）

```ts
let lastFumeLayoutCache: { key: string; article: FumeArticleLayout | null } | null = null  // 模块级
const LAYOUT_REBUILD_DEBOUNCE_MS = 96
```

effect 逻辑（`VisualizerFume.tsx:150-195`）：

```
requestVersion = ++layoutBuildVersionRef
若 viewport 非正 或 lines 为空：
    hasResolvedArticleRef = false；setArticle(null)；setIsLayoutPending(false)；return

setIsLayoutPending(true)
delay = hasResolvedArticleRef.current ? 96 : 0        // 首次立即算，之后防抖
raf = requestAnimationFrame(() => {
  timeout = setTimeout(() => {
    if (layoutBuildVersionRef !== requestVersion) return     // 过期请求丢弃
    key = buildLayoutCacheKey(...)
    next = lastFumeLayoutCache?.key === key ? lastFumeLayoutCache.article : buildArticleLayout(...)
    if (layoutBuildVersionRef !== requestVersion) return
    lastFumeLayoutCache = { key, article: next }
    hasResolvedArticleRef = next !== null
    setArticle(next); setIsLayoutPending(false)
  }, delay)
})
return () => { cancelAnimationFrame(raf); clearTimeout(timeout) }
```

依赖数组：`[layoutFumeTuning, layoutTheme, lines, lyricsFontScale, viewport]`。

**两个容易漏的点**：

1. `requestVersion` 检查**出现两次**（setTimeout 回调开头 & 布局算完之后）——因为
   `buildArticleLayout` 是同步长任务，中途用户可能已经换了歌；
2. 传给布局的 tuning 不是完整的 `resolvedFumeTuning`，而是
   `{ ...DEFAULT_FUME_TUNING, heroScale: resolvedFumeTuning.heroScale }`（`…:145-148`）——
   **布局只受 `heroScale` 影响**，其余调参（相机速度、辉光、透明度…）不参与排版，也不该让文章重排。

### 7.10 视口与背景场景

```ts
// 视口：ResizeObserver 观察 stage 容器，尺寸不变则保持同一个对象（避免无谓重排）
new ResizeObserver(entries => setViewport(prev =>
  prev.width === nextWidth && prev.height === nextHeight ? prev : { width: nextWidth, height: nextHeight }))

// 背景场景（world 就是文章尺寸；无文章时用视口的 1.8 倍兜底）
buildFumeBackgroundScene({
  viewport,
  world: {
    width:  article?.width  ?? Math.max(viewport.width  * 1.8, viewport.width),
    height: article?.height ?? Math.max(viewport.height * 1.8, viewport.height),
  },
  paperBounds: article?.paperBounds,
  seed: `${seed ?? 'fume'}:${theme.name}`,
})

// 总览镜头
overviewCamera = article ? resolveArticleOverviewCamera(article, viewport) : null

// 总览开始时刻：最后一条**可渲染**行的起止中点
lastRenderableLine = 从后往前第一条 fullText.trim() 非空的行
overviewStartTime = lastRenderableLine
  ? lineStartTime + max(getLineRenderEndTime(line) - lineStartTime, 0) * 0.5
  : +Infinity
```

> `overviewStartTime` 是**「最后一行唱到一半」**，不是唱完：总览镜头提前起飞，
> 让最后的字在镜头拉远的过程中继续打印。

### 7.11 本项目的适配缺口

| Folia 概念 | 本项目现状 | 处理建议 |
| --- | --- | --- |
| `Line.words[]`（词级时间戳，秒） | `LyricLine.words?: LyricWord[]`（`{ word, timeMs, durationMs, trailing? }`，毫秒） | 适配层转成 `{ text, startTime: timeMs/1000, endTime: (timeMs+durationMs)/1000 }`；**没有 words** 时 `wordRanges = []`，走 §5.5 的整行摊分路径 |
| `Line.syllables`（字级时间） | **本项目无音节数据**（`LyricWord` 只有 `trailing`） | `graphemeTimings` 会退化成「词内均分」，这与 §5.2 的 `timedGlyphCount = 0` 分支等价 → 走 `floor(progress * length + 0.2)` |
| `Line.isChorus` | **本项目无** | 变体选择里把 `isChorus` 恒当 `false`：hero 全靠 `(index+1) % 6 === 0 \|\| random > 0.965` 与 fallback 逻辑。**副作用**：副歌不再优先给 hero，长副歌行会全部落成 body。建议先照此实现（行为可预期），若视觉不满意再单独定一条本项目自己的规则 |
| `Line.renderHints`（预计算的过场/揭示模式） | **本项目无** | 用 `getLineRenderEndTime` 的等价实现：本项目 `LyricLine` 没有 `endTime`，需按「下一行 `timeMs` 兜底、最后一行用 `timeMs + 时长估计`」推算（参考 tilt 适配层的行结束时间推算思路） |
| `wordSegments` / `autoWordSegments` | **本项目无** | 不做；词边界完全由 `words` 或整行给出 |
| `Line.translation` / `romanization` | **本项目有** `translation` / `romaji` | 底部字幕层可直接复用（§14.2） |

---

## 8. 区块逐帧判定（`fumeBlockFrame.ts`）

### 8.1 辉光基量

```ts
resolveFumeGlowBases(animationIntensity, glowIntensity) => {
  activeGlowBoost: (chaotic ? 1.15 : calm ? 0.72 : 0.92) * glowIntensity,
  passedGlowBase:  (chaotic ? 0.95 : calm ? 0.35 : 0.62) * glowIntensity,
}
```

### 8.2 在屏判定

```ts
isFumeBlockOnScreen(block, camera, viewport, overscan = 180) => boolean
  screenScale = camera.scale
  screenLeft = viewport.width  * 0.5 + (block.x - camera.x) * screenScale
  screenTop  = viewport.height * 0.5 + (block.y - camera.y) * screenScale
  screenRight  = screenLeft + block.width  * screenScale
  screenBottom = screenTop  + block.height * screenScale
  return !(screenRight  < -overscan || screenLeft > viewport.width  + overscan
        || screenBottom < -overscan || screenTop  > viewport.height + overscan)
```

> 这行 `screenLeft/Top` 公式就是**世界 → 屏幕**变换（与 §10.2 的 canvas 变换等价）；
> 移植时应把这一条抽成共享函数，避免两处各写一份：
> `screenX = vw/2 + (worldX - camera.x) * scale`、`screenY = vh/2 + (worldY - camera.y) * scale`。

### 8.3 区块时序

```ts
resolveFumeBlockTiming(block, time, nextLineStartTime, textHoldRatio) => FumeBlockTiming

waitingOpacity       = block.variant === 'hero' ? 0.06 : 0.035
activeOpacity        = block.variant === 'hero' ? 0.985 : 0.92
effectiveTextHoldStyle = textHoldRatio >= 1 ? 'standard' : 'dimmed'
passedStyle            = resolvePassedTextStyle(block.variant, effectiveTextHoldStyle)
transitionPassedStyle  = resolvePassedTextStyle(block.variant, 'standard')
baselineOffset         = block.lineHeight * (isCJK(block.line.fullText) ? 0.52 : 0.5)
lineEndTime            = getLineRenderEndTime(block.line)
linePassCutoffTime     = resolveLinePassCutoffTime(block.line, nextLineStartTime)
revealCompleteTime     = block.line.endTime
hasRevealCompleted     = time >= revealCompleteTime
hasPassCutoffReached   = time >= linePassCutoffTime
lineDuration           = max(lineEndTime - block.line.startTime, 0.18)
colorTrailDuration     = clamp(lineDuration * (hero ? 0.42 : 0.52), 0.45, 1.45)
staticState            = time < block.line.startTime ? 'waiting'
                       : time >= lineEndTime + colorTrailDuration ? 'passed'
                       : null                       // null = 必须实时绘制
```

**这是整条渲染分流的依据**：

- `waiting` / `passed` → 用**离屏快照**（§11.1），每帧只是 `drawImage`；
- `null` → **必须逐字素实时绘制**（§11.3）。

### 8.4 静态层

```ts
interface FumeSnapshotSpec { key: string; fill: string; shadowBlur: number; shadowColor: string }

resolveFumeStaticLayers(block, timing, input, getSnapshot) => Array<{ snapshot: T; alpha: number }> | null
  input = { time, theme, passedGlowBase, passedFadeDuration, overviewTextRestoreProgress, snapshotScale }

  staticState === null → null                       // 实时绘制
  cacheStyleKey = staticState === 'passed' ? effectiveTextHoldStyle : 'base'
  snapshot = getSnapshot({
    key: `${block.id}:${staticState}:${cacheStyleKey}:${snapshotScale}`,
    fill: staticState === 'waiting'
      ? colorWithAlpha(theme.primaryColor, waitingOpacity)
      : colorWithAlpha(theme.primaryColor, passedStyle.opacity),
    shadowBlur: staticState === 'waiting' ? 0
      : (2 + block.fontPx * 0.1) * 0.65 * passedGlowBase * passedStyle.glowMultiplier,
    shadowColor: staticState === 'waiting' ? 'transparent'
      : colorWithAlpha(theme.primaryColor, passedStyle.shadowAlphaBase),
  })
  snapshot 拿不到 → null（调用方回落到实时绘制）

  if (staticState === 'passed' && effectiveTextHoldStyle === 'dimmed') {
    passedAt  = lineEndTime + colorTrailDuration
    baseDim   = resolvePassedDimAmount(time, passedAt, passedFadeDuration)
    dimAmount = baseDim * (1 - overviewTextRestoreProgress)   // 总览时纸痕「重新变清楚」
    standardSnapshot = getSnapshot({ key: `${block.id}:passed:standard:${snapshotScale}`,
                                     fill/shadow 用 standard 样式, shadowBlur = (2 + fontPx*0.1)*0.65*passedGlowBase })
    若 standardSnapshot 拿得到：
      dimAmount <= 0 → [{ standard, alpha: 1 }]
      dimAmount <  1 → [{ standard, alpha: 1 - dimAmount }, { dimmedSnapshot, alpha: dimAmount }]
  }
  return [{ snapshot, alpha: 1 }]
```

**两条关键设计**：

1. **快照与「变暗程度」解耦**：dim 是通过**两个快照互相叠加**（standard + dimmed 各带 alpha）实现的，
   所以 dim 的连续变化不需要重建快照 —— 否则每帧都要重画一遍文字，浮名的性能会直接崩掉。
2. **总览会恢复清晰**：`dimAmount = baseDim * (1 - overviewTextRestoreProgress)`，
   拉远看整页时，被 dim 的纸痕重新变清楚（因为此时它们不再是「干扰」，而是「内容」）。

---

## 9. 相机（`fumeCamera.ts` + `fumeCameraStep.ts`）

相机是浮名的灵魂：**它决定了「你看到的是一篇被读着的文章」，而不是一堆堆上去的字。**

### 9.1 常量

```
CAMERA_SCALE_MIN = 0.22
CAMERA_SCALE_MAX = 2.24
OVERVIEW_CAMERA_SOURCE = -2
FUME_CAMERA_TELEPORT_TRIGGER_SCREENS = 2.75     // 长距离桥接触发阈值（屏幕数）
```

### 9.2 两种跟随模式下的焦点

```ts
resolveSteppedBlockFocusPoint(block, printedCount) => { x, y }   // 整数光标
  renderLines 为空 → 区块中心 (x + width/2, y + height/2)
  effectiveOffset = clamp(printedCount, 0, graphemes.length)
  targetLine = 第一个满足 effectiveOffset <= renderLine.end 的渲染行（都没有则最后一行）
  localOffset = clamp(effectiveOffset, targetLine.start, targetLine.end)
  progressWidth = widthBetweenOffsets(block.prepared, block.segmentMetas, targetLine.start, localOffset)
  minX = block.x + targetLine.left；maxX = minX + targetLine.width
  return { x: clamp(minX + progressWidth, minX, maxX),
           y: block.y + targetLine.top + block.lineHeight * 0.5 }
```

```ts
resolveSmoothBlockFocusPoint(block, printedProgress) => { x, y }   // 浮点光标
  renderLines 为空 → 区块中心
  effectiveOffset = clamp(printedProgress, 0, graphemes.length)
  findRenderLineIndex(offset) = 第一个 offset <= renderLine.end 的下标，否则最后一行
  resolvePointOnRenderLine(lineIndex, offset)：
    clampedOffset = clamp(offset, targetLine.start, targetLine.end)
    baseOffset = floor(clampedOffset)；fractionalOffset = clampedOffset - baseOffset
    baseWidth = widthBetweenOffsets(..., targetLine.start, baseOffset)
    localGlyphIndex = baseOffset - targetLine.start
    glyphAdvance = (0 <= localGlyphIndex < targetLine.graphemes.length)
      ? resolveGlyphAdvance(targetLine, localGlyphIndex) : 0
    x = clamp(minX + baseWidth + glyphAdvance * fractionalOffset, minX, maxX)
    y = block.y + targetLine.top + block.lineHeight * 0.5

  crossLineBlendWindow = 0.7
  若 targetLineIndex > 0 且 effectiveOffset < currentLine.start + 0.7：
      blend = easeInOutCubic(clamp(1 - ((effectiveOffset - previousLine.end) / 0.7), 0, 1))
      point = mix(point, resolvePointOnRenderLine(targetLineIndex - 1, previousLine.end), blend)
  否则若 targetLineIndex < 最后一行 且 effectiveOffset > currentLine.end - 0.7：
      blend = easeInOutCubic(clamp((effectiveOffset - (currentLine.end - 0.7)) / 0.7, 0, 1))
      point = mix(point, resolvePointOnRenderLine(targetLineIndex + 1, nextLine.start), blend)
```

**跨行混合窗口 0.7**（字素单位）：在换行边界前 0.7 个字处，相机开始悄悄移到下一行的起点，
这样「文本换行」不会让镜头瞬移。

```ts
resolveBlockEntryFocusPoint(block) => 区块第一渲染行的左端中点
  // { x: block.x + firstRenderLine.left,
  //   y: block.y + firstRenderLine.top + block.lineHeight * 0.5 }
  // 即「这一块开始打印的地方」—— 进场时相机先落在这里（见 §9.5 的 entryFocusBias）
```

### 9.3 缩放与重定位时长

```ts
resolveCameraScaleForBlock(block, viewport) =>
  minSide = max(min(viewport.width, viewport.height), 1)
  targetLineHeight = clamp(minSide * 0.115, 64, 124)
  clamp(targetLineHeight / max(block.lineHeight, 1), 0.88, 2.2)

resolveCameraRetargetDuration(line) =>        // 秒
  hints = getLineRenderHints(line)；无 hints → 0.09
  transitionTiming = getLineTransitionTiming(hints.rawDuration, hints.lineTransitionMode, hints.wordRevealMode)
  lineTransitionMode === 'none' → clamp(max(hints.rawDuration, 0.08) * 0.34, 0.04, 0.075)
  lineTransitionMode === 'fast' → clamp(enter * 0.5 + exit * 0.12, 0.055, 0.095)
  否则                          → clamp(enter * 0.44 + linePassHold * 0.22, 0.075, 0.13)

resolveOverviewRetargetDuration(viewport) =>
  clamp(min(viewport.width, viewport.height) / 1500, 0.38, 0.58)
```

**「行越长，镜头切得越快」**：`rawDuration` 越大 → `enter/exit/linePassHold` 越大 → 重定位时长越大，
但都被钳在 ≤ 0.13s。也就是说逐行推进的镜头移动几乎是**瞬切 + 弹性收敛**，
只有长距离移动才会走 §9.6 的桥接。

### 9.4 总览镜头

```ts
resolveArticleOverviewCamera(article, viewport) => CameraViewTarget
  article.blocks.length === 0 →
    fitScale = min(viewport.width / max(article.width,1), viewport.height / max(article.height,1))
    return { x: article.width/2, y: article.height/2, scale: clamp(fitScale * 0.92, CAMERA_SCALE_MIN, 0.72) }

  // 否则用**所有区块的包围盒** + 内边距
  minX/minY/maxX/maxY = 遍历所有 block 的 (x, y, x + width, y + height)
  paddingX = clamp(viewport.width  * 0.2, 120, 280)
  paddingY = clamp(viewport.height * 0.2,  96, 220)
  framedWidth  = max(maxX - minX + paddingX * 2, 1)
  framedHeight = max(maxY - minY + paddingY * 2, 1)
  fitScale = min(viewport.width / framedWidth, viewport.height / framedHeight)
  return { x: (minX + maxX)/2, y: (minY + maxY)/2, scale: clamp(fitScale, CAMERA_SCALE_MIN, 0.72) }
```

> **上限 0.72**：总览也不会真的缩到「整页全见」那么小，而是略近 —— 让纸上的字还看得出形状。

### 9.5 目标区块选择

```ts
resolveFocusBlock(article, currentLineIndex, currentTimeValue) => FumeBlock | null
  currentLineIndex >= 0：
      active = blockBySourceLineIndex.get(currentLineIndex)
      有 → 直接返回
  最后一块存在 且 currentTimeValue >= lastChronologicalRenderEndTime → 返回最后一块
  从时间序末尾往前扫：第一块 resolvePrintedGraphemeCount(...) > 0 的 → 返回
  都没有 → chronologicalBlocks[0] ?? null
```

> 「从后往前找第一个已经打印过至少一个字」= 相机永远盯着**最近有内容的那一块**，
> 当前行索引缺失时（例如插曲/间奏）也不会飞回开头。

### 9.6 长距离桥接路径

```ts
resolveOverviewFlightBridge({
  fromX, fromY, fromScale, targetX, targetY, targetScale, overviewCamera, viewport
}) => { waypointX, waypointY, waypointScale, waypointPhase, duration } | null

  overviewCamera 为空 → null
  safeScale = max(fromScale, targetScale, overviewCamera.scale, 0.001)
  minSide = max(min(viewport.width, viewport.height), 1)
  worldDistance = hypot(fromX - targetX, fromY - targetY)
  screenDistance = worldDistance * safeScale
  worldDistance <= 0 或 screenDistance < minSide * 2.75 → null

  loftStrength = clamp((screenDistance / minSide - 2.75) / 3.4, 0, 1)
  midpointX = mix(fromX, targetX, 0.5)；midpointY = mix(fromY, targetY, 0.5)
  waypointCenterBias = mix(0.18, 0.42, loftStrength)
  waypointX = mix(midpointX, overviewCamera.x, waypointCenterBias)
  waypointY = mix(midpointY, overviewCamera.y, waypointCenterBias)

  endpointScale = max(fromScale, targetScale, 0.001)
  loftedScale = endpointScale * mix(0.62, 0.4, loftStrength)
  overviewLimitedScale = overviewCamera.scale * mix(1.85, 1.55, loftStrength)
  waypointScale = clamp(max(loftedScale, overviewLimitedScale),
                        CAMERA_SCALE_MIN, max(endpointScale * 0.92, CAMERA_SCALE_MIN))

  dFromStart = hypot(waypointX - fromX, waypointY - fromY) * max(fromScale, waypointScale, 0.001)
  dToTarget = hypot(targetX - waypointX, targetY - waypointY) * max(targetScale, waypointScale, 0.001)
  total = dFromStart + dToTarget
  waypointPhase = total <= 0 ? 0.36 : clamp(dFromStart / total, 0.26, 0.44)
  duration = clamp(0.26 + (screenDistance / (minSide * 5.5)) * 0.28, 0.3, 0.68)
```

**直觉**：两个区块隔得太远（≥ 2.75 屏）时，直接插值等于「穿墙飞行」，会看到大量空白。
于是路径中间插一个**靠近总览镜头的路径点**（`waypointCenterBias` 越大越靠总览中心），
同时把 `waypointScale` 压到接近总览的缩放 —— 视觉上就是「拉远、快速滑过去、再推进去」。
`loftStrength` 是这次「抬升」的强度：距离越远越靠中间、缩得越小。

### 9.7 状态机与每帧积分（`stepFumeCamera`）

`FumeCameraState` 的初值（`fumeCameraStep.ts:19-45`）：

```
initialized = false
retarget = { sourceLineIndex:-1, startedAt:0, duration:0.18, fromX/Y:0, fromScale:1,
             bridgeMode:'none', bridgeWaypointX/Y:0, bridgeWaypointScale:1, bridgeWaypointPhase:0.36 }
camera   = { x:0, y:0, velocityX:0, velocityY:0, focusX:0, focusY:0, scale:1, velocityScale:0, focusScale:1 }
```

```ts
syncFumeCameraToArticle(state, article)
  article && !initialized：把相机放到 (article.width/2, article.height/2)、scale = 1.18，
                           focus 同值、速度归零、initialized = true
  article &&  initialized：把 x/y/focusX/focusY 钳进 [0, article.width/height]，
                           scale/focusScale 钳进 [CAMERA_SCALE_MIN, CAMERA_SCALE_MAX]
  否则：initialized = false
```

`stepFumeCamera(state, input)` 的输入（§2.7 之外）：

```
article, time(秒), now(墙钟 ms), dt(秒), lineIndex, viewport,
overviewCamera, overviewStartTime, cameraSpeed, cameraTrackingMode, staticMode, animationIntensity
```

#### 步骤 1：决定目标

```
focusBlock = resolveFocusBlock(article, lineIndex, time)
shouldShowOverview = overviewCamera !== null && time >= overviewStartTime
targetCameraX = article.width  * 0.5
targetCameraY = article.height * 0.5
targetCameraScale = 1.18
entryFocusPoint = null；didRetargetThisFrame = false

若 shouldShowOverview：
    target = overviewCamera
    若 retarget.sourceLineIndex !== OVERVIEW_CAMERA_SOURCE：
        retarget = { sourceLineIndex: -2, startedAt: time,
                     duration: clamp(resolveOverviewRetargetDuration(viewport) / cameraSpeed, 0.12, 1.2),
                     from = 当前相机, bridgeMode:'none', bridgeWaypoint* 归零, phase:0.36 }
        didRetargetThisFrame = true
否则若 focusBlock：
    focusPoint = stepped ? resolveSteppedBlockFocusPoint(block, resolvePrintedGraphemeCount(...))
                          : resolveSmoothBlockFocusPoint(block, resolvePrintedGraphemeProgress(...))
    entryFocusPoint = resolveBlockEntryFocusPoint(focusBlock)
    target = focusPoint；targetScale = resolveCameraScaleForBlock(focusBlock, viewport)
    若 retarget.sourceLineIndex !== focusBlock.sourceLineIndex：
        retarget = { sourceLineIndex: focusBlock.sourceLineIndex, startedAt: time,
                     duration: clamp(resolveCameraRetargetDuration(focusBlock.line) / cameraSpeed, 0.03, 0.3),
                     from = 当前相机, bridgeMode:'none', ... }
        didRetargetThisFrame = true
否则若 retarget.sourceLineIndex !== -1：
    retarget = { sourceLineIndex: -1, startedAt: time, duration: clamp(0.18 / cameraSpeed, 0.05, 0.4),
                 from = 当前相机, bridgeMode:'none', ... }
    didRetargetThisFrame = true
```

#### 步骤 2：进度、进场偏置与呼吸浮动

```
retargetElapsed = max(time - retarget.startedAt, 0)
overviewTextRestoreProgress =
    shouldShowOverview && retarget.sourceLineIndex === -2
      ? easeInOutCubic(clamp(retargetElapsed / max(retarget.duration, 0.001), 0, 1))
      : 0
retargetPhase = clamp(retargetElapsed / max(retarget.duration, 0.001), 0, 1)
retargetBoost = 1 - easeOutCubic(retargetPhase)     // 1 → 0：重定位刚发生时最大
entryFocusBias = pow(retargetBoost, 0.58)

若 entryFocusPoint 非空：
    targetX = mix(targetX, entryFocusPoint.x, entryFocusBias)
    targetY = mix(targetY, entryFocusPoint.y, entryFocusBias)
```

**`entryFocusBias` 的用意**：重定位刚开始时，镜头先偏向**这一块的起点**（还没打印的第一个字），
随着 `retargetPhase → 1`，`entryFocusBias → 0`，镜头滑到真正的打印光标处。
这制造了「刚进入这一块时先看到标题/行首」的节奏。

```
若 !staticMode：
    floatConfig = chaotic ? { distance:24, duration:5.8,  scaleAmplitude:0.014 }
                : calm    ? { distance:14, duration:8.5,  scaleAmplitude:0.008 }
                          : { distance:18, duration:7,    scaleAmplitude:0.011 }
    floatPhase = (now / 1000 / duration) * PI * 2
    overviewAttenuation = shouldShowOverview ? 0.36 : 1
    screenFloatX = sin(floatPhase * 0.74 + 0.8) * distance * 0.34
    screenFloatY = (sin(floatPhase) * distance
                    + sin(floatPhase * 0.5 + 1.1) * distance * 0.22) * overviewAttenuation
    worldDivisor = max(targetCameraScale, 0.001)
    targetX -= screenFloatX / worldDivisor
    targetY -= screenFloatY / worldDivisor
    targetScale = clamp(targetScale * (1 + sin(floatPhase + 0.9) * scaleAmplitude * overviewAttenuation),
                        CAMERA_SCALE_MIN, CAMERA_SCALE_MAX)
```

**呼吸浮动在屏幕空间定义，再除以缩放折回世界空间** —— 所以不论镜头拉多近/多远，
「屏幕上的飘动幅度」是恒定的（这正是它像「手持拍摄」而不是「纸在抖」的原因）。
总览时纵向浮动衰减到 36%，横向**不衰减**（`screenFloatX` 没有乘 `overviewAttenuation`）。

#### 步骤 3：本帧重定位则决定桥接模式

```
若 didRetargetThisFrame：
    bridgeScale = max(相机当前 scale, targetScale, 0.001)
    screenDelta = hypot(|targetX - retarget.fromX|, |targetY - retarget.fromY|) * bridgeScale
    retarget.bridgeMode = screenDelta >= min(viewport.w, viewport.h) * 0.42 ? 'direct' : 'none'
    retarget.bridgeWaypoint* = 当前 target；bridgeWaypointPhase = 0.5

    若 retarget.sourceLineIndex >= 0：             // 只对「区块 → 区块」尝试总览桥接
        bridge = resolveOverviewFlightBridge({ from: retarget.from*, target: target, overviewCamera, viewport })
        若 bridge：
            bridgeMode = 'overview'
            bridgeWaypoint* = bridge.waypoint*；bridgeWaypointPhase = bridge.waypointPhase
            retarget.duration = max(retarget.duration, clamp(bridge.duration / cameraSpeed, 0.16, 0.9))
```

三种桥接模式的语义：

| 模式 | 触发 | 路径 |
| --- | --- | --- |
| `none` | 位移 < 0.42 屏 | 直接弹簧收敛（下面 §步骤 5 的 else 分支） |
| `direct` | 位移 ≥ 0.42 屏 | 直线 `easeInOutCubic` 插值 from → target（+ 追赶平滑） |
| `overview` | 位移 ≥ 2.75 屏 **且**有总览镜头 **且**目标是区块 | 二次贝塞尔 from → 路径点 → target（+ 追赶平滑） |

#### 步骤 4：桥接执行

```
cameraDistance = hypot(targetX - camera.x, targetY - camera.y)
shouldUseBridge = retarget.bridgeMode !== 'none' && retargetPhase < 1

若 shouldUseBridge：
    overview:  bridgePhase = easeOutCubic(retargetPhase)
               bridged* = quadraticBezier(from*, bridgeWaypoint*, target*, bridgePhase)
    direct:    bridgePhase = easeInOutCubic(retargetPhase)
               bridged* = mix(from*, target*, bridgePhase)
    bridgeCatchUp = 1 - exp(-dt * (overview ? mix(12.5, 22, 1 - retargetPhase)
                                          : mix(10.5, 17.5, 1 - retargetPhase)))
    focus = bridged*；camera.* += (bridged* - camera.*) * bridgeCatchUp
    scale 再钳进 [MIN, MAX]
    velocityX *= 0.72；velocityY *= 0.72；velocityScale *= 0.68
```

> 桥接期间**不走弹簧**，而是「解析路径 + 指数追赶」：路径保证视觉形状（弧线），
> 追赶保证不会穿帮（路径因浮动/目标变化而漂移时能跟上）。
> 追赶率随 `retargetPhase` 增大而增大（越接近终点追得越紧）。

#### 步骤 5：普通弹簧收敛

```
boostedCatchUpRate = clamp(4.8 / max(retarget.duration, 0.05), 20, 54)
targetCatchUp = 1 - exp(-dt * mix(11.2, boostedCatchUpRate, retargetBoost))
camera.focusX += (targetX - camera.focusX) * targetCatchUp
camera.focusY += (targetY - camera.focusY) * targetCatchUp
camera.focusScale += (targetScale - camera.focusScale) * (1 - exp(-dt * mix(5.4, 12.8, retargetBoost)))

springStrength = mix(208, clamp(15.8 / max(retarget.duration², 0.0064), 260, 780), retargetBoost)
damping        = mix(24,  clamp(sqrt(springStrength) * 1.36, 24, 40), retargetBoost)

accelX = (camera.focusX - camera.x) * springStrength - camera.velocityX * damping
accelY = (camera.focusY - camera.y) * springStrength - camera.velocityY * damping
camera.velocityX += accelX * dt；camera.velocityY += accelY * dt

maxVelocity = mix(1320, clamp(cameraDistance / max(retarget.duration * 0.28, 0.028), 2600, 8800), retargetBoost)
velocityX/Y 各自钳到 ±maxVelocity
camera.x += velocityX * dt；camera.y += velocityY * dt

scaleSpringStrength = mix(54, 108, retargetBoost)
scaleDamping        = mix(13.5, 21, retargetBoost)
accelScale = (camera.focusScale - camera.scale) * scaleSpringStrength - camera.velocityScale * scaleDamping
camera.velocityScale += accelScale * dt；钳到 ±1.6
camera.scale += camera.velocityScale * dt；钳进 [CAMERA_SCALE_MIN, CAMERA_SCALE_MAX]
```

**阻尼系数 1.36** 是临界阻尼的 1.36 倍（过阻尼）：镜头不会过冲回弹，只会「稳稳贴上」。
`retargetBoost` 把刚度从 208 拉到 260..780，也就是「刚切行时收紧，稳定后放松」。

#### 返回值

```ts
stepFumeCamera(...) => { shouldShowOverview: boolean; overviewTextRestoreProgress: number }
```

`overviewTextRestoreProgress` 只被 §8.4 的快照 alpha 使用。

### 9.8 背景视差视图

```ts
FUME_BACKGROUND_PARALLAX_X = 0.9
FUME_BACKGROUND_PARALLAX_Y = 0.74
FUME_BACKGROUND_SCALE_FACTOR = 0.94
FUME_BACKGROUND_VERTICAL_OFFSET_RATIO = 0.22

resolveFumeBackgroundView(backgroundScene, camera, viewport) => {
  screenScale = camera.scale
  backgroundCenterX = backgroundScene.width  * 0.5
  backgroundCenterY = backgroundScene.height * 0.5
  backgroundVerticalOffset = clamp(viewport.height * 0.22 / max(screenScale, 0.001), 48, 180)
  backgroundCameraX = mix(backgroundCenterX, camera.x, 0.9)
  backgroundCameraY = mix(backgroundCenterY, camera.y, 0.74) - backgroundVerticalOffset
  backgroundScale   = clamp(screenScale * 0.94, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX)
  return { backgroundCenterX, backgroundCenterY, backgroundCameraX, backgroundCameraY, backgroundScale }
}
```

**背景比文字慢**（x 跟 90%、y 跟 74%），且**整体下移**（最多 180px 世界单位），
缩放也略小（0.94）。这三条合起来把背景钉在「更远的一层」上。

---

## 10. 文字绘制（`fumeCanvasText.ts`）

### 10.1 字体串与基线

```ts
buildCanvasFont(block, theme) =>
  buildFontSpec(block.fontPx, block.variant, resolveThemeFontStack(theme), theme)
```

每次绘制前都显式设置 `context.font` / `textAlign = 'left'` / `textBaseline = 'middle'`。
基线 offset（两处必须一致：`fumeCanvasText.ts:83` 与 `fumeBlockFrame.ts:69`）：

```
baselineOffset = block.lineHeight * (isCJK(block.line.fullText) ? 0.52 : 0.5)
基线 y = block.y + renderLine.top + baselineOffset
```

> CJK 用 0.52 而非 0.5：中文字面的视觉中心略低，0.02 的修正让中英混排看起来在同一行。

### 10.2 静态快照

```ts
createStaticBlockSnapshot(block, theme, fillStyle, shadowBlur = 0, shadowColor = 'transparent')
  => { canvas: HTMLCanvasElement; padding: number } | null
```

```
rasterScale = clamp(window.devicePixelRatio || 1, 1, 2)          // DPR 上限 2
padding     = ceil(max(block.fontPx * 0.32, shadowBlur + block.fontPx * 0.08, 4))
canvas.width  = max(1, ceil((block.width  + padding * 2) * rasterScale))
canvas.height = max(1, ceil((block.height + padding * 2) * rasterScale))

context.setTransform(rasterScale, 0, 0, rasterScale, 0, 0)
context.font = buildCanvasFont(block, theme)；textAlign 'left'；textBaseline 'middle'
context.fillStyle = fillStyle；shadowBlur = shadowBlur；shadowColor = shadowColor

for (const renderLine of block.renderLines)
  context.fillText(renderLine.text, renderLine.left + padding,
                   renderLine.top + baselineOffset + padding)

context.shadowBlur = 0；context.shadowColor = 'transparent'
```

要点：快照是**整块一张** canvas；`padding` 是给辉光留的边（贴回时必须一起用，§11.3）；
快照只画「一种填充色 + 一种阴影」，**不含颜色拖尾** —— 连续变化交给 alpha 叠加（§8.4）。

### 10.3 裁剪文本运行

```ts
buildTextStyleKey(fillStyle, shadowBlur, shadowColor) =>
  `${fillStyle}|${shadowColor}|${shadowBlur.toFixed(3)}`

drawRenderTextRun(context, renderLine, segment, runStart, runEnd, baseX, baseY)
```

```
segmentRunStart = max(runStart - segment.localStart, 0)
segmentRunEnd   = min(runEnd   - segment.localStart, segment.measuredGlyphOffsets.length - 1)
clipLeft  = segment.measuredGlyphOffsets[segmentRunStart]
            ?? (resolveRenderLineOffset(renderLine, runStart) - segment.x)
clipRight = segment.measuredGlyphOffsets[segmentRunEnd]
            ?? (resolveRenderLineOffset(renderLine, runEnd)   - segment.x)
clipWidth = max(clipRight - clipLeft, 0)
clipWidth <= 0 → return

context.save()
context.beginPath()
context.rect(baseX + segment.x + clipLeft,
             baseY - max(clipWidth, 1) - 64,
             clipWidth,
             max(128 + clipWidth * 2, 256))
context.clip()
context.fillText(segment.text, baseX + segment.x, baseY)
context.restore()
```

裁剪矩形**横向精确到字素**，纵向刻意开得很高（容纳 ascent/descent 与辉光）：
高度写成 `128 + clipWidth * 2`、上边界 `-clipWidth - 64` 是原实现的写法，
**照抄**，不要改成固定高度（它随字宽增长，从而在各种字号下都留够空间）。

### 10.4 实时逐字素绘制 `drawFumeLiveBlock`

```ts
drawFumeLiveBlock(context, block, timing,
  { time, theme, glowIntensity, activeGlowBoost, passedGlowBase, showPrintStamp })
```

前提：`context` 的变换**已经**是「世界坐标 → 设备像素」（由调用方设置，§11.3/§11.5），
函数内部只关心世界坐标。

#### (a) 准备

```
printedCount = resolvePrintedGraphemeCount(block.line, block.wordRanges, block.graphemes.length, time)
totalGraphemeCount = block.graphemes.length

context.save()
context.font = buildCanvasFont(block, theme)；textAlign 'left'；textBaseline 'middle'
isLineActive = time >= block.line.startTime && time <= linePassCutoffTime
```

#### (b) 整行辉光（仅该行活跃时）

```
若 isLineActive：
  lineProgress = resolveVisualProgressWithCutoff(block.line.startTime, lineDuration, time, linePassCutoffTime)
  lineGlowEnvelope = resolveDelayedGlowEnvelope(lineProgress, 0.8)

  lineGlowAlpha = ((hero ? 0.16 : 0.12) + lineGlowEnvelope * (hero ? 0.26 : 0.2)) * glowIntensity
  lineGlowBlur  = ((hero ? 12 : 8) + lineGlowEnvelope * (block.fontPx * (hero ? 0.7 : 0.52))) * glowIntensity

  context.fillStyle = colorWithAlpha(theme.accentColor, lineGlowAlpha)
  setCanvasTextGlow(context, quantizeShadowBlur(lineGlowBlur),
                    colorWithAlpha(theme.accentColor, lineGlowAlpha * 1.35))

  for (const renderLine of block.renderLines)
    for (const segment of renderLine.segments)
      if (segment.text.trim().length !== 0)
        fillGlowText(context, segment.text,
                     block.x + renderLine.left + segment.x,
                     block.y + renderLine.top + baselineOffset)
```

这一层辉光是**整行**的、颜色是 `theme.accentColor`；与逐字主体色（`getActiveColor`）是两套。
用 `fillGlowText`（而不是 `fillText`）是为了把带 filter 的绘制裁到文字包围盒内（§16）。

#### (c) 逐片段、逐字素

```
对每个 renderLine：
  baseX = block.x + renderLine.left
  baseY = block.y + renderLine.top + baselineOffset

  对每个 segment：
    runStart = -1；runFillStyle = ''；runShadowBlur = 0；runShadowColor = 'transparent'；runStyleKey = ''

    flushRun(segmentEnd)：
      if (runStart < 0 || !runStyleKey || segmentEnd <= runStart) return
      localStart = runStart - renderLine.start；localEnd = segmentEnd - renderLine.start
      runText = renderLine.graphemes.slice(localStart, localEnd).join('')
      if (!runText || (runText.trim().length === 0 && runFillStyle === '')) { runStart = -1; return }
      context.fillStyle = runFillStyle
      setCanvasTextGlow(context, runShadowBlur, runShadowColor)
      drawRenderTextRun(context, renderLine, segment, localStart, localEnd, baseX, baseY)
      clearCanvasTextGlow(context)
      runStart = -1；runStyleKey = ''

    for (globalOffset = segment.start; globalOffset < segment.end; globalOffset += 1)：
      graphemeIndex = globalOffset - renderLine.start
      grapheme      = renderLine.graphemes[graphemeIndex]
      rangeIndex    = block.wordRangeIndexByOffset[globalOffset] ?? -1
      range         = rangeIndex >= 0 ? block.wordRanges[rangeIndex] : null
      colorIndex    = block.colorRangeIndexByOffset[globalOffset] ?? -1
      colorRange    = colorIndex >= 0 ? block.wordRanges[colorIndex] : range

      isPrinted  = hasRevealCompleted || globalOffset < printedCount
      isFrontier = printedCount > 0 && globalOffset === printedCount
                   && printedCount < totalGraphemeCount && !hasRevealCompleted && !hasPassCutoffReached

      alpha      = isPrinted ? activeOpacity : (isFrontier ? 0.82 : waitingOpacity)
      shadowBlur = 0；shadowColor = 'transparent'
      fillStyle  = colorWithAlpha(theme.primaryColor, alpha)

      if (range) {
        wordDuration = max(range.word.endTime - range.word.startTime, 0.08)
        wordProgress = clamp((time - range.word.startTime) / wordDuration, 0, 1)
        glyphCount   = max(range.end - range.start, 1)
        glyphIndexInRange = globalOffset - range.start

        glyphTiming = range.word.syllables?.length
          ? range.graphemeTimings[min(glyphIndexInRange, max(range.graphemeTimings.length - 1, 0))]
          : undefined
        glyphStartTime = glyphTiming?.startTime ?? (range.word.startTime + (glyphIndexInRange / glyphCount) * wordDuration)
        glyphEndTime   = glyphTiming?.endTime   ?? (range.word.startTime + ((glyphIndexInRange + 1) / glyphCount) * wordDuration)
        glyphDuration  = max(glyphEndTime - glyphStartTime, 0.001)

        glyphProgress = glyphTiming
          ? clamp((time - glyphStartTime) / glyphDuration + 0.16, 0, 1)
          : clamp(wordProgress * glyphCount - glyphIndexInRange + 0.16, 0, 1)
        easedGlyphProgress = easeOutCubic(glyphProgress)

        activeColor = getActiveColor((colorRange ?? range).word.text, theme)
        glyphTrailStart = glyphStartTime + glyphDuration * 0.18
        colorTrailProgress = pow(
          resolveVisualProgressWithCutoff(glyphTrailStart, colorTrailDuration, time, linePassCutoffTime), 1.35)

        if (hasPassCutoffReached) {
          alpha = mix(activeOpacity, transitionPassedStyle.opacity, colorTrailProgress)
          fillStyle = mixColors(activeColor, theme.primaryColor, 0.18 + colorTrailProgress * 0.82, alpha)
          shadowBlur = (2 + block.fontPx * 0.1) * (1 - colorTrailProgress * 0.35)
                       * passedGlowBase * transitionPassedStyle.glowMultiplier
          shadowColor = colorWithAlpha(
            mixColors(activeColor, theme.primaryColor, 0.55 + colorTrailProgress * 0.45),
            transitionPassedStyle.shadowAlphaBase
              + (1 - colorTrailProgress) * transitionPassedStyle.shadowAlphaTrail)
        } else if (time < range.word.startTime) {
          alpha = waitingOpacity
          fillStyle = colorWithAlpha(theme.primaryColor, alpha)
        } else if (time <= glyphTrailStart) {          // 正在打印
          alpha = mix(waitingOpacity, activeOpacity, easedGlyphProgress)
          fillStyle = mixColors(theme.primaryColor, activeColor, 0.22 + easedGlyphProgress * 0.78, alpha)
          shadowBlur = (4 + block.fontPx * 0.22) * easedGlyphProgress * activeGlowBoost
          shadowColor = colorWithAlpha(activeColor, 0.4 + easedGlyphProgress * 0.44)
        } else {                                       // 已打印，颜色拖尾
          alpha = mix(activeOpacity, transitionPassedStyle.opacity, colorTrailProgress)
          fillStyle = mixColors(activeColor, theme.primaryColor, 0.18 + colorTrailProgress * 0.82, alpha)
          shadowBlur = (2 + block.fontPx * 0.1) * (1 - colorTrailProgress * 0.35)
                       * passedGlowBase * transitionPassedStyle.glowMultiplier
          shadowColor = colorWithAlpha(
            mixColors(activeColor, theme.primaryColor, 0.55 + colorTrailProgress * 0.45),
            transitionPassedStyle.shadowAlphaBase
              + (1 - colorTrailProgress) * transitionPassedStyle.shadowAlphaTrail)
        }

        if (showPrintStamp && grapheme.trim().length > 0) { ...见 §10.5... }
      }

      if (alpha <= 0.002) { flushRun(globalOffset); continue }

      shadowBlur = quantizeShadowBlur(shadowBlur)      // 整像素化（§16）
      styleKey = buildTextStyleKey(fillStyle, shadowBlur, shadowColor)

      if (runStart < 0) { runStart = globalOffset；记录 style；continue }
      if (styleKey !== runStyleKey) { flushRun(globalOffset)；runStart = globalOffset；记录 style }

    flushRun(segment.end)

context.restore()
```

三个必须记住的常量：`+0.16`（揭示提前量）、`glyphTrailStart = glyphStartTime + glyphDuration * 0.18`、
`pow(colorTrailPhase, 1.35)`（拖尾前慢后快）。

**为什么要合并 run**：`fillStyle / shadowBlur / shadowColor` 相同就合并成一次
`setCanvasTextGlow + clip + fillText`。稳定状态下相邻字 style 相同，
于是「一字一次绘制」退化成「一串字一次绘制」——这是帧率的主要来源。

### 10.5 打印印章

```
glyphWindowDuration = max(wordDuration / glyphCount, 0.04)
activationLeadDuration = clamp(min(glyphWindowDuration * 0.86, lineDuration * 0.16),
                              0.055, hero ? 0.2 : 0.16)
activationReleaseDuration = activationLeadDuration * 0.42
activationWindowStart = glyphTrailStart - activationLeadDuration
activationWindowEnd   = glyphTrailStart + activationReleaseDuration

glyphAdvance  = resolveSegmentGlyphAdvance(segment, globalOffset)
stampProgress = resolveVisualProgressWithCutoff(activationWindowStart,
                  activationWindowEnd - activationWindowStart, time, linePassCutoffTime)
只在 0 < stampProgress < 1 时绘制印章

glyphTrailPhase = resolveVisualProgressWithCutoff(glyphTrailStart,
                    max(activationWindowEnd - glyphTrailStart, 0.001), time, linePassCutoffTime)
isDropping = glyphTrailPhase <= 0
dropProgress = isDropping
  ? easeOutCubic(resolveVisualProgressWithCutoff(activationWindowStart,
      max(glyphTrailStart - activationWindowStart, 0.001), time, linePassCutoffTime))
  : 1
fadeProgress = isDropping ? 0 : easeInOutCubic(glyphTrailPhase)
blockPulse   = isDropping ? mix(0.18, 1, pow(dropProgress, 0.78)) : pow(1 - fadeProgress, 1.2)

glyphVisualWidth = max(glyphAdvance * 0.88, isCJK(grapheme) ? fontPx * 0.56 : fontPx * 0.38)
blockCenterX = baseX + segment.x + resolveSegmentGlyphOffset(segment, globalOffset) + glyphAdvance * 0.5
dropDistance = block.lineHeight * (hero ? 0.24 : 0.2)
activationBlockAlpha  = blockPulse * (hero ? 0.82 : 0.72)
activationBlockWidth  = glyphVisualWidth + fontPx * (hero ? 0.18 : 0.12)
activationBlockHeight = fontPx * (hero ? 0.72 : 0.62)
activationBlockY = baseY - fontPx * 0.38 - mix(dropDistance, 0, dropProgress)
activationBlockBlur = (8 + fontPx * 0.24) * blockPulse * activeGlowBoost

context.fillStyle = colorWithAlpha(activeColor, activationBlockAlpha)
context.shadowBlur = activationBlockBlur
context.shadowColor = colorWithAlpha(activeColor, 0.56 * blockPulse)
context.fillRect(blockCenterX - activationBlockWidth / 2,
                 activationBlockY - activationBlockHeight / 2,
                 activationBlockWidth, activationBlockHeight)
```

**视觉含义**：每个字被「打印」前，有一个实心方块从上方落下再淡出 —— 像活字印刷的印模。
默认开启（`hidePrintSymbols` 可关），是浮名最有辨识度的细节之一。

---

## 11. 栅格化与每帧流程（`useFumeCanvasStage.ts` / `fumeLiveRaster.ts`）

### 11.1 快照缓存

```
SNAPSHOT_IDLE_MS = 15_000
cache: Map<key, { snapshot: StaticBlockSnapshot; lastUsed: number }>     // useRef，跨帧存活

releaseSnapshots(cache, now)：
  now - entry.lastUsed <= 15_000 → 跳过
  entry.snapshot.canvas.width = 0；entry.snapshot.canvas.height = 0   // 立刻把 backing store 还回去
  cache.delete(key)
```

全量清空时机（`useFumeCanvasStage.ts:35-51`）：

- 卸载 → 释放全部快照 + `liveRaster.clear()`；
- `article` / `theme.name` / `theme.primaryColor` / `theme.secondaryColor` / `theme.accentColor` /
  `theme.fontStyle` / `theme.fontFamily` / `theme.fontFamilyStack` 变化 → 释放全部。

> 快照里烤了颜色与字体，所以这些字段必须参与失效；`theme.backgroundColor` 不在列表里，
> 因为快照不画背景（底色由外壳画）。

### 11.2 effect 初始化（只跑一次）

```
effect deps: [article, canvasRef, driver, paused, scene, theme]
  canvas 或 context 取不到 → 直接 return
  liveRaster ??= new FumeLiveRaster()
  let hasPrintedContent = false                        // effect 局部（不是 state）
  width  = max(floor(viewport.width), 1)；height = max(floor(viewport.height), 1)
  dpr    = window.devicePixelRatio || 1
  若 canvas.width !== floor(width * dpr) || canvas.height !== floor(height * dpr)：
      canvas.width = floor(width * dpr)；canvas.height = floor(height * dpr)
      canvas.style.width = `${width}px`；canvas.style.height = `${height}px`
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)
  syncFumeCameraToArticle(cameraState, article)
  lastFrameAt = null
  draw()                                               // 立即画第一帧
  return () => { cancelAnimationFrame(frameId); lastFrameAt = null }
```

> `canvas.width = ...` 会清空画布并重置变换，所以**尺寸检查必须在 `setTransform` 之前**。
> `driver` / `scene` 是 useMemo 出来的对象，依赖变化时会重跑整个 effect（重置帧计时但**不重置相机**，
> 因为 `cameraState` 由组件持有）。

### 11.3 `draw()` 每帧流程（严格按序）

```
now = performance.now()
dt  = lastFrameAt === null ? 1/60 : clamp((now - lastFrameAt) / 1000, 1/240, 0.05)
lastFrameAt = now

① 尺寸/DPR 复查（窗口缩放、跨屏拖动 DPR 变化）
   若 canvas.width !== floor(currentWidth * currentDpr) 等 → 重设 canvas 尺寸与 style
   context.setTransform(currentDpr, 0, 0, currentDpr, 0, 0)
   context.clearRect(0, 0, currentWidth, currentHeight)          // 每帧全屏清屏，无脏区优化

   time = currentTime.get()
   viewportCenterX = viewport.width * 0.5；viewportCenterY = viewport.height * 0.5
   audioLevels = readFumeAudioLevels(driver)

② 无文章时：只画背景，世界中心对到视口中心
   若 !article：
     若 !staticMode：
        save → translate(viewportCenterX, viewportCenterY)
             → translate(-backgroundScene.width/2, -backgroundScene.height/2)
        drawFumeBackground({ context, scene: backgroundScene, theme,
                             time: time + now * 0.00018,       // 播放时间 + 墙钟漂移
                             audioLevels,
                             objectOpacityMultiplier: backgroundObjectOpacity * 2 })
        restore
     若 !paused → requestAnimationFrame(draw)；return

③ 一次性：第一个区块开始打印
   若 !hasPrintedContent && time >= article.firstRenderableStartTime：
       hasPrintedContent = true；driver.onPrintedContent()

④ 相机步进
   { overviewTextRestoreProgress } = stepFumeCamera(cameraState, {
       article, time, now, dt, lineIndex: driver.getLineIndex(), viewport,
       overviewCamera, overviewStartTime, cameraSpeed, cameraTrackingMode,
       staticMode, animationIntensity: theme.animationIntensity })
   camera = cameraState.camera；screenScale = camera.scale

⑤ 背景层
   若 !staticMode：
     { backgroundCenterX, backgroundCenterY, backgroundCameraX, backgroundCameraY, backgroundScale }
       = resolveFumeBackgroundView(backgroundScene, camera, viewport)
     save → translate(viewportCenterX, viewportCenterY)
          → scale(backgroundScale, backgroundScale)
          → translate(-backgroundCameraX, -backgroundCameraY)
     drawFumeBackground({ context, scene, theme, time, audioLevels,
                          objectOpacityMultiplier: backgroundObjectOpacity * 2,
                          parallax: { cameraX: backgroundCameraX, cameraY: backgroundCameraY,
                                      originX: backgroundCenterX, originY: backgroundCenterY,
                                      strength: 0.72 } })
     restore

⑥ 文字层：世界变换
   save → translate(viewportCenterX, viewportCenterY)
        → scale(screenScale, screenScale)
        → translate(-camera.x, -camera.y)

   { activeGlowBoost, passedGlowBase } = resolveFumeGlowBases(theme.animationIntensity, glowIntensity)
   liveParams       = { time, theme, glowIntensity, activeGlowBoost, passedGlowBase, showPrintStamp }
   staticLayerInput = { time, theme, passedGlowBase, passedFadeDuration,
                        overviewTextRestoreProgress, snapshotScale: clamp(dpr, 1, 2) }
   rasterLive = isGlowBlurQuantized()
   margin     = 32 / screenScale                       // 让「即将进屏」的字提前画好
   liveFrame  = { deviceScale: screenScale * dpr,
                  visible: { left:  camera.x - viewportCenterX / screenScale - margin,
                             top:   camera.y - viewportCenterY / screenScale - margin,
                             right: camera.x + viewportCenterX / screenScale + margin,
                             bottom:camera.y + viewportCenterY / screenScale + margin } }

   若 showText：
     for (const block of article.blocks) {
       若 !isFumeBlockOnScreen(block, camera, viewport) → continue      // 180px 外跳过
       timing = resolveFumeBlockTiming(block, time,
                  lines[block.sourceLineIndex + 1]?.startTime ?? null, textHoldRatio)
       layers = resolveFumeStaticLayers(block, timing, staticLayerInput,
                  spec => 查快照缓存，没有就 createStaticBlockSnapshot，更新 lastUsed)
       若 layers 非空：
         for ({ snapshot, alpha })：
           context.globalAlpha = alpha
           context.drawImage(snapshot.canvas,
                             block.x - snapshot.padding, block.y - snapshot.padding,
                             block.width + snapshot.padding * 2, block.height + snapshot.padding * 2)
         context.globalAlpha = 1
         continue
       若 !rasterLive：
         drawFumeLiveBlock(context, block, timing, liveParams)          // 直接在舞台变换下画
         continue
       image = liveRaster.draw(block, timing, liveParams, liveFrame, now)
       若 image 非空：
         context.drawImage(image.canvas, 0, 0, image.width, image.height,
                           image.x, image.y, image.worldWidth, image.worldHeight)
     }
   restore

⑦ 清理与续帧
   liveRaster.sweep(now)
   releaseSnapshots(staticBlockSnapshotCache, now)
   若 !paused → requestAnimationFrame(draw)
```

**顺序总览**：`clearRect` →（无文章：只画背景并结束）→ 相机步进 → 背景 → 世界变换 →
逐区块（快照 or 实时）→ `restore` → 清缓存 → 下一帧。

**混合模式**：全程没有任何 `globalCompositeOperation` 设置（默认 `source-over`）。
唯一被改动的状态是 `globalAlpha`（叠加两个快照）与 `shadowBlur/shadowColor/filter`（文字辉光）。

**`paused` 的语义**：暂停时仍会画**一帧**，但不再排下一帧 —— 相机不动、背景不转、文字不推进。
[未确认] 是否存在「恢复播放时补一帧」之类的外部逻辑；本次阅读只看到这一处暂停处理。

### 11.4 实时区块的两种画法

| 分支 | 条件 | 变换 | 代价 |
| --- | --- | --- | --- |
| 直接绘制 | `isGlowBlurQuantized() === false` | 舞台的世界变换 | 相机连续缩放 → Chromium 不断为新尺寸重建字形缓存 |
| 量化栅格 | `isGlowBlurQuantized() === true` | 自己 canvas 内固定 `scale`，再 `drawImage` 缩放贴回 | 最多损失 1.45% 锐度，换来**有界**的字形尺寸集合 |

`isGlowBlurQuantized()` 默认**只在 Linux 上为 true**（`utils/glowBlurQuantize.ts:22-43`），
值存 `localStorage['visualizer_glow_blur_quantize']`。
若本项目要上 Linux，这条优化（连同 §16 的整像素 blur）必须一起移植，否则长时间播放会因
字形缓存泄漏导致卡死；只做 Windows/macOS 时可先保留接口、默认关闭。

### 11.5 `FumeLiveRaster` 细节

```
LIVE_IDLE_MS = 5_000
LIVE_CANVAS_GRANULE = 256
LIVE_RASTER_LEVELS_PER_OCTAVE = 48

resolveLiveRasterScale(scale) =
  2 ** (ceil(log2(max(scale, 1e-3)) * 48 - 1e-9) / 48)
  // = 不小于 scale 的最小栅格倍率；最多比输入高 2^(1/48) - 1 ≈ 1.45%

FumeLiveRaster.draw(block, timing, params, { deviceScale, visible }, now) => FumeLiveRasterImage | null
  scale = resolveLiveRasterScale(deviceScale)
  glowReach = (12 + block.fontPx * 0.7) * max(params.glowIntensity, 1) * 1.5
  pad = ceil(block.lineHeight * 0.5 + glowReach / max(scale, 0.01))
  left   = max(block.x - pad, visible.left)；top    = max(block.y - pad, visible.top)
  right  = min(block.x + block.width  + pad, visible.right)
  bottom = min(block.y + block.height + pad, visible.bottom)
  right <= left || bottom <= top → null
  width  = max(1, ceil((right - left) * scale))；height = max(1, ceil((bottom - top) * scale))

  live = ensure(block.id, width, height)
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, max(live.usedWidth, width), max(live.usedHeight, height))
  context.setTransform(scale, 0, 0, scale, -left * scale, -top * scale)
  drawFumeLiveBlock(context, block, timing, params)
  live.usedWidth = width；live.usedHeight = height；live.lastUsed = now
  return { canvas, width, height, x: left, y: top,
           worldWidth: width / scale, worldHeight: height / scale }

ensure(id, width, height)：
  已有且 canvas.width >= width && canvas.height >= height → 复用
  否则把 canvas.width/height 按 256 向上取整（只增不减）

sweep(now)：超过 LIVE_IDLE_MS 未使用的 → canvas.width = 0；height = 0；delete
clear()：sweep(+Infinity)
```

**为什么裁剪到 `visible`**：正在打印的区块通常只露出屏幕的一部分，把它整块按设备像素栅格化会很浪费；
只画可见（略外扩 pad）的那部分，**单块 canvas 永远不会超过视口尺寸**。

### 11.6 DPR 处理汇总

| 位置 | 处理 |
| --- | --- |
| 舞台 canvas | `width = floor(viewport.width * dpr)`；`setTransform(dpr, …)`；CSS 尺寸写逻辑 px |
| 静态快照 | `rasterScale = clamp(dpr, 1, 2)`；画布尺寸 = `(block + 2*padding) * rasterScale`；贴回用世界尺寸自动缩放 |
| 实时栅格 | 输入 `deviceScale = camera.scale * dpr`，`visible` 用世界坐标；输出世界矩形供 `drawImage` |
| 快照缓存键 | 含 `snapshotScale = clamp(dpr, 1, 2)`，跨屏拖动会重新生成 |

---

## 12. 浮名自带背景（`FumeBackground.ts`）

### 12.1 形状数据模型

```ts
type FumeBackgroundShapeKind = 'ring' | 'square' | 'cross' | 'spark'
type FumeBackgroundAudioBand = 'bass' | 'lowMid' | 'mid' | 'vocal' | 'treble'
type FumeBackgroundShapeColor = 'secondary' | 'accent'

interface FumeBackgroundShape {
  id: string                    // `fume-bg-${i}` / `fume-spark-${i}`
  kind: FumeBackgroundShapeKind
  x: number; y: number          // 世界坐标**中心**
  width: number; height: number // 基础尺寸（会被音频缩放）
  rotation: number              // 基础旋转，弧度
  rotationSpeed: number         // 弧度/秒（乘 time）
  strokeWidth: number
  opacity: number
  color: 'secondary' | 'accent'
  depth: number                 // 0..1：决定视差响应与绘制顺序
  audioBand?: FumeBackgroundAudioBand    // 只有 spark 有
  ringGapStart?: number; ringGapSize?: number
}

interface FumeBackgroundScene { width: number; height: number; shapes: FumeBackgroundShape[] }

type FumeBackgroundAudioLevels =
  Partial<Record<'bass'|'lowMid'|'mid'|'vocal'|'treble', number>> & { power?: number }
```

### 12.2 形状路径

```
buildShapePath(context, shape)     // 调用方已 translate/rotate 到形状中心
  ring：
    gapStart = shape.ringGapStart ?? -PI * 0.18
    gapSize  = clamp(shape.ringGapSize ?? PI * 0.2, 0.18, PI * 0.6)
    context.lineCap = 'round'
    context.ellipse(0, 0, width/2, width/2, 0, gapStart + gapSize, gapStart + PI * 2)
    // 正圆，且**永远留一个缺口**（缺口位置/大小由种子决定）→ 手绘圆环的观感
  square：context.rect(-size/2, -size/2, size, size)      // size = shape.width
  cross：
    arm = size * 0.3
    (-arm,-size/2) → (arm,-size/2) → (arm,-arm) → (size/2,-arm) → (size/2,arm) → (arm,arm)
    → (arm,size/2) → (-arm,size/2) → (-arm,arm) → (-size/2,arm) → (-size/2,-arm) → (-arm,-arm) → close
  spark（四角星）：
    outer = size * 0.5；inner = size * 0.13
    (0,-outer) → (inner,-inner) → (outer,0) → (inner,inner) → (0,outer)
    → (-inner,inner) → (-outer,0) → (-inner,-inner) → close
```

> `spark` 的 `inner = size * 0.13` 是**很细的星芒**（不是常见的 0.3+），
> 所以它看起来像「闪光」而不是「星星」。这是最容易画错的一个常数。

### 12.3 场景生成 `buildFumeBackgroundScene`

```
入参：{ viewport, world, paperBounds?, seed? }

守卫：viewport 或 world 任一非正 →
  { width: max(world.width, viewport.width, 1), height: max(world.height, viewport.height, 1), shapes: [] }

worldWidth  = max(world.width,  viewport.width  * 1.2)
worldHeight = max(world.height, viewport.height * 1.2)
baseUnit    = clamp(min(viewport.width, viewport.height) * 0.72, 320, 760)

defaultPaperBounds = { left: worldWidth*0.24, top: worldHeight*0.18,
                       right: worldWidth*0.76, bottom: worldHeight*0.82 }
resolvedPaperBounds = normalizeBounds(paperBounds ?? defaultPaperBounds, worldWidth, worldHeight)
  // normalizeBounds：先取 min/max 归正 left/top/right/bottom，再各自 clamp 进世界范围内

shapeKinds  = ['ring','square','cross','ring','square','cross']
shapeCount  = worldWidth > worldHeight ? 8 : 7
sparkBands  = ['treble','vocal','mid','treble','lowMid']
sparkCount  = worldWidth > worldHeight ? 12 : 9

sparkArea = { left: worldWidth*0.2, right: worldWidth*0.8,
              top: worldHeight*0.18, bottom: worldHeight*0.82 }
sparkColumns = ceil(sqrt(sparkCount * (worldWidth / max(worldHeight, 1))))
sparkRows    = ceil(sparkCount / sparkColumns)
sparkCellWidth  = (sparkArea.right - sparkArea.left) / sparkColumns
sparkCellHeight = (sparkArea.bottom - sparkArea.top) / sparkRows
```

基础形状（`index` 从 0 起）：

```
localSeed = `${seed ?? 'fume'}:${worldWidth}:${worldHeight}:${index}`
kind   = shapeKinds[index % 6]
width  = baseUnit * mix(0.82, 1.36, seeded(`${localSeed}:size`))
height = width
anchor = choosePaperHaloAnchor({ paperBounds: resolvedPaperBounds, worldWidth, worldHeight,
                                 width, height, seedKey: localSeed })          // §12.4
{
  id: `fume-bg-${index}`, kind, x: anchor.x, y: anchor.y, width, height,
  rotation:      mix(-PI*0.2, PI*0.2, seeded(`${localSeed}:rotation`)),
  rotationSpeed: mix(-0.045, 0.045, seeded(`${localSeed}:rotation-speed`)),
  strokeWidth:   mix(0.25, 2.1,    seeded(`${localSeed}:stroke-width`)),
  opacity:       mix(0.01, 0.16,   seeded(`${localSeed}:opacity`)),
  color:         seeded(`${localSeed}:color`) > 0.5 ? 'accent' : 'secondary',
  depth:         seeded(`${localSeed}:depth`),
  ringGapStart:  kind === 'ring' ? mix(-PI, PI, seeded(`${localSeed}:gap-start`)) : undefined,
  ringGapSize:   kind === 'ring' ? mix(PI*0.12, PI*0.24, seeded(`${localSeed}:gap-size`)) : undefined,
}
```

火花（`index` 从 0 起）：

```
localSeed = `${seed ?? 'fume'}:${worldWidth}:${worldHeight}:spark:${index}`
width  = baseUnit * mix(0.1, 0.24, seeded(`${localSeed}:size`))
column = index % sparkColumns；row = floor(index / sparkColumns)
jitterX = mix(-0.32, 0.32, seeded(`${localSeed}:jitter-x`)) * sparkCellWidth
jitterY = mix(-0.32, 0.32, seeded(`${localSeed}:jitter-y`)) * sparkCellHeight
x = clamp(sparkArea.left + (column + 0.5) * sparkCellWidth  + jitterX, sparkArea.left, sparkArea.right)
y = clamp(sparkArea.top  + (row    + 0.5) * sparkCellHeight + jitterY, sparkArea.top,  sparkArea.bottom)
{
  id: `fume-spark-${index}`, kind: 'spark', x, y, width, height: width,
  rotation:      mix(-PI, PI, seeded(`${localSeed}:rotation`)),
  rotationSpeed: mix(-0.18, 0.18, seeded(`${localSeed}:rotation-speed`)),
  strokeWidth:   mix(0.75, 1.7,   seeded(`${localSeed}:stroke-width`)),
  opacity:       mix(0.08, 0.22,  seeded(`${localSeed}:opacity`)),
  color:         seeded(`${localSeed}:color`) > 0.5 ? 'accent' : 'secondary',
  depth:         seeded(`${localSeed}:depth`),
  audioBand:     sparkBands[index % 5],
}
```

最后：`shapes = [...baseShapes, ...sparkShapes].sort((a, b) => a.depth - b.depth)`
（**深度排序 = 绘制顺序**，后面的形状画在上面）。

### 12.4 锚点选择 `choosePaperHaloAnchor`（私有）

```
insideChance = seeded(`${seedKey}:inside-chance`)

若 insideChance < 0.22：              // 22% 落在纸张内部
  x = clamp(mix(paperBounds.left + width*0.12, paperBounds.right  - width*0.12, seeded(`${seedKey}:inside-x`)), 0, worldWidth)
  y = clamp(mix(paperBounds.top  + height*0.12, paperBounds.bottom - height*0.12, seeded(`${seedKey}:inside-y`)), 0, worldHeight)
否则：                                // 78% 挂在纸张四条边之一
  side = floor(seeded(`${seedKey}:side`) * 4) % 4      // 0=左 1=右 2=上 3=下
  overflowX   = width  * mix(0.16,  0.24, seeded(`${seedKey}:overflow-x`))
  overflowY   = height * mix(0.16,  0.24, seeded(`${seedKey}:overflow-y`))
  spanJitterX = width  * mix(-0.18, 0.18, seeded(`${seedKey}:span-jitter-x`))
  spanJitterY = height * mix(-0.18, 0.18, seeded(`${seedKey}:span-jitter-y`))

  side 0: x = clamp(paperBounds.left  - overflowX, 0, worldWidth)
          y = clamp(mix(paperBounds.top - height*0.12, paperBounds.bottom + height*0.12, seeded(`${seedKey}:y`)) + spanJitterY, 0, worldHeight)
  side 1: x = clamp(paperBounds.right + overflowX, 0, worldWidth)；y 同上
  side 2: y = clamp(paperBounds.top   - overflowY, 0, worldHeight)
          x = clamp(mix(paperBounds.left - width*0.12, paperBounds.right + width*0.12, seeded(`${seedKey}:x`)) + spanJitterX, 0, worldWidth)
  side 3: y = clamp(paperBounds.bottom + overflowY, 0, worldHeight)；x 同上
```

**分布语义**：绝大多数形状**环绕这张纸的四边**（并向外溢出 16%~24% 自身尺寸），
22% 落在纸内部 —— 所以观感是「纸张周围的手绘装饰」，不是均匀撒点。

### 12.5 每帧绘制 `drawFumeBackground`

```ts
drawFumeBackground({ context, scene, theme, time = 0, audioLevels, parallax, objectOpacityMultiplier = 1 })
```

```
resolvedObjectOpacityMultiplier = clamp(objectOpacityMultiplier, 0, 2)
gradients = lineGradients.get(context) ?? (lineGradients.set(context, new Map()), 该 Map)
  // 模块级 WeakMap<CanvasRenderingContext2D, Map<string, CanvasGradient>>，上限 256

createLineGradient(shape, opacity)：
  key = `${shape.width}|${shape.height}|${opacity}|${theme.secondaryColor}|${theme.accentColor}`
  未命中则：
    gradient = context.createLinearGradient(-w*0.55, -h*0.28, w*0.55, h*0.28)
    stop(0,    colorWithAlpha(secondary, opacity * 0.18))
    stop(0.28, colorWithAlpha(mixColors(secondary, accent, 0.24), opacity * 0.58))
    stop(0.54, colorWithAlpha(mixColors(secondary, accent, 0.62), opacity * 0.92))
    stop(1,    colorWithAlpha(accent, opacity * 0.7))
```

> 缓存键**不含位置与旋转**：位移/旋转由 context 变换施加，渐变只依赖尺寸/透明度/两个颜色
> （源码注释 `FumeBackground.ts:364-366`）。因此镜头移动不会不断新建渐变对象。

```
drawGradientGeometry(shape, opacity)：
  baseWidth = max(shape.strokeWidth * 0.28, 0.14)      // 细底
  topWidth  = max(shape.strokeWidth * 0.92, 0.78)      // 粗顶
  两次 buildShapePath + stroke：先 gradient(opacity*0.56)/baseWidth，再 gradient(opacity)/topWidth
  两次都 shadowBlur = 0、shadowColor = 'transparent'
```

逐形状：

```
bandValue = shape.audioBand ? audioLevels?.[shape.audioBand] : undefined
audioScale        = bandValue === undefined ? 1 : mix(0.95, 1.45, clamp((bandValue - 10) / 190, 0, 1))
audioOpacityBoost = bandValue === undefined ? 1 : mix(0.85, 1.55, clamp((bandValue - 10) / 190, 0, 1))

context.save()
context.lineWidth = shape.strokeWidth
shapeColor = shape.color === 'accent' ? theme.accentColor : theme.secondaryColor
layerResponse    = mix(0.58, 1.16, shape.depth)
parallaxStrength = parallax?.strength ?? 1
parallaxOffsetX  = parallax ? (parallax.cameraX - parallax.originX) * (1 - layerResponse) * parallaxStrength : 0
parallaxOffsetY  = parallax ? (parallax.cameraY - parallax.originY) * (1 - layerResponse) * parallaxStrength : 0

renderedShape = { ...shape,
  x: shape.x + parallaxOffsetX, y: shape.y + parallaxOffsetY,
  width:  shape.width  * audioScale, height: shape.height * audioScale,
  rotation: shape.rotation + time * shape.rotationSpeed }

若 kind === 'spark'：
  strokeStyle = colorWithAlpha(shapeColor, clamp(shape.opacity * audioOpacityBoost * resolvedObjectOpacityMultiplier, 0, 0.42))
  shadowBlur  = 10 * audioScale
  shadowColor = colorWithAlpha(shapeColor, shape.opacity * audioOpacityBoost * 0.75 * resolvedObjectOpacityMultiplier)
  traceShape(context, renderedShape)         // save → translate(x,y) → rotate(rotation) → buildShapePath → stroke → restore
否则：
  context.translate(renderedShape.x, renderedShape.y)
  context.rotate(renderedShape.rotation)
  drawGradientGeometry(renderedShape, clamp(shape.opacity * audioOpacityBoost * resolvedObjectOpacityMultiplier, 0, 0.42))
context.restore()
```

**`layerResponse = mix(0.58, 1.16, depth)` 的语义**：深度越大（越“近”）响应越强。
视差偏移系数是 `1 - layerResponse`：`depth = 0` → `+0.42`（跟着镜头同向移动得多）、
`depth = 1` → `-0.16`（近乎不动甚至轻微反向）。这就是伪景深：
远层随镜头漂，近层几乎钉住，于是镜头一动就有纵深。

其余三层“不会盖住文字”的护栏：`opacity` 基础形状 0.01..0.16、火花 0.08..0.22，
乘上音频与调参后**统一 clamp 到 0.42**；只有火花的 `shadowBlur = 10 * audioScale` 会发光。

### 12.6 与外壳背景的关系

```ts
// VisualizerFume.tsx:304-311
background: { ...props.background,
              common: { ...props.background?.common,
                        disableGeometricBackground:
                          Boolean(props.background?.common?.disableGeometricBackground)
                          || resolvedFumeTuning.disableGeometricBackground } }
```

`disableGeometricBackground` 默认 **true**：它让外壳 `common` 背景**只保留纯色底**
（`backgrounds/common/entry.tsx:52-64` 里 `hideShapes` 为真时不渲染几何层），
浮名自己的 canvas 画在那层纯色底之上（stage 是 `z-10`）。

**移植结论**：浮名至少需要「外壳给纯色底（`theme.backgroundColor`）+ 自己 canvas 画背景与文字」两层。
若本项目不移植外壳背景注册表，也必须让浮名皮肤自己铺一层纯色底，
否则会透出沉浸页原有的背景，观感明显错误。

### 12.7 时间轴的两处差别

```
有文章：drawFumeBackground({ time })                        → 形状自转严格跟播放进度
无文章：drawFumeBackground({ time: time + now * 0.00018 })   → 播放时间 + 墙钟漂移
```

无文章（例如前奏/加载）时形状也在缓慢自转，用的是「播放时间 + 墙钟 × 0.00018」。
[未确认] 0.00018 这个系数的设计动机；**数值照抄**即可。

---

## 13. 音频驱动

### 13.1 Folia 侧：六频带 → 用途

`fumeStage.ts:41-48`：

```ts
readFumeAudioLevels({ audioPower, audioBands }) => ({
  power:  audioPower.get(),
  bass:   audioBands.bass.get(),
  lowMid: audioBands.lowMid.get(),
  mid:    audioBands.mid.get(),
  vocal:  audioBands.vocal.get(),
  treble: audioBands.treble.get(),
})
```

上游采集（`hooks/usePlaybackVisualizerBridge.ts:93-131`）：

```
getEnergy(minHz, maxHz) = mean(dataArray[floor(minHz/21.5) .. floor(maxHz/21.5)])   // 0..255
process(value, boost)   = pow(value / 255, boost) * 255                             // 仍是 0..255 量纲

bass   = getEnergy(20, 150)     → process(bass,   1.8)
lowMid = getEnergy(150, 400)    → process(lowMid, 2)
mid    = getEnergy(400, 1200)   → process(mid,    2)
vocal  = getEnergy(1000, 3500)  → process(vocal,  1.5)
treble = getEnergy(3500, 12000) → process(treble, 2)
audioPower = process((bass + lowMid) / 2, 3)
无信号时（未播放）：全部设为 breath = (sin(Date.now()/2000) + 1) * 20          // 0..40 的呼吸
```

**浮名真正读取的只有 `audioBands` 里被火花引用的那几条**。逐条用途：

| 频带 | 被谁读 | 作用 |
| --- | --- | --- |
| `treble` | `sparkBands[0]`、`sparkBands[3]` | 火花缩放/不透明度/发光 |
| `vocal` | `sparkBands[1]` | 同上 |
| `mid` | `sparkBands[2]` | 同上 |
| `lowMid` | `sparkBands[4]` | 同上 |
| `bass` | **没有任何火花引用它**（`sparkBands` 只有 5 项且不含 `bass`） | **未被浮名使用** |
| `power` | 传给 `drawFumeBackground` 但 `drawFumeBackground` 内**从未读取** `audioLevels.power` | **未被浮名使用** |

> 这是一个可以直接确认的事实：`FumeBackground.ts` 里对 `audioLevels` 的唯一访问是
> `audioLevels?.[shape.audioBand]`（第 431 行），而 `shape.audioBand` 的类型不含 `power`。
> 所以浮名的音频反应实际上**只有 4 条频带、且只作用在火花上**（基础形状完全不响应音频）。
> `bass` / `power` 在浮名里是「传了但没用」—— 本项目不必为它们增加工作量。

映射公式（火花，`FumeBackground.ts:432-437`）：

```
normalized        = clamp((bandValue - 10) / 190, 0, 1)
audioScale        = mix(0.95, 1.45, normalized)      // 尺寸倍率 0.95 → 1.45
audioOpacityBoost = mix(0.85, 1.55, normalized)      // 不透明度倍率 0.85 → 1.55
```

**减去 10 是噪声门**：低于 10 的能量一律当 0，避免安静段落火花乱闪。
`190` 是分母，使 `bandValue = 200` 达到饱和。

### 13.2 本项目的四频带近似方案

本项目的 `use-audio-bands.ts` 只提供 4 条（`low` 20–250Hz、`mid` 250–2000Hz、
`high` 2000–8000Hz、`power` 20–8000Hz），**且归一化到 0–1**（不是 0–255），
没有 Folia 的 `pow` 增强与呼吸兜底。

**换算关系**（先把 0–1 还原成 0–255 量纲，才能套用 §13.1 的公式）：

```
foliaValue(ours) = ours * 255
```

**逐条映射建议**（按「频率覆盖最接近」+「视觉用途」两个标准）：

| Folia 频带 | 频率范围 | 本项目替代 | 频率覆盖理由 |
| --- | --- | --- | --- |
| `bass` | 20–150Hz | **不需要**（浮名未使用） | — |
| `lowMid` | 150–400Hz | `low`（20–250Hz） | 本项目的 `low` 上沿 250Hz 覆盖了 150–400 的下半段；这是四频带里唯一落在低频的通道，给 `lowMid` 的位置最合适 |
| `mid` | 400–1200Hz | `mid`（250–2000Hz） | 区间几乎被 `mid` 完整包住（400–1200 ⊂ 250–2000） |
| `vocal` | 1000–3500Hz | `mid` 与 `high` 各半 | 1000–2000 落在 `mid`，2000–3500 落在 `high`；因为浮名的 `vocal` 只用在一个火花上，取 `mid * 0.5 + high * 0.5` 视觉上足够 |
| `treble` | 3500–12000Hz | `high`（2000–8000Hz） | 3500–8000 落在 `high`；>8000Hz 的信息本项目拿不到（采样上限），会有轻微“少闪” |
| `power` | 低频均值 | **不需要**（浮名未使用） | — |

**还要补两件事**，否则视觉会与 Folia 不一致：

1. **减噪门与量纲**：四频带的 0–1 值先 `× 255`，再套
   `clamp((value - 10) / 190, 0, 1)`；因为本项目频带是「均值 / 255」，
   在小音量下数值天然偏小，噪声门可以让安静段落的火花保持静止。
2. **呼吸兜底**：本项目未播放时频带一律为 0（`use-audio-bands.ts:44-46` 的 `zeroBands()`），
   而 Folia 会用 `(sin(t) + 1) * 20` 的呼吸值（约 0..40）驱动背景。
   若希望浮名在**暂停/加载**时背景仍有生命感，需要在适配层补一个等价的呼吸值
   （建议直接照抄 `(Math.sin(Date.now() / 2000) + 1) * 20` 的 0..40 量纲），
   而不是让火花完全静止；否则暂停时背景会比 Folia 明显“死”。

**不做的映射（明确记录，避免以后误加）**：本项目的 `power` 频带（20–8000Hz 均值）
**不要**拿去当 Folia 的 `power` 用 —— 浮名根本没有消费它；把它接进任何视觉参数都会偏离原设计。

---

## 14. 默认调参表与字幕层

### 14.1 `DEFAULT_FUME_TUNING`

```ts
export interface FumeTuning {
  hidePrintSymbols: boolean
  disableGeometricBackground: boolean
  backgroundObjectOpacity: number
  textHoldRatio: number
  cameraTrackingMode: 'stepped' | 'smooth'
  cameraSpeed: number
  glowIntensity: number
  heroScale: number
}

export const DEFAULT_FUME_TUNING: FumeTuning = {
  hidePrintSymbols: false,
  disableGeometricBackground: true,
  backgroundObjectOpacity: 0.5,
  textHoldRatio: 1,
  cameraTrackingMode: 'smooth',
  cameraSpeed: 1,
  glowIntensity: 1,
  heroScale: 1,
}
```

取值来自 `src/types.ts:439-459`。**运行时钳制**（`VisualizerFume.tsx:119-134`）：

| 字段 | 默认 | 运行时范围 | 作用与影响 |
| --- | --- | --- | --- |
| `hidePrintSymbols` | `false` | boolean，不钳 | `true` 时 `showPrintStamp = false`：完全不画 §10.5 的落下方块 |
| `disableGeometricBackground` | `true` | boolean，不钳 | 是否让外壳几何背景让位（见 §12.6）。**改成 false 会同时出现几何层与浮名背景，视觉会脏** |
| `backgroundObjectOpacity` | `0.5` | `clamp(…, 0, 1)` | 传给背景的 `objectOpacityMultiplier`，实际使用时**再乘 2**（§11.3），所以默认等效系数 1.0；上限 2.0 |
| `textHoldRatio` | `1` | `clamp(…, 0, 1)` | `>= 1` → 唱过的字**永不淡出**（`effectiveTextHoldStyle = 'standard'`）；`< 1` → 走 dimmed 与快照交叉淡出（§6、§8.4） |
| `cameraTrackingMode` | `'smooth'` | 仅接受 `'stepped'`/`'smooth'` | `'stepped'` 用整数已打印字数求焦点（字到字跳），`'smooth'` 用浮点进度（连续滑动） |
| `cameraSpeed` | `1` | `clamp(…, 0.55, 1.85)` | 除到所有重定位时长上（`duration / cameraSpeed`），越大镜头切得越快、桥接越短 |
| `glowIntensity` | `1` | `clamp(…, 0, 1.8)` | 同时乘到 activeGlowBoost / passedGlowBase（§8.1）、整行辉光（§10.4b）、印章辉光强度与 `FumeLiveRaster` 的 `glowReach`（§11.5） |
| `heroScale` | `1` | `clamp(…, 0.82, 1.32)` | 只影响 hero 块的候选字号（`buildPreparedSingleLine` 的第三个倍率）与布局缓存键。**它是唯一参与排版的调参**（§7.9） |

> **本项目定案**：浮名**没有设置面板**（与「倾诉」一致，见 `skins/types.ts` 的 `hasSettings`）。
> 因此上表除了 `heroScale` 之外的全部字段，在本项目里都是**内置常量**，
> 一律取默认值：`hidePrintSymbols=false`、`disableGeometricBackground=true`、
> `backgroundObjectOpacity=0.5`、`textHoldRatio=1`、`cameraTrackingMode='smooth'`、
> `cameraSpeed=1`、`glowIntensity=1`、`heroScale=1`。
> 换句话说：**唱过的字永不淡出**（`textHoldRatio=1`）是浮名在本项目里的唯一形态，
> §6.2/§6.3 的 dim 路径与 §8.4 的双快照交叉淡出**不会被走到**（可以保留实现以便将来接线）。
> 同理 `isGlowBlurQuantized()`（§11.4）是否生效由平台决定，不属设置面板。

### 14.2 底部字幕（`VisualizerSubtitleOverlay.tsx`）

浮名的字幕**不在 canvas 里**，而是 React 组件叠在 canvas 之上（`VisualizerFume.tsx:378-395`）。
移植时要照抄的规则（`VisualizerSubtitleOverlay.tsx`，221 行）：

```ts
hasReadableText(text) = !!text && /[\p{L}\p{N}]/u.test(text)
  // 只含标点/分隔符的行（"//"、"●●●"、"---"）永不显示

resolveVisualizerSubtitleOverlayContent({ showText, activeLine, recentCompletedLine, nextLines,
                                          hideTranslationSubtitle, showSubtitleTranslation,
                                          subtitleContentMode }):
  !showText || hideTranslationSubtitle →
    { shouldRenderOverlay: false, subtitleText: null, subtitleTracks: [], upcomingLines: [] }

  resolvedMode = resolveSubtitleContentMode(subtitleContentMode, showSubtitleTranslation)
  subtitleTracks = [activeLine, recentCompletedLine]
      .map(line => resolveLyricSubtitleTracks(line, resolvedMode, hasReadableText))
      .find(tracks => tracks.length > 0) ?? []
  subtitleText = 有 track 时 tracks.map(t => t.text).join(' / ') 否则 null
  previewLines = nextLines.filter(line => hasReadableText(line.fullText))
  upcomingLines = subtitleText ? [] : (activeLine ? previewLines : [])
```

排版与样式常量：

| 项 | 值 | 出处 |
| --- | --- | --- |
| 字幕字号（译文 / 音译） | `clamp(1.05rem * s, 2.2vw * s, 1.2rem * s)`，`s = lyricsFontScale` | `VisualizerFume.tsx:239` |
| 下一句预览字号 | `clamp(0.875rem * s, 1.8vw * s, 1.0rem * s)` | 同上 |
| 双行栈第二行 | 字号 `× SECONDARY_TRACK_SIZE_FACTOR = 0.88`、不透明度 `0.82`、字重回退 `400`（首行回退 500）、上方间距 `0.25em` | `utils/lyrics/subtitleTrackStyle.ts:9-14` |
| 行序 | `'both'` = 先音译（romanization）后译文（translation） | `alternateText.ts:63` |
| 文本色 | `theme.secondaryColor` | `VisualizerSubtitleOverlay.tsx:173` |
| 文字阴影 | `0 1px 2px ${colorWithAlpha(theme.backgroundColor, 0.24)}` | `:130` |
| 背板辉光 | `radial-gradient(ellipse 115% 130% at center, bg@0.96 0%, bg@0.78 62%, transparent 100%)`，`blur-2xl`，容器 `px-1.5 py-0.5` | `:118-128`、`:153` |
| 进场/退场 | `opacity 0→resolvedOpacity`、`y 20→0`，时长 `0.24s ease-out`；行内容另有一层 `opacity 0→1, y 10→0` | `:136-142`、`:157-163` |
| `resolvedOpacity` | `subtitleOverlayOpacity ?? 0.6` | `:116` |
| 底部位置 | `bottom = usePlayerSubtitleBottomPx(isPlayerChromeHidden)`（随底栏显隐/上移的弹簧值） | `:103`、`:145` |
| 预览行 class | `truncate max-w-2xl mx-auto transition-all duration-500` + 可选 `blur-[1px]` | `:22-24` |

**与本项目的差异**：

- 本项目没有 `[playerBottomBarBottomPx]` 那套弹簧基线；倾诉已有自己的字幕行（`tilt` 皮肤内的字幕变体），
  建议把字幕做成**皮肤共享组件**，浮名直接复用，底边距用沉浸页现有的底栏变量。
- `resolveLyricSubtitleTracks` 的上游版本按「先音译后译文」排序；本项目 `LyricLine` 的字段是
  `translation` / `romaji`，`'both'` 模式下也应当是**先 romaji 后 translation**（同一规则）。
- `hasReadableText` 的 `/[\p{L}\p{N}]/u` 判据必须保留：本项目 RPC 接口同样会返回
  `//`、`●●●` 这类纯符号行（见 `tilt-porting-notes.md` 的记录）。

---

## 15. 移植到本项目（Vue 3 + TypeScript）的落地方案

### 15.1 层划分（对应本仓库现有的「倾诉」分层）

倾诉已经验证过的分层方式，浮名照用（纯算法 → 单测；测量/渲染 → 不进单测）：

```
src/features/immersive/skins/fume/
├── index.ts                     # defineSkin({ id:'fume', name:'浮名', hasSettings:false, order:2 })
├── SkinFume.vue                 # 皮肤根：stage 容器 + canvas + 字幕 + 空态（目标 ≤ 200 行）
├── fume.scss                    # 容器、空态、字幕位置
├── use-fume-stage.ts            # 每帧绘制循环（等价 useFumeCanvasStage）
├── use-fume-layout.ts           # 排版调度/缓存/视口观察（等价 VisualizerFume 的 effect 部分）
├── core/                        # 纯算法层，无 DOM、可 vitest
│   ├── fume-math.ts             # §3 全部
│   ├── graphemes.ts             # 复用 tilt 的 core/graphemes.ts（不重复实现）
│   ├── char-timing.ts           # 复用 tilt 的 core/char-timing.ts（不重复实现）
│   ├── reveal.ts                # §5（含 resolvePrintedGraphemeCount/Progress）
│   ├── text-style.ts            # §6
│   ├── block-frame.ts           # §8（除 getSnapshot 依赖注入外全纯）
│   ├── camera.ts                # §9.2-9.6（纯函数）+ §9.8 背景视图
│   ├── camera-step.ts           # §9.7（原地 mutate state，纯数值、可单测）
│   ├── article-layout.ts        # §7 的装箱/变体/参数搜索；测量部分通过注入接口
│   ├── layout-key.ts            # §7.1
│   └── types.ts                 # §2（本项目命名：Fume*）
├── measure/
│   └── text-measure.ts          # §4：pretext + canvas 测量（唯一接触 DOM/Canvas 的算法模块）
├── render/
│   ├── canvas-text.ts           # §10（字体串、裁剪运行、快照、drawFumeLiveBlock）
│   ├── live-raster.ts           # §11.5
│   └── background.ts            # §12（场景生成 + 绘制）
└── components/
    ├── FumeStage.vue            # canvas 元素 + ResizeObserver（薄壳）
    ├── FumeSubtitle.vue         # §14.2（或放 shared/ 供多皮肤复用）
    └── FumeLayoutPending.vue    # 「正在排版」提示（等价源码的 Hourglass 卡）
```

**必须保持的边界**：

1. `core/` 不许 import `measure/` 或 `render/`，也不许 import Vue —— 它是可单测的纯函数层；
2. `measure/` 是**唯一**允许直接调 `prepareWithSegments` / `layoutWithLines` / `getContext('2d')` 的地方；
3. `article-layout.ts` 需要 `resolveThemeFontStack` 结果与测量函数，**用参数注入**
   （`measure = { prepareSingleLine, measureSegmentGlyphOffsets, widthBetweenOffsets }`），
   这样装箱、变体选择、参数搜索（§7.2/7.4/7.8）都能在 node 环境单测；
4. 组件层只做「接线 + 生命周期 + DOM 事件」。

### 15.2 单位与数据适配

| 本项目 | Folia | 换算 |
| --- | --- | --- |
| `ctx.currentTime()` 毫秒 | `currentTime` 秒 | `t = ms / 1000`，**每帧读一次** |
| `LyricLine.timeMs` | `line.startTime` | `/1000` |
| `LyricLine` 无 `endTime` | `line.endTime` | 需推算：下一行 `timeMs` 兜底（参考 tilt 适配层的推算规则），最后一行用时长估计 |
| `LyricWord { word, timeMs, durationMs }` | `Word { text, startTime, endTime }` | `{ text: word, startTime: timeMs/1000, endTime: (timeMs + durationMs)/1000 }` |
| `use-audio-bands` 的 4 频带 0–1 | 6 频带 0–255 | `×255` + 噪声门（§13.2） |
| `LyricLine.words` 为可选 | `Line.words` 必填 | 无 words 时 `wordRanges = []`，走整行摊分路径（§5.5） |

**时间源的关键差异**：本项目 `player.currentTimeMs` 来自 `timeupdate`，被节流到 **250ms**
（`src/composables/useAudioElement.ts:63` 的 `THROTTLE_MS = 250`），
也就是**每 4Hz 才更新一次**（倾诉的 CSS + 负延迟方案正是为此设计）。
而浮名每帧都要 `currentTime`（相机跟随打印光标、逐字揭示、颜色拖尾）。

三种可选处理（**移植前必须定下一种，并写成注释**）：

1. **直读音频元素**（最准）：`getAudioElement().currentTime * 1000 + settings.lyricOffset`
   —— 项目里已有 `@/app/providers/player-provider` 的 `getAudioElement()`（`audio-graph.ts:1` 已在用），
   每帧读 `currentTime` 是 O(1) 且不触发响应式更新；**推荐**。
2. **rAF 外推**：以 `currentTimeMs` 为锚点，用 `performance.now()` 外推，每次新快照到来自动校正。
   优点是纯响应式；缺点是播放速率变化 / 拖动进度条时会有短暂偏差。
3. **自建 4Hz→60Hz 插值器**（不推荐）：等于重写选项 2，且更难对齐。

> 无论选哪种，`isPlaying` 为 false 时必须停止推进（浮名的暂停是「定格」语义，§11.3）。

### 15.3 必须避免的 React → Vue 陷阱

| React 写法 | 为什么在原实现里是对的 | Vue 里的等价做法 | 不这么做的后果 |
| --- | --- | --- | --- |
| `useRef<Map>` 存快照/栅格缓存 | ref 对象跨渲染保持不变 | 模块级或 `setup` 里的普通变量（**不要放 `reactive`/`ref`**，否则 Map 会被代理，性能骤降） | 用 `ref(new Map())` 会得到 Proxy 包装，每次 get/set 都走响应式，帧率明显下降 |
| `useRef<FumeCameraState>` | 相机是可变对象，跨 effect 重跑保留 | `const cameraState = createFumeCameraState()`（普通对象，**不要 reactive**） | 相机放进 `reactive` 后，每帧改 x/y/velocity 都会触发依赖更新 |
| `useEffect(deps)` 重跑整个绘制循环 | 依赖变化时重新初始化 canvas 与帧循环 | `watch([article, viewport, ...], () => restart(), { flush: 'post' })` 或 `watchEffect` + `onBeforeUnmount` | 忘了 `onBeforeUnmount` 清理 → rAF 泄漏、组件卸载后仍在画 |
| `useMemo` 计算背景场景/总览镜头 | 依赖不变就不重算 | `computed()`（注意 `article` 是普通对象，`computed` 只按引用比较） | 把场景生成放进渲染函数体 → 每帧重建随机形状 |
| `requestAnimationFrame` 在 effect 内自续 | effect 清理时 `cancelAnimationFrame` | 同上，清理必须在 `onBeforeUnmount` **和** `watch` 回调的停止函数里都做 | 切歌时叠出多条 rAF 循环，越跑越慢 |
| 箭头函数闭包读 `driver.getLineIndex()` | 通过 ref 永远读到最新值 | `SkinContext` 的 getter 本身就是这个语义（`ctx.currentLineIndex()`），**直接调用，不要解构缓存** | 缓存成 `const idx = ctx.currentLineIndex()` → 整帧用旧行号，相机跟错块 |
| `driver.onPrintedContent` 只调一次 | `hasPrintedContentRef` 防重 | 用一个普通 boolean 变量（effect 局部）或 `ref`，**在 article 变化时重置** | 不重置 → 第二首歌不会再触发「缩放入场」动画 |
| `scene` / `driver` 每次渲染新建对象 | effect deps 引用变化 → 重跑 | 用 `computed` 包出 scene；把 driver 做成稳定对象（内部只调 getter） | 每帧合成新对象导致 watch 反复触发 |

**StrictMode 差异**：React 18 的 StrictMode 会**双调** effect（挂载→卸载→挂载），
原实现因此必须保证 cleanup 彻底；Vue 没有这个行为，但 `v-if` 切换皮肤时同样会走
`onBeforeUnmount` → 再 `setup`，所以**清理逻辑必须和 React 版本一样彻底**（快照 canvas 置 0、rAF 取消、
ResizeObserver disconnect）。本项目已经约定「设置面板打开时 `v-if` 挂载皮肤」，
切皮肤会重建整个皮肤组件，这一点与 StrictMode 等价。

### 15.4 组件行数约束（AGENTS.md 硬规则）

规则：**单个 Vue 组件不得超过 400 行**。按上述分层，各文件预期行数：

| 文件 | 预估 | 说明 |
| --- | --- | --- |
| `SkinFume.vue` | 120–180 | 容器 + canvas + 字幕 + 空态；绘制与布局全在 composable/hook 里 |
| `use-fume-stage.ts` | 200–260 | §11.3 的顺序逐条落地；若超 400 拆出 `use-fume-canvas-frame.ts`（只放 `drawFrame`） |
| `use-fume-layout.ts` | 120–180 | 视口观察 + 防抖 + 缓存 + 版本号 |
| `core/camera-step.ts` | 200–260 | §9.7 的积分；数值多但无 DOM |
| `core/article-layout.ts` | 260–360 | §7 全部；若超限按「变体选择 / 装箱 / 参数搜索」拆三个文件 |
| `render/canvas-text.ts` | 300–400 | §10；`drawFumeLiveBlock` 单独一个文件会更稳（原文 408 行的函数都在这里面） |
| `render/background.ts` | 300–420 | §12；场景生成与绘制拆成两个文件即可都达标 |

**建议**：`drawFumeLiveBlock` 与 `createStaticBlockSnapshot` 分文件；
`buildFumeBackgroundScene` 与 `drawFumeBackground` 分文件。这样每个文件都在 150–250 行，
既符合规则，也便于逐个写测试。

### 15.5 单测清单（core 层）

| 测试对象 | 必须覆盖的用例 |
| --- | --- |
| `fume-math` | `seeded` 的确定性（同输入同输出）、粒度 1/10000、`hashString` 与已知向量一致、`clamp/mix/quadraticBezier` 边界、三个 easing 在 0/0.5/1 的取值 |
| `reveal` | 无 words 的整行摊分、`+0.2` 偏置、`hasRevealCompleted` 用 `line.endTime`、`resolveLinePassCutoffTime` 取 min、`graphemeTimings` 路径 |
| `text-style` | `textHoldRatio >= 1` → `+Infinity`、`clamp(8 * ratio, 2.4, 130)`、缓存键命中、`dimmed` 的 0.11/0.075 |
| `block-frame` | `waiting`/`passed` 边界（严格 `<` / `>=`）、`colorTrailDuration` 的 clamp、`staticState` 与 `resolveFumeStaticLayers` 的双快照 alpha 之和为 1 |
| `camera` | `resolveFocusBlock` 的三条分支、`resolveCameraScaleForBlock` 的 64..124 钳制、`resolveOverviewFlightBridge` 在 2.75 屏处的 null 与非 null 分界 |
| `camera-step` | 固定 dt 序列的收敛性（弹簧不发散）、`retarget` 只在新目标时重建、桥接模式选择、`dt` 上限 0.05 时的行为 |
| `article-layout` | 注入假测量函数后：变体选择的边界（4/22/28/36 字）、列高装箱的轮转、`overflowPenalty = 0.14`、`targetHeight = 2.45 * viewportHeight`、`paperWidth` 的 920/2400 钳制 |
| `layout-key` | 忽略颜色/动画强度、`heroScale` 参与、`Math.round(viewport)` 的取整 |
| `background-scene` | 形状数量（横向 8+12 / 纵向 7+9）、`insideChance < 0.22` 的分支、`sparkBands` 的 5 项循环、`depth` 排序 |

### 15.6 与「倾诉」的共享点

可以（也应该）复用，避免两份实现漂移：

1. `skins/tilt/core/graphemes.ts` 的 `segmentGraphemes` / `isWhitespaceOnly` / `countGraphemes`
   —— 浮名的 `splitGraphemes` 语义与它完全一致（都基于 `Intl.Segmenter` 的 grapheme 粒度）；
2. `skins/tilt/core/char-timing.ts` 的 `buildCharTimings` / `buildCharTimingsFromWords`
   —— 浮名在**没有 syllables** 时的字素均分与它同构（但不含空白锚点逻辑，
   浮名的空白字素由 `buildWordRangesFromWords` 的「吞并空白」规则处理，两者不冲突）；
3. 字幕渲染（若倾诉已有 `TiltSubtitle` 之类的组件）→ 抽到 `skins/shared/` 供两个皮肤参数化使用；
4. `backgrounds/GeometricBackground.vue` —— 如果将来要支持 `disableGeometricBackground = false`，
   它可以直接充当外壳几何层（本项目已有等价实现）。

**不要复用**的部分：

- 倾诉的 `use-tilt-timing.ts`（CSS 动画 + 负延迟）——浮名是 canvas 每帧绘制，二者驱动模型不同；
- 倾诉的排版（分段/倾斜/溢出缩放）——与浮名的列装箱没有共同点。

---

## 16. 性能要点

维持 60fps 的全部取舍（按重要性排序）：

### 16.1 必须做的缓存（逐个对应到源码）

| 缓存 | 位置 | 键 | 上限 | 失效条件 |
| --- | --- | --- | --- | --- |
| 整篇文章布局 | 模块级 `lastFumeLayoutCache`（§7.9） | `buildLayoutCacheKey(...)` | 1 条 | 键变化 |
| 静态区块快照 | stage 内 `Map`（§11.1） | `blockId:state:style:snapshotScale` | 无硬上限，按 `SNAPSHOT_IDLE_MS = 15s` 回收 | 文章/主题字体/颜色变化时全清；15s 未用则释放 |
| 实时区块栅格 | `FumeLiveRaster.canvases`（§11.5） | `block.id` | 无硬上限，按 `LIVE_IDLE_MS = 5s` 回收；**只能在 256 的整数倍上增长** | 5s 未用则置 0 并删除 |
| 片段逐字素偏移 | `segmentMeasureCache`（§4.7） | `` `${fontSpec}__${text}` `` | **2048**（`SEGMENT_MEASURE_CACHE_LIMIT`） | 有界淘汰（插入顺序最老的） |
| 背景渐变 | 模块级 `WeakMap<context, Map>`（§12.5） | `width|height|opacity|secondary|accent` | 256（`LINE_GRADIENT_LIMIT`） | 有界淘汰 |
| 颜色解析 | `colorMix.ts` 的 `parsedColors` | 颜色字符串 | 512（`PARSED_COLOR_LIMIT`） | 有界淘汰 |
| passed 渐隐时长 | `lastFumePassedFadeDurationCache`（§6.3） | 时间轴 + ratio | 1 条 | 键变化 |

### 16.2 必须避免的每帧分配

- **不要在 `draw()` 里创建对象/数组**：`liveParams` / `staticLayerInput` / `liveFrame` 原实现每帧新建
  （`useFumeCanvasStage.ts:200-221`），因为它们要在 effect 内捕获 `theme`/`offsets`。
  本项目的 Vue 版本应当**把它们提到 `draw` 之外**（每个 effect 实例只建一次），
  因为 JS 引擎在 60fps 下每秒会产生 300+ 个短命对象，GC 抖动会直接表现为掉帧。
  [未确认] Folia 是否有这方面的实测数据，这属于本项目自己的加固。
- **`resolveFumeStaticLayers` 的 `getSnapshot` 回调**不要闭包捕获整块 `article`（每次调用都新建闭包）；
  用参数传递或用不带闭包的函数 + 显式 cache 参数。
- **`resolvePrintedGraphemeCount` / `Progress` 每帧被相机与绘制各调用一次**（同一块、同一 time 调两次）。
  本项目可以在 `stepFumeCamera` 里把结果缓存进帧上下文（`frameCache.printedCountByBlockId`），
  绘制时复用。这是纯收益优化，不改数值。
- **`widthBetweenOffsets` 是 O(段数) 线性扫描**（§4.4），相机每帧对同一块最多调用 3 次。
  必要时按 `(blockId, startOffset, endOffset)` 做帧内缓存（只活一帧，`Map.clear()` 即可）。

### 16.3 视觉与算力的取舍（原实现已经做过的）

| 取舍 | 代价 | 收益 | 出处 |
| --- | --- | --- | --- |
| 非当前块用离屏快照 | `passed` 块的样式变化只能是离散的（靠双快照 alpha 近似） | 几十个块只花 `drawImage`，不重建字形 | §8.4 / §11.3 |
| 只画视口内 ±180px 的块 | 快速飞行时边缘可能有一帧空 | 块数从「全部」降到「几块」 | `isFumeBlockOnScreen` 的 `overscan = 180` |
| 实时块裁到可见区域 | 逻辑比整块稍复杂 | 单块 canvas 永不超过视口 | §11.5 |
| 量化栅格（仅 Linux） | 最多 1.45% 锐度损失 | 字形尺寸集合有界，避免长时间播放卡死 | §11.4 / §11.5 |
| 模糊半径整像素化（仅 Linux） | 辉光略「跳」 | 避免每帧新建字形 strike（4KiB 共享内存/帧） | `glowBlurQuantize.ts:1-17` |
| 同样的渐变只建一次 | 无 | 每帧省下 2 个渐变 + 十几次颜色转换/形状 | `FumeBackground.ts:364-366` |
| 逐字素 style 相同的连续 run 合并 | 无 | 稳定段落的 draw call 降低一个数量级 | §10.4c |

### 16.4 停帧与生命周期

- `paused === true` 时**不排下一帧**（不是「排了但什么都不做」）：CPU 真降到 0；
- 文章为空时仍然排帧（背景要转）——这是渲染循环里唯一的「空转」场景，且它只在加载/前奏期存在；
- `liveRaster.sweep(now)` 与 `releaseSnapshots(cache, now)` **每帧都调**，
  因为它们是 Map 遍历（小常数），比定时器更可靠；
- 切换歌曲会让 `article` 变化 → effect 重跑 → 释放全部快照与栅格 canvas。

---

## 17. 移植陷阱（React → Vue 语义对照）

### 17.1 必须等价保留的语义

1. **`cameraState` 必须跨 effect 重跑存活**（`VisualizerFume.tsx:70` 的 `useRef`、
   `fumeStage.ts:34` 的注释「Owned by the component, so a stage re-run keeps the shot」）。
   在本项目里它必须是 `setup` 作用域里的**普通对象**，且在切歌（`article` 变化）时
   **不要**重建 —— 否则每次重排都会让镜头瞬移回纸张中心。
   `syncFumeCameraToArticle` 只在 `initialized === false` 时放置相机，`initialized` 只在
   `article === null` 时被清掉（`fumeCameraStep.ts:69-71`）。
2. **文章布局是同步长任务**：`buildArticleLayout` 内部是 `(列数 × 8 次二分 × 每块测量)`，
   大歌单（几百行）可能耗时几十毫秒到上百毫秒。原实现用「rAF + setTimeout(0/96ms) + 版本号」
   把它挪出渲染路径（§7.9）。Vue 版本必须保留同样的三段式：
   `requestAnimationFrame` → `setTimeout(0/96)` → 版本号校验。**不要**放进 `computed`（会同步阻塞渲染）。
3. **`hasPrintedContent` 是「整首歌一次」**：它触发的是容器从 `scale 0.985 → 1` 的入场动画
   （`VisualizerFume.tsx:316-322`，`duration 0.45, ease easeOut`）。切换文章时**必须重置**，
   否则第二首歌不会有入场动画。
4. **`showText` / `staticMode` 的语义**：`showText === false` 时**不画任何文字块**（但背景照画）；
   `staticMode === true` 时**连背景都不画**（`useFumeCanvasStage.ts:118-131` 与 `:163-192` 的两处 `if (!staticMode)`）。
   这两个开关在本项目里对应「演示模式 / 静态截图」类需求，别简化成同一个开关。
5. **`overviewStartTime` 用「最后一条可渲染行」**（不是 `lines` 的最后一项）：
   `line.fullText.trim().length > 0` 才算（`VisualizerFume.tsx:196-213`）。
6. **`nextLineStartTime` 传的是「数组里的下一行」**（`lines[block.sourceLineIndex + 1]`，
   `useFumeCanvasStage.ts:232`），不是「时间上的下一行」，也不做空行跳过。
   本项目如果过滤了空行，必须在适配层保持同样的相对关系，否则 `linePassCutoffTime` 会变。

### 17.2 可以自由换成 Vue 写法的部分

| React | Vue | 说明 |
| --- | --- | --- |
| `useRef<HTMLDivElement>` + `ResizeObserver` | `ref` + `onMounted` 里的 `ResizeObserver`、`onBeforeUnmount` 里 `disconnect` | 语义完全一致 |
| `useState` 的 `article` / `viewport` / `isLayoutPending` | `ref` / `shallowRef` | `article` 是只读大对象，用 `shallowRef` 避免深层代理 |
| `motion.div` 的入场动画（`opacity/scale`） | CSS `transition` + class 切换（倾诉已经这么做） | 不需要 `motion-v`；`duration 0.45s ease-out` 手写即可 |
| `AnimatePresence` 字幕进出场 | `Transition` 组件 + CSS（倾诉已有先例） | 转场曲线照抄 §14.2 的 `0.24s ease-out` |
| `useMemo` 的 `runtime`（activeLine/recent/next） | `computed` + 本项目 `LyricLine` 的等价推导 | `getRecentCompletedLine` / `getUpcomingLines` 的判据见 `runtime.ts:35-86`，可以直接翻译 |
| `lucide-react` 的 `Hourglass` | `@ant-design/icons-vue` 的 `HourglassOutlined` 或纯 CSS 骨架 | 加载卡外观次要，但**要保留**（排版确实可能耗时） |

### 17.3 容易踩的坑

1. **`Intl.Segmenter` 的实例应当模块级复用**：原实现在 `fumeMath.ts` 与
   `graphemeTiming.ts` 各建一个（`splitGraphemes` 与 `splitLyricGraphemes` 是两份实现）。
   本项目已有 `tilt/core/graphemes.ts` 的模块级 `SEGMENTER`，**只保留一份**。
2. **`seeded` 的输入字符串必须逐字符一致**：所有形状/区块的随机都绑在
   `${seed}:${worldWidth}:${worldHeight}:${index}` 这类字符串上。
   移植时若把 `worldWidth` 从 `max(world.width, viewport.width * 1.2)` 改成
   `Math.round(...)` 或改变小数位数，**背景形状会全部变位置**（虽然仍然“随机得好看”）。
3. **`Math.round(viewport.width)` 参与布局缓存键**：窗口拖动时浮点尺寸抖动不会触发重排，
   但 `ResizeObserver` 给出的 `contentRect` 是浮点数，所以键里必须取整（否则每像素都重排）。
4. **`lineHeight` 必须取整**（`Math.round(fontPx * 1.02/1.06)`）：基线 `lineHeight * 0.52` 依赖它，
   改成浮点会让文字在垂直方向的抖动变得可见（亚像素基线跳动）。
5. **`colorWithAlpha` 的输入必须是 hex 或 `rgb()`**：它对命名色/`hsl()` 直接原样返回
   （`colorMix.ts:75-80`）。本项目主题色来自 Material You 提取，都是 `rgb(...)`，安全；
   但若以后接入自定义主题色（如 `#fff8` 四位 hex），会走 `fallback` 分支变成白色，
   这是上游已存在的边界，移植时保持同样行为即可（不要「顺手修复」）。
6. **`resolveFumeBlockTiming` 的 `<` / `>=` 精确边界**：
   `staticState = time < line.startTime ? 'waiting' : time >= lineEndTime + colorTrailDuration ? 'passed' : null`。
   写成 `<=` 会让「刚好在起点」的块走 waiting 分支（快照而非实时绘制），
   在那一刻会看到一次明显的「跳帧」。
7. **`hasRevealCompleted` 用的是 `line.endTime`（不是 renderEndTime）**，
   而 `hasPassCutoffReached` 用的是 `linePassCutoffTime`（§8.3）。
   两者的差别在「最后一行 + 无下一行」时最大：`hasRevealCompleted` 一到 `endTime` 就把所有字视为已打印，
   而颜色拖尾要等 `linePassCutoffTime`。改成同一个值会让最后一行少一段拖尾。
8. **`article.blocks`（放置顺序）与 `article.chronologicalBlocks`（时间序）必须分开**：
   绘制用的是 `blocks`（顺序影响遮挡与深度，且是按 seed 打乱的），
   相机与「最后一块」判定用的是 `chronologicalBlocks`。
   用一个数组同时干两件事必然出错。
9. **`resolveFocusBlock` 的「从后往前找第一块已打印」是 O(n)**，每帧一次；
   n 是歌词行数（几百），可以接受，但**不要**在这个循环里额外调用 `widthBetweenOffsets`。
10. **`fume/types.ts` 的 `FumeArticleLayout` 含 `Map`**：本项目若把 article 放进
    `ref` 并开启深层响应式，`Map` 会被代理（且 `blockBySourceLineIndex` 每帧被读）。
    必须用 `shallowRef` 或 `markRaw`。

---

## 18. 未确认项

以下内容本次阅读**无法从源码确认**，实现时不要当成既定事实：

1. **暂停/恢复是否额外补帧**：只看到「`paused` 时不排下一帧」，没有看到恢复播放时
   主动补画或重置 `lastFrameAt` 的逻辑（`useFumeCanvasStage.ts:276-278`）。
   恢复播放瞬间的 `dt` 会变成「暂停时长」（但被 `clamp(…, 1/240, 0.05)` 钳到 50ms），
   因此相机弹簧只走一步 —— 视觉上应当察觉不到，但**未实测**。
2. **`fumeMath.ts` 的 `seeded` 是否存在跨平台差异**：依赖 `Math.imul` 与 `charCodeAt`，
   理论上跨平台一致；未在多引擎下验证。
3. **`prepared.segments` 与 `layoutWithLines` 的行边界是否总能对上**：
   `cursorToGlobalOffset` 对越界游标会退化成「最后一段末尾」，这在极端文本（超长无空格串）下
   可能让 `start === end`，从而产生空 `renderLine`。未构造该用例验证。
4. **`resolveLiveRasterScale` 在 `deviceScale` 极小时的行为**：公式里有 `max(scale, 1e-3)`，
   但 `liveFrame.deviceScale = camera.scale * dpr` 在相机缩到 `CAMERA_SCALE_MIN = 0.22`、
   DPR = 1 时为 0.22 —— 此时栅格倍率约 0.22~0.23，`pad` 里的 `glowReach / scale`
   会被放大 4 倍以上（`pad` 可能达到数百像素）。未确认这是否会触发 `live canvases` 过大。
5. **`textHoldRatio < 1` 的整条路径是否真的被走通**：默认值是 1，
   且本项目不提供设置面板，因此 §6.2/§6.3/§8.4 的 dim 分支在本项目里是死代码（保留但不会触发）。
6. **背景 `time + now * 0.00018` 中的 `now` 单位**：`now = performance.now()`（毫秒），
   乘 0.00018 后每秒贡献 0.18 秒的额外相位。未确认这是笔误还是刻意（例如本意是 0.00018 秒/毫秒）。
   移植时照抄数值。
7. **`buildFumeBackgroundScene` 的 `viewport` 只出现在三处**：入参守卫（`FumeBackground.ts:255`）、
   `worldWidth/worldHeight = max(world, viewport * 1.2)`（`:263-264`）、
   `baseUnit = clamp(min(viewport) * 0.72, 320, 760)`（`:265`）。
   形状数量与火花网格用的是 `worldWidth/worldHeight`（由与视口取大后的结果派生）。
   因此「同一首歌在窗口尺寸变化后背景会重新生成」这一点是确定的，但
   **背景是否会因为纸张高度变化（而非视口）而改变形状布局**需要再看调用方
   （`VisualizerFume.tsx:214-225` 的依赖里有 `article?.width/height`，故会重建）——
   本次未逐项验证所有组合，实现时以「场景随 (viewport, world, seed) 重建」为准。

---

## 19. 实施顺序建议（按依赖倒序，每步可独立验证）

| 阶段 | 内容 | 验收方式 |
| --- | --- | --- |
| F1 | `core/` 纯算法：math / reveal / text-style / block-frame / camera / camera-step / layout-key | vitest 覆盖 §15.5 的首批用例（无 DOM） |
| F2 | `measure/text-measure.ts` + `core/article-layout.ts`（注入测量） | 在真实浏览器里对一首歌打印 §7.8 的 timing 日志，与 Folia 的同名日志对比量级 |
| F3 | `render/background.ts` + 一个只有背景的 `SkinFume.vue`（无文字） | 截图对比：形状数量/分布/不透明度/转动速度 |
| F4 | `render/canvas-text.ts` 的静态快照 + stage 的快照分支 | 播放到中段，已唱过的块应当稳定不闪 |
| F5 | `drawFumeLiveBlock`（逐字素 + 辉光 + 印章） | 单行慢放观察：字序、颜色拖尾、落下的方块 |
| F6 | 相机步进 + 桥接 + 总览 | 长歌词跳行观察：近距离不穿墙、远距离有抬升 |
| F7 | 字幕层 + 空态 + 加载卡 | 与 Folia 逐项对照 §14.2 的表格 |
| F8 | 性能加固（§16）与 Linux 路径（§11.4） | 连续播放 30 分钟观察内存/帧率；Linux 下确认无字形缓存泄漏 |
