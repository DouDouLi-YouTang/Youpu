# 改造实施方案：音频回归渲染进程 + 移除低内存模式 + Folia 歌词面板

> 本文件是 `docs/folia-integration.md` 的**修订版实施计划**。
> 原文档写在「音频在主进程」的前提下，其中 §1.2 的音频分析器结论已被本次改造**推翻**。
> 凡与原文档冲突处，以本文件为准。

---

## 0. 三项改动的相互影响（先看这个）

```
移除低内存模式  ──┐
                 ├──> 音频回到渲染进程 ──> 真实频谱变得可行（原文档的最大障碍消失）
移除音频引擎    ──┘                          │
                                            └──> Folia 面板的「随拍反应」可以真正实现
```

**关键结论**：原文档 §1.2.B 那套「跨 4 层、改 13 处」的 IPC 转发链路**整体作废**。
音频回到渲染进程后，`getAudioElement()` 就是真正的播放元素，直接
`createMediaElementSource()` + `AnalyserNode` 即可，**零 IPC**。

**但 CORS 问题不会因此消失** —— 它与音频在哪个进程无关，只取决于资源 origin。
好在已实证澄清（详见 §4.5）：三处音源里两处自带 CORS 头，只剩 `muice-cache://` 需补一个响应头。
另有一个原文档未提及的**新问题**：`createMediaElementSource()` 会破坏 `setSinkId`（输出设备切换），
解法见 §4.5 问题 1。

---

## 1. 已确认的决策（用户拍板）

| # | 决策项 | 结论 |
|---|---|---|
| 1 | 改造范围 | 按原文档做**完整皮肤系统**（封面 + 歌词 + 背景），控制条不参与换肤 |
| 2 | 首批面板 | **只要「倾诉」（tilt）** + 现有面板作为「经典」 |
| 3 | 切换入口 | 沉浸页悬浮切换条 **+** 设置面板 tab，两处同步 |
| 4 | 音频响应 | **要**，做真实频谱 |
| 5 | Folia 许可 | **重写**，不引入 Folia 任何源文件（AGPL-3.0 → 本项目 MIT 保持干净） |
| 6 | 排版库 | **引入** `@chenglou/pretext`（MIT） |
| 7 | 面板命名 | 用 Folia 的中文译名（倾诉） |
| 8 | 开发方式 | 开子代理团队并行，协调者负责集成与验收 |
| 9 | 队列持久化 | **删掉**，回到引入低内存前的行为（重启后队列为空） |
| 10 | 设置面板拆分 | **先拆分**再加「样式」tab |
| 11 | 现有面板 | **保留为「经典」**，不重写 |

---

## 2. 第一阶段：音频回归渲染进程 + 移除低内存模式

### 2.1 整文件删除（5 个）

| 文件 | 行数 | 说明 |
|---|---|---|
| `electron/main/audio-engine.ts` | 586 | 主进程音频编排层 |
| `electron/main/bg-player.ts` | 332 | 隐藏播放窗口（内联 HTML） |
| `electron/main/memory-mode.ts` | 287 | 低内存模式本体 |
| `electron/preload/bg-player.ts` | 16 | `window.bgBridge` 暴露 |
| `src/features/player/core/bg-advance.ts` | 50 | 后台切歌决策（唯一消费者是 audio-engine） |

**连带删除**：
- `src/features/player/use-low-memory-restore.ts`（212 行）
- `src/features/player/low-memory-restore.test.ts`（320 行）
- `src/features/player/core/bg-advance.test.ts`（99 行）
- `src/domain/low-memory.ts`（87 行）
- `src/platform/electron/low-memory.ts`（30 行）
- `src/pages/settings/components/LowMemorySettings.vue`（73 行）
- `src/platform/electron/remote-audio.ts`（169 行）

### 2.2 `electron/main/index.ts` 改动点

