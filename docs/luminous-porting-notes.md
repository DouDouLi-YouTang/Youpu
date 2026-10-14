# 「流光」面板移植笔记（算法还原规格书）

> **许可说明**：Folia 源码是 AGPL-3.0，本项目是 MIT。本文件记录的是从阅读其源码后提炼的
> **算法结构、参数与公式**；若后续实现直接复制 Folia 的源码片段（包括 GLSL），本项目必须整体
> 重许可为 AGPL-3.0。参考仓库：`chthollyphile/folia-major`（commit `7701347`，版本 0.7.19）。
>
> 参考文件统一写作 `…/classic/<名字>.tsx`，指
> `F:\Work\_refs\folia-major\src\components\visualizer\classic\`；
> `…/visualizer/<名字>.ts` 指 `F:\Work\_refs\folia-major\src\components\visualizer\`；
> `…/utils/<名字>.ts` 指 `F:\Work\_refs\folia-major\src\utils\`。
> 行号引用的是本次阅读的这份工作副本（与 commit `7701347` 对应）。
>
> 单位约定：**时间一律是秒**（Folia 的 `currentTime` 是秒），**长度一律是 CSS px**，
> **旋转是弧度**。本项目内部是毫秒，换算点在适配层，见 §10.1。
> 凡本次阅读无法从源码确认的推断，均显式标注「**未确认**」。

---

## 0. 一句话概括

流光（Folia 的 `classic` 模式，zh-CN 显示名「流光」）是**逐词呼吸的一次一句歌词舞台**：

1. 从 `lines` 里取出**当前行**（`currentLineIndex`），把这一行按词切开；
2. 用**行起始时间当种子**给每个词算一份确定性的「散落」配置（位移 / 缩放 / 旋转 / 右边距），
   同一行无论重渲染多少次，摆位都一样；
3. 每个词独立维护 `waiting -> active -> passed` 三态，由 `currentTime` 的区间判定驱动；
4. 整行容器有 5.8–8.5 秒的**呼吸浮动**，让没有词在唱的间隙里画面也不完全静止；
5. 底部还有一层共享副字幕（译文 / 罗马音 / 下一句预览）。

它是 Folia 里最“朴素”的一个模式（Folia 自己的注释也这么说），但同时是**唯一一个**把
「逐词散落布局 + 每词独立弹簧 + 合唱涟漪」这套机制走通的原型 —— 后续的 `partita` 直接复用
了它的 `GlowWord` 与 timing 层。

---

## 1. 数据流

```
player.currentTimeMs ─┐
settings.lyricOffset ─┼─► currentTime(秒) ─┬─► 行下标（本项目的 useActiveLyricIndex）
                      │                    │
                      │                    └─► 每个词的 active/passed 判定
lyric.lines ──────────┴─► activeLine ─┬─► displayWords（分词结果）
                                      ├─► lineConfig（容器对齐 / perspective）
                                      └─► wordConfigs（每词的 x/y/scale/rotate/marginRight）
