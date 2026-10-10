# 「倾诉」面板移植笔记（算法思路，非源码）

> **许可说明**：Folia 是 AGPL-3.0，本项目是 MIT。
> 本文件**只记录从阅读其源码中提炼的算法思路与参数**，不含任何 Folia 源码片段。
> 实现代码全部用 Vue + TypeScript 独立重写。
>
> 参考仓库：`chthollyphile/folia-major`（commit `d824c0b`）
> 参考文件：`src/components/visualizer/tilt/VisualizerTilt.tsx`（701 行）

---

## 1. 视觉意图

一句话：**把一行歌词切成 1–4 段，其中最多一段用「斜体手写感 + 上下交错」呈现，其余用正常横排。**

- 非倾斜段：正体、字重较细、字间距略宽、逐字淡入
- 倾斜段：斜体、字重更细、字间距更宽、每个字按奇偶上下交错偏移
- 两段之间在时间上先后浮现（前一段出现后才轮到后一段）
- 当前正在唱的字有轻微放大脉冲，唱完留一点余晖

整体气质是「安静」，没有背景装饰，靠排版本身制造节奏。

---

## 2. 分行决策

### 2.1 决定切几段

输入：`charCount`（行文本去空格后长度）、`seed`（用行起始时间做种子）、`splitProbability`（用户可调，默认 0.75）

算法：
1. 归一化长度：`normalized = log(charCount + 4) / log(24)`
   - 4 与 24 是拟合常数，使约 20 字的行接近 1.0
2. 抖动：`jitter = seededRandom(seed, 1) * 0.6 + 0.7` → 落在 [0.7, 1.3]
3. 得分：`score = normalized * jitter * splitProbability`
4. 按阈值分段：`< 0.45` → 1 段；`< 1.05` → 2 段；`< 1.7` → 3 段；否则 4 段

**为什么用 log**：字数与「视觉上该分几行」不是线性关系。10 字和 20 字的差别远大于 30 字和 40 字。

### 2.2 切分位置（5 级递进）

从粗到细逐级尝试，每级只对「还不够多」的段再切：

| 级别 | 切分依据 | 说明 |
|---|---|---|
| 1 | 标点 | `，。；！？、…·.,;!?` 之后切（标点归属前段，后随空格归属后段） |
| 2 | 括号引号 | 成对符号外侧切 |
| 3 | 西文词 | 按 `[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*` 的词边界切 |
| 4 | CJK 空格 | 中文里的空格处切 |
| 5 | 特殊字符 | 兜底 |

切完若段数仍不足目标，用「二次切分」补足；若超过目标则合并相邻段。

### 2.3 选定哪一段倾斜

1. 每段按 `seededRandom(seed, 100 + i) < tiltStyleProbability`（默认 0.35）成为候选
2. 从候选中按 `seededRandom(seed, 200)` 选一个
3. 候选为空则整行都是非倾斜

**用行起始时间做种子的意义**：同一首歌每次播放排版一致（可复现），不同歌/不同行排版不同（有变化）。

### 2.4 末段过短的补偿

若最后一段不是倾斜段且长度 ≤ 2 字，且其长度 × 2 ≤ 前一段长度 → 标记为「短末段」，
渲染时字号放大 1.18 倍，避免视觉上过于孤立。

---

## 3. 溢出处理

测量所有段在对应字号下的宽度，与可用宽度（`window.innerWidth * 0.85`）比较。

- **溢出比 ≥ 1.6**：重新切分成更多段（最多比原段数多 4 段），并按新段数重算倾斜选择
- **溢出比 < 1.6**：整体等比缩放，下限 0.5（倾斜段）/ 0.55（非倾斜段）

**为什么分两档**：轻微溢出靠缩放解决（保持分行结构），严重溢出说明分行本身不合理，得重切。

---

## 4. 字号与间距

字号用 CSS `clamp()` 做响应式，三个锚点：