| 行号区间 | 内容 | 处理 |
|---|---|---|
| `:33-52` | audio-engine 的 18 个符号 import | 删 |
| `:53` | `registerBgPlayerProtocol` | 删 |
| `:55-64` | memory-mode 的 8 个符号 import | 删 |
| `:65-66` | `LowMemoryMode` / `QueueItem` 类型 import | 删 |
| `:146-156` | `muice-bg` privileged scheme | 删 |
| `:915-949` | `buildTrayMenu`，`:919-923` 的 `routeMediaAction` fallback | 简化为直接 send |
| `:951-974` | `createTray`，`:963-970` 托盘左键走 `ensureWindowVisible()` | 改回 `win.show()/hide()` |
| `:1042-1050` | `webPreferences` | **加 `backgroundThrottling: false`**（见 §2.5） |
| `:1082-1085` | `attachLowMemoryWindow` | 删 |
| `:1095-1098` | `teardownMainWindowReference` | 删 |
| `:1100-1113` | `LOW_MEMORY_CONFIG_FILE` + `persistLowMemoryMode` | 删 |
| `:1214-1219` | `player:state-push` 里的 `isEnginePlaying()` | 改回纯 `lastPlayerState` |
| `:1221-1269` | audio IPC 全部 10 个 handle + payload 接口 | 删 |
| `:1271-1281` | low-memory IPC 2 个 handle | 删 |
| `:1608` | `registerBgPlayerProtocol()` | 删 |
| `:1611-1645` | `initAudioEngine` / `attachAudioEngine` / `setEngineEventForwarder` / `onEngineStateChanged` / `setLowMemoryMode` / `initLowMemoryMode` | 删 |
| `:1689-1693` | `app.on('activate')` 的 `ensureWindowVisible()` | 改回原版判断 |
| `:1705-1715` | `before-quit` 的 `disposeLowMemoryMode()` / `destroyAudioEngine()` | 删 |

**保留不动**：
- `:1565-1567` `app.setAppUserModelId` — SMTC 回归渲染进程后仍需要
- `:104` `use-fake-ui-for-media-stream` 与 `:1600-1604` 权限放行 — 初始提交就有，与设备名显示有关
- `playback-cache.ts` 全部 — 与低内存无关

### 2.3 `src/stores/player.store.ts` 改动点

| 位置 | 处理 |
|---|---|
| `:29` | 删 remote-audio import |
| `:239-271` `init()` | 改回无条件 `useAudioElement(getAudioElement(), callbacks)`，拆掉 `if (!remote)` 守卫 |
| `:283-311` `updateMediaSessionMetadata()` | 删 remote 分支（`:287-297`），保留本地实现 |
| `:318` | 删 `if (shouldUseRemoteAudio()) return` |
| `:739-749` `syncPosition` | **保留**（`onPosition` 现在是 `useAudioElement` 的正式回调），改注释 |
| `:501-527` `play()` | **保留** `!track && currentItem` 分支与 `expiresAt != null` 判断 — 前者在切歌瞬间也会命中，后者比真值判断更严谨 |

### 2.4 `src/stores/play-queue.store.ts` 改动点（回到旧行为）

- 删 `positionMs` 字段（`:24-31`）
- 删 `setPosition()`（`:135-138`）
- 删 `clear()` 里的 `:122`
- **删 `persist` 配置**（`:203-208`）— 回到 `44b507f` 的不持久化行为

### 2.5 窗口隐藏后能否继续播放（已核实，非推测）

**结论：音频本身不受影响；加 `backgroundThrottling: false` 是为了定时器，作为保险保留。**

证据链（本仓库自身，非外部推测）：

1. `bg-player.ts` / `audio-engine.ts` 由 **f1c6c06（2026-10-04）** 引入
   （`git log --diff-filter=A -- electron/main/bg-player.ts`）
2. 即 **2.0.4 及之前，音频本来就在渲染进程的主窗口里**
3. 用 `git show f1c6c06^:electron/main/index.ts | grep backgroundThrottling` 查证：
   那时主窗口**没有**这个设置，同时期已有 `mainWindow.hide()`（`:908`、`:1088`）的托盘隐藏逻辑
4. 而这些版本已发布并被正常使用（能最小化到托盘继续听歌）

**推论**：
- Chromium 不会因窗口不可见而中断媒体播放 —— 媒体事件（`timeupdate` 等）不受后台节流影响
- 本项目 `src/` 下**没有任何** `visibilitychange` / `document.hidden` 监听（已 grep 确认），
  不存在「页面隐藏时自己暂停」的代码
- 音频回渲染进程后，进度同步走 `useAudioElement.ts` 的 `timeupdate` 媒体事件（`:263`），不受节流

**那为什么还要加 `backgroundThrottling: false`**：隐藏窗口的**定时器**会被 Chromium 降频
（后台约 1 分钟一次），受影响的是：

