# Folia 集成方案（youpu 沉浸播放面板）

参考仓库：`chthollyphile/folia-major`（AGPL-3.0，⭐3964）
目标：让用户能自己挑选沉浸面板样式（皮肤），首批视觉语言取自 Folia。

---

## 0. 结论先行

**不能搬组件，只能搬架构 + 重写布局算法。**

|      | Folia                                | youpu                         |
| ---- | ------------------------------------ | ----------------------------- |
| 框架 | React 19                             | Vue 3.5.32                    |
| 状态 | zustand + MotionValue                | Pinia 3 + ref                 |
| 渲染 | Pixi.js / three.js / canvas 2D / DOM | DOM + SCSS                    |
| 动画 | framer-motion                        | CSS transition + GSAP（已装） |
| 样式 | tailwind                             | SCSS + ant-design-vue         |

Folia 的 13 个视觉模式里，**5 个是 DOM 实现**（classic / cadenza / partita / claddagh / tilt），
这 5 个可以直接用 Vue 重写布局算法，成本可控；
`fume` / `pendolo` 是 canvas 2D 自绘文字引擎，需要重写引擎；
`monet` / `sonnet` / `tempera` / `lumiere` / `diorama` 依赖 Pixi.js / three.js，**不在首批范围**。

真正值得抄的三块，按价值排序：

1. **注册表契约**（`definition.ts` + `registry.tsx` + 每模式 `entry.tsx`）—— 加一个皮肤 = 加一个文件夹，零改动其他文件。
2. **背景注册表与模式注册表正交** —— 背景 7 类（fluid / geometric / latent / monet / nomand / sora / url）独立于视觉模式。
3. **歌词工具链**（`src/utils/lyrics/`，66 文件）—— `parserCore.ts` 43KB 统一解析 LRC/QRC/KRC/TTML；`sentenceLayout.ts` + `cjkSemanticLayout.ts` 是中文断句的核心。

**调研中挖出的一个必须先解决的障碍**：Folia 每个模式都吃 `audioBands` 做「随拍反应」，
但本项目的音频**根本不在渲染进程**里（Electron 下恒走主进程隐藏窗口的 `<audio>`），
渲染进程里 `createMediaElementSource()` 拿到的是空流 —— **频谱恒为 0 且不报错**。
详见 §1.2（含「假节拍」与「真实频谱 4 层链路」两条路，以及一个会让音频静音的连带风险）。

---

## 1. 先决条件（必须先做，否则后面全部返工）

### 1.1 `ImmersiveSettings.vue` 已 1318 行，违反 AGENTS.md 400 行硬约束

现状：`src/features/immersive/ImmersiveSettings.vue` = 1318 行 / 40835 字符，
内含 6 个 tab（appearance / cover / background / lyric / font / about）全部平铺在一个 `<template>` 里。

拆法（对齐 AGENTS.md「超过的组件按照功能模块拆分」+「仅在当前页使用的组件放该页 components/」）：

```
src/features/immersive/
├── ImmersiveSettings.vue          # 壳：Transition + 关闭按钮 + tab 导航 + 6 个 tab 子组件
└── settings/
    ├── AppearanceTab.vue          # 外观
    ├── CoverTab.vue               # 封面
    ├── BackgroundTab.vue          # 背景
    ├── LyricTab.vue               # 歌词（单一版本，不按面板拆分）
    ├── FontTab.vue                # 字体
    ├── AboutTab.vue               # 关于
    ├── SettingsSlider.vue         # 共用滑块行（reset 圆点）
    ├── defaults.ts                # 各 slider 默认值（reset 用）
    └── system-fonts.ts            # 系统字体查询（整会话缓存一次）
```

### 1.2 音频分析器缺失 —— Folia 视觉模式的动力源（**这里有个架构级障碍**）

Folia 每个模式都收 `audioPower: MotionValue<number>` 与 `audioBands: AudioBands`，用来驱动「随拍反应」。

**障碍：本项目的音频根本不在渲染进程里。**
`src/stores/player.store.ts:247-250`：

```ts
const remote = shouldUseRemoteAudio()
const c = remote
  ? createRemoteAudioController(callbacks, () => this.currentItem) // Electron：音频在主进程的隐藏窗口
  : useAudioElement(getAudioElement(), callbacks) // 浏览器调试：本地 <audio>
```

`shouldUseRemoteAudio()`（`src/platform/electron/remote-audio.ts:154`）= `isElectronRuntime() && Boolean(window.muiceDesktop?.audio)`，
**在 Electron 下恒为 true**。音频实际播放位置是 `electron/main/bg-player.ts:90` 那个隐藏窗口里的 `<audio id="a">`。

后果：**在渲染进程里 `createMediaElementSource(getAudioElement())` 拿到的是空流，频谱恒为 0。**
所以 `ImmersiveBackground.vue` 的注释「在独立播放器中无音频分析器，故位移固定 400」不是偷懒，是结构限制。

#### 1.2.A 第一步：假节拍（P0，零架构改动）

先让皮肤能跑起来、能看效果。用播放进度推一个稳定的节拍，不追求与真实音乐同步：