```

关键点：**只有「当前行」参与渲染**。流光不显示上一行、也不做行列表滚动 —— 与「经典」皮肤
的滚动歌词完全不同的排版范式。

---

## 2. 行容器（`…/classic/Visualizer.tsx`）

### 2.1 外层（呼吸浮动）

`…/classic/Visualizer.tsx:337-345`：

```
className  = "relative z-10 w-full h-[70vh] flex items-center justify-center p-8 pointer-events-none will-change-transform"
animate    = { y: [0, -d, 0, d*0.45, 0], scale: [1, 1+0.01*m, 1, 1-0.005*m, 1] }
transition = { duration, repeat: Infinity, ease: 'easeInOut' }
```

其中（`…/classic/Visualizer.tsx:301-330`）：

| 动画强度 (`theme.animationIntensity`) | `distance` d | `duration`（秒） |
| --- | --- | --- |
| `calm` | 10 | 8.5 |
| `normal` | 14 | 7 |
| `chaotic` | 18 | 5.8 |

`m` = `breathingFloatMultiplier`（调参，默认 1，钳制 0–2）。`m <= 0` 时**完全没有浮动
动画**（`lyricContainerFloat` 返回 null）—— 这是「关掉呼吸」的正式途径，不是把幅度调没。

⚠️ `scale` 也在同一条 keyframe 里，幅度是 +1% / −0.5%（乘 `m`），不是纯 y 平移。

### 2.2 内层（整行出场 / 离场）

`…/classic/Visualizer.tsx:346-356`：

```
className = `flex flex-wrap w-full max-w-6xl content-center ${justify} ${align}`
style     = { perspective: `${lineConfig.perspective}px`, minHeight: '300px' }
```

`justify` / `align` / `perspective` 由 §3.2 决定。`max-w-6xl` = 72rem = 1152px。

整行容器的 initial / animate / exit 由 `getGlowWordLineContainerMotion`
（`…/visualizer/glowWordTiming.ts:66-105`）给出，按 `lineTransitionMode` 分三档：

| mode | initial | animate | exit |
| --- | --- | --- | --- |
| `none` | `{opacity:1, scale:1, filter:'blur(0px)'}` | 同 initial | `{opacity:0, scale:1.02, filter:'blur(6px)'}`，0.12s easeOut |
| `fast` | `{opacity:0.35, scale:0.96, filter:'blur(4px)'}` | `{opacity:1, scale:1, filter:'blur(0px)'}`，0.16s easeOut | `{opacity:0, scale:1.04, filter:'blur(10px)'}`，0.16s easeInOut |
| `normal` | `{opacity:0, scale:0.9, filter:'blur(10px)'}` | `{opacity:1, scale:1, filter:'blur(0px)'}`（无显式 duration → framer 默认） | `{opacity:0, scale:1.1, filter:'blur(20px)'}`，0.3s |

三档的 `filter` 都带 `transitionEnd: { filter: 'none' }` —— 动画结束后**必须摘掉 filter**，
否则整行文字在长时间停留时会持续吃 blur 的合成开销。

### 2.3 行过渡档位的来源（`renderHints`）

`resolveGlowWordRenderProfile`（`…/visualizer/glowWordTiming.ts:20-38`）从行对象上读
`renderHints`，拿不到就现算。Folia 的 `buildLineRenderHints`
（`…/utils/lyrics/renderHints.ts`）按**原始行时长** `rawDuration = endTime - startTime` 分档：

| `rawDuration` | `timingClass` | `lineTransitionMode` | `wordRevealMode` |
| --- | --- | --- | --- |
| `< 0.10` s | `micro` | `none` | `instant` |
| `< 0.18` s | `short` | `fast` | `fast` |
| 其它 | `normal` | `normal` | `normal` |

派生量：

- `wordLookahead` = `instant ? 0.03 : fast ? 0.08 : 0.15`（秒）—— 词提前多少秒进入 active；
- `lineRenderEndTime` = 该行可以留在屏幕上的最晚时刻，含出场/离场的补白。`micro` 行取
  `max(endTime, startTime + 0.067)`；其余按 `getLineTransitionTiming` 算 enter/exit 与
  `linePassHold`（`instant` 时 0，否则 normal 0.06 / fast 0.03），见
  `…/utils/lyrics/renderHints.ts:96-146`。

### 2.4 每词 active 的结束时刻

`getGlowWordActiveEndTime`（`…/visualizer/glowWordTiming.ts:40-50`）：

```
instant -> lineRenderEndTime                （整行一起亮，直到行结束）
fast    -> min(lineRenderEndTime, max(word.endTime, word.startTime + 0.12))
normal  -> word.endTime
```

`getGlowWordDisplayDuration`（同文件 `:52-64`）：

```
max(activeEndTime - word.startTime, instant ? 0.08 : fast ? 0.12 : 0.1)
```

这个 duration 是**正文层颜色过渡**的时长（不是容器的）—— 见 §5.2。

---

## 3. 逐词布局配置

### 3.1 分词（`displayWords`）

`…/classic/Visualizer.tsx:139-147`：默认走
`buildPostLyricLayoutUnits(activeLine, { semantic: true, sticky: true })` 再
`buildDisplayWordsFromLayoutUnits(...)`（`…/utils/lyrics/cjkSemanticLayout.ts`）。

`useLegacyLayout: true` 时**直接退回** `activeLine.words`（原始解析器词）。
这是给「新版分词在个别歌词上不好看」准备的逃生门，默认 `false`。

### 3.2 容器档位（`lineConfig`）

`…/classic/Visualizer.tsx:163-176`。种子 `seed = activeLine.startTime`（**秒**，含小数）。

```
isChaotic = animationIntensity === 'chaotic'
isCalm    = animationIntensity === 'calm'