| 位置 | 用途 | 受影响表现 |
|---|---|---|
| `player.store.ts:104` | 播放失败 3 秒自动跳过（`setInterval`） | 最小化时失败后卡住不跳，恢复窗口才跳 |
| `ImmersivePlayer.vue:225` | 沉浸页时钟（`setInterval` 1000ms） | 最小化时时钟不走（沉浸页本身也不可见，影响极小） |

**处理**：`electron/main/index.ts:1042-1050` 的 `webPreferences` 加 `backgroundThrottling: false`。
这是**保险措施而非必需项** —— 加了不会有副作用，不加也不会导致音频中断。

**验收标准**：播放中最小化窗口 / 关闭到托盘，音乐必须不中断，恢复窗口后进度条位置正确。

### 2.6 清理项

- `electron/preload/index.ts`：删 `:37-38` channels、`:173-220` 类型、`:415-422` `lowMemory` 命名空间、`:423-475` `audio` 命名空间
- `src/types/global.d.ts`：删 `:133-198` 类型、`:236-237` channels、`:296-318` 两个命名空间
- `src/platform/electron/commands.ts`：删 `:34-35` channels
- `src/app/main.ts`：删 `:10-13` import、`:26-28`、`:33-35`；**保留 `initPlayerProvider()`**（回归后必需）
- `src/features/player/core/queue.ts`：删 `resolveQueueItemIndex`（唯一消费者是 audio-engine）
- `electron.vite.config.ts:50-52`：删 preload 的 bg-player input（**不删会构建失败**）
- `electron.vite.config.ts:27-33` + `tsconfig.electron.json:6-8`：main 的 `@` alias — 删 audio-engine 后无消费者，可删（已 grep 确认 `electron/` 下无 `from '@/'`）
- `README.md:57-80`「低内存模式」整节；`build/release-notes.md` 全文重写
- `src/composables/useAudioElement.ts`：逻辑不动，只改注释里指向 `bg-player.ts` 的部分

---

## 3. 第二阶段：设置面板拆分（纯机械重构）

### 3.1 目标结构

```
src/features/immersive/
├── ImmersiveSettings.vue          # 壳：~140 行（Transition + 关闭 + tab 导航 + <component :is>）
└── settings/
    ├── SettingsAppearance.vue     # ~130 行
    ├── SettingsCover.vue          # ~110 行
    ├── SettingsBackground.vue     # ~190 行
    ├── SettingsLyric.vue          # ~230 行
    ├── SettingsFont.vue           # ~70 行
    ├── SettingsAbout.vue          # ~60 行
    ├── SettingsSkin.vue           # 新增（§4.4）
    ├── options.ts                 # 共用 options 数组 + marks 常量
    └── use-settings-draft.ts      # 条件显隐 computed
```

### 3.2 现状对照

- `TABS` 常量在 `ImmersiveSettings.vue:211-218`，`TabKey` `:219`，`activeTab` `:220`
- 切换机制是 **`v-show` 平铺**，不是动态组件 — 改为 `<component :is>` 后各 tab 的 `v-show` 条件消失
- 6 个 section 的行号：外观 `:319-368`、封面 `:371-416`、背景 `:419-578`、歌词 `:581-731`、字体 `:734-796`、关于 `:799-823`
- **注意**：文件头注释 `:23-24` 写「8 个 tab」与实现不符（实际 6 个），拆分时顺手修正

### 3.3 已发现的既有问题（拆分时一并修正）

`ImmersiveSettings.vue:41-57` 的 `DEFAULTS` 与 store 实际默认值有 3 处不符：
- `albumSize`: DEFAULTS 400 vs store 800
- `lyricFontWeight`: DEFAULTS 700 vs store 500
- `fluidBlur`: DEFAULTS 6 vs store 7

**处理方式**：以 store 为准修正 DEFAULTS（reset 按钮应恢复到真实默认值）。

### 3.4 验收标准

- 拆完后用 `node scripts/css-equiv-check.mjs` 校验样式等价
- `git diff --stat` 核对行数守恒
- **需要你手动过一遍 6 个 tab 确认没漏控件**

---

## 4. 第三阶段：皮肤系统骨架 + Folia「倾诉」面板

### 4.1 目录结构