```
clamp(3.125rem, 6.875vw, 5.625rem)
```

再乘以 `fontScale`（用户字号设置）与 `scaleMultiplier`（溢出缩放）。

- 非倾斜段：`fontWeight 400`、`letterSpacing 0.08em`、`lineHeight 1.35`
- 倾斜段：`fontStyle italic`、`fontWeight 300`、`letterSpacing 0.15em`、`lineHeight 1.25`
- 倾斜段的上下交错位移量：`yOffset = 当前字号 px / 6`

---

## 5. 逐字时间

把词级时间戳均摊到字素（grapheme）：

1. 用 `Intl.Segmenter(undefined, { granularity: 'grapheme' })` 切字素
2. 找到该段文本在整行 `fullText` 中对应的字符区间
3. 对区间内的每个词，把 `[startTime, endTime]` 均分给它的非空格字素
4. 若词数不足（时间戳缺失），退化为「整段时长 / 非空格字素数」的均匀分配

**为什么要到字素级**：emoji、组合字符、韩文音节等多码点字符，按 `length` 切会切碎。

---

## 6. 逐字脉冲

对每个字，给定当前时间与它的 `[startTime, endTime]`：

```
duration = clamp(endTime - startTime, 0.2, 0.9)   // 钳制，避免极短/极长音
elapsed = currentTime - startTime

若 elapsed < 0            → 0（还没唱到）
若 elapsed <= duration    → sin(elapsed / duration * π)        // 0→1→0 的钟形
否则：
    afterElapsed = elapsed - duration
    ramp = duration * 1.2
    若 afterElapsed >= ramp → 0.25                              // 余晖底噪(唱过的字保持略大 = "已唱"状态)
    否则                    → 0.25 * (afterElapsed / ramp)      // 余晖线性升起
```

> ⚠️ 上面最后一行早期误写作「余晖线性**衰减**」，那是错的：钟形在 `elapsed = duration`
> 处刚好归 0，而本式在 `afterElapsed = 0` 处也是 0 —— 两者连续，这正是 `ramp` 存在的
> 意义。若是「衰减」，值就得从 0 跳到 0.25 以上再降回来，不连续。所以**公式为准**：
> 曲线是 `0 → 1 → 0 →（升）→ 0.25` 后保持。实现见
> `src/features/immersive/skins/tilt/core/char-pulse.ts`（单测断言余晖段**单调不减**）。

放大倍率：倾斜段 `1 + intensity * 0.18`，非倾斜段 `1 + intensity * 0.15`。

**钟形曲线的作用**：字在唱到的瞬间鼓一下，然后回落，比线性渐变更像「发声」。

---

## 7. 段落浮现时序

每段的显示时间窗口由它包含的词的起止时间决定：
- `start` = 段内第一个词的 `startTime`
- `end` = 段内最后一个词的 `endTime`
- 若段内无词（纯标点等），退化为整行的起止时间

当前时间 `>= segment.start - 0.25` 时该段可见（提前 0.25 秒，让字先出来等声音）。

段内逐字淡入延迟：非空格字的序号 × 0.04 秒（倾斜段 0.05 秒）。

---

## 8. 在本项目的适配要点

### 8.1 数据形状差异

| | Folia | 本项目 |
|---|---|---|
| 行文本 | `line.fullText` | `LyricLine.text` |
| 逐字 | `line.words: { text, startTime, endTime }`（**秒**） | `LyricLine.words?: { word, timeMs, durationMs, trailing? }`（**毫秒**） |
| 行起止 | `line.startTime / endTime`（秒） | 由 `timeMs` 与下一行 `timeMs` 推算 |
| 翻译 | `line.translation` | `LyricLine.translation` |
| 罗马音 | `line.romanization` | `LyricLine.romaji` |

**注意**：本项目的 `words` 是**可选**的 —— 只有拿到 YRC 格式歌词才有逐字时间戳。没有 `words` 时必须退化为「整行时长均匀分配」，否则面板会完全不动。