```ts
// src/features/immersive/use-audio-bands.ts
import { onBeforeUnmount, ref, type Ref } from 'vue'
import { usePlayerStore } from '@/stores/player.store'

/** 音频四带能量，0–1。假节拍与真实频谱（§1.2.B）共用这个形状 */
export interface AudioBands {
  /** 低频能量，驱动整体脉动 */
  low: number
  /** 中频，驱动文字呼吸 */
  mid: number
  /** 高频，驱动粒子闪烁 */
  high: number
  /** 全带能量，驱动全局强度 */
  power: number
}

/**
 * 模块级共享状态：`use-skin-context` 需要脱离组件读取它（皮肤的 rAF 里逐帧拉），
 * 所以值放模块作用域；但 **rAF 循环由 useAudioBands() 按订阅数启停**，
 * 主界面不挂载沉浸页时不会有一条空转的 60fps 循环。
 */
export const audioBands: Ref<AudioBands> = ref({ low: 0, mid: 0, high: 0, power: 0 })

const BPM = 120
const DECAY = 0.92

let raf = 0
let subscribers = 0
/** 首个订阅者在 setup 里存进来：tick 不在 setup 上下文里，不能自己调 usePlayerStore() */
let playerRef: ReturnType<typeof usePlayerStore> | null = null

function tick(): void {
  const player = playerRef
  const b = audioBands.value
  if (player && player.isPlaying) {
    const t = (player.currentTimeMs / 1000) * (BPM / 60)
    // 低频跟拍、中频半拍、高频四分之一拍 —— 三个带不同相位，视觉上不会「一起闪」
    const beat = Math.exp(-((t % 1) * 4))
    const half = Math.exp(-(((t * 2) % 1) * 5))
    const quarter = Math.exp(-(((t * 4) % 1) * 6))
    b.low = 0.35 + 0.65 * beat
    b.mid = 0.25 + 0.55 * half
    b.high = 0.15 + 0.4 * quarter
  } else {
    b.low *= DECAY
    b.mid *= DECAY
    b.high *= DECAY
  }
  b.power = (b.low + b.mid + b.high) / 3
  raf = requestAnimationFrame(tick)
}

/**
 * 在组件 setup 里调用以订阅节拍。订阅数归零时停掉 rAF。
 * **只在沉浸页挂载**，不要放到 App 根部。
 */
export function useAudioBands(): { bands: Ref<AudioBands> } {
  if (!playerRef) playerRef = usePlayerStore()
  subscribers++
  if (!raf) raf = requestAnimationFrame(tick)
  onBeforeUnmount(() => {
    subscribers--
    if (subscribers <= 0 && raf) {
      cancelAnimationFrame(raf)
      raf = 0
      subscribers = 0
    }
  })
  return { bands: audioBands }
}
```

> **接口契约（关键）**：`useAudioBands()` 返回的 `bands` 与 `audioBands` 是**同一个 ref**。
> 上 B 方案（真实频谱）时，只需要在 `remote-audio.ts` 的 `onSpectrum` 回调里
> `Object.assign(audioBands.value, bands)`，并**把这个文件里的 rAF 循环整段删掉** ——
> 皮肤代码、`SkinContext.bands()` 一行都不用改。这就是「先做 A 不返工」的兑现方式。

#### 1.2.B 第二步：真实频谱（P2，跨 4 层）

要做「随拍反应」必须把分析器放进 **bg-player 窗口**，再把结果 IPC 推回来。改动面：

| 层  | 文件                                                                      | 改动                                                                                             |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | `electron/main/bg-player.ts:90` 内联 HTML `<audio id="a" preload="auto">` | 加 `crossorigin="anonymous"`（**有静音风险，见下方 CORS 第 3 条**）                              |
| 1   | `bg-player.ts:159-172` 的 `case 'load'`                                   | `a.src = p.url` **之前**按 URL 前缀决定是否设 `a.crossOrigin`（换 src 会重置）                   |
| 1   | `bg-player.ts:91` `<script>` 内，`bridge.onCommand`（:157）之前           | 加 `ensureAnalyser()` + `pushSpectrum()` + `setSpectrum()`                                       |
| 1   | `bg-player.ts:157` 的 `switch (cmd.type)`                                 | 加 `case 'spectrum'`                                                                             |
| 1   | `bg-player.ts:50-59` 的 `BgCommand` 联合类型                              | 加 `\| { type: 'spectrum'; enabled: boolean }`                                                   |
| 2   | `bg-player.ts:18-27` 的 `BgPlayerEvent`                                   | 加 `\| { type: 'spectrum'; bins: number[] }`                                                     |
| 2   | `BgPlayerWindow` 类                                                       | 加 `setSpectrum(enabled: boolean)` 方法（向页面发 command）                                      |
| 3   | `electron/main/audio-engine.ts:136-171` `handleEngineEvent` 的 switch     | 加 `case 'spectrum'` + `forwardToRenderer(event)`                                                |
| 3   | `electron/main/audio-engine.ts`                                           | 新增导出的 `engineSetSpectrum(enabled)`（照抄 `engineSetSink`（:272）的 `withEngine` 写法）      |
| 3   | `electron/main/index.ts:1233-1265` 的 `ipcMain.handle('audio:*')` 区      | 加 `ipcMain.handle('audio:spectrum', (_e, enabled) => void engineSetSpectrum(Boolean(enabled)))` |
| 4   | `electron/preload/index.ts:427-475` 的 `audio: {}`                        | 加 `setSpectrum(enabled)`（照抄 `setSink`（:460））                                              |
| 4   | `src/types/global.d.ts:144-152` `AudioEngineEvent`                        | 加 `\| { type: 'spectrum'; bins: number[] }`                                                     |
| 4   | `src/types/global.d.ts:304-318` `audio` 命名空间                          | 加 `setSpectrum(enabled: boolean): Promise<void>`                                                |
| 4   | `src/platform/electron/remote-audio.ts:46` 的 `api.onEvent` switch        | 加 `case 'spectrum'`（合成 4 带）                                                                |
| 4   | `src/composables/useAudioElement.ts:16-33` 的 `AudioControllerCallbacks`  | 加 `onSpectrum?: (bands: AudioBands) => void`                                                    |

> `AudioControllerCallbacks` 定义在 `src/composables/useAudioElement.ts`（不在 `src/types/`），
> 由本地控制器与 `remote-audio.ts` 共用一个接口（`player.store.ts:30` import 它）。
> 加可选字段是**向后兼容**的：`useAudioElement` 侧不实现也不会类型报错（浏览器调试时没有频谱，退化为假节拍）。

> **CSP 不用改**：`bg-player.ts:86` 的 CSP 是 `default-src 'none'; media-src *; script-src 'unsafe-inline'; img-src https: data:`。
> Web Audio API（`AudioContext` / `createMediaElementSource` / `AnalyserNode`）不发起网络请求，不受 `default-src 'none'` 限制。
> **IPC 通道也不用改**：`bg-player.ts:69-78` 的 `ensureIpcRouting` 只信任 bg-player 窗口自己发的事件，新增事件类型自动走同一条路。

bg-player 页面内联脚本追加（保持在 `bridge.onCommand` 之前）：