```
src/features/immersive/
├── use-audio-bands.ts             # 真实频谱（§4.5）
├── immersive-settings.store.ts    # +skin 字段 +applySkin
└── skins/
    ├── types.ts                   # SkinId / SkinDefinition / SkinContext
    ├── registry.ts                # import.meta.glob 自动发现
    ├── use-skin-context.ts        # 统一把 store 状态喂给皮肤
    ├── shared/
    │   ├── SkinShell.vue          # 拖拽带 + 窗口按钮 + 全屏时钟 + 演示提示 + ESC
    │   ├── SkinChromeButtons.vue  # 4 个窗口按钮（避免 SkinShell 超 400 行）
    │   ├── SkinSwitcher.vue       # 悬浮切换条（§4.4）
    │   ├── use-transport.ts       # seek/volume/rate/音质
    │   └── use-backdrop.ts        # backgroundType → 渲染参数
    ├── classic/                   # 现有布局 = 第一款皮肤
    │   ├── index.ts
    │   ├── SkinClassic.vue        # 复用 LyricLines.vue
    │   └── classic.scss
    └── tilt/                      # Folia 倾诉
        ├── index.ts
        ├── SkinTilt.vue
        ├── use-tilt-layout.ts     # 分行 + 倾斜选择 + 缩放
        ├── use-tilt-timing.ts     # 逐字时间 + 脉冲强度
        └── tilt.scss
```

### 4.2 关键契约（对齐原文档 §3.1，但 `AudioBands` 形状更新）

```ts
/** 音频频带能量，0–1。真实频谱（§4.5）驱动 */
export interface AudioBands {
  low: number    // 20–250Hz，驱动整体脉动
  mid: number    // 250–2kHz，驱动文字呼吸
  high: number   // 2k–8kHz，驱动粒子闪烁
  power: number  // 全带能量
}
```

**`skin` 字段的持久化不用额外做**：`immersive-settings.store.ts` 末尾是 `persist: true`
（整体持久化，`:176`），加进 state 即自动持久化。
（对比：`play-queue.store.ts` 的 `persist` 本次要**删掉**，见 §2.4 —— 两者方向相反，别搞混。）

`SkinContext` 保持原文档 §3.1 的 getter 形态（`currentTime()` / `currentLineIndex()` /
`isPlaying()` / `bands()` / `coverUrl()` / `songTitle()` / `songArtist()` / `songAlbum()` / `seekLyric()`）。

### 4.3 「倾诉」面板移植要点（从 Folia 源码重写为 Vue）

**Folia 原始实现**（`src/components/visualizer/tilt/VisualizerTilt.tsx`，701 行）的核心逻辑：

1. **分行**：`determineLineCount(charCount, seed, splitProbability)` — 用 `log(charCount+4)/log(24)`
   算出归一化长度，乘种子抖动与 splitProbability，按阈值 `[0.45, 1.05, 1.7]` 决定 1–4 行
2. **断句**：`SentenceLayout.splitIntoSentences(text, targetCount, seed)` — 5 级递进切分：
   标点 → 括号引号 → 西文词 → CJK 空格 → 特殊字符
3. **倾斜选择**：每行按 `seededRandom(seed, 100+i) < tiltStyleProbability`（默认 0.35）成为候选，
   再从中随机选一行
4. **溢出处理**：测量最宽行，超过可用宽度（`window.innerWidth * 0.85`）时
   ① 超 1.6 倍 → 重新切分更多行；② 否则按比例缩放（下限 0.5/0.55）
5. **逐字动画**：`buildCharTimings` 把词的 `startTime/endTime` 均分到字素；
   `getCharPulseIntensity` 给出脉冲曲线 —— `sin(progress * π)` 的 0→1→0 钟形，
   随后 1.2 倍时长内**升到** 0.25 的余晖地板并保持（唱过的字永久略大 = 「已唱」状态）。
   注意：早期文档把这句写成「衰减到 0.25」，是错的，见 `tilt-porting-notes.md` §6 的订正说明
6. **渲染**：非倾斜行用正常字重（400）+ `letterSpacing 0.08em` + 逐字淡入（`ci * 0.04s` 延迟）；
   倾斜行用 italic + 字重 300 + `letterSpacing 0.15em` + 奇偶行上下交错（`±yOffset`）
7. **外壳与配色**（2026-10-10 补齐，之前漏掉导致首版与 Folia 预览图不符）：
   - 歌词是**全屏舞台**（`w-full h-[70vh] flex items-center justify-center`），
     没有封面列、没有左右分栏 —— 这是一个独立面板，不是在经典骨架上换色
   - 分色取 `getColors()` 的默认档：`normal = theme.primaryColor`（本项目 = 正文色 shade-2）、
     `tilt = theme.accentColor`（本项目 = 专辑主色 tone 50）
   - 底部还有一条**副字幕层**（译文/罗马音），字号走 `resolveSubtitleFontSizes`：
     `clamp(1.125rem, 2.6vw, 1.25rem) × lyricsFontScale`