justifyOptions = isCalm ? ['justify-center']
                        : ['justify-start','justify-center','justify-end','justify-around','justify-between']
alignOptions   = isCalm ? ['items-center'] : ['items-start','items-center','items-end']

isInterlude = activeLine.fullText === '......'   // 六个半角句点，逐字比较

justifyContent = isInterlude ? 'justify-center'
                             : justifyOptions[floor(seed % justifyOptions.length)]
alignItems     = alignOptions[floor((seed * 2) % alignOptions.length)]
perspective    = isChaotic ? 500 + (seed % 500) : 1000
```

⚠️ `seed % N` 是**浮点取模**，`seed` 带小数时结果也带小数；`floor` 之后才是下标。
这是「逐行伪随机」的一种廉价写法，重现时必须保持 `seed` 是同样的浮点秒数。

⚠️ `'......'`（半角）是 Folia 自己的插曲行约定。本项目的中文歌词里未必出现，
按原样实现即可（不要顺手扩展成 `'……'`，那是另一个字符，会让行为与 Folia 不一致）。

### 3.3 每词的散落参数（`wordConfigs`）

`…/classic/Visualizer.tsx:177-268`。逐词下标 `i`，`wordSeed = seed + i`，
伪随机 `random(offset) = frac(sin(wordSeed + offset) * 10000)`：

```
插曲行（isInterlude）：
  x = 0
  y = (random(2) - 0.5) * 15
  rotate = 0；scale = 1.5；marginRight = '3rem'；alignSelf = 'center'；passedRotate = 0

普通行：
  baseSpread = chaotic ? 60 : calm ? 0 : 20
  baseRotate = chaotic ? 30 : calm ? 0 : 5

  wordConfigScale = chaotic ? 0.8 + random(4) * 0.6 : 1.1 + random(4) * 0.2
  xVal        = (random(1) - 0.5) * baseSpread * 2
  yVal        = (random(2) - 0.5) * baseSpread * 2
  rotate      = enableWordRotation ? (random(3) - 0.5) * baseRotate * 2 : 0
  passedRotate= enableWordRotation ? (random(8) - 0.5) * 45 : 0
  alignSelf   = (chaotic && random(6) > 0.7) ? (random(7) > 0.5 ? 'flex-start' : 'flex-end') : 'auto'
  marginRight = chaotic ? `${random(5) * 1.5}rem` : '0.8rem'      // legacy 布局到此为止