已核实（`src/services/api/endpoints/lyric.api.ts:21`）：本项目请求 `/lyric/new` 时显式传 `lv=0&tv=0&yv=0`，
其中 `yv=0` 就是要 YRC 逐字歌词，所以**多数歌曲会有 `words`**。但仍有降级场景：
- 部分老歌/冷门歌上游只有行级 LRC，`words` 为 `undefined`
- 歌词加载中（`lyric.loading === true`）或确实无歌词（`lyric.hasLyric === false`）

三种状态都要有对应的渲染分支，不能只处理「有 words」这一种。

### 8.1.1 行结束时间的推算

本项目 `LyricLine` **没有** `endTime` 字段（Folia 有）。需要自己推算：
- 有下一行 → `nextLine.timeMs`
- 最后一行 → `timeMs + 预估时长`（可用 `player.durationMs` 兜底，或固定值如 5 秒）

这个推算值同时用于「段显示窗口的结束」与「无 words 时的均匀分配」。

### 8.2 时间源

Folia 用 `MotionValue<number>` + `currentTime.on('change')` 订阅；
本项目改用 `SkinContext.currentTime()` getter + 组件内 rAF 循环读取。

**rAF 循环由 `SkinShell.vue` 统一启停**（订阅数归零即停），皮肤自己不要另起循环。

### 8.3 字体

Folia 有 `Theme` 对象（`fontFamilyStack` / `fontWeight` 等）；
本项目对应的是沉浸设置里的 `customFont` + `customFontFamily` 数组 + `lyricFontWeight`。
通过 CSS 变量 `--lyric-font-size` / `--rnp-lyric-original-weight` 已注入到沉浸层根元素，
面板可直接 `var()` 取用，不必自己算。

### 8.4 复用现有能力

`LyricLines.vue` 已实现 zoom / blur / fade / stagger / rotate / karaoke / glow 七种动画。
「倾诉」面板**不复用**它（布局逻辑完全不同），但下列能力应当对齐其行为：

- 歌词点击 seek：调 `ctx.seekLyric(lineTimeSec)`，由壳层扣掉 `lyricOffset`
- `lyricStagger` 开启时提前 200ms 切行（与 `ImmersivePlayer.vue:99-100` 一致）
- 暂停时动画应定格（参考 `LyricLines.vue` 的暂停快照机制，用 `transition: none` + 手算中间值）

### 8.5 无歌词 / 纯音乐

Folia 显示「等待音乐」占位文本。本项目应显示中文占位（遵循「用户可见文案必须中文」），
且 `LyricStore` 有 `hasLyric` 标志与 `loading` 状态，需区分「加载中」与「确实无歌词」。

### 8.6 `@chenglou/pretext` 实际 API（已核实，2026-10-10）

已装 `@chenglou/pretext@0.0.9`（`package.json:32`）。导出入口：`.`（layout）、`./rich-inline`。

本次用得到的函数签名（`node_modules/@chenglou/pretext/dist/layout.d.ts:62-73`）：

```ts
prepare(text: string, font: string, options?: PrepareOptions): PreparedText
prepareWithSegments(text: string, font: string, options?: PrepareOptions): PreparedTextWithSegments
layoutWithLines(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight: number): LayoutLinesResult
measureNaturalWidth(prepared: PreparedTextWithSegments): number   // ← 溢出检测用这个
clearCache(): void
setLocale(locale?: string): void
```

`font` 参数是 CSS font shorthand 字符串，如 `'400 48px sans-serif'`。

**⚠️ 全部需 canvas**：这些函数在 Node 环境直接抛
`Text measurement requires OffscreenCanvas or a DOM canvas context.`
（实测确认，见 [[pretext-needs-canvas-no-node-test]]）。
因此「测量」与「算法」必须分层 —— 纯算法可写 vitest 单测，测量层不测。