8. **纵向溢出**（2026-10-10 补，Folia 没有这一层）：Folia 的舞台是固定 `70vh`，
   只按宽度缩放，段数多 / 窗口矮时首尾段会被切断。本项目舞台吃掉的是「扣掉副字幕
   与控制条后的剩余高度」，所以补了一层高度自适应：先算出这批段的总高（Σ 段行高 ×
   段字号 + (段数−1) 个段间距），放不下就把字号整体缩一档（下限与横向一致）。
   顺序必须是**先横后竖**：重切会增加段数、从而增加所需高度，纵向判定必须在段数定型后。

**Vue 重写映射**：

| Folia (React) | 本项目 (Vue) |
|---|---|
| `MotionValue<number>` + `currentTime.on('change')` | `ctx.currentTime()` getter + 组件内 rAF |
| `useMemo` 布局计算 | `computed` |
| `useInsertionEffect` 订阅 | `watch` + `onBeforeUnmount` 清理 |
| `motion.span` + `animate` | `:style` + CSS transition |
| `Intl.Segmenter` 字素切分 | 相同（浏览器原生） |
| `prepareWithSegments` / `layoutWithLines` | **相同**（引入 `@chenglou/pretext`） |
| `SentenceLayout` | 自己实现（按上述 5 级规则，不抄源码） |

**数据适配**：Folia 的 `Line` 是 `{ fullText, words: {text,startTime,endTime}[], startTime, endTime }`（秒），
本项目是 `{ text, timeMs, words?: {word,timeMs,durationMs,trailing?}[] }`（毫秒）。
需要一个适配层把毫秒转秒、`word`→`text`。

### 4.4 切换入口（两处同步）

**① 沉浸页悬浮切换条** `shared/SkinSwitcher.vue`
- 位置：歌词区右上角（与关闭按钮同侧的空白区），胶囊式
- 行为：点击展开面板列表 → 选择即切 → 自动收起
- 跟随 `idle` 显隐（与关闭按钮一致）
- 演示模式下隐藏

**② 设置面板「样式」tab** `settings/SettingsSkin.vue`
- 卡片网格，每张卡 = 缩略图 + 中文名 + 一句话描述
- 点击即时生效（调 `settings.applySkin(id)`）
- `TABS` 改为把 `{ key: 'skin', label: '样式' }` 放最前

### 4.5 真实频谱实现（`use-audio-bands.ts`）

**音频回到渲染进程后**，`getAudioElement()`（`src/app/providers/player-provider.ts:40`）
就是真正的播放元素，可直接 `createMediaElementSource()`。原文档 §1.2.B 那套
「跨 bg-player 窗口 + 13 处 IPC 转发」的链路**整体作废**。

```ts
const el = getAudioElement()
const ctx = new AudioContext()
const source = ctx.createMediaElementSource(el)
const analyser = ctx.createAnalyser()
analyser.fftSize = 2048
analyser.smoothingTimeConstant = 0.8
source.connect(analyser)
analyser.connect(ctx.destination)  // 必须连，否则静音
```

#### ⚠️ 三个必须处理的真实问题（已实证，非推测）

**问题 1：`setSinkId` 会被破坏 —— 这是最严重的一个**

`src/composables/useAudioElement.ts:106` 的注释明确写着前人踩过的坑：

> `/** Web Audio 图(惰性创建);仅用于 resume 音频时钟,不改路由以免破坏 setSinkId。 */`

一旦 `createMediaElementSource()` 把元素接进 Web Audio 图，音频输出改走
`AudioContext.destination`，**元素的 `setSinkId()` 即失效**。
而「设置 → 输出设备」是本项目正式功能（`player.store.ts:264` / `:589`）。

**解法**：改用 `AudioContext.setSinkId()`（Chrome 110+，本项目 Electron 42.4.1
→ Chromium ~140，**已支持**）。在 `useAudioElement.ts` 的 `setSinkId()`
（`:362-368`）里同步切换两条路径：
- 未建图 → `el.setSinkId(deviceId)`（现状）
- 已建图 → `audioCtx.setSinkId(deviceId)`

**问题 2：CORS —— 远程 CDN 已实测通过，只剩自家协议**

原 `folia-integration.md:290-303` 把 CORS 列为「最危险的坑」，但**现已实测澄清**：