```

`useLegacyLayout: true` 时 `marginRight` 就用上面那条；`false`（默认）时换成**精确计算**，
见 §3.4。

### 3.4 精确右边距（默认路径，防放大重叠）

`…/classic/Visualizer.tsx:212-241`。目的是：词在 active 时会被放大到 `scale * 1.4`，
相邻词的放大溢出会互相压住，所以右边距要按「溢出量 + 位移差」来给。

先量宽，`measureWordWidth`（`…/classic/Visualizer.tsx:84-98`）：一个模块级复用 canvas，
`context.font = ${fontWeight} ${pxSize}px ${fontStack}`，返回 `measureText(text).width`。
无 DOM 时退化为 `text.length * pxSize * 0.65`（**未确认**：这条分支只在 SSR 下走到）。

`pxFontSize` 由 `getPixelFontSize`（同文件 `:190-196`）算出，rem 固定取 16：

```
pxFontSize = clamp(2.25 * fontScale * 16, 6 * fontScale * viewportWidth / 100, 4.5 * fontScale * 16)
```

逐词（`i` 为当前词下标）：

```
w_i    = 本词宽度；s_i = wordConfigScale_i * 1.4
w_next = 下一词宽度（无下一词则 0）；s_next = wordConfigScale_{i+1} * 1.4（无则 1.0）
x_next = 下一词的 xVal（无则 0）

spacingMultiplier = wordSpacing（默认 0.7，钳制 0–2）
gap = 0.05 * pxFontSize

halfOverflow_i    = w_i * (s_i - 1) / 2
halfOverflow_next = w_next * (s_next - 1) / 2
xOffsetDiff       = xVal - x_next

calculatedMargin = (halfOverflow_i + halfOverflow_next + xOffsetDiff + gap) * spacingMultiplier
minMargin        = (chaotic ? 0.08 : 0.12) * pxFontSize * spacingMultiplier
finalMargin      = max(minMargin, calculatedMargin)
marginRight      = `${finalMargin.toFixed(1)}px`
```

⚠️ 量宽用的字体是 `resolveThemeFontStack(theme)` + `resolveThemeFontWeight(theme, 700)`；
**渲染**时词的字重也是 `resolveThemeFontWeight(theme, 700)`（`…/visualizer/GlowWord.tsx:73`）。
两处必须一致，否则量出来的宽度和真正排出来的宽度不是一回事。

### 3.5 字号

`…/classic/Visualizer.tsx:149-151`：

```
主行字号 mainFontSize  = clamp(2.25*scale rem, 6*scale vw, 4.5*scale rem)
空态字号 emptyFontSize = clamp(1.5*scale rem, 3.5*scale vw, 2.25*scale rem)
```

`scale` = `lyricsFontScale`。副字幕字号（`…/visualizer/subtitleFontSizes.ts`）：

```
translationFontSize = clamp(1.125*scale rem, 2.6*scale vw, 1.25*scale rem)
upcomingFontSize    = clamp(0.875*scale rem, 2*scale vw, 1*scale rem)
```

⚠️ `clamp()` 的三项**都必须**乘 `scale`（Folia 用 `toFixed(3)` 拼字符串）。只乘中间项是
常见的移植错误：那样缩放在触到下/上界时会失效。

---

## 4. 词的三态机

`…/visualizer/GlowWord.tsx:48-58`：

```
newStatus = 'waiting'
if (t >= word.startTime - wordLookahead && t <= activeEndTime) newStatus = 'active'
else if (t > activeEndTime) newStatus = 'passed'
```

⚠️ 三个边界都要留意：

1. 下界是 `>=`（**含** `startTime - lookahead`，所以词会提前 `lookahead` 秒进入 active）；
2. 上界是 `<= activeEndTime`（**含**，正好等于时仍是 active）；
3. `t > activeEndTime` 才转 `passed`；`t < startTime - lookahead` 是 waiting。

Folia 用 `useMotionValueEvent(currentTime, 'change', ...)` 订阅，**只在状态真的变化时**
`setState`。这一点很重要：每帧都 setState 会让整行重渲染。

---

## 5. 词的三层结构

`…/visualizer/GlowWord.tsx:61-131`。一个词 = 容器 `motion.div`，内含三层：

```
<motion.div variants={layoutVariants}
            class="inline-block origin-center relative will-change-transform whitespace-nowrap"
            style={{ fontSize, fontWeight, lineHeight: 1.22, ...layoutStyle }}>
  <span class="absolute inset-0 select-none pointer-events-none block" aria-hidden>   <- 辉光层
     ...每个字素一个 <motion.span variants={wordGlowVariants}>
  </span>
  <motion.span variants={bodyVariants} class="relative z-10 block">                  <- 正文层
     {word.text}
  </motion.span>
  <AnimatePresence>... 合唱涟漪 ...</AnimatePresence>                                 <- 涟漪层