```js
var audioCtx = null,
  analyser = null,
  srcNode = null,
  freqData = null
var spectrumTimer = null
var BINS = 32

// 惰性建图：只有渲染层订阅频谱时才建，避免常驻 60fps 分析开销
function ensureAnalyser() {
  if (analyser) return true
  try {
    var Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return false
    audioCtx = new Ctx()
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.8
    srcNode = audioCtx.createMediaElementSource(a)
    srcNode.connect(analyser)
    // 必须连 destination，否则 createMediaElementSource 会切断原有声音输出（变静音）
    analyser.connect(audioCtx.destination)
    freqData = new Uint8Array(analyser.frequencyBinCount)
    return true
  } catch (e) {
    return false
  }
}

function pushSpectrum() {
  if (!analyser) return
  analyser.getByteFrequencyData(freqData)
  // 32 个对数刻度桶：IPC 每帧只传 32 个数字，20Hz 下每秒 640 个，可接受
  var out = new Array(BINS)
  for (var i = 0; i < BINS; i++) {
    var lo = Math.floor(Math.pow(i / BINS, 1.6) * freqData.length)
    var hi = Math.floor(Math.pow((i + 1) / BINS, 1.6) * freqData.length)
    if (hi <= lo) hi = lo + 1
    var s = 0
    for (var j = lo; j < hi; j++) s += freqData[j]
    out[i] = Math.round(s / (hi - lo))
  }
  emit({ type: 'spectrum', bins: out })
}

function setSpectrum(enabled) {
  if (enabled) {
    if (!ensureAnalyser()) return
    if (audioCtx.state === 'suspended') audioCtx.resume()
    if (!spectrumTimer) spectrumTimer = setInterval(pushSpectrum, 50)
  } else if (spectrumTimer) {
    clearInterval(spectrumTimer)
    spectrumTimer = null
  }
}
```

`bridge.onCommand` 里加一个 case：

```js
case 'spectrum':
  setSpectrum(!!cmd.enabled)
  break
```

渲染进程侧把 32 桶合成 4 个带（`remote-audio.ts` 的 `onEvent` 里）：

```ts
case 'spectrum': {
  const b = event.bins
  const avg = (from: number, to: number) => {
    let s = 0
    for (let i = from; i <= to; i++) s += b[i] ?? 0
    return s / (to - from + 1) / 255
  }
  // 32 桶对数刻度下：0–7 ≈ 20–250Hz，8–19 ≈ 250–2kHz，20–31 ≈ 2k–8kHz
  callbacks.onSpectrum?.({
    low: avg(0, 7),
    mid: avg(8, 19),
    high: avg(20, 31),
    power: avg(0, 31)
  })
  break
}
```

**订阅时机**：`ImmersivePlayer.vue` 的 `open` watch 里 `window.muiceDesktop?.audio.setSpectrum(true)`，
`close` / `onBeforeUnmount` 里 `setSpectrum(false)`。不做常驻订阅 —— 频谱推送会持续占用 IPC 通道。

**⚠️ 低内存模式会打断链路**：转发链是 `bg-player → audio-engine.forwardToRenderer`（:102）`→ setEngineEventForwarder`（`electron/main/index.ts:1620`）`→ contents.send('audio:event')`。
低内存模式回收主渲染进程后 `contents.isDestroyed()` 为 true，:1622 直接 `return` —— 事件没有接收方；而此时 bg-player 里那个
`setInterval` 还在跑（`clearInterval` 只在 `setSpectrum(false)` 时触发），会**空转烧 CPU**。
两种处理，二选一：

- 省事：**不用改代码**。20Hz × 32 个数字的开销可以忽略，且回收期间本来也没人看频谱；
- 干净：主进程检测到渲染进程回收时主动 `win.setSpectrum(false)`，渲染进程重建后再订阅一次。

**建议先按「省事」实现**（回收期间无人看频谱，等 §6.3 决定上 B 方案再补）。\*\*

**CORS 的三个坑（第 3 个最危险）**：

1. **网易云 CDN 直链**：实测返回 `Access-Control-Allow-Origin: *`（403 响应也带，说明是 CDN 层统一加的头）。
   注意**实测的是 403 响应**（链接已过期），200 响应要等真正播放时再确认一次。
2. **`muice-cache://` 走的是 `serveAudioFile`（`electron/main/index.ts:195`），它的两个 `Response`（206 在 :235、200 在 :248）都没有 `Access-Control-Allow-Origin`**，
   而 `serveDownloadedAudioFile`（`muice-file://` 用，`index.ts:301`）有 —— 它把 CORS 头收在 `commonHeaders`（:313-320）里复用。
   **照抄这个写法**：给 `serveAudioFile` 也提一个 `commonHeaders`，一次覆盖 206/200/416 三个出口。
   `muice-cache` 的 privileged 声明里已有 `corsEnabled: true`（`index.ts:118`），加响应头即可。
3. **⚠️ 加上 `crossorigin="anonymous"` 会让「不带 CORS 头」的音源彻底播不出来，不只是频谱为 0。**
   现在 `<audio>` 没有 `crossorigin`，走 no-cors 模式，跨源也能播；一旦加上就变成 CORS 模式，
   源站不回 `Access-Control-Allow-Origin` 时**整个音频加载失败**。
   所以**必须和上面第 2 条一起改，且上线前用真实可播链接各测一次（CDN 直链 + 缓存文件 + 已下载文件）**。
   兜底设计：`load` 命令里按 URL 前缀决定 —— 自家协议（`muice-cache://` / `muice-file://`）一定设 `crossOrigin = 'anonymous'`；
   远程 CDN 直链只有在验证过 200 响应带 ACAO 之后才设，否则不设（该曲目的频谱退回假节拍，视觉降级但不静音）。
   对应地 `ensureAnalyser()` 里检查 `if (!a.crossOrigin) return false` —— 不设 crossorigin 的元素分析出来恒为 0，白建图。

#### 1.2.C 旧方案（**已废弃，不要采用**）

~~在 `useAudioElement.ts` / `player-provider.ts` 的 `new Audio()` 上加 `crossOrigin` 并在渲染进程建 AnalyserNode。~~
**错的**：Electron 下那个元素根本没在播放（音频在 bg-player 窗口），分析出来永远是 0。
只有浏览器 `pnpm dev:renderer` 调试时才走 `useAudioElement` 分支，那时这段才有意义。

---

## 2. 目录结构