| 音源 | CORS 头 | 结论 |
|---|---|---|
| 网易云 CDN 直链 | **实测 200/206 响应带 `Access-Control-Allow-Origin: *`**（`curl -H "Range: bytes=0-1023"` 实测，2026-10-10） | ✅ 无需处理 |
| `muice-file://`（已下载） | 有（`electron/main/index.ts:317`） | ✅ 无需处理 |
| `muice-cache://`（缓存，**主播放路径**） | **没有** —— `serveAudioFile`（`:195`）的 206（`:235`）/200（`:248`）两个出口都缺 | ⚠️ **需补** |

**解法**（照 `serveDownloadedAudioFile` 的写法）：给 `serveAudioFile` 也提一个
`commonHeaders`（含 `Access-Control-Allow-Origin: *`），一次覆盖 206/200/416 三个出口。
`muice-cache` 的 privileged 声明里已有 `corsEnabled: true`（`:118`），加响应头即可。

> 注：此项修改在 `electron/main/index.ts`，属 A1 子代理的文件范围。
> **实施顺序**：C2 开始前先确认此项已改，否则播缓存文件时频谱恒为 0（不会静音，见下）。

**问题 3：`crossorigin` 属性 —— 不要无条件加**

原文档 `:297-303` 的警告仍然成立：给 `<audio>` 加 `crossorigin="anonymous"` 会把
no-cors 模式改成 CORS 模式，**不带 CORS 头的音源会彻底播不出来**（不是频谱为 0，是加载失败）。

但现在三处音源里**两处已确认带 CORS 头**，第三处（`muice-cache://`）**由我们自己控制**（补头即可）。
所以可以**统一设 `crossOrigin = 'anonymous'`**，前提是问题 2 的响应头先补上。

**兜底**：若上线后发现某个音源仍失败，退回按 URL 前缀判断 ——
自家协议（`muice-cache://` / `muice-file://`）设 `crossorigin`，远程直链视实测结果决定。
`ensureAnalyser()` 里检查 `if (!a.crossOrigin) return false`（不设 crossorigin 的元素分析恒为 0，白建图）。

#### 其余要点

- **惰性创建**：只有沉浸页打开时才建图（避免常驻分析开销）
- **频带划分**：`fftSize=2048` → 1024 bins，采样率 44.1kHz → 每 bin ≈ 21.5Hz
  - `low`: 0–11 bins（0–250Hz）
  - `mid`: 12–93 bins（250–2kHz）
  - `high`: 94–372 bins（2k–8kHz）
- **复用现有 AudioContext**：`useAudioElement.ts:107` 已有一个 `audioCtx`（仅用于 resume 时钟）。
  应**复用它**而非新建，避免两个 AudioContext 与 `setSinkId` 双头管理。
- **rAF 循环由订阅数启停**，沉浸页关闭即停
- **`AudioContext` 需要用户手势才能 resume** —— 播放本身就是手势，首次播放时 resume 即可

**契约**：`audioBands` 是模块级 ref，`useSkinContext()` 只读它，不启动循环；
循环由 `SkinShell.vue` 通过 `useAudioBands()` 启动（它在 `v-if="open"` 内）。

### 4.6 硬约束与坑

1. **400 行上限**：`SkinShell.vue` 会把窗口 chrome 拆到 `SkinChromeButtons.vue`
2. **不能分叉逻辑层**：`use-transport.ts` / `use-skin-context.ts` 必须被所有皮肤共用
3. **`import.meta.glob` 路径必须相对**：写 `'./*/index.ts'`，不支持 `@/` 别名
4. **皮肤异步 chunk 与 `file://`**：生产构建下 `defineAsyncComponent` 的 chunk 路径需实测
   （原文档 §5.4 已列为必测项）
5. **`.rnp-lyrics` / `.rnp-lyrics-line` 是硬契约**：`immersive-shell.scss` 有 7 处 `:deep()` 依赖它们。
   新皮肤若不复用这些类名，需自己承担「居中失效」「旋转被裁切」等风险
6. **AGPL 隔离**：只借鉴算法思路，代码全部 Vue 重写。`docs/` 保留来源说明

### 4.7 「几何」背景（第 6 种背景类型）

**决策**：不在皮肤里内置，而是作为 `backgroundType` 的**第 6 个选项**接进
`ImmersiveBackground.vue` 的 `v-if` 链（与 fluid/blur/gradient/solid/none 并列）。
理由是 Folia 的设计本就是**背景与歌词面板正交**：同一套背景要能在两款皮肤下都可用，
做成皮肤私有物就复制了一份。