</motion.div>
```

关键样式：`lineHeight: 1.22`、字重 `resolveThemeFontWeight(theme, 700)`、
`origin-center`（缩放/旋转的基准点在中心）、`whitespace-nowrap`（词内绝不换行）。

`layoutStyle` 由调用方合并进来：`{ marginRight, alignSelf }`。

### 5.1 容器层（位移 / 缩放 / 旋转）

`buildGlowWordLayoutVariants`（`…/visualizer/glowWordVariants.ts:7-45`）：

| 状态 | opacity | scale | x | y | rotate |
| --- | --- | --- | --- | --- | --- |
| `waiting` | 0 | 0.5 | `config.x + sin(config.y) * 100` | `config.y + cos(config.x) * 50` | `enableWordRotation ? config.rotate + 20 : 0` |
| `active` | 1 | `isNaN(config.scale) ? 1.5 : config.scale * 1.4` | `config.x` | `config.y` | `config.rotate` |
| `passed` | `chaotic ? 0.9 : 0.82` | `config.scale or 1` | `config.x` | `config.y` | `config.rotate + config.passedRotate` |

过渡：

- waiting：`{ duration: 0.4 }`
- active：`{ type: 'spring', stiffness: 200, damping: 20, opacity: { duration: 0.1 } }`
- passed：`{ duration: 0.5, rotate: { duration: 5, ease: 'linear' } }`

⚠️ 三处易错点：

1. **waiting 的 x/y 不是配置值**，而是 `x + sin(y)*100` / `y + cos(x)*50` —— 拿 `y` 当
   sin 的入参（弧度）、`x` 当 cos 的入参。这是「从远处飘进来」的起点，不是随手写的偏移。
2. `active` 的 scale 里有 `isNaN` 兜底（Folia 用 `config.scale * 1.4`，NaN 会让元素消失）。
3. `passed` 的 rotate 用**独立的 5 秒线性过渡**，而 scale/x/y/opacity 用 0.5 秒 ——
   于是词在归位后还会**慢慢继续转** 5 秒，这是「余韵」的来源。

### 5.2 正文层（颜色 / 模糊）

`glowWordBodyVariants`（`…/visualizer/glowWordVariants.ts:48-74`）：

| 状态 | color | filter | 过渡 |
| --- | --- | --- | --- |
| `waiting` | `baseColor` | `blur(10px)` | `{ duration: 0.4 }` |
| `active` | `activeColor` | `none` | `color: { duration: duration或0.2, ease:'linear' }`；`filter: { type:'tween', duration: instant?0.08 : fast?0.12 : 0.2 }` |
| `passed` | `baseColor` | `blur(0px)` | `color: { duration: instant?0.12 : fast?0.24 : 0.8, ease:'easeInOut' }`；`filter: { duration: instant?0.12 : fast?0.2 : 0.5 }` |

`active` 与 `passed` 都带 `transitionEnd: { filter: 'none' }`。

`baseColor` = `theme.primaryColor`，`activeColor` = `resolveWordColor(...)`（§6）。

### 5.3 辉光层（逐字素）

`wordGlowVariants`（`…/visualizer/wordGlow.ts`，**本次未逐行阅读 —— 未确认**细节）。
驱动方式：`graphemeTimings.length > 1` 时**逐字素**渲染一个 `motion.span`，否则整词一个 span。
每个字素的自定义参数（`…/visualizer/GlowWord.tsx:80-105`）：

```
{ config, activeColor, baseColor, duration, index, total,
  charStartTime: timing.startTime, charEndTime: timing.endTime,
  wordStartTime: word.startTime, wordRevealMode }