```
src/features/immersive/
├── ImmersivePlayer.vue              # 瘦身成壳：Transition + v-if="open" + <SkinShell/>
├── use-immersive-player.ts          # 已有：open / idle
├── use-audio-bands.ts               # 新增：§1.2
├── immersive-settings.store.ts      # 已有：扁平设置 + skin 字段 + applySkin（§3.3）
├── settings/                        # 新增：§1.1 拆出的 6 个 tab
└── skins/                           # 新增：全部皮肤
    ├── types.ts                     # SkinId / SkinDefinition（含 hasSettings）/ SkinContext
    ├── registry.ts                  # import.meta.glob 自动发现
    ├── use-skin-context.ts          # 统一把 store 状态喂给皮肤
    ├── shared/                      # 所有皮肤共用，不分叉
    │   ├── SkinShell.vue            # 拖拽带 + 窗口按钮 + 全屏时钟 + 演示提示 + ESC + 设置按钮 + 切换按钮
    │   ├── SkinChromeButtons.vue    # 4 个窗口按钮（避免 SkinShell 超 400 行）
    │   ├── SkinSwitcher.vue         # 顶部切换按钮（唯一入口，§3.7）
    │   ├── use-transport.ts         # 从 ImmersiveControls 抽出的 seek/volume/rate/音质
    │   └── use-backdrop.ts          # 两档 rootClasses / CSS 变量（§3.7）
    ├── classic/                     # 现有 ImmersivePlayer 布局 = 第一款皮肤（hasSettings: true）
    │   ├── index.ts                 # export default defineSkin({...})
    │   ├── SkinClassic.vue
    │   └── classic.scss
    ├── tilt/                        # Folia 倾诉（hasSettings: false —— 没有设置）
    │   ├── index.ts
    │   ├── SkinTilt.vue
    │   ├── use-tilt-layout.ts       # 逐行倾斜 + 手写体 + 缩放的几何算法
    │   └── tilt.scss
    └── partita/                     # （未来）Folia 云阶（DOM，~1100 行 TSX → Vue ~600 行）
        ├── index.ts
        ├── SkinPartita.vue
        ├── use-partita-layout.ts    # 阶梯错位 + 十字准线
        ├── PartitaGuide.vue         # 极细十字准线（工程图纸感）
        └── partita.scss
```

**为什么皮肤要独立文件夹**：对齐 AGENTS.md「一个页面一个文件夹」的同构思路，
且 `import.meta.glob('./*/index.ts')` 要求每个皮肤有稳定的入口路径。

---

## 3. 核心代码

### 3.1 `skins/types.ts`

```ts
import { defineAsyncComponent, type Component } from 'vue'

/** 皮肤 id 的单一真源；新增皮肤先加到 `SKIN_IDS`（registry 与 store 都从它派生类型）。 */
export const SKIN_IDS = ['classic', 'tilt'] as const
export type SkinId = (typeof SKIN_IDS)[number]

/** 音频四带能量，0–1。真实频谱（§1.2.B / 本项目 renderer 内建图）共用这个形状 */
export interface AudioBands {
  low: number
  mid: number
  high: number
  power: number
}

/** 皮肤只读上下文：全部是 getter，皮肤在自己的 rAF 里拉取（**时间单位一律毫秒**） */
export interface SkinContext {
  /** 当前播放毫秒数（已含 lyricOffset 修正） */
  currentTime: () => number
  /** 当前高亮歌词行下标；-1 表示尚未到首行 */
  currentLineIndex: () => number
  isPlaying: () => boolean
  /** 逐帧读 audioBands.value，不要解构 */
  bands: () => AudioBands
  coverUrl: () => string | null
  songTitle: () => string | null
  songArtist: () => string | null
  songAlbum: () => string | null
  /** 歌词行点击 → seek。皮肤传「行开始的毫秒数」，由壳层扣掉 lyricOffset 并按播放器规则钳 0 */
  seekLyric: (lineTimeMs: number) => void
}

export interface SkinDefinition {
  id: SkinId
  /** 悬浮切换条上的中文名，如「倾诉」 */
  name: string
  desc: string
  order: number
  /**
   * 该面板是否**有自己的设置**（2026-10-11 用户定：设置是给「经典」用的，
   * 「倾诉」没有设置）。true（经典）—— 沉浸页右上角显示设置按钮，根节点套用经典那套
   * 外观（背景 / 显示模式 / 歌词排版 / 字体 / 封面）；false（倾诉）—— 不显示设置按钮，
   * 也不读那套外观（背景恒为「几何」、永不显示封面、排版与字体用内置值）。
   * 判据只此一处，不要在别处硬判皮肤 id。
   */
  hasSettings: boolean
  /** 皮肤根组件：接收 `ctx: SkinContext`，自行消费 store 渲染布局 */
  component: Component
}

/** `defineSkin` 入参：组件用动态 import 传入（仍会单独打包成 chunk，不进主 bundle）。 */
export interface SkinDefinitionInput extends Omit<SkinDefinition, 'component'> {
  component: () => Promise<{ default: Component }>
}

export const defineSkin = (input: SkinDefinitionInput): SkinDefinition => ({
  ...input,
  component: defineAsyncComponent(input.component)
})
```

### 3.2 `skins/registry.ts`

```ts
import { computed } from 'vue'

import { useImmersiveSettingsStore } from '../immersive-settings.store'
import { DEFAULT_SKIN_ID, type SkinDefinition } from './types'

const modules = import.meta.glob('./*/index.ts', { eager: true }) as Record<
  string,
  { default: SkinDefinition }
>

/** 全部已注册皮肤，按 order 升序（同 order 按 id，保证列表顺序稳定）。 */
export const skins: SkinDefinition[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

// DEFAULT_SKIN_ID 定义在 ./types（settings store 也要用，放这里会形成循环 import），此处转出
export { DEFAULT_SKIN_ID }

/** 按 id 取皮肤；未注册的 id（旧持久化 / 已删除的皮肤）回退到默认皮肤，保证任何值都能渲染。 */
export function getSkin(id: string): SkinDefinition {
  const found = skins.find((s) => s.id === id) ?? skins.find((s) => s.id === DEFAULT_SKIN_ID)
  if (!found) throw new Error('未注册任何皮肤：请检查 skins/*/index.ts 是否存在')
  return found
}

/** 当前生效的皮肤（跟随 settings.skin，无效值同上回退）。切换入口改 settings 即生效。 */
export function useActiveSkin() {
  const settings = useImmersiveSettingsStore()
  return computed(() => getSkin(settings.skin))
}
```