**代码位置**（刻意放在 `src/features/immersive/backgrounds/`，不塞进 `skins/tilt/`）：

```
backgrounds/
├── geometric-model.ts            纯函数：形状/粒子生成 + 频带映射（可单测，27 个用例）
├── geometric-model.test.ts
├── GeometricBackground.vue       渲染层（35 个节点）
└── geometric-background.scss     keyframes + 按形状分档的频带缩放
```

`geometric-model.ts` 复用 `skins/tilt/core/seeded-random`（同一 seed + index 恒等），
不引入第二套随机源；索引区段从 1000 起，避开 tilt 排版占用的 100+/200 段。

**与 Folia 的四处刻意差异**（对照表见 `app-test-checklist.md` §6.1）：

| 差异 | 原因 |
|---|---|
| `Math.random()` → 按 `Song.id` 的确定性种子 | 进页面/切皮肤/暂停不该让形状「跳一下」 |
| framer-motion `useSpring` → CSS `transition: scale 0.12s` | 频带本就每帧刷新，再加 JS 弹簧只是多一层延迟 |
| JS 逐帧写内联样式 → CSS keyframes 驱动漂移/自转 | 不与 60fps 流体背景抢性能预算 |
| 暗角末色 `rgba(0,0,0,.6)` → `--rnp-accent-color-overlay` | 浅色主题下黑色暗角会「白底被压黑一圈」 |

**两条实现要点（写错了不报错、只是静默失效，属于高危）**：

1. **用 `translate` / `rotate` / `scale` 三个独立 transform 属性**，不能合成一条 `transform`：
   keyframes 只驱动位移与自转，`scale` 由频带 CSS 变量独立控制，合成后会互相冲掉。
2. **频带缩放绕开 Vue 的渲染管线**：`audioBands` 每帧一个新对象，在模板里读它会让整个组件
   每帧重渲染。改为 `watch([audioBands, isPlaying])` 里把四档缩放写成容器 CSS 变量
   （每帧 4 次 `style.setProperty`，零 VDOM）。

**新依赖**：`@lucide/vue`（1.55.0，MIT）。形状里有一型是图标（≤6 个），
用官方 Vue 包而不是 `lucide-vue-next`（后者 1.0.0 已弃用）。按图标分文件，
实测构建后只打进来 12 个图标、38.6 kB，没有整库。

---

## 5. 执行顺序（子代理团队）

考虑到「同文件修改的子代理必须串行」（否则延迟完成会覆盖后续改动），
按**文件所有权**划分，而非按功能划分：

| 阶段 | 负责范围 | 独占文件 | 依赖 |
|---|---|---|---|
| **A1** | 主进程音频链路移除 | `electron/main/*`、`electron/preload/*` | 无 |
| **A2** | 渲染层音频回归 | `src/stores/player.store.ts`、`play-queue.store.ts`、`src/app/main.ts` | 无（与 A1 不同文件） |
| **A3** | 类型与平台层清理 | `src/types/global.d.ts`、`src/platform/electron/*`、`src/domain/low-memory.ts` | **等 A1+A2**（要同步删除） |
| **A4** | 设置页清理 | `src/pages/settings/*` | **等 A3** |
| **B1** | 设置面板拆分 | `src/features/immersive/ImmersiveSettings.vue` + `settings/` | **等 A2**（store 要加 skin 字段） |
| **C1** | 皮肤骨架 | `src/features/immersive/skins/**`、`immersive-settings.store.ts` | **等 B1** |
| **C2** | 频谱 | `use-audio-bands.ts` | **等 A2** |
| **C3** | tilt 面板 | `skins/tilt/**` | **等 C1** |

**串行链**：A1 ∥ A2 → A3 → A4 ∥ B1 → C1 → C3，C2 可全程并行。

---

## 6. 验收清单

### 6.1 音频回归（必须逐项实测）

- [ ] 播放/暂停/切歌/进度拖动 正常
- [ ] 音量、静音、倍速、输出设备切换 正常
- [ ] 音质切换保留进度
- [ ] 播放缓存（`muice-cache://`）命中时正常播放
- [ ] 已下载文件（`muice-file://`）正常播放
- [ ] 播放失败 3 秒倒计时自动跳过
- [ ] 私人 FM / 心动模式 正常
- [ ] **最小化窗口后音乐不中断**
- [ ] **关闭到托盘后音乐不中断**
- [ ] Windows 系统媒体控制面板显示歌曲信息、按钮可用
- [ ] 托盘菜单播放控制可用
- [ ] 浏览器 `pnpm dev:renderer` 调试模式仍可用