```

字素时间由 `buildWordGraphemeTimings`
（`…/utils/lyrics/graphemeTiming.ts:44-52`）给出：有 `syllables` 就按音节各自均分，
否则把词的 `[startTime, endTime]` **均分到每个字素**（空串返回空数组）。

### 5.4 合唱涟漪

`…/visualizer/GlowWord.tsx:117-130`，仅当 `isChorus === true`（来自行对象）且
`status === 'active'`：

```
class  = "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[150%] aspect-square rounded-full border-1 pointer-events-none z-0"
style  = { borderColor: activeColor, filter: 'blur(1px)' }
initial= { scale: 0.2, opacity: 0.8 }
animate= { scale: rippleScale, opacity: 0 }     // rippleScale = 1.5 + Math.random() * 2（每次挂载随机）
exit   = { opacity: 0 }
transition = { duration: 0.5, ease: 'easeOut' }
```

⚠️ `rippleScale` 是 `useMemo(() => 1.5 + Math.random() * 2, [])` —— **每个词的涟漪大小
都不一样**，且每次挂载重掷。这是流光里唯一一处非确定性，重现时可换成确定性种子
（视觉等价），但要意识到它在那里。

---

## 6. 词的取色

`resolveWordColor`（`…/visualizer/wordColoring.ts:215-263`，`cjkMatchMode` 默认
`'target-contains-token'`）：

1. 没有 `theme.wordColors` 或为空 -> 返回 `fallbackColor`（= `theme.accentColor`）；
2. 词的 trim 结果为空 -> 同上；
3. 取 `theme.wordColors` 里**第一个**匹配项：
   - 词是 CJK（`/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/`）-> `target.includes(词)`；
   - 否则把 target 按空白拆词并去掉非 `\w`，与同样规范化后的当前词比对 -> `includes`。

⚠️ 是**第一个匹配**（`Array.find`），不是最长匹配、也不是权重最高的那个。

---

## 7. 空态

`…/classic/Visualizer.tsx:381-395`：`showText && !activeLine` 时居中显示一句
`t('ui.waitingForMusic')`，字号用 `emptyFontSize`、颜色 `theme.secondaryColor`、
`className="text-2xl opacity-50 absolute"`，配 `initial/animate/exit = {opacity: 0 -> 1 -> 0}`。

⚠️ 与「倾诉」不同，流光**没有**「歌名 + 歌手」这一档 —— Folia 的文案就是「等待音乐」。
本项目对齐自己的中文口径即可（用户 2026-10-11 定的口径见 `SkinTilt.vue`）。

---

## 8. 底部副字幕

`…/visualizer/VisualizerSubtitleOverlay.tsx`，两个模式共用：

1. **有可读文本**：`activeLine` 与 `recentCompletedLine` 里取**第一个**有内容的行，
   按 `subtitleContentMode` 展开成轨道（罗马音在前、译文在后）；
2. **无可读文本但有 activeLine**：显示接下来的 `nextLines`（最多 2 行）作为预览，
   带 `blur-[1px]`（`subtitleUpcomingLyricsBlur` 控制）；
3. 每行都要求 `/[\p{L}\p{N}]/u` 命中，纯符号行（`//`、`●●●`）一律不显示。

背景辉光（`subtitleOverlayBackground` 为真时）：

```
radial-gradient(ellipse 115% 130% at center,
                rgba(bg, 0.96) 0%, rgba(bg, 0.78) 62%, transparent 100%)
```

铺在一个 `absolute -inset-x-10 -inset-y-6 blur-2xl` 的层上。
文字阴影：`0 1px 2px rgba(bg, 0.24)`。