> 说明：
>
> - `DEFAULT_SKIN_ID` 与 `SKIN_IDS` 都在 `skins/types.ts`（**不能在 registry 里定义** ——
>   settings store 要用它们，而 registry 反过来 import store，会成环）。
> - `SkinId` 是 `SKIN_IDS` 派生的联合类型（`'classic' | 'tilt'`），不是 `string`：
>   store 无法 import registry 推导配置键集，靠这个中立常量保证「注册项一定在集合内」。
> - `import.meta.glob` 是 Vite 核心能力，本项目 Vite 7.3.5 原生支持；
>   路径必须写成 `'./*/index.ts'`（不支持 `@/` 别名）。

### 3.3 `immersive-settings.store.ts` 增量（只加 1 个字段 + 1 个 action）

设置**只有一份，它属于「经典」面板**（2026-10-11 用户定）—— state 就是扁平的
`{ ...createDefaultSettings(), skin }`，没有 `panels` 分桶、没有 `active`、没有 `settingsTarget`。

```ts
import { DEFAULT_SKIN_ID, type SkinId } from './skins/types' // 从 types 取，不要从 registry（会成环）

// state 里追加：
skin: DEFAULT_SKIN_ID as SkinId,

// actions 里追加：
/** 切换面板：只改「在放哪个面板」，不换设置（设置只有一份，见上）。 */
applySkin(id: SkinId): void {
  this.skin = id
},
```

持久化用 `persist: { key, pick }`，`pick` 由 `createDefaultSettings()` 的全部键 + `skin` 推导
（`PERSISTED_KEYS`），新增设置字段不会漏落盘。

> 历史注记：皮肤系统刚上线时曾短暂按面板分桶（`panels: Record<SkinId, ImmersiveSettings>`），
> 已被用户否决。旧分桶数据由 `immersive-settings.migrate.ts` 的 `settingsFromBucketed()`
> **只取 classic 那一桶**折叠成扁平（tilt 桶按设计丢弃），由 `migrateBucketedSettings()`
> 在 `bootstrapSettings()` 里跑一次。

### 3.4 `ImmersivePlayer.vue` 瘦身成壳

现有 442 行里，**全部窗口 chrome 职责都属于壳层，不属于任何皮肤**：
顶部 32px 拖拽带、4 个窗口 chrome 按钮（关闭/最小化/最大化/全屏）、设置按钮、全屏时钟、
演示模式提示、ESC 分层（关设置 → 退全屏 → 关闭）、CSS 变量注入
（`useBackdrop()` 的 `rootStyleVars` + `rootClasses` + `fontFamilyStyle`，加 `accentVars`）。
它们落在 `SkinShell.vue`（壳）里；`ImmersivePlayer.vue` 只剩常驻挂载的几件事：
`<Transition>` + `v-if="open"` 的开关时机、旧持久化引导（`bootstrapSettings()`）、
歌词懒加载、专辑主色提取（它同时驱动全局主题色，必须常驻挂载）。

**设置按钮与切换按钮都在 `SkinShell` 里，按 `hasSettings` 分派**：

- 设置按钮：仅当前面板 `hasSettings` 为真时渲染（倾诉下**没有**这个按钮）；
- 切换胶囊：不受 `hasSettings` 影响（两款面板都渲染，仅演示模式下隐藏），`hasSettings`
  为真时紧挨设置按钮左侧（第一排 `right:184` / 全屏 `right:96`），为假时**占住设置按钮那一格**
  （`right:140` / 全屏 `right:52`）；
- 复用 `useBackdrop()` 得到的 `rootClasses` / `rootStyleVars` / `fontFamilyStyle` 挂在根
  `<section class="immersive-root">` 上（两档注入见 §3.7）。

```vue
<template>
  <Transition name="immersive-slide">
    <SkinShell v-if="open" :accent-vars="accentVars" />
  </Transition>
</template>
```

**皮肤切换过渡**：皮肤组件用 `defineAsyncComponent`（`defineSkin` 内部包好），
chunk 到达前由异步组件自身的 loading 态兜底，避免白屏。

### 3.5 第一款皮肤 `classic/index.ts`（把现有布局原样搬进来）

```ts
import { defineSkin } from '../types'

export default defineSkin({
  id: 'classic',
  name: '经典',
  desc: '左封面右歌词，界面与改造前一致',
  order: 0,
  // 沉浸页设置说的就是本面板（见 types.ts 的 hasSettings 说明）
  hasSettings: true,
  component: () => import('./SkinClassic.vue')
})
```

`SkinClassic.vue` 直接复用现有的 `.immersive-content` / `.immersive-cover-slot` / `.immersive-lyric`
结构 + `LyricLines.vue`，把 `immersive-shell.scss` 里属于「内容区」的那部分
搬到 `classic/classic.scss`（选择器与声明一字未改），属于窗口 chrome 的部分留在 `immersive-shell.scss`。

「倾诉」对应 `hasSettings: false`：不显示设置按钮，背景恒为「几何」、永不显示封面、
排版与字体用内置值（`skins/tilt/` 内固定；字体是随包内置的「站酷快乐体 + 圆体假名兜底」，
声明在 `src/assets/fonts/fonts.scss`，详见 `docs/tilt-porting-notes.md` §8.3）。

### 3.6 皮肤上下文 `skins/use-skin-context.ts`

```ts
import { computed } from 'vue'
import { usePlayerStore } from '@/stores/player.store'
import { useLyricStore } from '@/stores/lyric.store'
import { useImmersiveSettingsStore } from '../immersive-settings.store'
import { audioBands } from '../use-audio-bands'
import type { SkinContext } from './types'

export function useSkinContext(): SkinContext {
  const player = usePlayerStore()
  const lyric = useLyricStore()
  const settings = useImmersiveSettingsStore()

  /** 歌词显示时间 = 播放时间 + 用户偏移；与改造前的 lyricDisplayTimeMs 同式 */
  const lyricTimeMs = (): number => player.currentTimeMs + settings.lyricOffset

  /** 线性扫描，与改造前一致；lyricStagger 时提前 200ms */
  const currentLineIndex = (): number => {
    const lines = lyric.lines
    if (!lines.length) return -1
    const t = lyricTimeMs() + (settings.lyricStagger ? 200 : 0)
    let idx = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].timeMs <= t) idx = i
      else break
    }
    return idx
  }

  return {
    currentTime: () => lyricTimeMs(), // 毫秒
    currentLineIndex,
    isPlaying: () => player.isPlaying,
    bands: () => audioBands.value,
    coverUrl: () => player.currentItem?.song?.coverUrl ?? null,
    songTitle: () => player.currentItem?.song?.name ?? null,
    songArtist: () => player.currentItem?.song?.artists?.map((a) => a.name).join(' / ') ?? null,
    songAlbum: () => player.currentItem?.song?.album?.name ?? null,
    seekLyric: (lineTimeMs) => {
      player.seek(Math.max(0, lineTimeMs - settings.lyricOffset))
    }
  }
}
```