### 6.2 移除低内存

- [ ] 设置页无「低内存模式」卡片
- [ ] 重启应用后队列为空（回到旧行为）
- [ ] 无残留 IPC 报错
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm test` 通过

### 6.3 皮肤系统

- [ ] 沉浸页悬浮切换条可切换面板
- [ ] 设置面板「样式」tab 可切换面板
- [ ] 切换后刷新页面，选择被持久化
- [ ] 「经典」面板与改造前**逐像素一致**
- [ ] 「倾诉」面板在中文/日文/英文歌词下均正常分行
- [ ] 短句（1–4 字）、长句（>40 字）、纯英文歌词均不溢出
- [ ] 无歌词时的空状态正常
- [ ] 6 个原设置 tab 控件无遗漏
- [ ] 「倾诉」是全屏歌词（无封面列），任一段用**专辑主色**、其余段近白色
- [ ] 「倾诉」底部显示罗马音 + 译文两行，缺的行不出现空占位
- [ ] 「倾诉」在「仅封面」模式整屏显示封面、且水平/垂直对齐设置生效
- [ ] 「仅封面」往返后歌词**不重播**（`resyncNow` 生效）
- [ ] 纵向放不下时（窗口压到最小高度 / 字号拉满 / 4 段长句）字号自适应缩小，首尾段完整可见

### 6.4 「几何」背景

- [ ] 类型一行有 6 个选项，「几何」可选中且立即出画面
- [ ] 同一首歌反复进出沉浸页，形状布局不变；换歌才换一套
- [ ] 播放时形状按频带缩放（圆/方←低音、三角←中音、十字←高音、图标←整体）
- [ ] 暂停时漂移继续、缩放回落；系统「减少动态效果」下整体静止
- [ ] 明暗主题切换时形状颜色翻转（不出现「白底白形状」）
- [ ] 与「流体」背景相比占用更低

### 6.5 频谱

- [ ] 播放时频谱有反应（随鼓点跳动）
- [ ] **播放声音正常（不是静音）** ← `analyser.connect(destination)` 没漏
- [ ] **设置页切换输出设备后声音真的换了设备** ← `AudioContext.setSinkId()` 同步切了（§4.5 问题 1）
- [ ] **播缓存文件（`muice-cache://`）时有声音且有频谱** ← `serveAudioFile` 的 CORS 头补上了
- [ ] **播已下载文件（`muice-file://`）时有声音且有频谱**
- [ ] **播远程 CDN 直链时有声音且有频谱**（实测该源带 ACAO，应无问题）
- [ ] 暂停时频谱静止
- [ ] 沉浸页关闭后 rAF 停止（Performance 面板确认）
- [ ] 浏览器调试模式下频谱同样工作

### 6.6 打包

- [ ] `npm run build` 通过
- [ ] 打包后应用能切皮肤（验证 `file://` 下 chunk 路径）
- [ ] 打包后「几何」背景的图标能加载（`@lucide/vue` 代码分割 chunk）
- [ ] 打包后应用音频正常

---

## 7. 需要留意的既有问题（不属本次范围，但会撞上）

1. `ImmersiveControls.vue` 1353 行、`LyricLines.vue` 1079 行，均超 400 行硬约束
   — 本次不重构（避免叠加风险），但皮肤系统落地后应单独立项
2. `LyricLines.vue` 的两个 `<style>` 块（内联 + `rnp-lyrics.scss`）有大量重复选择器，
   靠源顺序压过 — 改样式时两处都要动
3. `ImmersivePlayer.vue` 的 `rootClasses` 里有 6 个 class（`lyric-fade`/`lyric-zoom`/`lyric-blur`/
   `lyric-stagger`/`lyric-glow`/`lyric-timing-*`）在全部 SCSS 里**没有任何消费方**（死代码），
   实际都是通过 prop 生效的。做多皮肤时**不要**误以为可以靠这些 class 做 CSS 分支
4. `ImmersiveBackground.vue` 现在 6 种背景仍是硬编码 `v-if` 链，无注册表 —
   原文档 §4 把它列为 P3「背景注册表」，本次只把「几何」挂进了分支（见 §4.7），
   注册表化仍未做；皮肤系统只做歌词面板