配色 / 字重：`color = theme.secondaryColor`，`fontWeight = resolveThemeFontWeight(theme, 500)`；
第二行（栈里的次级行）按 `subtitleTrackStyle` 降档（**本次未逐行阅读 —— 未确认**）。

---

## 9. 事件

流光本身没有点击事件（`pointer-events-none`）。行跳转由外侧的播放器桥接层负责，
本项目对齐「倾诉」的做法：**点当前行 -> `ctx.seekLyric(line.timeMs)`**。

---

## 10. 落地到本项目（Vue）

### 10.1 单位与时间源

| Folia（秒） | 本项目（毫秒） |
| --- | --- |
| `line.startTime` | `line.timeMs / 1000` |
| `word.startTime` / `endTime` | `word.timeMs` / `word.timeMs + word.durationMs`（÷1000） |
| `wordLookahead` 0.15 / 0.08 / 0.03 | 150 / 80 / 30 ms |
| `duration`（正文过渡） | 同上，毫秒 |

**行索引的来源**：Folia 用 `currentLineIndex` prop；本项目同一个语义由
`useActiveLyricIndex()`（`use-skin-context.ts`）提供，已含 `lyricOffset` 与 stagger 提前量。

**逐帧时钟**：Folia 的 `currentTime` 是每帧更新的 MotionValue；本项目
`player.currentTimeMs` 被 `THROTTLE_MS = 250` 节流。因此「流光」**必须**走
`skins/shared/use-smooth-clock.ts`（外推 + 相位收敛），不能直接用 `ctx.currentTime()`：
4Hz 会让三态区间判定成批跳变（`instant` 档的行时长下限只有 67ms，比一个采样周期还短）。

### 10.2 动画驱动方式的选择

Folia 用 framer-motion 的 variants + spring。本项目有两条路：

1. **`motion-v`**（`motion-v@2.7.0`，MIT，framer-motion 的 Vue 端口）—— 可以几乎逐字搬运
   variants、spring 参数、`AnimatePresence`，保真度最高；
2. 手写 CSS keyframes + 负延迟（倾诉走的路）—— 依赖少，但 spring 曲线要自己拟，
   且「词的状态变了才重渲染」这层优化要自己做。

**结论：走 `motion-v`。** 流光几乎全部视觉都建立在 framer 的 variants / spring 语义上
（`type:'spring'` 的 stiffness/damping、`transitionEnd`、`AnimatePresence` 的 popLayout
与退出动画），手写等价物要重实现半个动画引擎，且必然在某些时刻与 Folia 有肉眼可见差异。

⚠️ `motion-v` 的 peer dependency 是 `@vueuse/core >= 10`。本项目没有直接声明它，但
npm 已把它作为传递依赖装好（实测 `npm ls @vueuse/core` -> `motion-v@2.7.0 -> @vueuse/core@15.0.0`），
`framer-motion` / `motion-dom` / `motion-utils` 同为 `14.1.1`。落地时不需要额外装包，
但要知道这层依赖来自 motion-v（不是本项目自己声明的）。

### 10.3 与「经典」皮肤的关系

流光是**并列的新皮肤**（不是替换经典），所以：

- 新建 `skins/<id>/` 目录，`index.ts` 里 `defineSkin({ hasSettings: false, order: 2 })`；
- `hasSettings: false` -> 沉浸页右上角不出现设置按钮、根节点不套用经典那套外观 class /
  CSS 变量（见 `shared/use-backdrop.ts` 的两档说明）；
- **不读** `settings.lyricFontSize` / `lyricFontWeight` / `customFontFamily` ——
  字号倍率固定为 1（对应 Folia 的 `lyricsFontScale = 1` 默认），字体用内置衬线字体
  `'Folia Noto Serif SC'`（已在 `src/assets/fonts/fonts.scss` 注册）。

唯一的例外是**沉浸页通用项**（明暗 / 主色 / 底栏 / 演示模式 / **歌词偏移**）—— 两边都读。