> **`rootStyleVars` / `rootClasses` / 字体注入在 `shared/use-backdrop.ts`**（不在本 hook）：
> 那里**分两档**注入 —— 「面板外观档」（背景 / 显示模式 / 歌词排版 / 自定义字体）只在
> `SkinDefinition.hasSettings` 为真时注入（倾诉拿到空对象），「沉浸页通用档」（明暗主题 /
> 专辑主色 / 底栏四项 / 演示模式 / 空闲态）无条件注入。详见 §3.7。

> **谁来启动 rAF**：`useSkinContext()` 只**读**共享的 `audioBands` ref，不启动循环。
> 启动交给 `SkinShell.vue` —— 它在 `v-if="open"` 内部，所以 `useAudioBands()` 的
> `onBeforeUnmount` 会在沉浸页关闭时触发，订阅数归零、rAF 停下。这样：
>
> - 沉浸页关闭 → 没有空转循环；
> - 切换皮肤 → `SkinShell` 不卸载（只换里面的 `<component>`），循环不会重启，没有闪烁；
> - 某个皮肤忘了用 `bands()` → 只是白跑一条 rAF，不影响正确性。
>
> 音频图（`AudioContext` + `AnalyserNode`）现在建在渲染进程里（原「A 假节拍 / B 频谱」两阶段
> 随音频回归渲染进程而合并）；`audioBands` 是模块级 ref，图未就绪时全 0。
> 皮肤是否「需要音频」不再由 `SkinDefinition` 声明 —— 当前没有 `needsAudio` 字段，
> 图在沉浸页打开时统一挂起（消费者只有「几何」背景）。

### 3.7 面板主题切换入口与「设置归属」—— **定稿（2026-10-11）**

> ⚠️ 本节原方案（在设置面板里加「样式」tab + 页内切换条、并按面板分桶设置）**已被用户否决并删除**。
> 用户原话：「原来的设置是给经典面板用的，然后倾诉这个主题是没有设置的，然后倾诉这个主题的
> 背景就是几何并且无法更改，你怎么把设置直接给我干掉了，还有，主题切换按钮直接放到设置旁边，
> 不要放到第二排」。

最终形态：

- **切换入口唯一** —— 沉浸页顶部控制栏**第一排**的切换按钮 `skins/shared/SkinSwitcher.vue`，
  紧挨设置按钮左侧（用户明确要求：「主题切换按钮直接放到设置旁边，不要放到第二排」）。
  设置面板里没有 `skin` tab，也没有页内切换条。位置：有设置按钮时 `right:184`（全屏 `right:96`）；
  倾诉没有设置按钮，切换按钮占住那一格（`right:140` / 全屏 `right:52`）。
- **设置只有一份，它是「经典」面板的设置**；「倾诉」没有设置（背景恒为「几何」、永不显示封面、
  排版与字体用内置值）。归属说明写在 `immersive-settings.store.ts` 与 `skins/types.ts`
  的 `hasSettings` 注释里。
- **面板外观档 vs 沉浸页通用档**（`skins/shared/use-backdrop.ts` 两档注入）：
  面板外观档（`rootClasses` 的 `display-mode-*` / `rnp-bg-*` / 歌词排版 class / `custom-font`、
  `rootStyleVars` 的 `--bg-*` `--lyric-*`、`fontFamilyStyle`）只在 `hasSettings` 为真时注入；
  通用档（明暗主题、专辑主色、底栏四项、演示模式、空闲态）无条件注入。
- **设置面板不按面板裁剪任何行**（`settings/panel-capabilities.ts` 那套已被否决并删除）。
  「倾诉」没有设置按钮，所以那张面板在倾诉下根本打不开 —— 不需要按面板裁剪。

> 历史注记（均已删除）：`SettingsSkin.vue` / `skin-tab.scss` / `PanelTargetSwitch.vue`、
> `settings/panel-capabilities.ts` + `panel-capabilities.test.ts`、
> `settings/LyricTabClassic.vue` / `LyricTabTilt.vue`。

---

## 4. 分阶段落地

| 阶段           | 内容                                                                                     | 新增/改动 | 预估                                                         |
| -------------- | ---------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------ |
| **P0**         | 拆 `ImmersiveSettings.vue` → 6 个 tab 组件                                               | 改 1 建 8 | 半天，纯机械重构，无行为变更                                 |
| **P0**         | 补 `use-audio-bands.ts`（假节拍版，零架构改动）                                          | 建 1      | 半天                                                         |
| **P1**         | `skins/` 骨架：types / registry / SkinShell / use-skin-context                           | 建 6      | 1 天                                                         |
| **P1**         | `classic` 皮肤 = 现有布局搬进来，`ImmersivePlayer.vue` 瘦身                              | 建 3 改 2 | 1 天，验收标准：视觉与重构前逐像素一致                       |
| ~~**P1**~~     | ~~设置面板「样式」tab + 缩略图卡片~~ **已取消**（面板主题只在顶部胶囊选，见 §3.7）       | —         | —                                                            |
| **P2**         | 移植 Folia `tilt`（倾诉）：逐行倾斜 + 手写体 + 当前句描边发光                            | 建 4      | 1.5 天，第一个「真的不一样」的皮肤                           |
| **P2**         | 移植 Folia `partita`（云阶）：阶梯错位 + 十字准线                                        | 建 5      | 2 天                                                         |
| **P3**         | 移植 Folia `cadenza`（心象）：逐字随机旋转/位移/字号 + 光圈                              | 建 5      | 3 天，逐字布局量大，需拆 3 个子组件                          |
| **P3**         | 背景注册表：把现有 `backgroundType` 5 类扩展成注册表，补 Folia 的 `geometric` / `latent` | 建 5 改 2 | 2 天                                                         |
| **P4**         | 移植 Folia `fume`（浮名）：canvas 2D 文字雾 + 相机                                       | 建 8      | 5 天+，要重写文字测量与栅格化                                |
| **P4**         | 移植 Folia `pendolo`（时计）：canvas 2D 齿轮表盘                                         | 建 6      | 4 天+                                                        |
| **P4（可选）** | 上 B 方案真实频谱：§1.2.B 的 13 处 + `serveAudioFile` CORS 头                            | 改 8 建 3 | 1.5 天，**必须与 crossorigin 同批改完，否则播缓存文件静音**  |
| **不做**       | `monet` / `sonnet` / `tempera` / `lumiere` / `diorama`                                   | —         | 依赖 Pixi.js / three.js，与当前 60fps 流体背景的性能预算冲突 |

### 移植 Folia DOM 模式的通用改法

| Folia (React)                            | youpu (Vue)                                |
| ---------------------------------------- | ------------------------------------------ |
| `props.currentTime: MotionValue<number>` | `ctx.currentTime()` getter + 皮肤内 rAF    |
| `props.audioPower: MotionValue<number>`  | `ctx.bands().power`                        |
| `React.lazy(() => import(...))`          | `defineAsyncComponent(() => import(...))`  |
| `<Suspense fallback>`                    | `<Suspense>` 或异步组件自带 loading        |
| `useMemo` 布局计算                       | `computed`                                 |
| `useEffect` 订阅                         | `watch` + `onBeforeUnmount` 清理           |
| 逐字 `transform` inline style            | 同一个 `:style` 对象，逐字元素用 `v-for`   |
| tailwind class                           | SCSS + `:deep()`（项目已大量使用这个模式） |

---

## 5. 硬约束与坑

1. **400 行上限**：`SkinShell.vue` 会因为 4 个按钮 + 全屏 + ESC + 拖拽带而逼近上限，
   建议把窗口 chrome 按钮单独抽成 `shared/SkinChromeButtons.vue`。
2. **不能分叉逻辑层**：`use-transport.ts` / `use-backdrop.ts` / `use-skin-context.ts` 必须被所有皮肤共用。
   psysonic 用两个真实 bug 换来的教训 —— 一旦每个皮肤各写一份 seek 逻辑，就会出现「某个皮肤拖动进度条偏移 200ms」这类只在个别皮肤复现的 bug。
3. **`import.meta.glob` 的路径必须在 `src/features/immersive/skins/` 内相对**：
   写成 `'./*/index.ts'`，不要写 `'@/features/immersive/skins/*/index.ts'`（glob 不支持别名）。
4. **皮肤异步 chunk 与 Electron 的 `file://`**：生产构建下 `defineAsyncComponent` 的 chunk 是相对路径，
   electron-vite 默认 `base: './'`，需要确认 `out/renderer/assets/` 下皮肤 chunk 能被正确解析。
   **P1 结束时必须跑一次 `pnpm build` 并在打包后的应用里切一次皮肤验证**，不要只在 `pnpm dev` 下测。
5. **AGPL-3.0**：Folia 是 AGPL-3.0。**只借鉴架构模式与算法思路，代码全部用 Vue 重写**，
   并在 `docs/` 里保留来源说明。不要直接复制 Folia 的 `.ts` 文件（尤其 `parserCore.ts` 43KB 这种量级）。
6. **`LyricLines.vue` 已有能力先复用**：现有组件已支持 zoom / blur / fade / stagger / rotate / karaoke / glow
   七种动画，`tilt` 皮肤的「倾斜」可以用 `enableRotate + rotateCurvature` 的组合先试，
   不够再新写 `use-tilt-layout.ts`。不要重复造。
7. **AGENTS.md 要求**：遇到不知道如何决定的问题先问，不要自己决定。
   本方案里有 4 处需要你拍板（见 §6）。
8. **⚠️ 上 B 方案（真实频谱）时，`crossorigin="anonymous"` 必须和 `serveAudioFile` 的 CORS 头同一次提交改完。**
   只加 `crossorigin` 不加响应头 = **播缓存文件直接静音**（不是「没频谱」，是整个加载失败）。
   这是本方案里唯一一个「改错会让功能倒退」的点，其余全部是纯增量。

---

## 6. 需要你拍板的事

### 6.1 首批移植哪几款？

| 选项                  | 成本   | 特点                                                                       |
| --------------------- | ------ | -------------------------------------------------------------------------- |
| **`classic`**         | 1 天   | 不是新皮肤，是把现有布局原样搬进 `skins/classic/`，作为骨架验收基准        |
| **`tilt`（倾诉）**    | 1.5 天 | 最安静。逐行倾斜 + 手写体 + 当前句描边发光。中文抒情歌气质最搭             |
| **`partita`（云阶）** | 2 天   | 工程图纸感。阶梯错位 + 极细十字准线。与现有风格差异最大                    |
| **`cadenza`（心象）** | 3 天   | 逐字随机旋转/位移/字号 + 光圈。视觉冲击最强，逐字布局量大，要拆 3 个子组件 |
| **`claddagh`**        | 2 天   | DOM，49479 B，尚未细读源码                                                 |

**我的建议：`classic` 必做（骨架的验收标准就是「与重构前逐像素一致」），然后从 `tilt` 起步** ——
它最安静，出了问题最容易看出是布局错还是动画错；`partita` 的十字准线是绝对定位，调起来更费眼。

### 6.2 P0 的 `ImmersiveSettings.vue` 拆分要不要现在做？

- **现在做**：纯机械重构，行为零变更。之后每次加皮肤只动 `skins/<id>/index.ts`（在 `hasSettings` 上表态即可，设置面板本身不动）。
  代价：有回归风险，拆完你需要手动过一遍 6 个 tab 确认没漏控件。
- **不做**：把面板切换塞进 1318 行的设置组件里 → 变 1500+ 行，且以后每加皮肤都要动它。

**我的建议：做。** 这一步是纯搬运（模板段复制粘贴 + `v-show` 改 `:is`），风险主要在「漏搬某一行」，
拆完可以用 `git diff --stat` 核对行数守恒。

### 6.3 音频响应上不上？