### 10.4 主题字段的对应

Folia 的 `Theme` 与本项目的差异（本项目没有独立的 Theme 对象，环境配色来自 CSS 变量与
`colorScheme`）：

| Folia 字段 | 本项目的来源 |
| --- | --- |
| `backgroundColor` | 深色 `#09090b` / 浅色 `#f5f5f4` |
| `primaryColor` | 深色 `#f4f4f5` / 浅色 `#1c1917` |
| `accentColor` | 深色 `#f4f4f5` / 浅色 `#ea580c` |
| `secondaryColor` | 深色 `#71717a` / 浅色 `#44403c` |
| `animationIntensity` | 本项目无对应设置 -> 固定 `'normal'`（见 §10.5） |
| `wordColors` | 本项目无对应设置 -> 空（取色回退到 `accentColor`） |
| `fontStyle` / `fontFamily` | 固定衬线内置字体（§10.3） |

配色取值来源：`…/services/baseThemes.ts` 的 `DEFAULT_THEME`（暗）与 `DAYLIGHT_THEME`（亮）。

### 10.5 `animationIntensity` 的固定值

本项目没有「动画强度」这个设置（结论来自用户的「三个面板都先不带设置」要求）。
固定的档位必须是 Folia 的默认值 `'normal'`，理由是：

- `calm` 会把 `justifyOptions` / `alignOptions` 收成单元素数组、`baseSpread` / `baseRotate`
  归零 —— 变成「所有行都一模一样地居中」，**丢失散落布局这个特征**；
- `chaotic` 的 `baseSpread = 60` / `baseRotate = 30` 在窄窗口上会明显出界。

`'normal'` 下：`baseSpread = 20`、`baseRotate = 5`、`perspective = 1000`、
5 种 justify × 3 种 align、呼吸 7 秒 / 14px。

---

## 11. 验收要点（与 Folia 的预览图对齐）

Folia 自己的预览图 `img/preview-lumi.png`（2521×1358）就是 `classic` 模式的定妆照，
可作为像素级对照的基准。对照时留意：

1. 背景**不是**几何形状 —— 默认背景是 `latent`（封面取色的 mesh / dithering 着色器）。
   预览图里的五角星 / 水滴 / 太阳图标来自 **AI 主题的 `lyricsIcons`**，默认主题下
   不会出现（`GeometricBackground` 的 `shape.type === 'icon'` 分支只在
   `theme.lyricsIcons` 非空时才会被选中，见
   `…/backgrounds/common/GeometricBackground.tsx:283-293`）。
2. 词是**逐词放大 1.4 倍**再回落，不是整行缩放。
3. 唱过的词**不会**变暗到看不见：`passed` 的 opacity 是 0.82（normal），颜色回到
   `primaryColor`，还会继续缓慢旋转 5 秒。
4. 底部有一层副字幕（译文 / 罗马音），带一个椭圆形的深色辉光背景。
5. 整行在 7 秒周期里做 ±14px 的上下呼吸，幅度不大但肉眼可见。

---

## 12. 未确认事项

1. `…/visualizer/wordGlow.ts` 的 `wordGlowVariants` 本次**没有**逐行阅读 ——
   辉光层的具体 text-shadow 半径 / 颜色过渡公式未在本文件给出。
2. `…/utils/lyrics/subtitleTrackStyle.ts` 的次级轨道降档系数
   （`SECONDARY_TRACK_*` 四常量）本次未逐行阅读。
3. Folia 的 `buildDisplayWordsFromLayoutUnits`（`…/utils/lyrics/cjkSemanticLayout.ts`
   后半部分）本次只读到 `buildCjkSemanticLayoutUnits`，display 层的合并规则未逐行确认。
4. `lineConfig` 里的 `perspective` 在 `alignItems` 已由 flex 决定的情况下具体影响哪一层
   变换 —— 从源码能看出值，但未做渲染级验证。