**结论已明确（见 §1.2）：真实频谱技术上可行**，实测网易云 CDN 返回 `Access-Control-Allow-Origin: *`（403 响应）。
但要做完整链路要动 **13 处、跨 4 层**，而且有一个**必须一起改的连带风险**：
给 `<audio>` 加 `crossorigin="anonymous"` 会让不带 CORS 头的音源**彻底播不出来**（不只是频谱为 0）。

| 方案                                                    | 效果                                                 | 成本             | 风险                                                      |
| ------------------------------------------------------- | ---------------------------------------------------- | ---------------- | --------------------------------------------------------- |
| **A. 假节拍**（`use-audio-bands.ts` 按 120 BPM 出正弦） | 有呼吸感，但与音乐**不同步**。鼓点重的地方不会真的跳 | 半天，零架构改动 | 无                                                        |
| **B. 真实频谱**（§1.2.B 的 4 层链路）                   | 真正的随拍反应                                       | 1.5 天           | 改 `serveAudioFile` 的 CORS 头 + 逐源验证，漏一个源就静音 |

**我的建议：先做 A，把皮肤跑起来；等 `tilt` 皮肤验收通过后再决定要不要上 B。**
理由有三条：

1. A 的接口（`useAudioBands()` 返回 `{ bands }`）与 B 完全一致，切 B 时皮肤代码一行不用改 —— **先做 A 不会返工**；
2. B 的连带风险（加 crossorigin 导致静音）需要逐个音源实测，不适合和「皮肤架构改造」同时进行 —— 两件事叠在一起，出问题分不清是谁的锅；
3. Folia 的 DOM 模式（`tilt`/`partita`/`cadenza`）对音频的依赖本来就弱，它们靠的是**歌词排版**而不是频谱；
   真正吃频谱的是 `fume`/`diorama` 那些（P4，且已判定「不做」）。

### 6.4 还有一个你没问但我需要确认的

现有 `ImmersiveControls.vue` 已经 **1353 行**，且它的样式表 `immersive-controls.package.scss` 是 **708 行**。
皮肤一旦分叉，控制条是否也要跟着变？

- **方案 1（推荐）**：控制条**不参与皮肤**，所有皮肤共用同一条底栏（`shared/` 里）。
  皮肤只改「封面 + 歌词 + 背景」三块。这样 1353 行只需拆成子组件（不改视觉），工作量最小。
- **方案 2**：控制条也做成皮肤的一部分（像 Folia 的 `VisPlaygroundSettingsPanel` 那样每模式自定义）。
  视觉自由度最大，但 1353 行要拆成「共享逻辑 + N 份布局」，成本翻倍。

**我的建议：方案 1。** 你的原始需求是「让用户选好看的播放面板」，视觉重心在封面和歌词；
底栏是功能件，变来变去只会让用户找不到播放键。

## 7. Folia 三主题背景与字体落地记录

本节记录当前已落地的实现，**取代**前文「倾诉没有设置、背景恒为几何、字体全部固定」的历史阶段描述。

### 7.1 背景配置按主题独立

- 持久化结构为 `settings.folia.backgroundModes: Record<'tilt' | 'glow' | 'fume', FoliaBackgroundChoice>`。
- 旧存档的单个 `folia.backgroundMode` 会一次性迁移到持久化主题对应的槽位：
  - `classic` 归一到 `glow`；旧值非法或为 `url` 时回退 `native`；
  - 只缺失某个主题键时仅补该主题默认值，重复迁移幂等。
- 三套主题的原生选项分别是「原生（几何）」「原生（Common）」「原生（手绘纸面）」。
- 流光原生背景就是 Common，因此选择器隐藏重复的 `common`，历史 `common` 归一为 `native`。
- 背景透明度与模糊度仍由三主题共享；透明度与模糊只作用于覆盖背景层。

### 7.2 浮名覆盖背景跟随文章相机

- 浮名原生档继续使用 canvas 手绘纸面背景；Common、Monet、Nomand、Latent、Sora 挂载在文章世界背景层。
- 覆盖背景与文字共享同一帧相机快照，由 `useFumeStage` 的现有绘制 rAF 通过
  `FoliaSkinBackground.syncView()` 命令式写 CSS `matrix(...)`，不新增第二条 rAF，也不逐帧触发 Vue 响应式重渲染。
- 世界尺寸有文章时取文章包围盒，无文章时取舞台 1.8 倍，并保证不小于视口 1.2 倍；
  Common 的几何构图对齐文章纸张包围盒。
- 背景模式切换、窗口缩放与切歌时复用当前世界 / 相机；透明模式不挂载背景组件。

### 7.3 字体设置按主题独立

- 持久化结构为 `settings.folia.fonts: Record<FoliaSkinId, FoliaFontSettings>`：

```ts
interface FoliaFontSettings {
  custom: boolean
  families: string[]
  weight: number | null // null = 跟随主题内置字重
}
```

- 设置页在 Folia 主题下增加「字体」页签，顺序为外观 / 歌词 / 背景 / 字体 / 关于；页签内只编辑当前主题。
- `custom` 只控制自定义字体族；字重独立生效，默认跟随主题：
  - 倾诉正文 400、倾斜段 300；
  - 流光 700；
  - 浮名正文 640、hero 780。
- 字体链会 trim、去空、按首次出现顺序去重；渲染时统一转义并追加主题内置族与通用兜底族。
- 倾诉、流光、浮名分别读取自己的字体槽位，不按切换中的 `settings.skin` 动态取值，避免异步皮肤切换时串配置。
- 浮名字体或字重变化会同时清空 `pretext` / 字素测量缓存、更新布局缓存键与主题指纹，并触发文章重排。
- 副歌词、空态、加载卡与歌名卡保持各自内置字重层级，不受主歌词字体设置影响。

### 7.4 回归验证

修改 Folia 背景或字体后至少检查：

1. 三套主题的背景选择互不影响；流光不出现重复 Common；历史存档可正常迁移。
2. 浮名在每种覆盖背景下都与歌词同帧移动；缩放、切歌、切背景、暂停与恢复无跳变。
3. 三套字体配置互不影响；关闭自定义字体后仍可独立调字重；恢复默认只重置当前主题。
4. 倾诉 / 流光 / 浮名的主歌词分别使用各自字体，副歌词、空态与加载卡不被污染。
5. 运行 `npm test`、`npm run typecheck`，并对改动文件执行精确 ESLint。
