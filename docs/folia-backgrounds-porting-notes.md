# Folia 背景系统移植规格书（6 种模式，算法思路非源码）

> **许可说明**：Folia 是 AGPL-3.0，本项目（youpu）是 MIT。
> 本文件**只记录从阅读其源码中提炼的算法思路、参数与契约**，不含任何 Folia 源码片段。
> 实现代码全部用 Vue 3 + TypeScript 独立重写。
> 可以直接复用的，只有 Folia 依赖的第三方库 —— `@paper-design/shaders`（Apache-2.0）与 `twgl.js`（MIT）——
> 以及它们自身提供的 shader 与 WebGL 封装；Folia 自己的代码（GLSL 装配、音频映射、取色、布局）
> 一律重写。这与 `docs/refactor-plan.md:433`、`docs/folia-integration.md:687` 已确立的原则一致。
>
> 参考仓库：`chthollyphile/folia-major`，commit `77013479`（`git describe` = `v0.7.19-4-g77013479`，package.json version `0.7.19`）
> 来源根目录（下文所有相对路径都相对它）：
> - `B = F:\Work\_refs\folia-major\src\components\visualizer\backgrounds`
> - 其它文件写全路径，如 `src/types.ts`、`src/utils/paperShaderContext.ts`
>
> 本机依赖版本（已实测）：Folia 装 `@paper-design/shaders@0.0.80`（`package-lock.json`），
> 本项目装 `@paper-design/shaders@0.0.81`、`twgl.js@7.0.0`、`electron@42.4.1`。
> **两者在 `paper-texture` 上有实质性不兼容**，见 §5.6 与 §11 风险 1。

---

## 0. 结论先行

### 0.1 六种模式的定位

| mode | order | 一句话 | 渲染技术 | 直接搬第三方 shader？ |
| ---- | ----- | ------ | -------- | --------------------- |
| `common` | 10 | 封面取色流体底 + 纯 CSS/DOM 几何层 + 暗角 | 无 WebGL | 不涉及 |
| `latent` | 35 | 封面取色双 shader 叠层，音频驱动 | Paper `mesh-gradient` + `dithering` | 可以 |
| `monet` | 20 | 封面/上传图烘焙成海报底图 + 可漂移 | Canvas 2D 离线合成 | 不涉及 |
| `nomand` | 30 | 封面/上传图 + 单档 Paper 图像滤镜（5 档） | Paper 图像类 shader | 可以（`paper-texture` 除外，见 §5.6） |
| `sora` | 50 | WebGL 星空 | 自写 GLSL + twgl.js | shader 要自己写 |
| `url` | 40 | iframe 嵌网页 | iframe | 不涉及 |

`latent` 是 Folia 的**默认**背景模式（`src/types/visualizerModes.ts:42`）——
注意这意味着「默认背景 = 需要 WebGL2 的双 shader」，本仓库若照抄默认值，
新用户开箱就会跑 WebGL2 路径，必须准备好降级链（§10.4）。

### 0.2 本项目已定的取舍（用户决定，本文按此写）

1. **A) 全部模式先不带设置面板**：即本仓库不实现 `renderSettingsPanel` / `renderQuickControls`，
   所有 tuning 取 `DEFAULT_*` 常量（§3.3、§4.5、§5.5、§6.5）；但数据结构、取值域与钳制函数要照抄，
   以后接设置面板时不用改渲染层。
2. **C) 背景 1:1 还原，整套背景注册表搬过来**：6 种模式全部可选，不是只挑一种。
3. 第三方依赖复用（`@paper-design/shaders` + `twgl.js`），Folia 自己的代码全部 Vue 重写。

### 0.3 全文速查表：谁在什么时候被暂停

| 输入 | 来源 | 影响 |
| ---- | ---- | ---- |
| `paused` | `displayPlayerState !== PLAYING`（`useVisualizerRendererModel.ts:153`） | `common` 几何层切成静止快照（不带动画）；`latent` 速度降到 `base×0.12`、音频目标归零；`sora` 停止推进 `u_time` |
| `staticMode` | `resolvedStaticMode \|\| resolvedBackgroundStaticMode`（`VisualizerShell.tsx:194`） | `common` **整层几何被移除**（`common/entry.tsx:52`）；`latent` `setSpeed(0)` 且不跑 rAF；`sora` 等同 `paused` |
| `backgroundStaticMode` | `shouldPauseVisualizerBackground`（首页且开了「关闭首页动态背景」）或 `latent + dynamicOnlyInPlayer + 非播放页`（`useVisualizerRendererModel.ts:147-152`） | 同上 |
| `transparent` | `useVisualizerRendererModel.ts:119` 强制 `isPlayerPageTransparent` | 背景渲染器**直接返回 null**（§1.6） |

---

## 1. 注册表契约

### 1.1 发现机制

- `B/registry.tsx:11`：`import.meta.glob('./*/entry.tsx', { eager: true })` —— 每个模式目录一个 `entry.tsx`，
  默认导出 `VisualizerBackgroundRegistryEntry`。
- `B/registry.tsx:13-33`：`buildBackgroundRegistry` 校验「缺 default 导出」与「重复 mode」并**按 `order` 升序**排序。
- `B/registry.tsx:42-46`：初始化时用 `assertBuiltinModeList` 把 glob 发现的 mode 列表与
  `src/types/visualizerModes.ts:32-39` 的 `BUILTIN_VISUALIZER_BACKGROUND_MODES` **逐字比对**，不一致直接抛错。
  好处是「加了一个 entry 目录忘了登记」会当场炸，不靠人同步（`visualizerModes.ts:11-13` 的注释）。
- `B/registry.tsx:54-57`：`getVisualizerBackgroundRegistryEntry(mode)` 未命中时**回退到默认模式**，不抛错、不返回空。
- `B/registry.tsx:59-66`：`getVisualizerBackgroundModeLabel` —— 翻译缺失（`t(key)` 返回原 key 或空）时用 `labelFallback`。
- `B/registry.tsx:74-96`：`appendVisualizerBackgroundEntry` / `removeVisualizerBackgroundEntry` 是 **mod 投稿通道**，
  id 约定带 `mod:` 前缀。本项目没有 mod 体系，可先不实现，但**注册表要留出「追加」的形状**，
  否则以后接插件要重构。

### 1.2 `VisualizerBackgroundConfig` 逐字段

定义：`B/definition.ts:18-44`。

| 字段 | 类型 | 含义 / 备注 |
| ---- | ---- | ----------- |
| `mode` | `VisualizerBackgroundMode \| null`（可选） | 当前模式；id 是 `string & {}` 所以 mod 模式不破坏类型 |
| `transparent` | `boolean`（可选） | 见 §1.6；由调用方（`useVisualizerRendererModel.ts:119`）在「播放页透明」时强制 true |
| `common.useCoverColorBg` | `boolean`（可选） | 封面取色流体底开关。**来源是主题设置，不是可视化设置**（`useVisualizerBackgroundConfig.ts:28-29`：`useThemeSettingsStore(state => state.useCoverColorBg)`） |
| `common.opacity` | `number`（可选） | 叠加在流体底之上的**主题底色**的不透明度，默认 0.75 |
| `common.disableGeometricBackground` | `boolean`（可选） | 关几何层 |
| `common.disableVignette` | `boolean`（可选） | 关暗角（暗角是几何层内部的一层，见 §2.3.6） |
| `customImage` | `MonetBackgroundImage \| null`（可选） | `{ id, name, url }`（`src/types.ts:1115-1119`）。**monet 与 nomand 共用同一个上传图资产**（`useVisualizerBackgroundConfig.ts:39`） |
| `monet.tuning` | `MonetBackgroundTuning`（可选） | §4.3 |
| `nomand.tuning` | `NomandBackgroundTuning`（可选） | §5.3 |
| `latent.tuning` | `LatentBackgroundTuning`（可选） | §3.3 |
| `sora.tuning` | `SoraBackgroundTuning`（可选） | §6.3，只有一个 `blank` |
| `url.items` | `UrlBackgroundItem[]`（可选） | `{ id, url, note }`（`src/types.ts:922-926`） |
| `url.selectedId` | `string \| null`（可选） | 选中项 id；不在列表里 → 不渲染（§7） |

### 1.3 `VisualizerBackgroundActions`（设置面板回调，本项目先不用但要知道形状）

定义：`B/definition.ts:46-81`。要点：

- `onModeChange` 在顶层。
- `common` 四个 `onXxxChange`：`onCoverColorChange` / `onOpacityChange` / `onDisableGeometricChange` / `onDisableVignetteChange`。
- `customImage.onUpload(files) => Promise<{ok, error?}>` / `customImage.onClear()` / `customImage.isLoading`。
- 四套 tuning 各是 `{ onTuningChange(patch), onResetTuning() }`。
- `url` 是 CRUD：`onAdd` / `onUpdate(id, patch)` / `onDelete(id)` / `onSelect(id | null)`。

### 1.4 `VisualizerBackgroundRenderProps` 逐字段

定义：`B/definition.ts:83-93`。

| 字段 | 类型 | 含义 | Vue 侧建议 |
| ---- | ---- | ---- | ---------- |
| `config` | `VisualizerBackgroundConfig`（可选） | 上面那一坨 | prop，`readonly` |
| `theme` | `Theme` | 当前生效的明/暗主题（`src/types.ts:93-108`）：`backgroundColor` / `primaryColor` / `accentColor` / `secondaryColor` / `fontStyle` / `animationIntensity` / `lyricsIcons?` … | prop |
| `isDaylight` | `boolean` | 是否浅色主题。**影响 nomand 的反色、sora 的底色与颜色回退、monet 的图不透明度** | prop |
| `coverUrl` | `string \| null`（可选） | 当前封面 URL | prop |
| `audioPower` | `MotionValue<number>` | **0–255** 的整体能量（不是 0–1！`normalizeAudio` 才除以 255） | 本项目换成 `() => number` 或 `Ref<number>` |
| `audioBands` | `AudioBands` | 五个 `MotionValue<number>`，各 **0–255**：`bass` 20–150Hz、`lowMid` 150–400Hz、`mid` 400–1200Hz、`vocal` 1000–3500Hz、`treble` 3500Hz+（`src/types.ts:1418-1425`），另可选 `spectrum` | 同上 |
| `seed` | `string \| number`（可选） | 几何层重掷种子；`GeometricBackground` 用它做 `AnimatePresence` 的 key（`B/common/GeometricBackground.tsx:385`） | prop |
| `staticMode` | `boolean` | 「整层别动」：不建 WebGL 帧循环 / 不渲染几何层（§0.3） | prop |
| `paused` | `boolean` | 「播放暂停」：冻结动画但层还在 | prop |

> **注意 `MotionValue` 的语义**：Folia 用 framer-motion 的 `MotionValue` 是为了「**不触发 React 重渲染地逐帧读值**」。
> Vue 里没有等价物，别把 0–255 的值放进 `reactive()` 每帧改 —— 那会触发整个组件树重渲染。
> 本仓库已有正确做法：`src/features/immersive/use-audio-bands.ts` 是「rAF 里写一个 `ref`」，
> 而 `GeometricBackground.vue` 进一步用**容器 CSS 变量 + watch 写样式**绕开 VDOM（见该文件 45-48 行注释）。

### 1.5 `VisualizerBackgroundRegistryEntry` 逐字段

定义：`B/definition.ts:116-125`。

| 字段 | 类型 | 含义 |
| ---- | ---- | ---- |
| `mode` | `VisualizerBackgroundMode` | 唯一 id |
| `order` | `number` | **升序**排列，决定选择器里的顺序（`registry.tsx:30`）。已有值：common 10、monet 20、nomand 30、latent 35、url 40、sora 50 |
| `labelKey` | `string` | i18n key，如 `options.visualizerBackgroundModeLatent` |
| `labelFallback` | `string` | 英文兜底：Common / Monet / Nomand / Latent / Embed / Sora |
| `render` | `(props) => ReactNode` | 渲染函数。Vue 里对应「一个组件」，建议 `component: Component` |
| `renderSettingsPanel?` | `(props: VisualizerBackgroundSettingsProps) => ReactNode` | 设置面板（本项目先不做） |
| `renderQuickControls?` | `(props: VisualizerBackgroundQuickControlsProps) => ReactNode` | 播放面板快捷控件（本项目先不做） |
| `resetSettings?` | `(actions?) => void` | 重置。注意 `common` 的重置是**手写四个常量**（`B/common/entry.tsx:83-88`），其余三种是 `onResetTuning()` |

`defineVisualizerBackground`（`B/definition.ts:131`）是恒等函数，只为类型推断，可以照搬这个思路。

### 1.6 `transparent` 的处理

```ts
// B/VisualizerBackgroundRenderer.tsx:9-14
if (props.config?.transparent) return null;
const mode = props.config?.mode ?? DEFAULT_VISUALIZER_BACKGROUND_MODE;
return getVisualizerBackgroundRegistryEntry(mode).render(props);
```

三个后果，实现时别漏：

1. **连几何层和暗角一起没了**。透明不是「背景透明但装饰还在」，是整棵背景树返回 `null`。
2. `transparent` 是**调用方强制的**：`useVisualizerRendererModel.ts:117-126` 把 `isPlayerPageTransparent` 合并进 config。
   另外 `monet` 自己还有一道 `transparentBackground` 判断（`B/monet/MonetBackgroundLayer.tsx:150-152` 返回 null，
   `:99` 清空烘焙结果），是双保险。
3. 渲染器仍然会先算 `mode`，也就是说 `transparent` 优先于 mode 解析 —— 未命中 mode 的回退在这里没有意义。

### 1.7 调用点与参数合成（照抄这份就够）

- `VisualizerShell.tsx:185-197`：把 `theme / isDaylight / coverUrl / audioPower / audioBands / seed`
  与 `staticMode = resolvedStaticMode || resolvedBackgroundStaticMode`、`paused = resolvedPaused` 一起传下去。
- `useVisualizerRendererModel.ts:117-126`：`transparent`、`common.disableGeometricBackground || isSettingsSubviewOpen`
  （设置子页盖住几何层时白画不如不画）。
- `useVisualizerRendererModel.ts:147-152`：
  `backgroundStaticMode = shouldPauseVisualizerBackground || (mode === 'latent' && tuning.dynamicOnlyInPlayer && currentView !== 'player')`。
  `shouldPauseVisualizerBackground` 定义在 `components/app/presentation/buildPlayerViewFlags.ts:30`
  = `currentView !== 'player' && disableHomeDynamicBackground`。
- OBS 浏览器源也走同一份 config：`useObsBrowserSourcePublisher.ts:124-131`。

### 1.8 本项目落地方案（建议）

```
src/features/immersive/backgrounds/
  registry.ts                  # 6 个 entry 的静态表 + order 排序 + resolve(mode) 回退
  types.ts                     # VisualizerBackgroundConfig / RenderProps / RegistryEntry 的 Vue 版类型
  definition.ts                # defineBackground() 恒等函数
  common/
  latent/
  monet/
  nomand/
  sora/
  url/
  shared/                      # paperShaderMount.ts / audio-bands.ts / color.ts
```

- 用**静态数组 + 显式顺序**而不是 `import.meta.glob`：本项目是 Electron 单页应用，
  没有 mod 体系，`glob` 只会让打包器把 6 种模式的 WebGL 代码都拉进主 chunk。
  需要「eager 全量」时就同步 6 条 import，需要懒加载时用 `defineAsyncComponent`。
- **保留**「未命中回退默认模式」与「runtime 追加」两个语义（后者留空实现），
  因为 `urlBackgroundSelectedId` 这类脏数据回退是运行期真实会走到的路径。
- `assertBuiltinModeList` 那种自检值得照搬：本项目 6 个 mode 与
  `immersive-settings.model.ts` 的取值域要有一处断言，避免出现「切到 latent 但类型里没登记」。

---

## 2. `common` 模式

### 2.1 渲染结构

`B/common/entry.tsx:18-67` 返回一个 Fragment，DOM 顺序 = 层叠顺序（都在 `z-0`）：

| # | 层 | 条件 | 样式要点 |
| - | -- | ---- | -------- |
| 1 | 流体封面取色层 `<motion.div>` 包 `FluidBackground` | `common.useCoverColorBg` 为真 | `absolute inset-0 z-0`；进场 `opacity 0→1`，`duration 1s`；离场 `opacity→0` |
| 2 | **主题底色层** | 恒有 | `absolute inset-0 z-0 transition-all duration-1000`，`backgroundColor: theme.backgroundColor`，`opacity: useCoverColorBg ? (common.opacity ?? 0.75) : 1` |
| 3 | 几何层（`GeometricBackground`） | `!staticMode` | 外包一层 `absolute inset-0 z-0` |

关键理解：**第 2 层压在第 1 层上面**。所以「打开取色」并不是把底色删掉，
而是把主题底色以 75% 不透明度盖在流体底上（这就是「染色/压暗」的来源）。
第 2 层还带 `transition-all duration-1000` —— 改主题色或改 opacity 时是 1 秒渐变，不是硬切。

`common.*` 的四个值：

| 字段 | 默认 | UI 范围 | 持久化默认 |
| ---- | ---- | ------- | ---------- |
| `useCoverColorBg` | `false`（`entry.tsx:29`） | 开关 | 主题设置 store |
| `opacity` | `0.75`（`entry.tsx:49`） | 0–1 step 0.05（`CommonBackgroundSettingsCard.tsx:64-74`） | `readStoredBackgroundOpacity()` = `parseFloat(localStorage['background_opacity'])`，**只在非有限值时回退 0.75，不做区间钳制**（`stores/visualizerSettingsPersistence.ts:26-34`） |
| `disableGeometricBackground` | `false`（`entry.tsx:59`） | 开关 | 可视化设置 |
| `disableVignette` | `false`（`entry.tsx:60`） | 开关 | 可视化设置 |

无封面时的退化：`FluidBackground` 自己会铺 `theme.backgroundColor` 的 0.8 不透明度一层（§2.2.3）。

### 2.2 `FluidBackground` 完整算法

文件：`B/common/FluidBackground.tsx`（404 行）。它不吃 shader，全部是 Canvas 2D + CSS 滤镜 + CSS 渐变。
分成「封面预处理」和「渲染」两段，预处理按平台走两条完全不同的管线。

#### 2.2.1 平台判定

`detectIOSSafari()`（`FluidBackground.tsx:15-25`）三个条件同时成立才算：

- Apple 移动端：`/iPad|iPhone|iPod/i.test(ua)`，或 `navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1`（后者盖住 iPadOS 桌面 UA）
- `/WebKit/i.test(ua)`
- **不是**第三方内核：`/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser|GSA/i` 命中即排除

结果用 `useMemo(detectIOSSafari, [])` 缓存一次（`:171`），运行期不重算。

> 本项目（Electron/Chromium）恒为 `false`，**软焦管线整条可以不做**，但两处 iOS 分支的样式差异要留在结构里并在注释中说明，否则以后改 UA 判定会漏。

#### 2.2.2 非 iOS：降采样模糊源

```ts
const COVER_BLUR_SOURCE_MAX = 384;           // FluidBackground.tsx:128
buildDownscaledCover(coverUrl, 384)          // :129-168
```

1. `new Image()`，`crossOrigin = 'anonymous'`，`decoding = 'async'`（`:134-136`）
2. 取 `naturalWidth || width`；为 0 → `resolve(null)`
3. `scale = min(1, 384 / max(w, h))`，`width = max(1, round(w*scale))`（`:145-147`）
4. 画到离屏 canvas，`imageSmoothingEnabled = true`、`imageSmoothingQuality = 'high'`（`:156-157`）
5. `canvas.toDataURL('image/jpeg', 0.82)`
6. `catch` 时 `console.warn` 并 `resolve(null)` —— 注释（`:161`）写明原因是**跨源封面没有 CORS 头会污染画布**

调用处 `:210-212`：`const src = smallUrl ?? coverUrl;` —— **降采样失败就回退原图 URL**，不阻断渲染。

为什么必须是 384：文件内注释（`:121-127`）解释，背景是 `blur(40px)` 的重模糊，比 40px 细的细节全被抹掉，所以 384px 源在观感上等价；真正的区别是纹理上传 —— 全分辨率封面（常见 1000–3000px）首次合成时**分块上传**，每块落地都可见，就是「网格/栅格状闪烁」的来源，而 384px 源只有一块。本项目如果直接照抄，需要保留这条注释，否则后来人会以为是性能优化而删掉。

#### 2.2.3 iOS：软焦封面

`buildSoftFocusCover(coverUrl)`（`:27-119`），常量 `IOS_SOFT_FOCUS_SAMPLE_SIZE = 24`、`IOS_SOFT_FOCUS_OUTPUT_SIZE = 96`（`:12-13`）：

1. 源 canvas 24×24，取**中心正方形**：`squareSize = min(w,h)`，`sx = (w-squareSize)/2`，`sy = (h-squareSize)/2`（`:53-71`）
2. 输出 canvas 96×96，`globalAlpha = 1` 画第一层（`:73-86`）
3. 三次偏移叠加（`:88-107`）：

| pass | x | y | size | alpha |
| ---- | - | - | ---- | ----- |
| 1 | -8 | -8 | 96 + 16 = 112 | 0.22 |
| 2 | 6 | 0 | 96 | 0.14 |
| 3 | 0 | 6 | 96 | 0.14 |

4. `globalAlpha` 复位为 1，`toDataURL('image/jpeg', 0.72)`（`:109-110`）
5. `catch` → `console.warn('[FluidBackground] Failed to build soft focus cover', error)` + `resolve(null)`

副作用：`useEffect`（`:174-195`）里 `coverUrl` 或 `isIOSSafari` 变化都会 `setSoftFocusCoverUrl(null)` 先清空，异步结果回来时用 `cancelled` 标记防止过期写入。

#### 2.2.4 渲染结构（DOM 分层）

容器（`:250-258`）：`absolute inset-0 w-full h-full overflow-hidden pointer-events-none z-0`，内联 `isolation: 'isolate'`、`contain: 'paint'`、`transform: 'translateZ(0)'`。
`contain: paint` + `isolation` 是这套做法的前提：`blur(40px)` 的图层不会溢出、也不会和外部配色串味。

**有封面时**（`:260-368`）：

| 顺序 | 层 | 非 iOS | iOS |
| ---- | -- | ------ | --- |
| 1 | 封面层 | `coverLayers` 数组，每层 `motion.div`（`opacity`）包一个 `<img object-cover>`，`filter: blur(40px)`、`transform: scale(1.5) translateZ(0)`（`:229-248`） | 单张 `<img>`，`transform: scale(isSoftFocusReady ? 1.28 : 1.2)`、`opacity: isSoftFocusReady ? 0.94 : 0.3`、`transition-opacity duration-700 ease-out`（`:229-238, :263-271`） |
| 2 | iOS 预热底图 | — | `isSoftFocusReady === false` 时再铺一张原图：`scale(1.36)`、`opacity 0.12`（`:333-349`） |
| 3 | iOS 压暗层 | — | `theme.backgroundColor` @ `0.28`（`:351-357`） |
| 4 | iOS 径向叠色 | — | 三层 radial：`accent55 @(20% 20%) → transparent 42%`、`secondary50 @(80% 28%) → transparent 44%`、`primary28 @(50% 78%) → transparent 52%`，整层 `opacity = isSoftFocusReady ? 0.52 : 0.7`（`:359-365`） |
| 5 | 无封面回退 | `theme.backgroundColor` @ `0.8`，带 `transition-colors duration-1000`（`:369-377`） | 同左 |
| 6 | 顶层混合渐变 | `linear-gradient(to bottom right, primary, transparent, secondary)`，`opacity 0.4`、`mixBlendMode: 'overlay'`（`:380-387`） | 同渐变，`opacity 0.2`、`mixBlendMode: 'normal'` |

注意第 3–4 层只在**有封面**的 iOS 分支里（`:331-366` 嵌在 `coverUrl ?` 的 Fragment 内），第 5 层是 `coverUrl` 为空时的 `else`。两层是互斥的，不是叠加。

#### 2.2.5 交叉淡入的层管理

状态（`:203-205`）：

```ts
const coverKeyRef = useRef(0);
const [coverLayers, setCoverLayers] = useState<{ url: string; sourceCover: string; key: number }[]>([]);
const [readyCoverKeys, setReadyCoverKeys] = useState<Set<number>>(() => new Set());
```

- `:206-222`：`coverUrl` 变 → 降采样 → `setCoverLayers` 里**只保留「当前顶 + 新来」两层**（`:217-218` 注释原文：Keep only the current top (to fade out beneath the newcomer) plus the newcomer）
- 同一 `sourceCover` 重复推送直接 `return prev`（`:215`），避免重复挂载
- `:284-297`：新层 `initial.opacity = isTop ? 0 : 1`，`animate.opacity = (isTop && !ready) ? 0 : 1`，`transition { duration: 1.5, ease: 'easeInOut' }`
- `:307-318`：`ref` 回调里 `el.decode().then(() => requestAnimationFrame(() => markCoverReady(key))).catch(() => markCoverReady(key))` —— **decode 失败也放行**，避免永远卡在透明
- `:291-297`：`onAnimationComplete` 中只有 `isTop && ready` 才 `setCoverLayers(prev => prev.filter(l => l.key === layer.key))`，并把 `readyCoverKeys` 收缩成只剩这一把 key
- `:319-324`：`onError` 剔除这一层，但 `prev.length > 1` 才剔除 —— **最后一层永不移除**
- `:275-279` 注释解释了为什么 opacity 动画挂在 wrapper 上而不是模糊的 `<img>` 上：直接在 `blur(40px)` 图层上动 opacity 会让浏览器每帧重新栅格化模糊并产生分块闪烁

#### 2.2.6 `React.memo` 比较函数（移植时容易埋的坑）

`:390-402` 只比较四项：

```ts
if (prevProps.coverUrl !== nextProps.coverUrl) return false;
return pTheme.backgroundColor === nTheme.backgroundColor
    && pTheme.primaryColor === nTheme.primaryColor
    && pTheme.secondaryColor === nTheme.secondaryColor;
```

**`accentColor` 不在比较里**。iOS 径向叠色（`:362`）用了 `theme.accentColor`，所以在 iOS 上单独改 accent 不会触发这张图的刷新。Vue 版建议直接依赖 props 的响应式（`watch` 到具体字段），不要复刻这个遗漏；如果要逐字复刻视觉，就按「非 iOS 下 accent 不参与」来实现 —— 非 iOS 分支确实一个 accent 都没用。

#### 2.2.7 依赖与移植结论

- 依赖：`framer-motion`（`motion.div` 的进出场 + `onAnimationComplete`）、React `useState/useEffect/useCallback/useMemo/useRef`
- Vue 版落点：`onAnimationComplete` 用 `@animationend` 或直接用 `motion-v` 的 `onComplete`；`transition-opacity duration-700` 是纯 CSS，可以原样搬
- 本项目 Electron 恒走非 iOS 分支，**软焦管线可整体砍掉**，但 `COVER_BLUR_SOURCE_MAX = 384` 的降采样必须留（它决定闪烁与否）
- 取色/配色只用到 `backgroundColor / primaryColor / secondaryColor / accentColor` 四个字段，与 `§2.1` 表格的 `theme` 完全一致

### 2.3 `GeometricBackground` 完整算法

文件：`B/common/GeometricBackground.tsx`（440 行）。纯 DOM + CSS，唯一的外部依赖是 `framer-motion` 和 `lucide-react` 图标解析。

#### 2.3.1 形状集合与频带映射

```ts
type ShapeType = 'circle' | 'square' | 'triangle' | 'cross' | 'icon';   // :19
type ScaleKey  = 'bass' | 'lowMid' | 'mid' | 'vocal' | 'treble' | 'default';  // :20
```

映射（`getShapeScaleKey`，`:47-62`）：

| 形状 | 频带 | 说明 |
| ---- | ---- | ---- |
| `circle` | `bass` | |
| `square` | `lowMid` | |
| `triangle` | `mid` | |
| `cross` | `treble` | 注意是 treble，不是 vocal |
| `icon` | `vocal` | 图标用弹簧放大，不做位移关键帧 |
| 其他 | `default` | 落到 `audioPower` |

#### 2.3.2 形状外观

`getShapeClipPath`（`:64-74`）逐字：

- `triangle`：`polygon(50% 0%, 0% 100%, 100% 100%)`
- `cross`：`polygon(20% 0%, 0% 20%, 30% 50%, 0% 80%, 20% 100%, 50% 70%, 80% 100%, 100% 80%, 70% 50%, 100% 20%, 80% 0%, 50% 30%)`
- 其他：`'none'`
- `circle` 额外 `borderRadius: '50%'`（`:87`）

`getShapeBaseStyle`（`:76-91`）：

```ts
const isCircleOrSquare = shape.type === 'circle' || shape.type === 'square';
const useStroke = isCircleOrSquare && !shape.filled;
// border:  useStroke ? `1px solid ${theme.secondaryColor}` : 'none'
// background: !useStroke ? theme.secondaryColor : 'transparent'
// opacity: shape.opacity
```

也就是说 **三角形和十字永远填充且永远没有描边**（`useStroke` 对它们恒为 false），`filled` 只影响圆和方。这不是笔误，是与 Folia 逐字一致的行为，移植时不要「顺手修正」。

#### 2.3.3 生成规则（随机序列，顺序敏感）

`shapes`（`:310-339`，`useMemo` 依赖 `[theme.lyricsIcons, seed]`）固定 **15 个**（`:315`），每个槽位按下面的顺序消耗随机数：

```ts
const shapeTypes = ['circle', 'square', 'triangle', 'cross'];
const availableIcons = theme.lyricsIcons || [];
let iconCount = 0;
// 每个 index：
const wantIcon = availableIcons.length > 0 && Math.random() > 0.7;   // 随机数 1
const useIcon  = wantIcon && iconCount < 6;                          // 上限 6
if (useIcon) iconCount += 1;
const iconName = useIcon ? availableIcons[Math.floor(Math.random() * availableIcons.length)] : null;  // 随机数 2（仅图标槽位）
type      = useIcon ? 'icon' : shapeTypes[Math.floor(Math.random() * shapeTypes.length)];  // 随机数 2 或 3
initialX  = Math.random() * 100;      // 0–100，单位 %
initialY  = Math.random() * 100;      // 0–100，单位 %
size      = 40 + Math.random() * 100; // 40–140，单位 px
duration  = useIcon ? 20 + Math.random() * 20 : 30 + Math.random() * 30;  // 图标 20–40s，形状 30–60s
delay     = Math.random() * 5;        // 0–5s
opacity   = 0.11 + Math.random() * 0.08;  // 0.11–0.19
reverse   = Math.random() > 0.5;
filled    = Math.random() < 0.3;
initialRotation = Math.random() * 360;    // 度
```

`particles`（`:341-351`，`useMemo` 依赖 `[seed]`，**不依赖 lyricsIcons**）固定 **20 个**：

```ts
size   = Math.random() * 4 + 1;   // 1–5 px
left   = Math.random() * 100;     // 0–100 %
top    = Math.random() * 100;     // 0–100 %
opacity= Math.random() * 0.3;     // 0–0.3
duration = 15 + Math.random() * 20;  // 15–35s
delay    = Math.random() * 10;       // 0–10s
```

> **随机源是 `Math.random()`，没有任何种子函数**。`seed` 只是 `useMemo` 依赖项和 `AnimatePresence` 的 key：seed 一变就整批重掷。
> 本项目已经不这么做 —— `src/features/immersive/backgrounds/geometric-model.ts` 用 `seededRandom` 取代随机源，并把形状参数写进 CSS 变量。两边的数值域一致（见 `§10.5` 对照表），但**同 seed 下不会得到 Folia 的同一张图**，这是既定差异，不是 bug。

#### 2.3.4 两套场景

`StaticGeometricScene`（`:102-169`）：不带动画，图标 `transform: rotate(initialRotation)`，圆/方/三角/十字 `transform: rotate(initialRotation)deg`，粒子直接铺点。`getLucideIconStatus(name) === 'loading'` 时 `return null`（`:114`）—— **图标 chunk 未就绪就留空，不闪方块兜底**（注释在 `:201`）。

`AnimatedGeometricScene`（`:171-296`）：

```ts
const useBandScale = (value?: MotionValue<number>) => {
  const source = value || audioPower;
  const spring = useSpring(source, { stiffness: 300, damping: 30 });
  return useTransform(spring, [10, 200], [0.95, 1.45]);
};
```

`scales` 记录（`:186-193`）为 bass / lowMid / mid / vocal / treble / default 各建一条弹簧 + 映射。**输入区间是 10–200，单位与 `audioBands` 相同（Folia 是 0–255 的桶能量）**，输出是缩放倍率 0.95–1.45。

形状关键帧（`:218-235`、`:251-261`）：

```ts
animate: {
  y: shape.reverse ? [-30, 30, -30] : [30, -30, 30],   // px
  x: shape.reverse ? [15, -15, 15] : [-15, 15, -15],   // px
  rotate: [shape.initialRotation, shape.initialRotation + 360],  // 度
}
transition: { duration: shape.duration, repeat: Infinity, ease: 'linear', delay: shape.delay }
```

图标形状额外一条 opacity 关键帧（`:222-234`）：

```ts
opacity: [0, shape.opacity * 3, 0]
transition.opacity = { duration: shape.duration * 0.5, repeat: Infinity, ease: 'easeInOut', delay: shape.delay }
```

> 注意 `shape.opacity * 3` 会超过 1（opacity ∈ 0.11–0.19 → 峰值 0.33–0.57，实际上不超过 1；但公式本身没有 clamp，属于「碰巧安全」）。移植时按公式写，不要额外 clamp，否则观感不同。

粒子关键帧（`:278-287`）：`y: [0, -100]`、`opacity: [0, particle.opacity, 0]`，`duration` / `repeat: Infinity` / `ease: 'linear'` / `delay` 同上。

`paused === true` 走静态场景（`:361-368`），`paused === false` 走动画场景。**这条分支是整个模式下唯一的「暂停」语义**：暂停 = 静止快照，不是冻结在某一帧的中间态。

#### 2.3.5 `lyricsIcons` 的判定（默认主题下不会出现图标）

`useLucideIcons(theme.lyricsIcons)`（`:308`）触发按需加载；`getLucideIconStatus` 返回 `'loading' | 'ready' | 'missing'`；`resolveLucideIcon` 只在已加载表里同步查（`services/lucideIconResolver.ts:138-155`）。

`Theme.lyricsIcons?: string[]`（`types.ts:105`）。写入它的路径只有两条：

1. AI 主题：`utils/aiThemePrompts.ts:134-136` 要求「3–5 个 PascalCase 的合法 Lucide 图标名」，并在返回 schema 里必填（`:139, :156, :171`）
2. 主题乐园编辑器：`components/modal/theme-park/themeParkDraft.ts:18` 的 `LYRICS_ICON_LIMIT = 12`，`ThemePark.tsx:316-319` 用 `draft.dark.lyricsIcons ?? []` + `updateSharedField({ lyricsIcons })`（明暗共用一份）

而 `services/baseThemes.ts` 的 `DEFAULT_THEME`（`:9-17`）与 `DAYLIGHT_THEME`（`:20-28`）**都没有 `lyricsIcons` 字段**，`services/themeSanitizer.ts:17, :30` 也把它归零为 `[]`。

结论：**默认主题 + 默认主题色下，几何层永远只有圆/方/三角/十字 + 粒子，不会出现图标。** 图标只在用户用了 AI 主题或自己编辑过主题乐园之后才可能出现，且图标总数被 `iconCount < 6` 限制在最多 6 个。本项目如果没有这两个入口，`lyricsIcons` 恒为空，图标分支可以保留为「死代码」但要标注原因。

#### 2.3.6 vignette

`VignetteOverlay`（`:93-100`）：

```tsx
<div className="absolute inset-0 pointer-events-none"
     style={{ background: 'radial-gradient(circle, transparent 40%, rgba(0,0,0,0.6) 100%)' }} />
```

`disableVignette` 为真时整个组件返回 `null`。**是纯 CSS radial-gradient，不是 SVG**，也没有用主题色 —— 固定黑色 0.6。它盖在形状和粒子之上（同一 `<div className="absolute inset-0">` 里最后渲染，`:167` / `:293`）。

#### 2.3.7 `AnimatePresence` 的坑（源码里有明确注释）

`:389-393` 原文注释：

> Do NOT use `initial={false}` on `AnimatePresence` here. `initial={false}` propagates via context to ALL nested motion components, causing keyframe animations with `repeat: Infinity` to never be dispatched on mount. Removing it allows the container to fade in (0.6s) and all child keyframe animations to start normally on every mount.

外层结构（`:384-398`）：`<div absolute inset-0 overflow-hidden pointer-events-none>` 包 `<AnimatePresence mode="sync">`，子节点 `key={String(props.seed ?? 'default')}`（`:385, :395`），容器本身 `initial opacity 0 → animate 1 → exit 0`，`transition { duration: 0.6, ease: 'easeInOut' }`（`:354-360`）。`mode="sync"` 意味着新旧两批形状会同时存在一小段（各自 0.6s 淡入淡出），移植时不要改成 `mode="wait"`。

#### 2.3.8 `React.memo` 比较函数

`:399-437` 逐项比较：`seed`、`audioPower`（引用比较）、`hideShapes`、`disableVignette`、`paused`、`audioBands` 是否存在（`:409` 的 `if (!previousBands !== !nextBands) return false;`，注意这是个「存在性异或」的巧写法）、五个频带的**数值**（`:412-419`）、四个主题色（`:425-429`）、`lyricsIcons` 的**逐项内容**（`:431-435`）。

> 这里 `audioBands.bass` 等都是 MotionValue，`.bass !== .bass` 对同一个 MotionValue 实例恒为 false，所以数值比较实际不触发重渲染；真正的逐帧变化由 `useSpring` 订阅。Vue 版改用 `shallowRef` / `watch` 时要意识到「同一对象的属性变化不会触发」这件事。

#### 2.3.9 与 `common` 层的叠加关系

`common/entry.tsx:52-64` 把几何层挂在 `!staticMode` 之下，外包一层 `absolute inset-0 z-0`。所以完整叠放顺序（自下而上）是：

1. `useCoverColorBg` 为真时的 `FluidBackground`（`entry.tsx:33-44`）
2. 主题底色层（`entry.tsx:45-51`，`opacity = useCoverColorBg ? (common.opacity ?? 0.75) : 1`）
3. 几何层（`entry.tsx:52-64`，含它自己的暗角）

`staticMode` 为真时第 3 层整块消失（不是暂停，是不挂载）—— 这与 `paused` 传进 `GeometricBackground` 后走静态场景是**两回事**：`staticMode` 移除整层，`paused` 保留静态形状。移植时两个开关必须分别落位，否则「首页动态背景关闭」会留下静态点缀。
---

## 3. `latent` 模式（默认模式）

文件：`B/latent/LatentBackground.tsx`（355 行）+ `B/latent/entry.tsx`（68 行）。
`order = 35`（`entry.tsx:22`），`labelFallback = 'Latent'`。它是 `DEFAULT_VISUALIZER_BACKGROUND_MODE`（`src/types/visualizerModes.ts:42`），也就是**开箱即跑**的模式 —— 没有 WebGL2 时必须有降级路径（见 `§10.4`）。

### 3.1 渲染结构

`LatentBackground.tsx:282-351` 的外层是 `<div className="absolute inset-0 z-0 overflow-hidden" style={{ backgroundColor: theme.backgroundColor, pointerEvents: 'none' }}>`。它的兄弟层不在这个组件里：`latent/entry.tsx:25-34` 直接渲染 `<LatentBackground>`，没有额外包一层，所以 `latent` 模式**不吃 `common` 的三个开关**（几何层、vignette、封面取色）—— 这是与 `common` 模式最大的结构差异。

层序（DOM 顺序 = 层叠顺序）：

| # | 层 | 条件 | 样式 | 备注 |
| - | -- | ---- | ---- | ---- |
| 0 | 底色 | 恒有 | 父容器 `backgroundColor: theme.backgroundColor` | 只为 shader 边缘兜底 |
| 1 | `MeshGradient` | `displayMode !== 'dithering'` | 外包 `absolute inset-0`，初始 `transform: scale(1.025)`、`transformOrigin: center` | 源码先渲染 mesh（`:287-311`） |
| 2 | `Dithering` | `displayMode !== 'mesh'` | 外包 `absolute inset-0`，`mixBlendMode: showMesh ? 'soft-light' : 'normal'`，初始 `opacity: showMesh ? tuning.ditheringOpacity : 1`，`transform: scale(1.015)` | 与 mesh 叠加时用 `soft-light` |
| 3 | overlay | `tuning.overlayEnabled && tuning.overlayOpacity > 0` | `absolute inset-0`，`backgroundColor: theme.backgroundColor`，`opacity: tuning.overlayOpacity` | 压暗/压平 |

**顺序要点**：DOM 里 mesh 在前、dithering 在后，所以 dithering 是上层，`soft-light` 用的底色是它下面的 mesh。`showDithering = tuning.displayMode !== 'mesh'`、`showMesh = tuning.displayMode !== 'dithering'`（`:130-131`）；`both` 时两个都为真。

### 3.2 用到的 shader

| 用途 | npm 包 | 导出名 | Folia 用的 React 封装 |
| ---- | ------ | ------ | --------------------- |
| 底层流动色块 | `@paper-design/shaders` | `meshGradientFragmentShader`（`node_modules/@paper-design/shaders/dist/index.d.ts:7`） | `@paper-design/shaders-react` 的 `MeshGradient` |
| 网点/图案抖动 | `@paper-design/shaders` | `ditheringFragmentShader`（同文件 `:35`） | `@paper-design/shaders-react` 的 `Dithering` |

JSX 传参（`LatentBackground.tsx:287-341`）：

```tsx
<MeshGradient
  colors={shaderColors.mesh}          // 6 色
  distortion={tuning.meshDistortion}  // 0–2
  swirl={tuning.meshSwirl}            // 0–1
  grainMixer={0}
  grainOverlay={0.01}
  speed={staticMode ? 0 : resolveLatentShaderSpeed(tuning.meshSpeed, tuning.meshAudioSpeed, 0, paused)}
  minPixelRatio={1}
  maxPixelCount={1280 * 720}
  webGlContextAttributes={PAPER_SHADER_CONTEXT_ATTRIBUTES}
/>

<Dithering
  colorBack={shaderColors.ditheringBack}
  colorFront={shaderColors.ditheringFront}
  shape="warp"
  type="4x4"
  size={tuning.ditheringSize}
  speed={staticMode ? 0 : resolveLatentShaderSpeed(tuning.ditheringSpeed, tuning.ditheringAudioSpeed, 0, paused)}
  minPixelRatio={1}
  maxPixelCount={1280 * 720}
  webGlContextAttributes={PAPER_SHADER_CONTEXT_ATTRIBUTES}
/>
```

落地到 uniform（证据：`@paper-design/shaders-react/dist/shaders/mesh-gradient.js:93-98`、`dithering.js:132-134`）：

| uniform | 取值公式 |
| ------- | -------- |
| `u_colors` | `colors.map(getShaderColorFromString)`，6 个 4 通道 0–1 数组 |
| `u_colorsCount` | `colors.length` = 6 |
| `u_distortion` | `tuning.meshDistortion`；帧循环里改写为 `tuning.meshDistortion + smoothedPower * 0.62` |
| `u_swirl` | `tuning.meshSwirl`；帧循环里改写为 `tuning.meshSwirl + smoothedMid * 0.38` |
| `u_grainMixer` | 常量 `0` |
| `u_grainOverlay` | 常量 `0.01` |
| `u_colorBack` | `shaderColors.ditheringBack` |
| `u_colorFront` | `shaderColors.ditheringFront` |
| `u_shape` | `DitheringShapes.warp` = **2**（常量表：simplex 1 / warp 2 / dots 3 / wave 4 / ripple 5 / swirl 6 / sphere 7） |
| `u_type` | `DitheringTypes['4x4']` = **3**（random 1 / 2x2 2 / 4x4 3 / 8x8 4） |
| `u_pxSize` | `tuning.ditheringSize`；帧循环里改写为 `Math.max(0.5, tuning.ditheringSize - smoothedBass * tuning.ditheringSize * 0.34)` |

`u_distortion` 的官方声明范围是 0–1（`mesh-gradient.d.ts:15`），但 Folia 允许 `tuning.meshDistortion` 到 2（`§3.3`），再加帧循环最多 0.62，**实际最坏会送出 2.62，超出 shader 文档范围**（shader 侧没有 clamp，只是噪声幅度过大）。这是源码事实，移植时照抄或显式标注为已知越界。

### 3.3 tuning 全字段（逐字抄 `DEFAULT_LATENT_BACKGROUND_TUNING`）

来源：`src/types.ts:1049-1064`；钳制：`stores/visualizerSettingsPersistence.ts:865-892`；滑块：`LatentBackgroundSettingsCard.tsx:186-281`。

| 字段 | 默认值 | UI 范围 | 持久化钳制 | 单位 |
| ---- | ------ | ------- | ---------- | ---- |
| `displayMode` | `'both'` | dithering / mesh / both 循环 | 三值判定，非法回默认（`:871-873`） | — |
| `colorSource` | `'cover-theme'` | cover-theme / cover-only | 只有 `'cover-only'` 被特别识别（`:874-876`） | — |
| `dynamicOnlyInPlayer` | `true` | 开关 | 布尔判定 | — |
| `enhancedBeatResponse` | `true` | 开关 | 布尔判定 | — |
| `ditheringSpeed` | `0.1` | 0–2 step 0.1（`:207-211`） | `clampLatentNumber(v, fallback, 0, 2)`（`:865-867, :879-882`） | shader speed，1 = 实时 |
| `ditheringAudioSpeed` | `1.2` | 0–2 step 0.1（`:216-220`） | 0–2 | 同上 |
| `ditheringSize` | `2.5` | 0.5–8 step 0.25（`:225-229`） | 0.5–8（`:883-886`） | 抖动像素边长 px |
| `ditheringOpacity` | `0.55` | 0–1 step 0.05（`:234-239`） | 0–1 | 层不透明度 |
| `meshSpeed` | `0.3` | 0–2 step 0.1（`:250-254`） | 0–2 | shader speed |
| `meshAudioSpeed` | `2` | 0–2 step 0.1（`:259-263`） | 0–2 | shader speed |
| `meshDistortion` | `0.8` | 0–2 step 0.05（`:268-272`） | 0–2（`:887-890`） | 无单位 |
| `meshSwirl` | `0.1` | 0–1 step 0.05（`:277-281`） | 0–1（`:891-892`） | 无单位 |
| `overlayEnabled` | `true` | 开关（`:182`） | 布尔 | — |
| `overlayOpacity` | `0.35` | 0–1 step 0.05（`:189-195`） | 0–1 | 层不透明度 |

```ts
// stores/visualizerSettingsPersistence.ts:865-867
export const clampLatentNumber = (value, fallback, min, max) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
```

localStorage key：`latent_background_tuning`（`readStoredLatentBackgroundTuning`，`:894`）。

`dynamicOnlyInPlayer` 的生效点不在本组件里：`components/visualizer/useVisualizerRendererModel.ts:147-152` 把它折算进 `backgroundStaticMode = shouldPauseVisualizerBackground || (mode === 'latent' && tuning.dynamicOnlyInPlayer && currentView !== 'player')`，即「不在播放页就按静态处理」。

**本项目按决定 A 不带设置面板**：运行时全部取上表默认值，但类型、取值域、钳制函数要照抄，将来开面板时不用动数据结构。
### 3.4 封面取色：`resolveLatentShaderColors`（完整算法）

常量与纯函数（`LatentBackground.tsx:29-36`）：

```ts
MAX_SHADER_PIXELS  = 1280 * 720;      // = 921600
PAUSED_SPEED_SCALE = 0.12;
normalizeAudio(v)  = min(1, max(0, v / 255));   // 输入 0–255
clampShaderSpeed(v)= min(2, max(0, v));
clampAudioAmount(v)= min(1, max(0, v));
easeTowards(cur, target, amount) = cur + (target - cur) * amount;
```

取色链路（`:134-158`）：

1. 无 `coverUrl` → `setCoverColors([])`，全走回退
2. 有 → `extractRepresentativeColors(coverUrl, 6)`（`utils/colorExtractor.ts:122-128`）
3. 内部 `loadImagePixels`（`colorExtractor.ts:15-50`）把图缩到 **50×50**、`crossOrigin = 'Anonymous'`；加载失败 / 无 CORS 头 / 画布被污染（`getImageData` 抛 SecurityError）都返回 `null`
4. 像素交给 `extractRepresentativeColorsFromPixels`（`utils/colorPalette.ts:77-142`）：**4-bit 量化直方图**（key = `((r>>4)<<8)|((g>>4)<<4)|(b>>4)`，`alpha < MIN_ALPHA` 跳过）→ 加权中位切分（桶得分 `widestRange * sqrt(weight)`，按最宽通道排序后按累计权重取中点）→ 桶内加权平均 → 按权重降序 → `#rrggbb`
5. 任一步失败 → `[]`

`resolveLatentShaderColors(coverColors, theme, colorSource)`（`:83-109`）逐行：

**`colorSource === 'cover-only'`：**

```ts
const primary    = coverColors[0] ?? theme.secondaryColor;
const secondary  = coverColors[1] ?? primary;
const tertiary   = coverColors[2] ?? secondary;
const quaternary = coverColors[3] ?? primary;
const quinary    = coverColors[4] ?? secondary;
const senary     = coverColors[5] ?? tertiary;
return {
  ditheringBack:  tertiary,
  ditheringFront: primary,
  mesh: [primary, secondary, tertiary, quaternary, quinary, senary],
};
```

**`cover-theme`（默认）：**

```ts
const primary    = coverColors[0] ?? theme.secondaryColor;
const secondary  = coverColors[1] ?? theme.primaryColor;
const tertiary   = coverColors[2] ?? primary;
const quaternary = coverColors[3] ?? secondary;
return {
  ditheringBack:  theme.backgroundColor,
  ditheringFront: primary,
  mesh: [primary, secondary, tertiary, quaternary, theme.backgroundColor, theme.accentColor],
};
```

**六个槽位各有各的兜底对象**（`cover-only` 的 quaternary→primary、quinary→secondary、senary→tertiary；`cover-theme` 的 tertiary→primary）。写成一条 `??` 链就会走样。

用的主题色字段：

| 模式 | `backgroundColor` | `primaryColor` | `secondaryColor` | `accentColor` |
| ---- | ----------------- | -------------- | ---------------- | ------------- |
| `cover-only` | — | — | ✅（primary 兜底） | — |
| `cover-theme` | ✅（ditheringBack、mesh[4]） | ✅（secondary 兜底） | ✅（primary 兜底） | ✅（mesh[5]） |

> 本项目的 Material You 取色（`src/features/immersive/use-color-extraction.ts` 的 `QuantizerCelebi`）与这套 4-bit 加权中位切分**不是同一个算法**，六色顺序必然不同。要完全一致就得按算法把 `colorPalette.ts` 那套重写一遍。详见 `§11` 风险 4。

### 3.5 音频反应

每帧回调（`:193-280`）由 `requestAnimationFrame` 自驱，**不触发 React 重渲染**（注释 `:192`）。

平滑器（`:209-215`）：

```ts
smoothedPower = easeTowards(smoothedPower, targetPower, 0.12);
smoothedBass  = easeTowards(smoothedBass,  targetBass,  0.16);
smoothedMid   = easeTowards(smoothedMid,   targetMid,   0.13);
```

输入（`:195-208`）：

| 目标 | 来源 | 暂停时 |
| ---- | ---- | ------ |
| `targetPower` | `normalizeAudio(audioPower.get())` | 0 |
| `targetBass` | `normalizeAudio(audioBands.bass.get())` | 0 |
| `targetBeatEnergy` | `resolveLatentBroadbandEnergy(bass, lowMid, mid, vocal, treble)` | 0 |
| `targetMid` | `normalizeAudio(max(audioBands.mid.get(), audioBands.vocal.get()))` | 0 |

宽带能量（`:37-52`）：

```ts
broadbandEnergy = norm(bass) * 0.22 + norm(lowMid) * 0.18 + norm(mid) * 0.22
                + norm(vocal) * 0.28 + norm(treble) * 0.10;
return pow(broadbandEnergy, 0.55);
```

onset 脉冲与速度目标（`:54-72`）：

```ts
resolveLatentOnsetPulse(cur, prev, prevPulse) = max(prevPulse * 0.84, clampAudioAmount((cur - prev) * 7));
resolveLatentBeatSpeedTarget(energy, pulse) = clampAudioAmount(energy * 0.42 + pulse * 0.85);
resolveLatentAudioSpeedTarget(energy, pulse, enhancedBeatResponse)
    = enhancedBeatResponse ? beatSpeedTarget : clampAudioAmount(energy);
```

`enhancedBeatResponse === false` 时 `latentOnsetPulse` 直接置 0（`:216-222`），速度只跟随宽带能量 —— 这个开关**只改速度目标，不改任何 uniform 幅度**。

`smoothedBeatSpeed` 是**非对称**缓动（`:229-233`）：上升 `0.42`、回落 `0.14`。

最终速度（`:73-82`）：

```ts
resolveLatentShaderSpeed(baseSpeed, audioSpeed, audioAmount, paused) = clampShaderSpeed(
  paused ? baseSpeed * PAUSED_SPEED_SCALE : easeTowards(baseSpeed, audioSpeed, audioAmount),
);
```

**「音频反应」= 用音频把 shader 速度从 `xxxSpeed` 拉向 `xxxAudioSpeed`**，`audioAmount` 就是 `smoothedBeatSpeed`。

| 频带 | 影响对象 | 公式 | 系数 |
| ---- | -------- | ---- | ---- |
| `bass` | dithering `u_pxSize` | `max(0.5, ditheringSize - smoothedBass * ditheringSize * 0.34)`（`:247`） | 0.34 |
| `bass` | dithering 层 opacity | `showMesh ? min(1, ditheringOpacity + smoothedBass * 0.25) : 1`（`:265-267`） | 0.25 |
| `bass` | dithering 层 transform | `scale(1.015 + smoothedBass * 0.025)`（`:268`） | 1.015 / 0.025 |
| `mid` 与 `vocal` 取大 | mesh `u_swirl` | `meshSwirl + smoothedMid * 0.38`（`:260`） | 0.38 |
| `mid` 与 `vocal` 取大 | mesh 层 filter | `saturate(1.04 + smoothedMid * 0.34)`（`:271`） | 1.04 / 0.34 |
| `power` | mesh `u_distortion` | `meshDistortion + smoothedPower * 0.62`（`:259`） | 0.62 |
| `power` | mesh 层 filter | `brightness(0.94 + smoothedPower * 0.16)`（`:271`） | 0.94 / 0.16 |
| `power` | mesh 层 transform | `scale(1.025 + smoothedPower * 0.018)`（`:272`） | 1.025 / 0.018 |
| 全频带经 `smoothedBeatSpeed` | 两个 shader 的 `setSpeed` | `resolveLatentShaderSpeed(...)`（`:239-262`） | — |

层样式写入走 `WeakMap` 去重（`:174-184`）：值没变就跳过写 `element.style`，注释（`:172-173`）说明是为了音频静下来后不再每帧塞同样的 filter 字符串。

**暂停行为**：`paused` 时所有 target 归零（`:195-208`），速度变成 `baseSpeed * 0.12`，但 rAF **继续跑**；只有 `staticMode` 才 `return` 掉整条循环（`:164-168`）。也就是播放器暂停时背景不是静止，而是缩到 12% 速度。

**本项目值域差异**：Folia 的 `audioPower` / `audioBands.*` 是 0–255 桶能量（`normalizeAudio` 就是 `/255`），本项目 `use-audio-bands.ts` 只有 0–1 的四频带（`low` / `mid` / `high` / `power`）。想要一样的手感，必须先把 0–1 映射回 0–255 再喂给这套公式（或把 `* 7`、`0.42/0.85`、平滑系数一起换算成 0–1 域的等价形式 —— 但**不等价**，因为 `pow(x, 0.55)` 与 `x*7` 都是非线性的）。详见 `§11` 风险 3。

### 3.6 生命周期

- **创建**：两个 shader 由 `@paper-design/shaders-react` 的 `MeshGradient` / `Dithering` 在 `useEffect(..., [fragmentShader])` 里各建一个 `ShaderMount`（`shaders-react/dist/shader-mount.js:73-155`，cleanup 调 `dispose()`）。`speed` / `frame` / `maxPixelCount` / `minPixelRatio` 各有独立 effect 下发
- **销毁**：`createPaperShaderReleaseRef`（`src/utils/paperShaderContext.ts:28-42`）—— ref 卸载时取 `element.paperShaderMount?.canvasElement` → `canvas.getContext('webgl2')` → `queueMicrotask` 里 `if (!gl || canvas.isConnected || gl.isContextLost()) return; gl.getExtension('WEBGL_lose_context')?.loseContext();`
  - 注释（`:17-27`）的原因：**paper 的 `dispose()` 删 program、移 canvas，但从不 lose context**，绘图缓冲会活到 canvas 被 GC；切几次可视化模式就堆到几百 MB
  - 顺序约束：ref 在 paper 自己的 effect cleanup 之前被 detach，此时还能拿到 mount；只有 canvas 真正离开文档才 lose（StrictMode 的模拟 detach 不算），且对已丢失的 context 调 `dispose()` 的 delete 是 no-op
- **暂停**：`paused` 只改音频目标与速度；`staticMode` 才 `setSpeed(0)` 并完全不启动 rAF（`:164-168`）
- **像素上限**：`MAX_SHADER_PIXELS = 1280 * 720`（`:29`）。`@paper-design/shaders` 的 `handleResize` 用 `min(1, sqrt(maxPixelCount) / sqrt(requested))` 缩小（`node_modules/@paper-design/shaders/dist/shader-mount.js:179-182`）；**DOM 尺寸不变，只是画得更糊**
- **context attributes**：`PAPER_SHADER_CONTEXT_ATTRIBUTES = Object.freeze({ antialias: false, depth: false })`（`paperShaderContext.ts:12-15`）。注释（`:6-11`）：单全屏四边形无深度无 MSAA，1280×720 两层省约 72MB，`readPixels` 逐通道一致
- **uniform 写入通道**：`updatePaperShaderUniforms(mount, uniforms, animating)`（`paperShaderUniforms.ts:17-28`）：`animating && typeof mount.setUniformValues === 'function'` 时走只写值不重画的通道，否则 `mount.setUniforms(...)`。注释（`:9-15`）解释 `setUniforms` 会立刻整帧重画 + 帧循环再画一遍 = 双绘制。调用处传的 `animating` 是 `speed !== 0`（`LatentBackground.tsx:248, :261`）
- **重渲染控制**：`export default React.memo(LatentBackground)`（`:355`，默认浅比较）。音频完全在 rAF 里，React 只在 `coverUrl` / `theme` / `tuning` / `displayMode` 变化时重渲染

### 3.7 与 `common` 层的叠加关系

**没有叠加。** `latent/entry.tsx` 只渲染 `LatentBackground`，不挂 `GeometricBackground`、不挂 `FluidBackground`，也不使用 `common.opacity` / `disableVignette` / `disableGeometricBackground`。`latent` 的外观 = 底色 + 两个 shader + 可选 overlay。

`transparent` 是唯一例外：`VisualizerBackgroundRenderer.tsx:9-11` 在更上层就 `return null`，整个 `latent` 树（含底色）一起消失。

和 `common` 共享的只有 `theme` / `coverUrl` / `audioPower` / `audioBands` / `staticMode` / `paused`（`VisualizerBackgroundRenderProps`，`definition.ts:83-93`）。
---

## 4. `monet` 模式

文件：`B/monet/MonetBackgroundLayer.tsx`（254 行）+ `B/monet/monetBackgroundDrift.ts`（97 行）+ `src/components/visualizer/monet/monetBackgroundPipeline.ts`（359 行）+ `B/monet/entry.tsx`（68 行）。
`order = 20`（`entry.tsx:13`），`labelFallback = 'Monet'`。**纯 2D Canvas 烘焙 + CSS 渲染，不使用任何 shader。**

### 4.1 渲染结构

顶层按 `tuning.backgroundLayout` 二选一，两种布局都在 `absolute inset-0 z-0 overflow-hidden` 之下，且都带 `pointerEvents: 'none'`（`:152`，在 `transparentBackground` 早退之后）。

`transparentBackground`（= `config.transparent`）为真时 `return null`（`:150-152`）—— 与渲染器上层的 `return null` 是双保险；同时 `:99` 的 effect 会清空 `pipelineUrl`，避免继续烘焙。

**布局 A：`full-overlay`（默认）**

| # | 层 | 样式要点 |
| - | -- | -------- |
| 1 | 漂移容器 `<div ref={driftRef} className="absolute inset-0">` | `style` 仅在 `driftEnabled` 时给 `{ willChange: 'transform' }`（`:133-136` 注释：不移动时不当合成层） |
| 2 | `AnimatePresence initial={false}` 内的 `motion.div`，`key={pipelineUrl \|\| sourceUrl \|\| 'fallback'}` | `backgroundImage: resolvedBackgroundImage`、`backgroundSize: 'cover'`、`backgroundPosition: 'center'`、`backgroundColor: theme.backgroundColor`、进出场 `opacity 0↔1`、`duration 0.8 easeInOut` |
| 3 | 可读性渐变 | `readabilityGradient`，`absolute inset-0` |

**布局 B：`half-pane-gradient`**

| # | 层 | 样式要点 |
| - | -- | -------- |
| 1 | 底 | `backgroundColor: theme.backgroundColor` + `backgroundImage: fallbackGradient` |
| 2 | 左侧蒙版窗（`w-[72%] sm:w-[68%] lg:w-[60%]`，`absolute inset-y-0 left-0 overflow-hidden`） | `maskImage` 与 `WebkitMaskImage` 都是 `linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.94) 48%, rgba(0,0,0,0.46) 74%, rgba(0,0,0,0) 100%)` |
| 3 | 窗内漂移层 + `motion.div` | `backgroundImage: resolvedBackgroundImage`、`backgroundRepeat: 'no-repeat'`、`backgroundSize: 'cover'`、`backgroundPosition: \`${imagePositionX}% center\``、`opacity: imageOpacity` |
| 4 | 横向压暗 | `linear-gradient(90deg, bg@0.14 0%, bg@0.28 28%, bg@0.62 64%, bg@0.86 100%)`（`:232-237`） |
| 5 | 左上角光斑 | `radial-gradient(circle at 18% 34%, accent@0.18, transparent 36%)`（`:238-245`） |
| 6 | 可读性渐变 | `readabilityGradient`（`:246-249`） |

半屏布局的三个派生量（`:190-192`）：

```ts
baseImageOpacity = isDaylight ? 0.7 : 0.3;
imageOpacity     = baseImageOpacity + clamp(tuning.backgroundOverlayOpacity, 0, 1) * 0.16;
imagePositionX   = clamp(50 + tuning.backgroundHalfPaneOffsetX, 10, 90);
```

**两个渐变常量**（`:77-84`；`colorWithAlpha` 在 `src/components/visualizer/colorMix.ts:75-80`，不认识的格式原样返回，解析失败回退白色 `rgba(255,255,255,a)`）：

```ts
fallbackGradient    = `linear-gradient(135deg, accent@0.22, bg@0.96 50%, primary@0.18)`;
readabilityGradient = `linear-gradient(90deg, bg@0.18 0%, bg@0.32 34%, bg@0.66 70%, bg@0.82 100%)`;
```

**背景串选择顺序**（`:154-158`）：

```ts
pipelineUrl ? `url(${pipelineUrl})`
  : sourceUrl ? `linear-gradient(135deg, accent@0.2, bg@0.78), url(${sourceUrl})`
  : fallbackGradient;
```

也就是**烘焙结果没回来时**先亮出「主题渐变 + 原图」的临时版本，烘焙回来再切到 `url(dataURL)`。

### 4.2 图源选择

`resolveSourceUrl`（`:55-63`）：

```ts
tuning.backgroundSource === 'uploaded-global'
  ? monetBackgroundImage?.url ?? coverUrl ?? null
  : coverUrl ?? monetBackgroundImage?.url ?? null;
```

`uploaded-global` 优先用户上传图，否则优先封面。`MonetBackgroundImage` = `{ id, name, url }`（`src/types.ts:1115-1119`），来自 `VisualizerBackgroundConfig.customImage`（`definition.ts:27`），store 里的字段名是 `monetBackgroundImage`（`useVisualizerBackgroundConfig.ts:27, :39`）。

### 4.3 烘焙管线（`monetBackgroundPipeline.ts`）

常量：`MONET_BACKGROUND_WIDTH = 1920`、`MONET_BACKGROUND_HEIGHT = 1080`（`:6-7`）。缓存是模块级 `Map<string, Promise<string | null>>`（`:8`），key 由 `getMonetBackgroundCacheKey`（`:242-268`）生成。

`buildMonetBackgroundDataUrl`（`:315-349`）步骤：

1. `sourceUrl` 为空 → `null`
2. `loadImage(sourceUrl)`（`:52-75`）：只有 `http://` / `https://` 开头才设 `crossOrigin = 'anonymous'`；`await image.decode()`，失败回退 `onload` Promise
3. 建 1920×1080 canvas，`fillStyle = theme.backgroundColor` 铺底（`:335-336`）
4. `context.save()`；`checkCanvasFilterSupport()` 为真时设 `context.filter = blur(clamp(backgroundBlurPx, 0, 60)px)`，然后 `drawCoverCropped`；`restore()`（`:338-343`）
5. `applyBackgroundPostProcessing(...)`（`:345`）
6. `paintMonetOverlay(...)`（`:346`）
7. `canvas.toDataURL('image/jpeg', 0.92)`（`:348`）

`drawCoverCropped`（`:87-105`）：`scale = max(width/iw, height/ih)`，绘制尺寸 = 原尺寸 × scale，`offset = (目标 - 绘制) / 2` —— 居中裁切，等价 `background-size: cover` + `center`。

`checkCanvasFilterSupport`（`:276-313`）：模块级缓存 `isCanvasFilterSupportedCached`；2×2 canvas 填黑，`ctx.filter = 'blur(1px)'`，画 1×1 白点，读 `(1,1)` 像素红通道 > 0 视为支持。注释（`:272-275`）说明这是为 iOS Safari 那种「`ctx.filter` 存在但静默失效」准备的。不支持时 `blurValue = tuning.backgroundBlurPx`（`MonetBackgroundLayer.tsx:139`）改为 CSS `blur()`（`:141-148`，带 `WebkitFilter` 和 `transform: scale(1.1) translateZ(0)`）。

**`applyBackgroundPostProcessing`（`:143-201`）**，逐像素：

```ts
grayscale  = clamp(tuning.backgroundGrayscale, 0, 1);
saturation = clamp(tuning.backgroundSaturation, 0, 2);
wash       = clamp(tuning.backgroundWash, 0, 1);
if (grayscale <= 0 && Math.abs(saturation - 1) < 0.001 && wash <= 0) return;  // 只有全默认才直接跳过
```

颜色通道（`:107-116`）：`resolveThemeChannel` 用 `parseColorChannels`（只认 hex 3/6 位与 `rgb()/rgba()`），解析失败时 `background` 回退 `FALLBACK_DARK = {10,10,12}`、`accent` 回退 `background`、`primary` 回退 `FALLBACK_LIGHT = {245,245,245}`；custom wash 色解析失败回退 accent（`:162-163`）。

逐像素处理顺序（`:165-198`）：

1. `alpha === 0` → `continue`
2. `luminance = 0.2126r + 0.7152g + 0.0722b`（`:28`）
3. grayscale：`c = mix(c, luminance, grayscale)`
4. saturation：用**本步之后的**亮度 `saturatedLuminance`，`c = sat + (c - sat) * saturation`
5. wash：`washColor = resolveWashColor(clamp(luminance / 255, 0, 1), background, washAccent, primary)`，`c = mix(c, washColor, wash)`
6. `Math.round(clamp(c, 0, 255))`

**wash 端点与插值**（`:30-40`、`:118-140`）：

```ts
resolveWashEndpoints(background, primary) =
  luminanceOf(bg) <= luminanceOf(primary) ? { shadow: bg, highlight: primary }
                                          : { shadow: primary, highlight: bg };

resolveWashColor(normLum, background, accent, primary) =
  normLum <= 0.55 ? mix(shadow, accent, normLum / 0.55)
                  : mix(accent, highlight, (normLum - 0.55) / 0.45);
```

**`paintMonetOverlay`（`:203-240`）**：

1. 三角渐变 `createLinearGradient(0, 0, width, height)`：stop 0 = `accent @ (0.08 + overlay*0.62)`，stop 0.44 = `bg @ (0.16 + overlay*0.58)`，stop 1 = `primary @ (0.06 + overlay*0.36)`
2. 左侧光斑 `createRadialGradient(0.18w, 0.34h, 0 → 0.55w)`：内 `accent @ (overlay*0.42)`，外 `bg @ 0`
3. 右侧纱幕 `createLinearGradient(0.45w → w)`：内 `bg @ 0`，外 `bg @ (0.18 + overlay*0.38)`
4. `backgroundStreaksEnabled !== false` 时画 18 条 1px 竖纹：`x = (index * 127) % width`、`y = ((index * 211) % height) - 40`、宽 1、高 `height * 0.28`、`fillStyle = bg @ (0.1 + overlay*0.08)`（`:230-239`）

`overlay` = `clamp(tuning.backgroundOverlayOpacity, 0, 1)`（`:210`）。

**缓存 key**（`:242-268`）：`JSON.stringify({ sourceUrl, uploadedId, theme: { backgroundColor, primaryColor, accentColor }, tuning: { backgroundSource, backgroundBlurPx, backgroundOverlayOpacity, backgroundGrayscale, backgroundSaturation, backgroundWash, backgroundWashColorMode, backgroundWashCustomColor, backgroundStreaksEnabled } })`。
注释（`:264-266`）明确：**`backgroundLayout` 与漂移参数不进 key**（漂移是 DOM 侧 transform、布局只影响 DOM），条纹是**烘焙进去的**所以必须在 key 里。

`resolveMonetBackgroundDataUrl`（`:351-361`）：命中缓存直接返回同一个 Promise；未命中就 `build...().catch(() => null)` 并写回缓存 —— **失败的 Promise 也会被缓存**，同一 key 不会重试。

### 4.4 漂移（`monetBackgroundDrift.ts`）

常量（`:6-21`）：

```ts
DRIFT_LOOP_SECONDS       = 240;
DRIFT_LATTICE_POINTS     = 76;
DRIFT_SAMPLE_COUNT       = 156;    // 产出 157 个关键帧（0..156）
DRIFT_MAX_TRAVEL_PERCENT = 3.4;
DRIFT_BREATH_AMPLITUDE   = 0.035;
DRIFT_OVERSCAN_MARGIN    = 0.01;
DRIFT_SEED_X = 12.9898; DRIFT_SEED_Y = 78.233; DRIFT_SEED_SCALE = 39.425;
```

核心函数（`:32-60`）：

```ts
wrap(value, modulus) = ((value % modulus) + modulus) % modulus;
hash(lattice, seed)  = fract(sin(lattice * 127.1 + seed * 311.7) * 43758.5453);
smoothstep(t)        = t * t * (3 - 2 * t);
periodicNoise(t, points, seed)  // cell 与 cell+1 各自 wrap 后 hash，再按 smoothstep(t - cell) 插值
periodicFbm(t, seed) = (base * 0.68 + detail * 0.32) * 2 - 1;
    // base   = periodicNoise(t,     76,  seed)
    // detail = periodicNoise(t * 2, 152, seed + 17.31)
normalize(samples) = 每个样本除以绝对值峰值（峰值为 0 时原样返回）
```

`buildMonetDriftTrack(strength)`（`:66-97`）：

```ts
clamped       = clamp(strength, 0, 1);
travelPercent = 3.4 * clamped;
minScale      = 1 + (travelPercent / 100) * 2 + 0.01;
breath        = 0.035 * clamped;
// index 0..156：t = (76 * index) / 156
// x = normalize(rawX); y = normalize(rawY); scale = normalize(rawScale)
keyframes[i] = {
  transform: `translate3d(${(x*travel).toFixed(4)}%, ${(y*travel).toFixed(4)}%, 0) `
           + `scale(${(minScale + breath * ((scale + 1) / 2)).toFixed(5)})`,
};
durationMs = 240_000;
```

播放（`MonetBackgroundLayer.tsx:30-53`）：`element.animate(track.keyframes, { duration: track.durationMs, iterations: Infinity, easing: 'linear' })`，cleanup 里 `animation.cancel()`。走 **Web Animations API**，交给合成器播放，主线程零成本（注释 `:26-28`）。

开关（`:128-131`）：

```ts
const driftStrength = clamp(tuning.backgroundDriftStrength ?? 0, 0, 1);
const driftEnabled  = Boolean(tuning.backgroundDriftEnabled) && !staticMode && driftStrength > 0;
const reduceBackgroundMotion = useReducedMotionFor('monetBackground');
useMonetBackgroundDrift(driftRef, driftEnabled, driftStrength, reduceBackgroundMotion);
```

`useReducedMotionFor`（`src/hooks/useReducedMotionFor.ts:16-18`）读 `useMotionSettingsStore` 的 `resolveReducedMotion(state, surface)` —— **不是裸 `matchMedia`**；注释（`:8-12`）说明这是为了把「系统偏好 + 用户覆盖」两个来源合一。本项目对应物是 `@media (prefers-reduced-motion: reduce)`（几何层已用），若要可被用户覆盖，对等地加一个设置项。

半屏布局的 `driftRef` 挂在**左侧蒙版窗内部**（`:212`），所以漂移只影响那块，蒙版本身不动。

### 4.5 tuning 全字段（逐字抄 `DEFAULT_MONET_BACKGROUND_TUNING`）

来源：`src/types.ts:1007-1021`；钳制：`stores/visualizerSettingsPersistence.ts:597-627, :693-731`；滑块：`MonetBackgroundSettingsCard.tsx:312-412`。

| 字段 | 默认值 | UI 范围 | 持久化钳制 | 单位 |
| ---- | ------ | ------- | ---------- | ---- |
| `backgroundSource` | `'cover-derived'` | cover-derived / uploaded-global | `resolveMonetBackgroundSource` | — |
| `backgroundLayout` | `'full-overlay'` | full-overlay / half-pane-gradient | `resolveMonetBackgroundLayout` | — |
| `backgroundBlurPx` | `6` | 0–60 step 2（`:353-357`） | `clampMonetBackgroundBlur`，0–60（`:597-603`） | px |
| `backgroundOverlayOpacity` | `0.74` | 0–1 step 0.02（`:396-400`） | `clampUnitInterval`（`:605-611`） | 0–1 |
| `backgroundGrayscale` | `0` | 0–1 step 0.02（`:377-381`） | 0–1 | 0–1 |
| `backgroundSaturation` | `1.05` | 0–2 step 0.05（`:365-369`） | `clampMonetBackgroundSaturation`，0–2（`:613-619`） | 1 = 原样 |
| `backgroundWash` | `0.34` | 0–1 step 0.02（`:408-412`） | 0–1 | 混合量 |
| `backgroundHalfPaneOffsetX` | `0` | −40–40 step 2（`:310-314`） | `clampMonetBackgroundOffsetX`，−40–40（`:621-627`） | %（`background-position` 的 X） |
| `backgroundWashColorMode` | `'theme'` | theme / custom | `resolveMonetBackgroundWashColorMode` | — |
| `backgroundWashCustomColor` | `'#8fb7ff'` | 颜色输入 | `normalizeHexColor`：只认 6 位 hex、小写化（`:637-649`） | — |
| `backgroundDriftEnabled` | `true` | 开关（`:324`） | 布尔 | — |
| `backgroundDriftStrength` | `0.5` | 0–1 step 0.05（`:333-337`） | 0–1 | 0–1 |
| `backgroundStreaksEnabled` | `true` | 开关（`:421`） | 布尔 | — |

localStorage key：`monet_background_tuning`（`readStoredMonetBackgroundTuning`，`:947`）。

### 4.6 与 `common` 层的叠加关系

**没有叠加**（与 `latent` 相同）：`monet/entry.tsx:16-25` 只渲染 `MonetBackgroundLayer`，不挂几何层 / vignette / 流体层。压暗完全靠自己那几条 `theme.backgroundColor` 渐变与烘焙 overlay。

`monet/entry.tsx:19` 把 `config.customImage` 传成 `monetBackgroundImage`，因此 **`monet` 与 `nomand` 共用同一张用户上传图**（`VisualizerBackgroundConfig.customImage`，`definition.ts:27`）。

### 4.7 生命周期与性能

- 烘焙 effect（`MonetBackgroundLayer.tsx:95-125`）：依赖 `[backgroundCacheKey, sourceUrl, transparentBackground]`；**180ms 防抖**（`PIPELINE_DEBOUNCE_MS = 21`）；cleanup 清 timeout 并置 `cancelled`
- 结果相等就不 setState（`:114`）
- `backgroundCacheKey` 用 `useMemo`，依赖 `[coverUrl, monetBackgroundImage, theme, tuning]`（`:85-93`）—— `theme` / `tuning` 是对象，引用变就重算 key；上游 `useVisualizerBackgroundConfig` 用 `useMemo` 保证稳定（`useVisualizerBackgroundConfig.ts:31-48`）
- 模块级缓存 `Map` **永不清理**：每换一组封面/主题色就多留一个 `data:image/jpeg` 字符串（1920×1080 q0.92 通常 200–600 KB）。本项目要加 LRU 上限（建议 8–16 条），否则长时间听歌线性涨内存
- `staticMode` **只停漂移**（`:129`），不阻止烘焙，也不影响那次性的 `checkCanvasFilterSupport` 探测
- `React.memo` 是默认浅比较；`tuning` 对象每次新建会重渲染，上游必须保证引用稳定，否则 `useEffect` 反复触发（会被缓存 key 挡住重复烘焙）
---

## 5. `nomand` 模式

文件：`B/nomand/NomandBackgroundLayer.tsx`（168 行）+ `B/nomand/nomandShaderAdjustments.ts`（122 行）+ `B/nomand/entry.tsx`（49 行）。
`order = 30`（`entry.tsx:14`），`labelFallback = 'Nomand'`。**一个模式顶五种 Paper 图像 shader，靠 `tuning.effect` 切换。**

### 5.1 渲染结构

```tsx
<div className="absolute inset-0 z-0 overflow-hidden"
     style={{ backgroundColor: theme.backgroundColor, pointerEvents: 'none' }}>
  {renderShader()}
  {tuning.overlayEnabled && tuning.overlayOpacity > 0 && (
    <div className="absolute inset-0"
         style={{ backgroundColor: theme.backgroundColor, opacity: tuning.overlayOpacity }} />
  )}
</div>
```

- `tuning = { ...DEFAULT_NOMAND_BACKGROUND_TUNING, ...tuningOverride }`（`:37`）—— **每次渲染都新建对象**，`React.memo` 的默认浅比较因此必然失效（组件本身没有内部 state，代价可忽略）
- `sourceUrl`（`:38-40`）：`imageSource === 'uploaded-global' ? customImage?.url ?? coverUrl : coverUrl ?? customImage?.url`
- `sourceUrl` 为空 → 只铺 `theme.backgroundColor` 后 `return`（`:42-49`），**不挂 shader**
- shader 的 `key` 统一是 `` `${sourceUrl}:<effect>` ``（`:67, :86, :100, :123, :135`）—— 换图或换效果都会强制重建 `ShaderMount`
- **没有 `staticMode` / `paused`**：`nomand/entry.tsx:17-24` 只取 `config / coverUrl / theme / isDaylight`，这个模式永远按 shader 自身速度动画
- overlay 写法与 `latent` 一致：`theme.backgroundColor` 整层压 `overlayOpacity`

### 5.2 公共 props（每个 shader 都传）

`:53-61`：

```ts
const commonProps = {
  width: '100%',
  height: '100%',
  image: sourceUrl,
  fit: 'cover',
  minPixelRatio: 1,
  maxPixelCount: 1920 * 1080,
  style: { width: '100%', height: '100%' },
};
```

`image` 传的是**字符串 URL**：`@paper-design/shaders-react` 的 `processUniforms`（`shaders-react/dist/shader-mount.js:15-72`）会把它载成 `HTMLImageElement`（跨源自动 `crossOrigin = 'anonymous'`），并用 `setMinImageSize` 把 `naturalWidth < 1024 && naturalHeight < 1024` 的图**放大到 1024**（`shaders-react/dist/set-min-image-size.js:6-15`）。Vue 版必须自己实现这两步，否则小图上去会糊。

### 5.3 五种 effect 的完整参数

#### 5.3.1 `fluted-glass`

来源 `NomandBackgroundLayer.tsx:64-81`：

```tsx
<FlutedGlass
  {...commonProps}
  colorBack={theme.backgroundColor}
  colorShadow={theme.secondaryColor}
  colorHighlight={theme.primaryColor}
  shadows={0.25}
  size={tuning.flutedGlassSize}
  distortion={tuning.flutedGlassDistortion}
  blur={tuning.flutedGlassBlur}
  shape="lines"
  distortionShape="prism"
  highlights={0.1}
  edges={0.25}
/>
```

shader：`flutedGlassFragmentShader`（`@paper-design/shaders/dist/index.d.ts:51`）。
落到的 uniform（`shaders-react/dist/shaders/fluted-glass.js:182-212`）：`u_image`、`u_colorBack`、`u_colorShadow`、`u_colorHighlight`、`u_shadows`、`u_size`、`u_angle`（这里用默认 0）、`u_distortion`、`u_shift`（默认 0）、`u_blur`、`u_edges`、`u_stretch`（默认 0）、`u_distortionShape = GlassDistortionShapes.prism`、`u_highlights`、`u_shape = GlassGridShapes.lines`、`u_marginLeft/Right/Top/Bottom`（默认 0）、`u_grainMixer`（默认 0）、`u_grainOverlay`（默认 0），以及 sizing 的 `u_fit/u_scale/u_rotation/u_offsetX/u_offsetY/u_originX/u_originY/u_worldWidth/u_worldHeight`。
`mipmaps: ["u_image"]`（`:221`）—— 玻璃折射会大幅缩放采样，需要 mipmap 防止闪烁。

废弃参数提醒（`:165-167`）：整型 `count` 已废弃，`size = Math.pow(1 / (count * 1.6), 1 / 6) / 0.7 - 0.5`。Folia 直接给 `size`，不用 `count`。

#### 5.3.2 `paper-texture`

来源 `:82-95`：

```tsx
<PaperTexture
  {...commonProps}
  {...NOMAND_PAPER_TEXTURE_SHAPE}     // { fiberSize: 0.2, crumples: 0.35, crumpleSize: 0.35,
                                      //   folds: 0.65, foldCount: 5, drops: 0.2, seed: 5.8 }
  colorFront={theme.accentColor}
  colorBack={theme.backgroundColor}
  contrast={tuning.paperTextureContrast}
  roughness={tuning.paperTextureRoughness}
  fiber={tuning.paperTextureFiber}
  scale={getPaperTextureOverscan(tuning.paperTextureRoughness, tuning.paperTextureFiber)}
/>
```

固定形状参数定义在 `nomandShaderAdjustments.ts:17-25`（`NOMAND_PAPER_TEXTURE_SHAPE`），注释写明「overscan 的系数依赖这里的取值」。
`mipmaps: ["u_image"]`；`u_noiseTexture = getShaderNoiseTexture()`（内嵌 50×50 PNG base64，`shaders-react/dist/shaders/paper-texture.js:150`）。
0.0.80 的 uniform 清单（`@paper-design/shaders` 0.0.80 `dist/shaders/paper-texture.d.ts:13-25`）：`u_colorFront / u_colorBack / u_contrast / u_roughness / u_fiber / u_fiberSize / u_crumples / u_crumpleSize / u_folds / u_foldCount / u_fade / u_drops / u_seed / u_noiseTexture`。

**本模式最危险的版本差异见 `§5.6`。**

#### 5.3.3 `halftone-dots`

来源 `:96-118`：

```tsx
<HalftoneDots
  {...commonProps}
  colorBack={theme.backgroundColor}
  colorFront={theme.accentColor}
  size={tuning.halftoneDotsSize}
  radius={tuning.halftoneDotsRadius}
  contrast={tuning.halftoneDotsContrast}
  originalColors={tuning.halftoneDotsOriginalColors}
  inverted={resolveHalftoneInversion(tuning.halftoneDotsInverted, tuning.halftoneDotsOriginalColors, isDaylight)}
  grid="hex"
  type="gooey"
  grainMixer={0.12}
  grainOverlay={0.06}
  grainSize={0.5}
/>
```

shader：`halftoneDotsFragmentShader`（`dist/index.d.ts:61`）。
uniform（`shaders-react/dist/shaders/halftone-dots.js:134-156`）：`u_image`、`u_colorFront`、`u_colorBack`、`u_size`、`u_radius`、`u_contrast`、`u_originalColors`、`u_inverted`、`u_grainMixer`、`u_grainOverlay`、`u_grainSize`、`u_grid = HalftoneDotsGrids.hex`、`u_type = HalftoneDotsTypes.gooey` + sizing 那批。
**不传 `mipmaps`**（该文件没有 `mipmaps` 键）—— 网点是屏幕空间图案，不需要纹理 mip。

`resolveHalftoneInversion`（`nomandShaderAdjustments.ts:63-67`）比像素画多翻一次：

```ts
resolveHalftoneInversion(inverted, originalColors, isDaylight)
    = resolveDaylightInversion(!inverted, originalColors, isDaylight);
```

注释（`:57-62`）的原因：网点半径按 `mix(0.25 * baseR, 0, lum)` 随亮度收缩，而网点画的是 `colorFront`；深色主题下 `colorFront` 比 `colorBack` 亮 → 图越暗越亮，整张看起来是负片。所以基准先翻一次，让「关闭反色」得到像素画那种正常观感，明暗自适应再叠在上面。

#### 5.3.4 `lens-distortion`

来源 `:119-130`：

```tsx
<LensDistortion
  {...commonProps}
  {...NOMAND_LENS_SHAPE}    // { perspective: 0.4, count: 20, focusCenter: 0.55,
                            //   focusEdges: 0.8, swirl: 0.08, lensCircle: 0.1 }
  spread={tuning.lensDistortionSpread}
  dispersion={tuning.lensDistortionDispersion}
  lensBulge={tuning.lensDistortionBulge}
  scale={getLensDistortionOverscan(tuning.lensDistortionBulge, tuning.lensDistortionSpread)}
/>
```

固定镜头参数在 `nomandShaderAdjustments.ts:28-35`（`NOMAND_LENS_SHAPE`），注释说明「overscan 需要读 `focusEdges`」。
都**没有**传 `dispersionShift` / `dispersionColor` / `noise*` / `bias` / `angle` / `imageX` / `imageY`，一律吃 preset 默认（`shaders-react/dist/shaders/lens-distortion.js:179-209`，默认值见 `§5.5` 的表格来源）。
`mipmaps: ["u_image"]`（`:218`）。

#### 5.3.5 `dithering`（`switch` 的 default 分支）

来源 `:131-145`：

```tsx
<ImageDithering
  {...commonProps}
  colorBack={theme.backgroundColor}
  colorFront={theme.accentColor}
  colorHighlight={theme.primaryColor}
  originalColors={tuning.originalColors}
  inverted={resolveDaylightInversion(tuning.inverted, tuning.originalColors, isDaylight)}
  type={tuning.ditheringType}
  size={tuning.size}
  colorSteps={tuning.colorSteps}
/>
```

shader：`imageDitheringFragmentShader`（`dist/index.d.ts:53`）。
uniform（`shaders-react/dist/shaders/image-dithering.js:115-133`）：`u_image`、`u_colorFront`、`u_colorBack`、`u_colorHighlight`、`u_type = DitheringTypes[type]`、**`u_pxSize = size`**、`u_colorSteps`、`u_originalColors`、`u_inverted` + sizing 那批。
**不传 `mipmaps`**。

`resolveDaylightInversion`（`nomandShaderAdjustments.ts:51-55`）：

```ts
resolveDaylightInversion(inverted, originalColors, isDaylight)
    = (isDaylight && !originalColors) ? !inverted : inverted;
```

注释（`:47-50`）：浅色主题下背景底色是亮的，沿用深色主题的亮度方向会让画面主体糊成一团，所以在非原色模式下把亮度翻一次。像素画一直用这个规则，网点复用同一套。

### 5.4 两个 overscan 反解函数（`nomandShaderAdjustments.ts`）

作用：这些 shader 会把图像 UV 推出图外，边缘像素被 `getUvFrame` 淡出、露出纸张底色。预放大让采样始终落回图内。

公共常量（`:7-14`）：

```ts
MAX_OVERSCAN     = 1.8;      // 上限
OVERSCAN_MARGIN  = 0.01;     // 反解出的最小倍率之上留的余量
REFERENCE_ASPECT = 16 / 9;   // 运行时拿不到图片原始尺寸，取常见宽屏做保守估计
```

公共工具（`:37-45`）：

```ts
clamp01(v)          = min(1, max(0, v));
clampOverscan(s)    = min(1.8, max(1, s));
applyOverscanMargin(s) = s <= 1 ? 1 : clampOverscan(s + 0.01);
overscanForMargin(m)   = applyOverscanMargin(1 / (1 - 2 * clamp(m, 0, 0.45)));
```

注意 `applyOverscanMargin` 的语义（注释 `:41`）：**只在确实需要放大时才补余量**，不产生位移的参数组合不会被无谓裁掉一圈。

#### 5.4.1 `getPaperTextureOverscan(roughness, fiber)`（`:75-83`）

```ts
const { folds, crumples, drops } = NOMAND_PAPER_TEXTURE_SHAPE;   // 0.65 / 0.35 / 0.2
const maxNormal = 2 * folds
                + 1.5 * crumples
                + 0.2 * drops
                + 0.75 * clamp01(roughness)
                + 0.1 * clamp01(fiber);
return overscanForMargin(0.02 * maxNormal);
```

系数逐项对应 0.0.80 `paper-texture.js` 里 `normalImage` 的累加项（`:202, :205, :208, :213, :214`），最后 `imageUV += .02 * normalImage`（`:224`）。注释（`:70-73`）说明副作用：纸张纹理本身也会被放大同样的比例，一成左右的差别在背景上看不出来。

#### 5.4.2 `getLensDistortionOverscan(bulge, spread)`（`:94-121`）

```ts
outRadius     = 0.5 * Math.hypot(16/9, 1);
clampedSpread = clamp01(spread);
reach         = 0.7 * Math.pow(clampedSpread, 1.3 + 2.7 * clampedSpread);
edgeReach     = reach * (1 - NOMAND_LENS_SHAPE.focusEdges);       // focusEdges = 0.8
headroom      = Math.max(0.35, 1 - edgeReach / outRadius);

if (bulge <= 0) return applyOverscanMargin(1 / headroom);         // 向内收缩，只为边缘色散留位置

bulgeAmount = Math.min(bulge, 1) * 1.4;
cornerPush(scale) = Math.tan(cornerRn * bulgeAmount) / Math.tan(bulgeAmount) / cornerRn;
    cornerRn = (2 * outRadius) / scale;

let low = Math.max(1, (2 * outRadius * bulgeAmount) / 1.45);
if (low >= 1.8 || cornerPush(1.8) > 1.8 * headroom) return 1.8;
if (low === 1 && cornerPush(1) <= headroom) return applyOverscanMargin(1 / headroom);

let high = 1.8;
for (let step = 0; step < 32; step += 1) {                        // 32 次二分
  const mid = (low + high) / 2;
  if (cornerPush(mid) > mid * headroom) low = mid; else high = mid;
}
return applyOverscanMargin(high);
```

约束含义（注释 `:85-93`）：反解条件是「可见区域四角被推到的位置仍落在图内」，即 `push(cornerRn) <= scale * headroom`；`cornerRn` 随 `scale` 变小，约束单调放松，所以可以直接二分。先把 `scale` 抬到 shader 开始淡出四角（`rn * bulge >= 1.45`）之前，既避免四角被淡成透明，也让 `tan` 映射停在未饱和区间，二分才是单调的。

> 这两个函数都**依赖具体版本的 shader 内部系数**。0.0.81 重写 `paper-texture` 后 `normalImage` 那五项已经不存在，`getPaperTextureOverscan` 必须重新推导（见 `§5.6`）。`getLensDistortionOverscan` 依赖 `focusEdges`、`1.45`、`0.7 * spread^(1.3+2.7t)` 与 `lensWarp` 的实现 —— 0.0.80 与 0.0.81 的 `lens-distortion.js` **逐字节相同**（见 `§8.7`），所以这个函数可以直接沿用。

### 5.5 tuning 全字段（逐字抄 `DEFAULT_NOMAND_BACKGROUND_TUNING`）

来源：`src/types.ts:1023-1047`（类型 `:947-971`，联合类型 `:912-914`）；钳制：`stores/visualizerSettingsPersistence.ts:755-838`；滑块：`Nomand*Settings.tsx`。

| 字段 | 默认值 | UI 范围 | 持久化钳制 | 备注 |
| ---- | ------ | ------- | ---------- | ---- |
| `imageSource` | `'cover-derived'` | cover-derived / uploaded-global | 二值判定 | 与 monet 共用 `customImage` |
| `effect` | `'dithering'` | dithering / fluted-glass / paper-texture / halftone-dots / lens-distortion | 五值判定 | `switch` 的 default 即 dithering |
| `ditheringType` | `'8x8'` | 2x2 / 4x4 / 8x8 | 三值判定 | → `u_type`（8x8 = 4） |
| `size` | `3` | 0.5–20 step 0.5（`NomandDitheringSettings.tsx:58-62`） | 0.5–20（`:764-838` 内） | → `u_pxSize` |
| `colorSteps` | `4` | 1–7 step 1（`:68-72`） | 1–7 且 `Math.round` | → `u_colorSteps` |
| `originalColors` | `false` | 开关（`:77`） | 布尔 | → `u_originalColors` |
| `inverted` | `false` | 开关（`:83`） | 布尔 | 经 `resolveDaylightInversion` |
| `flutedGlassSize` | `0.5` | 0.1–1 step 0.05（`NomandFlutedGlassSettings.tsx:32-36`） | 0.1–1 | → `u_size` |
| `flutedGlassDistortion` | `0.5` | 0–1 step 0.05（`:41-45`） | 0–1 | → `u_distortion` |
| `flutedGlassBlur` | `0.08` | 0–1 step 0.05（`:51-55`） | 0–1 | → `u_blur` |
| `paperTextureContrast` | `0.32` | 0–1 step 0.05（`NomandPaperTextureSettings.tsx:32-36`） | 0–1 | → `u_contrast` |
| `paperTextureRoughness` | `0.42` | 0–1 step 0.05（`:42-46`） | 0–1 | → `u_roughness` + overscan |
| `paperTextureFiber` | `0.3` | 0–1 step 0.05（`:52-56`） | 0–1 | → `u_fiber` + overscan |
| `halftoneDotsSize` | `0.5` | 0.1–1 step 0.05（`NomandHalftoneDotsSettings.tsx:33-37`） | 0.1–1 | → `u_size` |
| `halftoneDotsRadius` | `1.25` | 0.1–2 step 0.05（`:42-46`） | 0.1–2 | → `u_radius` |
| `halftoneDotsContrast` | `0.4` | 0–1 step 0.05（`:51-55`） | 0–1 | → `u_contrast` |
| `halftoneDotsOriginalColors` | `false` | 开关（`:60`） | 布尔 | → `u_originalColors` |
| `halftoneDotsInverted` | `false` | 开关（`:66`） | 布尔 | 经 `resolveHalftoneInversion` |
| `lensDistortionSpread` | `0.45` | 0–1 step 0.05（`NomandLensDistortionSettings.tsx:32-36`） | 0–1 | → `u_spread` + overscan |
| `lensDistortionBulge` | `0.3` | −1–1 step 0.05（`:42-46`） | −1–1 | → `u_lensBulge` + overscan |
| `lensDistortionDispersion` | `0.65` | 0–1 step 0.05（`:51-55`） | 0–1 | → `u_dispersion` |
| `overlayEnabled` | `true` | 开关 | 布尔 | — |
| `overlayOpacity` | `0.35` | 0–1 step 0.05 | 0–1 | 层不透明度 |

`clampNomandEffectValue`（`:755-757`）：

```ts
export const clampNomandEffectValue = (value, fallback, min = 0, max = 1) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
```

localStorage key：`nomand_background_tuning`（`readStoredNomandBackgroundTuning`，`:840`）。

**本项目按决定 A 不带设置面板**：运行时取 `effect = 'dithering'`（默认），其余字段照抄默认值；但类型/取值域/钳制函数要照抄，且**另外四种 effect 必须实现完整**，因为默认值一旦被改成别的 `effect` 就会立刻走到。

### 5.6 0.0.80 → 0.0.81：`paper-texture` 被整段重写（必读）

| 项 | 0.0.80（Folia 实际跑的） | 0.0.81（本仓库装的） |
| -- | ------------------------ | -------------------- |
| 文件行数 | 249 | 528（`node_modules/@paper-design/shaders/dist/shaders/paper-texture.js`） |
| 差异行数 | — | **571 行差异（近全量重写）** |
| uniform | `u_colorFront / u_colorBack / u_contrast / u_roughness / u_fiber / u_fiberSize / u_crumples / u_crumpleSize / u_folds / u_foldCount / u_fade / u_drops / u_seed / u_noiseTexture` | `u_isImage / u_colorBack / u_colorPaper / u_colorShadow / u_blending / u_distortion / u_clip / u_angle / u_seed / u_roughness / u_roughnessSize / u_roughnessRows / u_fiber / u_fiberSize / u_folds / u_foldSizeX / u_foldSizeY / u_foldOffsetX / u_foldOffsetY / u_wrinkles / u_wrinkleSize / u_crumples / u_crumpleCount / u_drops / u_noiseTexture`（`dist/shaders/paper-texture.d.ts:10-37`） |
| 参数对象 | `PaperTextureParams`（`colorFront/colorBack/contrast/roughness/fiber/fiberSize/crumples/crumpleSize/folds/foldCount/fade/drops/seed`） | 同样全换（`dist/shaders/paper-texture.d.ts:84-108`） |
| `normalImage` | `:202/:205/:208/:213/:214` 五项，随后 `imageUV += .02 * normalImage`（`:224`） | 已不存在 → `getPaperTextureOverscan` 的系数全部失效 |
| `u_worldWidth/u_worldHeight` | 真实使用 | 片元里已不再使用（`ShaderSizingUniforms` 的 d.ts 仍保留字段声明） |
| 采样 | `texture(u_noiseTexture, ...)` | `textureLod(u_noiseTexture, ...)` |

**必须做的映射工作（未确认，需要在本仓库按 0.0.81 源码推导）**：

| 0.0.80 参数 | 0.0.81 近似对应 | 说明 |
| ----------- | --------------- | ---- |
| `colorFront`（`theme.accentColor`） | `colorShadow` | 0.0.81 里 `colorShadow` 是「纸张上的图案颜色」，语义最接近 |
| `colorBack`（`theme.backgroundColor`） | `colorBack` | 语义一致（纸背后的颜色） |
| — | `colorPaper` | 0.0.81 新增的「纸张本体颜色」，0.0.80 没有对应项；**未确认**该用什么（纸张色 = `colorBack`？= `theme.backgroundColor` 的浅化？） |
| `contrast` | `blending`（0–1） | 都是「图与纸的融合强度」，但曲线是否一致**未确认** |
| `roughness` | `roughness` + `roughnessSize` + `roughnessRows` | 0.0.81 拆成三项，0.0.80 只有一个 |
| `fiber` / `fiberSize` | `fiber` / `fiberSize` | 名字没变 |
| `crumples` / `crumpleSize` | `crumples`（0–1）/ `crumpleCount`（2–15） | 0.0.81 的 `crumpleCount` 是**个数**（有 `paperTextureMeta.maxCrumpleCount = 15`），不是 0.0.80 的尺寸 |
| `folds` / `foldCount` | `folds`（0–1）/ `foldSizeX` / `foldSizeY` / `foldOffsetX` / `foldOffsetY`（各 0–1） | 0.0.81 拆成四个尺寸/偏移项 |
| `drops` | `drops` | 名字没变（`u_drops` 在 0.0.81 仍是 0–1） |
| `seed` | `seed`（0–1000） | 名字没变 |
| `fade` | — | 0.0.81 已删除 |
| — | `distortion`（−1–1） | 0.0.81 新增：图像随纸面弯曲的程度 |
| — | `clip`（bool） | 0.0.81 新增：把纸裁到图像框内 |
| — | `wrinkles` / `wrinkleSize` | 0.0.81 新增，0.0.80 没有 |

**同时要改的调用点**：`NomandBackgroundLayer.tsx:82-95` 传的 `colorFront` / `contrast` 在 0.0.81 里**不存在对应 prop**（`PaperTextureParams` 里没有这两个键），TypeScript 会直接报错；这不是「可以忽略的警告」，是必须解决的编译错误。三条可选路线：

1. **锁 0.0.80**：把 `@paper-design/shaders` 降到 `0.0.80`，整段 nomand 照抄。代价是与仓库其它地方（如果将来用 0.0.81 的新 shader）版本分裂，且 0.0.80 没有 0.0.81 的 grain 早退优化（数值等价，只影响性能）。
2. **按 0.0.81 重新推导**：把 `NOMAND_PAPER_TEXTURE_SHAPE` 重新映射成 0.0.81 的键，并**重新推导 overscan**（0.0.80 的五项系数已失效，必须回到 0.0.81 片元里找新的最大位移公式）。视觉上不可能与 Folia 逐像素一致，只能做到「同一类纸纹观感」。
3. **只做观感近似**：直接用 0.0.81 preset 默认（`colorPaper`/`colorShadow`/`blending` 取 preset 值），把 `roughness`/`fiber` 直连，overscan 用固定值（如 1.05）。这是最省事但最不还原的一条。

> 结论：**其它四种 effect 可以直接搬；`paper-texture` 是唯一一处「无法直接照抄」的地方。** 这一条也进 `§11` 风险 1。

### 5.7 与 `common` 层的叠加关系

**没有叠加**：`nomand/entry.tsx:17-24` 只渲染 `NomandBackgroundLayer`。压暗靠自己那一层 overlay 与 presets。

### 5.8 生命周期

- 每个 shader 由 `shaders-react` 在 `useEffect(..., [fragmentShader])` 里建 `ShaderMount`；换 effect/换图（`key` 变化）时旧实例 dispose、新实例重建
- `maxPixelCount = 1920 * 1080`、`minPixelRatio = 1`：与 `latent` 一致（1920×1080 是**每个** shader 的上限）
- `mipmaps`：`fluted-glass` / `paper-texture` / `lens-distortion` 传 `["u_image"]`；`image-dithering` / `halftone-dots` 不传。对应 `ShaderMount.setTextureUniform` 里 `mipmaps.includes(uniformName)` 时 `generateMipmap` + `LINEAR_MIPMAP_LINEAR`（`node_modules/@paper-design/shaders/dist/shader-mount.js:226-266`）
- 图像 uniform 天然跨源：`shaders-react` 会对字符串 URL 自动 `crossOrigin = 'anonymous'`；图片加载失败或 `naturalWidth === 0` 会 **throw**（`setTextureUniform` 里的断言），错误由 React 边界或控制台暴露
- **Folia 在 nomand 里没有用 `createPaperShaderReleaseRef`**：换 effect 靠 `dispose()`，WebGL context 仍然不会被 lose。本项目如果沿用「重建 shader」的实现，**必须自己加上 release 逻辑**，否则每次切换 effect 就漏一个 context（见 `§11` 风险 5）
---

## 6. `sora` 模式（twgl.js 星空）

文件：`B/sora/SoraBackground.tsx`（227 行）+ `B/sora/entry.tsx`（48 行）。
`order = 50`（`entry.tsx:14`），`labelFallback = 'Sora'`。它**不用 `@paper-design/shaders`**，是手写 GLSL + `twgl.js`。

### 6.1 渲染结构

`entry.tsx:19-24`：

```tsx
<div className="absolute inset-0 z-0" style={{ backgroundColor: isDaylight ? '#ffffff' : '#000000' }}>
  {!config?.sora?.tuning?.blank && (
    <SoraBackground theme={theme} isDaylight={isDaylight} paused={paused || staticMode} />
  )}
</div>
```

- 外层只铺黑/白 —— 这是 `blank` 模式（`tuning.blank === true`）唯一的可见内容，此时 **WebGL canvas 完全不挂载**
- 注释（`:17-18`）写明两条意图：blank 永不挂 canvas；`staticMode` 故意让星空冻结，与共享背景契约一致
- `SoraBackground` 只渲染一个 `<canvas>`（`:213-223`）：`absolute inset-0 w-full h-full block pointer-events-none`，`width/height: 100%`、`willChange: 'transform'`、`transform: 'translateZ(0)'`
- 没有 overlay、没有 vignette、不吃 `common.*`

颜色（`:95-110`）：

```ts
primaryColorChannels = parseColorChannels(theme.primaryColor) || (isDaylight ? {0,0,0} : {255,255,255});
particleColor       = [r/255, g/255, b/255];
accentColorChannels = parseColorChannels(theme.accentColor) || primaryColorChannels;
particleAccentColor = [r/255, g/255, b/255];
bgColor             = isDaylight ? [1,1,1] : [0,0,0];
```

`parseColorChannels`（`src/components/visualizer/colorMix.ts:83-86`）只认 hex（3/6 位）与 `rgb()/rgba()`；命名色、`hsl()` 等一律返回 `null` → 走回退。

### 6.2 星空生成（顶点着色器，完整公式）

`PARTICLE_COUNT = 150`（`:16`）。粒子属性只有一个 `a_index`（float，0..149），**其余随机量全在 GPU 里用 hash 现算**：

```glsl
attribute float a_index;
uniform vec2  u_resolution;
uniform float u_time;
varying float v_color_type;
varying float v_intensity_base;

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

void main() {
  float seed = a_index * 123.456;

  float speed_rand      = hash2(vec2(seed, 1.1));
  float size_rand       = hash2(vec2(seed, 2.2));
  float y_rand          = hash2(vec2(seed, 3.3));
  float x_rand          = hash2(vec2(seed, 4.4));
  float blink_rand      = hash2(vec2(seed, 5.5));
  float color_type_rand = hash2(vec2(seed, 6.6));

  float aspect = u_resolution.x / u_resolution.y;
  float speed  = 0.008 + speed_rand * 0.024;
  float size   = 0.0006 + 0.0032 * pow(size_rand, 3.8);

  float y = -0.45 + y_rand * 0.9;          // NDC 纵向位置，−0.45..0.45

  float margin = 0.05;
  float width  = aspect + margin * 2.0;
  float x = fract(x_rand + u_time * speed);  // 0..1 循环右移
  x = x * width - (aspect * 0.5 + margin);   // 映射到 NDC 横向范围

  float wave = sin(u_time * 0.3 + y_rand * 6.283) * 0.005;  // 上下微摆 ±0.005

  float ndc_x = x / (aspect * 0.5);
  float ndc_y = (y + wave) / 0.5;

  gl_Position = vec4(ndc_x, ndc_y, 0.0, 1.0);

  float pointSize = size * u_resolution.y * 3.5;
  gl_PointSize = max(2.0, pointSize);

  float blink = 0.3 + 0.7 * sin(u_time * (1.0 + blink_rand * 2.5) + x_rand * 6.283);
  v_intensity_base = blink;
  v_color_type     = color_type_rand;
}
```

要点：

| 项 | 公式 | 含义 |
| -- | ---- | ---- |
| 漂移速度 | `0.008 + speed_rand * 0.024` | 单位是「每秒跨越屏幕宽度的 0.8%–3.2%」 |
| 尺寸系数 | `0.0006 + 0.0032 * pow(size_rand, 3.8)` | 三次方以上幂让**大多数星点很小、极少数很大** |
| 点数像素尺寸 | `max(2.0, size * u_resolution.y * 3.5)` | 按画布高度缩放，保证不同分辨率观感一致，最小 2px |
| 纵向分布 | `y = -0.45 + y_rand * 0.9` | 均匀铺满 NDC 的 90%，上下各留 0.05 |
| 横向循环 | `fract(x_rand + u_time * speed)` | 时间只影响 X，星点从一侧穿出后从另一侧回来 |
| 抖动 | `wave = sin(u_time * 0.3 + y_rand * 6.283) * 0.005` | 每个粒子相位不同的轻微漂浮 |
| 闪烁 | `blink = 0.3 + 0.7 * sin(u_time * (1 + blink_rand * 2.5) + x_rand * 6.283)` | 0.3–1.0（振幅 0.7，不是 0–1） |
| 颜色类型 | `v_color_type = color_type_rand`，片元里 `> 0.90` 用 accent | 大约 10% 的星点是强调色 |

片元着色器（`:67-87`）：

```glsl
precision mediump float;
uniform vec3 u_particle_color;
uniform vec3 u_particle_accent_color;
varying float v_color_type;
varying float v_intensity_base;

void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float dist = length(pc);
  float alpha = smoothstep(0.5, 0.1, dist) * v_intensity_base;
  if (alpha < 0.01) discard;
  vec3 baseColor = v_color_type > 0.90 ? u_particle_accent_color : u_particle_color;
  gl_FragColor = vec4(baseColor * alpha, alpha);   // 预乘 alpha
}
```

圆形软边（`smoothstep(0.5, 0.1, dist)` 是**反向**参数：中心 1、边缘 0）、低 alpha 直接丢弃、颜色**预乘**。

### 6.3 twgl 用法（逐函数）

`useEffect(..., [])`（`:122-207`）里只有一次初始化：

| 步骤 | 代码 | 说明 |
| ---- | ---- | ---- |
| 1 | `twgl.getContext(canvas, { alpha: false, depth: false, antialias: false })`（`:126`） | `getContext`（`twgl.js/dist/7.x/twgl-full.d.ts:161`）= `createContext(canvas, attrs)`，拿不到返回 `null`，代码直接 `if (!gl) return` |
| 2 | `twgl.createProgramInfo(gl, [VERTEX_SHADER, FRAGMENT_SHADER], onError)`（`:129-131`） | 编译+链接；失败回调 `console.error("SoraBackground twgl program error:", err)`，返回假值则 `return` |
| 3 | `const indices = new Float32Array(150)`，`indices[i] = i`（`:135-138`） | **粒子索引做顶点属性**，不是索引缓冲 |
| 4 | `twgl.createBufferInfoFromArrays(gl, { a_index: { numComponents: 1, data: indices } })`（`:140-143`） | 一个 attribute buffer |
| 5 | 每帧 `twgl.resizeCanvasToDisplaySize(canvas)`（`:162`） | 实现（`twgl-full.module.js:10536-10547`）：`width = canvas.clientWidth * multiplier \| 0`，尺寸变了才写 `canvas.width/height` 并返回 true |
| 6 | `gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)`（`:163`） | 手动设置 |
| 7 | `gl.clearColor(...); gl.clear(gl.COLOR_BUFFER_BIT)`（`:166-168`） | 每帧清屏为 `bgColorRef.current` |
| 8 | `gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)`（`:171-172`） | 注释写「additive blending」但**实际是标准预乘 alpha 混合**（`ONE, ONE_MINUS_SRC_ALPHA`）。片元输出也确实是预乘。注释有误导，以代码为准 |
| 9 | `gl.useProgram(programInfo.program)`（`:181`） | |
| 10 | `twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo)`（`:182`） | 绑 attribute + 启用 |
| 11 | `twgl.setUniforms(programInfo, { u_resolution, u_time, u_particle_color, u_particle_accent_color })`（`:174-183`） | `u_resolution = [gl.canvas.width, gl.canvas.height]` |
| 12 | `twgl.drawBufferInfo(gl, bufferInfo, gl.POINTS)`（`:185`） | **`gl.POINTS`**，一次 draw call 画 150 个点 |

清理（`:195-206`）：`ResizeObserver.disconnect()`、`cancelAnimationFrame`、`gl.deleteProgram(programInfo.program)`、`gl.deleteBuffer(bufferInfo.attribs.a_index.buffer)`。
**没有** `gl.getExtension('WEBGL_lose_context')` —— 见 `§11` 风险 5 的补充。

### 6.4 时间与暂停

```ts
let lastTimestamp: number | null = null;

const invalidate = () => {                                // :148-152
  if (animationRef.current === null) animationRef.current = requestAnimationFrame(render);
};

const render = (now) => {                                  // :154-188
  animationRef.current = null;
  if (!pausedRef.current && lastTimestamp !== null) timeRef.current += (now - lastTimestamp) / 1000;
  lastTimestamp = pausedRef.current ? null : now;
  ...
  twgl.resizeCanvasToDisplaySize(canvas);
  ...
  if (!pausedRef.current) invalidate();                    // 只有播放时才续帧
};
```

- 暂停时把 `lastTimestamp` 置 `null`，恢复后再拿到的时间戳不会把「暂停期间的时间」补进来 —— **恢复时不跳帧**
- 暂停时 `invalidate()` 仍可由外界触发，用来**在尺寸变化 / 主题色变化时补画一帧**（`:209-211`：`useEffect(..., [paused, isDaylight, theme.primaryColor, theme.accentColor]) => invalidateRef.current?.()`）
- `ResizeObserver(invalidate)`（`:190-191`）让容器尺寸变化也补画
- `paused` 在 `sora/entry.tsx:22` 被合并成 `paused || staticMode` —— 所以 `sora` 模式下 `staticMode` 与「暂停」是同一个行为（冻结），不像 `common` 那样整层消失
- **无音频反应**：sora 完全不读 `audioPower` / `audioBands`，Particle 的「闪烁」是纯 `u_time` 的函数。用户原始描述里的「音频反应」在 sora 里不存在，别自行加

### 6.5 tuning 与持久化

`SoraBackgroundTuning`（`src/types.ts:990-993`）只有一个字段：

```ts
export interface SoraBackgroundTuning {
  /** Skips the WebGL starfield and shows a static solid black (night) / white (daylight) frame. */
  blank: boolean;
}
export const DEFAULT_SORA_BACKGROUND_TUNING = { blank: false };   // :1066-1068
```

`resolveStoredSoraBackgroundTuning`（`stores/visualizerSettingsPersistence.ts:909-913`）：`blank` 只接受 boolean，否则默认。localStorage key：`sora_background_tuning`（`:915`）。
设置面板只有一个开关（`SoraBackgroundSettingsCard.tsx`，41 行），快捷控件也是同一个开关（`sora/entry.tsx:36-48`）。

### 6.6 与 `common` 层的叠加关系

**没有叠加**：`sora/entry.tsx` 只渲染外层底色 + canvas。`transparent` 由上层渲染器统一处理（`VisualizerBackgroundRenderer.tsx:9-11`）。

---

## 7. `url` 模式（iframe 嵌入）

文件：`B/url/UrlBackgroundLayer.tsx`（87 行）+ `B/url/entry.tsx`（29 行）+ `src/utils/urlBackground.ts`（95 行）。
`order = 40`（`entry.tsx:11`），`labelFallback = 'Embed'`（**不是 `Url`**，容易写错）。没有 `resetSettings`，也没有 `renderQuickControls`。

### 7.1 渲染结构

渲染结构（`UrlBackgroundLayer.tsx:60-86`）：

```
<div ref={containerRef} className="absolute inset-0 z-0 overflow-hidden">
  {ready && <iframe key={url} src={url} title={note || url} className="w-full h-full border-0"
                    style={{ pointerEvents: 'none' }} sandbox="allow-scripts" allowFullScreen />}
  <div className="absolute inset-0"
       style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0.35))',
                pointerEvents: 'none' }} />
</div>
```

- **单层 iframe + 单层黑色半透明遮罩**（`0.15 → 0.35` 从上到下），遮罩是为了歌词可读性；没有用主题色
- `sandbox="allow-scripts"`：**只放行脚本**。`allow-same-origin` 不在里面 —— 嵌入页面对宿主来说是**唯一源（opaque origin）**，无法读宿主 DOM/cookie。移植时不要为了「让某些页面正常」而加 `allow-same-origin`，那等于把沙箱拆了
- `pointerEvents: 'none'`：鼠标事件穿透，用户点不到 iframe 内容（背景层语义）
- `allowFullScreen`：允许嵌入内容自己进全屏

### 7.2 延迟挂载（防 0×0 白屏）

`useEffect(..., [selectedItem])`（`:34-56`）：

1. `setReady(false)`
2. 取 `containerRef.getBoundingClientRect()`，宽高都 > 0 → 立即 `setReady(true)` 并返回
3. 否则建 `ResizeObserver`，回调里 `entry.contentRect` 宽高 > 0 → `setReady(true)` + `observer.disconnect()`
4. cleanup 里 `observer.disconnect()`

注释（`:29-33`）的原因：**嵌入页脚本若以 0×0 初始化会抛 `IndexSizeError`，iframe 永久白屏**。
注释里还提到「Includes a max retry guard to prevent infinite rAF loop in extreme edge cases」，但**代码里没有 rAF、也没有重试上限** —— 这是注释与实现不一致（源码事实，移植时按代码做即可，ResizeObserver 方案本身不需要重试上限）。

`if (!selectedItem?.url) return null`（`:58`）：没选中项时**连遮罩都不渲染**，整块消失。

### 7.3 URL 校验与列表管理（`src/utils/urlBackground.ts`）

`normalizeUrlBackgroundUrl(value)`（`:6-26`）：

- 非字符串 → `null`；`trim()` 后为空 → `null`
- 不含 `://` → 自动补 `https://`
- `new URL(candidate)` 解析失败 → `null`
- **只接受 `http:` / `https:`**，其余协议（`file:` / `javascript:` / `data:` / 自定义 scheme）一律 `null`
- 成功返回 `parsed.href`（规范化后的绝对 URL）

`sanitizeUrlBackgroundItem(value)`（`:28-46`）：要求 `id` 非空（字符串 trim 后）+ `url` 合法；`note` 为空时回退成 `url`；返回 `{ id, url, note }`。

`mergeUrlBackgroundList(current, incoming)`（`:51-74`）：按 `id` 合并（`Map`），导入的项覆盖同 id 的 `url` / `note`，**不删除已有项**。注释（`:48-50`）说明这是为了让「导入配置」只增不减，确认框承诺什么就存什么。

`sanitizeUrlBackgroundList(items)`（`:76-95`）：非数组 → `[]`；逐项 sanitize；按首次出现的 `id` 去重。

`UrlBackgroundItem`（`src/types.ts:922-926`）：`{ id: string; url: string; note: string }`。
store 侧：`urlBackgroundList` / `urlBackgroundSelectedId`（`useVisualizerBackgroundConfig.ts:24-25, :44-47`）。

### 7.4 与 `common` 层的叠加关系

**没有叠加**。`url/entry.tsx:14-19` 只渲染 `UrlBackgroundLayer`，不吃 `common.*` 的任何字段。

### 7.5 生命周期

- `key={url}` 强制 iframe 在换 URL 时**完整重建**（注释 `:62-63`：避免 `chrome-error://chromewebdata` 的跨源导航错误）
- 没有 `paused` / `staticMode` 概念：iframe 内容按自己的节奏跑，宿主的播放状态不影响它
- 没有卸载时的特殊清理（iframe 移除即终止其进程）

### 7.6 Electron 环境的特别注意（不是 Folia 的行为，是本项目的约束）

| 话题 | Folia（浏览器） | 本项目（Electron `file://`） |
| ---- | --------------- | --------------------------- |
| `sandbox="allow-scripts"` | 标准行为 | Chromium 相同；但 `file://` 父页面下 iframe 内容仍是 opaque origin |
| 网络请求 | 无限制 | 受 CSP / `file://` 约束，跨域页面通常仍能加载，但被 `X-Frame-Options: DENY` / `frame-ancestors` 拒绝的站点会白屏 —— **未确认本项目是否对 iframe 请求做了额外拦截** |
| 自定义协议 | 不适用 | `normalizeUrlBackgroundUrl` 只放行 http/https，正好避开 `muice-cover://` 之类被 iframe 拒绝的坑 |
| 进程隔离 | 浏览器同进程模型 | Chromium 会给跨站 iframe 独立进程；`pointerEvents: none` 不影响加载 |

> 本项目如果复刻这一模式，建议额外加一条「加载失败占位」（`iframe.onerror` 或超时），因为 Electron 里如果目标站点拒绝被嵌，用户看到的是纯白，没有任何提示。Folia 没做这件事。
---

## 8. `@paper-design/shaders` 核心包 API 与 Vue 挂载器

证据路径约定：本节的一手来源是本仓库已安装的 **`@paper-design/shaders@0.0.81`**（`F:\Work\muiceDesktop\node_modules\@paper-design\shaders\`）。
Folia 实际跑的是 **`@paper-design/shaders@0.0.80`**（`F:\Work\_refs\folia-major\package.json:230` 声明 `@paper-design/shaders-react: ^0.0.80`，`package-lock.json` 锁定 `shaders` 0.0.80）。两者 `shader-mount.js` 与 `vertex-shader.js` **逐字节相同**（已比对，见 `§8.7`），所以 API 描述对两版都成立。

### 8.1 `ShaderMount` 构造参数（逐个说明）

来源：`dist/shader-mount.d.ts:35-56`（签名）+ `dist/shader-mount.js:42-80`（行为）。

| # | 参数 | 类型 | 默认 | 含义与行为 |
| - | ---- | ---- | ---- | ---------- |
| 1 | `parentElement` | `HTMLElement` | 必填 | 挂载宿主。构造函数断言 `parentElement?.nodeType === 1`，否则 `throw new Error("Paper Shaders: parent element must be an HTMLElement")`（`:43-47`）。canvas 由它 `prepend` 进去（`:57`），宿主尺寸即 shader 尺寸 |
| 2 | `fragmentShader` | `string` | 必填 | 片元着色器源码（GLSL ES 3.00；`vertexShaderSource` 由包内提供，见 `vertex-shader.js`） |
| 3 | `uniforms` | `ShaderMountUniforms` | 必填 | 初始 uniform。类型见 `dist/shader-mount.d.ts:119-121`：`boolean \| number \| number[] \| number[][] \| HTMLImageElement \| undefined`（`number[]` 长度决定 `uniform1f/2fv/3fv/4fv/matrix3fv/matrix4fv`，见 `§8.4`）。除自身 uniform 外，mount 还会自动补 `u_time` / `u_pixelRatio` / `u_resolution`；遇到 `HTMLImageElement` 会额外维护 `${key}AspectRatio`（`:259-264`） |
| 4 | `webGlContextAttributes` | `WebGLContextAttributes` | `undefined` | 直接透给 `canvas.getContext('webgl2', attrs)`（`:64`）。Folia 传 `{ antialias: false, depth: false }` |
| 5 | `speed` | `number` | `0` | `currentFrame += dt * currentSpeed`（`:201-203`）。**0 = 不启动 rAF**（`setCurrentSpeed`，`:355-365`）。负值可倒放（d.ts `:38`） |
| 6 | `frame` | `number` | `0` | 起始 `currentFrame`（毫秒）。用于确定性结果（d.ts `:40`）。`u_time = currentFrame * 1e-3`（`:206`） |
| 7 | `minPixelRatio` | `number` | `2` | 最低渲染像素比。d.ts `:42-45`：可调低提性能，或配合 `maxPixelCount` 调高提抗锯齿 |
| 8 | `maxPixelCount` | `number` | `DEFAULT_MAX_PIXEL_COUNT`（d.ts `:47-53` 说明默认 = 1920×1080×2² = 8,294,400） | 物理像素总数上限。超出后**只降低内部渲染分辨率**，DOM 尺寸不变 |
| 9 | `mipmaps` | `string[]` | `[]` | 需要生成 mipmap 的纹理 uniform 名。命中时 `generateMipmap` + `LINEAR_MIPMAP_LINEAR`（`:246-249`） |

构造顺序（`:49-79`）：注入 `<style data-paper-shader>`（若文档里还没有）→ 建 canvas 并 `prepend` → `getContext('webgl2')` → `initProgram`（`createProgram(gl, vertexShaderSource, fragmentShader)`）→ `setupPositionAttribute`（`a_position` 全屏四边形 6 顶点）→ `setupUniforms` → `setUniformValues(providedUniforms)`（**只写值，不画**）→ `setupResizeObserver` → 监听 `visualViewport.resize` → `setupIntersectionObserver` → `setSpeed(speed)`（这里才可能启动 rAF 并画第一帧）→ `parentElement.setAttribute('data-paper-shader', '')` → `parentElement.paperShaderMount = this` → 监听 `visibilitychange`。

注入的样式（`:460-477`，`defaultStyle`）：

```css
@layer paper-shaders {
  :where([data-paper-shader]) {
    isolation: isolate;
    position: relative;
    & canvas {
      contain: strict; display: block; position: absolute; inset: 0; z-index: -1;
      width: 100%; height: 100%; border-radius: inherit; corner-shape: inherit;
    }
  }
}
```

注意 canvas 是 `position: absolute; inset: 0; z-index: -1`，靠宿主 `position: relative` 定尺寸。**宿主必须是有尺寸的块级元素**，否则 canvas 是 0×0。

### 8.2 `PaperShaderElement` 与 ref 用法

`dist/shader-mount.d.ts:107-112`：

```ts
export interface PaperShaderElement extends HTMLElement {
  paperShaderMount: ShaderMount | undefined;
}
export declare function isPaperShaderElement(element: HTMLElement): element is PaperShaderElement;
```

构造完成时 mount 会把自己挂到宿主 DOM 节点上（`:78` `this.parentElement.paperShaderMount = this`），`dispose()` 里 `delete this.parentElement.paperShaderMount`（`:417`）。

Folia 的用法（`paperShaderContext.ts:28-42`）是一个**函数式 ref**：`(element) => { target.current = element; if (!element) return; return cleanup }`。这依赖 React 的 ref 清理语义（React 18 的 ref cleanup 函数）。Vue 3 里对应的写法是 `ref` + `onBeforeUnmount`，或者 `:ref="(el) => ..."` 返回清理函数会**不被调用** —— Vue 3 的函数 ref 不支持返回 cleanup（只有 `<template>` 上的 `v-on` 才处理返回函数）。所以 Vue 版要显式在 `onBeforeUnmount` 里做释放，见 `§8.6` 的挂载器骨架。

### 8.3 `setSpeed` / `setUniforms` / `setUniformValues` / `setFrame` / `dispose` 语义

| 方法 | 定义位置 | 语义 |
| ---- | -------- | ---- |
| `getCurrentFrame()` | `:337-339` | 返回 `currentFrame`（毫秒，从 0 起） |
| `setFrame(newFrame)` | `:341-345` | 写 `currentFrame`、重置 `lastRenderTime = performance.now()`、**立即渲染一帧** |
| `setSpeed(newSpeed = 1)` | `:347-350` | 写 `speed` 后调 `updateCurrentSpeed()` |
| `updateCurrentSpeed()`（private） | `:352-354` | `setCurrentSpeed(ownerDocument.hidden \|\| !isInViewport ? 0 : speed)` —— **标签页隐藏或元素离开视口时会自动压到 0**，不画帧。这是「滚动出屏幕自动省电」的来源 |
| `setCurrentSpeed(s)`（private） | `:355-365` | `s !== 0` 且当前无 rAF → 记 `lastRenderTime` 并 `requestAnimationFrame(render)`；`s === 0` 且有 rAF → `cancelAnimationFrame` 并置 `rafId = null` |
| `setMaxPixelCount(n = DEFAULT)` | `:366-370` | 写值后 `handleResize()` |
| `setMinPixelRatio(n = 2)` | `:371-375` | 写值后 `handleResize()` |
| `setUniforms(newUniforms)` | `:376-381` | `setUniformValues(newUniforms)` → 合并进 `providedUniforms` → **立即 `render(performance.now())`**。也就是说：**这个调用会立刻画一帧，同时帧循环还会在下一帧再画一帧**（双绘制） |
| `setUniformValues(updatedUniforms)`（private 于 d.ts，运行时存在） | `:275-335` | 只写 GL uniform，不画。见 `§8.4` |
| `dispose()` | `:386-418` | 见 `§8.6` |

**`setUniformValues` 是 d.ts 里 `private` 但运行时是箭头函数属性**（`:276` 是 `setUniformValues = (updatedUniforms) => {...}`，同 `:276` 而非 prototype 方法）。`paperShaderUniforms.ts:22` 就是靠这一点用 `(mount as unknown as { setUniformValues?: ... }).setUniformValues` 走这条通道。

Folia 的封装（`src/utils/paperShaderUniforms.ts:17-28`）：

```ts
export const updatePaperShaderUniforms = (mount, uniforms, animating) => {
  const writer = mount.setUniformValues;
  if (animating && typeof writer === 'function') { writer(uniforms); return; }
  mount.setUniforms(uniforms);   // 停止时没有帧循环，必须立刻画
};
```

注释（`:9-15`）原文：`setUniforms` 会当场整帧重画、帧循环下一帧再画一遍 = 一次更新画两遍全屏；shader 还在跑（speed ≠ 0）时它的循环会自己读到新值，所以只需要写值；停止的 shader 没有循环，才必须用 `setUniforms` 立刻画一次。并且明确写了「如果未来版本删掉 `setUniformValues`，就回退到 `setUniforms`」。

### 8.4 `setUniformValues` 的分派规则

`:276-335`：

1. `gl.useProgram(program)`，然后 `Object.entries(updatedUniforms).forEach(...)` —— **支持增量（partial）写入**
2. 缓存去重：`uniformCache[key]` 与本次值做 `areUniformValuesEqual` 递归比较（`:268-274`：原始值严格相等；数组则长度相等且逐项递归相等）。`HTMLImageElement` 的缓存值是 `` `${src.slice(0,200)}|${naturalWidth}x${naturalHeight}` ``（`:280-282`）—— 所以同一张图换个 `src` 也会重新上传
3. 拿不到 uniform location → `console.warn(\`Uniform location for ${key} not found\`)` 并跳过（**不是 throw**）。这意味着**把 uniform 名写错在浏览器里只会有 warn**，不会崩
4. 分派：

| 值类型 | 行为 |
| ------ | ---- |
| `HTMLImageElement` | `setTextureUniform(key, value)` |
| `Array`（元素非数组） | 按 `flatArray.length` 走 `2 → uniform2fv`、`3 → uniform3fv`、`4 → uniform4fv`、`9 → uniformMatrix3fv`、`16 → uniformMatrix4fv`；其它长度 `console.warn('Unsupported uniform array length: ...')` |
| `Array`（元素是数组） | 先检查所有子数组等长，`flat()` 拍平后按上述规则（`u_colors: [[r,g,b,a], ...]` 走这条，子数组长度 4 → `uniform4fv`） |
| `number` | `uniform1f` |
| `boolean` | `uniform1i(location, value ? 1 : 0)` |
| 其它 | `console.warn('Unsupported uniform type for ...')` |

`setTextureUniform`（`:226-266`）：

- `image.complete && naturalWidth > 0` 不满足 → **`throw new Error(\`Paper Shaders: image for uniform ${uniformName} must be fully loaded\`)`**（这是唯一会抛的路径）
- 同名纹理已存在先 `deleteTexture`
- 纹理单元按首次出现的顺序分配（`textureUnitMap`）
- `CLAMP_TO_EDGE` + `LINEAR`；`texImage2D(RGBA, RGBA, UNSIGNED_BYTE, image)`
- `mipmaps.includes(uniformName)` → `generateMipmap` + `MIN_FILTER = LINEAR_MIPMAP_LINEAR`
- `gl.getError()` 非 `NO_ERROR` → `console.error('Paper Shaders: WebGL error when uploading texture:', error)` 并**直接 return（不登记这条纹理）**
- 写 `uniform1i(location, textureUnit)`，若存在 `${uniformName}AspectRatio` location 则写 `naturalWidth / naturalHeight`

### 8.5 `mipmaps` 与 `minPixelRatio` / `maxPixelCount`

**`mipmaps`**：只对「会被大幅缩放采样」的图像 shader 有意义。Folia 的取舍（来自 `shaders-react` 各组件内部常量）：`fluted-glass` / `paper-texture` / `lens-distortion` 传 `['u_image']`；`image-dithering` / `halftone-dots` **不传**。原因：前三个会做几何折射/透视/色散，采样点跨度大，没有 mipmap 会闪；后两个是屏幕空间图案，逐像素采样，mipmap 只会糊。

副作用：`generateMipmap` 会为纹理分配完整金字塔（+33% 显存），而且要求图像尺寸是 2 的幂吗？—— **WebGL2 不需要**（`generateMipmap` 对非 POT 纹理合法），这是 WebGL1 时代的限制。

**`minPixelRatio` / `maxPixelCount`** 一起决定 canvas 的物理分辨率（`handleResize`，`:161-192`）：

```ts
dpr                          = max(1, window.devicePixelRatio);
pinchZoom                    = visualViewport?.scale ?? 1;

if (devicePixelsSupported) {                       // 浏览器给了 devicePixelContentBoxSize
  scaleToMeetMinPixelRatio   = max(1, minPixelRatio / dpr);
  targetPixelWidth           = parentDevicePixelWidth  * scaleToMeetMinPixelRatio * pinchZoom;
  targetPixelHeight          = parentDevicePixelHeight * scaleToMeetMinPixelRatio * pinchZoom;
} else {
  targetRenderScale          = max(dpr, minPixelRatio) * pinchZoom;
  if (isSafari) targetRenderScale *= max(1, bestGuessBrowserZoom(document));
  targetPixelWidth           = round(parentWidth)  * targetRenderScale;
  targetPixelHeight          = round(parentHeight) * targetRenderScale;
}

maxPixelCountHeadroom        = sqrt(maxPixelCount) / sqrt(targetPixelWidth * targetPixelHeight);
scaleToMeetMaxPixelCount     = min(1, maxPixelCountHeadroom);
newWidth                     = round(targetPixelWidth  * scaleToMeetMaxPixelCount);
newHeight                    = round(targetPixelHeight * scaleToMeetMaxPixelCount);
newRenderScale               = newWidth / round(parentWidth);

if (canvas 尺寸或 renderScale 变了) {
  canvas.width = newWidth; canvas.height = newHeight;
  resolutionChanged = true;
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  render(performance.now());          // 立刻重画一帧
}
```

要点：

- **`minPixelRatio` 的语义是「最低内部像素比」，默认 2**。也就是说**在 1× 屏上默认也会按 2 倍渲染**（d.ts `:61-64` 明确写了「Used to target 2x rendering even on 1x screens for better antialiasing」）。Folia 的两个背景显式传 `1`，等于接受 1× 渲染，省一半像素
- **`maxPixelCount` 只缩分辨率，不改 DOM 尺寸**：`scaleToMeetMaxPixelCount` 是等比缩放，`canvas.width/height` 变小、CSS 的 `width/height: 100%` 不变，视觉上就是变糊
- `maxPixelCountHeadroom` 用的是**开方比值**（面积 → 边长），所以 `maxPixelCount = 1280*720` 时，1920×1080 的宿主会得到 `sqrt(921600)/sqrt(2073600) ≈ 0.667`，即内部 1280×720
- `resolutionChanged` 只在**真的变了**的时候写 `u_resolution` / `u_pixelRatio`（`render`，`:207-211`）
- `u_pixelRatio` 写的是 **`renderScale`（内部像素 / CSS 像素）**，不是 `devicePixelRatio`
- **`ResizeObserver` 之外还监听 `visualViewport.resize`**（`:74` + `handleVisualViewportChange` `:156-159`），因为 pinch zoom 时 ResizeObserver 不一定回调；处理方式是**重建 ResizeObserver** 强制拿一次新回调

### 8.6 不用 React 封装包时怎么写一个框架无关的挂载器（Vue 版骨架）

`@paper-design/shaders-react` **只提供 React 组件，本仓库没有安装它**（`F:\Work\muiceDesktop\node_modules\@paper-design` 下只有 `shaders`）。所以 Vue 版必须自己做两件事：**字符串 URL → HTMLImageElement**、**宿主 div 生命周期**。

这是 `shaders-react` 的 `ShaderMount` 组件做的事（`shaders-react/dist/shader-mount.js:15-155`），逐条对照：

| 行为 | React 版实现 | Vue 版要做的事 |
| ---- | ------------ | -------------- |
| uniform 里的字符串当 URL 载图 | `processUniforms`（`:15-72`）：`isValidUrl` 接受 `/` 开头或 `new URL()` 能解析的；`isExternalUrl`（origin 不同）时才设 `crossOrigin = 'anonymous'`；`onload` → `setMinImageSize` → 赋值 | 同样两步；注意**外部 URL 才加 `crossOrigin`**，本地 `data:` / 相对路径不需要 |
| 小图放大 | `setMinImageSize(img)`：`naturalWidth < 1024 && naturalHeight < 1024` 时把 `width/height` 直接改成 1024（`set-min-image-size.js:6-15`） | 照做；不要改成 drawImage 缩放，`texImage2D` 读的是 `naturalWidth` |
| 已加载的 `HTMLImageElement` | `value.decode().then(...)` 后再 `setMinImageSize` | 等价：`await img.decode().catch(() => {})` |
| 建 mount | `useEffect(..., [fragmentShader])`：先 `await processUniforms`，再 `if (divRef.current && !shaderMountRef.current) new ShaderMountVanilla(...)` | `onMounted`（或 `watch(hostEl)`）里 `await` 完再 new；**必须判断宿主还在文档里** |
| 销毁 | cleanup：`shaderMountRef.current?.dispose()`；`= null` | `onBeforeUnmount`：**先** `mount.dispose()`，**再**做 `WEBGL_lose_context` 释放（顺序见下） |
| uniform 更新 | 第二个 effect 依赖 `[uniformsProp, isInitialized]`，内部再 `await processUniforms`，用 `isStale` 防止竞态 | `watch` 到 uniform 对象变化 → 重新处理图片 → `setUniforms`；**必须处理「上一次异步还没回来」的竞态** |
| speed / frame / maxPixelCount / minPixelRatio | 各自一个 effect，依赖 `[值, isInitialized]` | 各自一个 `watch` + `{ flush: 'post' }`，避免在 DOM 更新前调 |
| 宿主元素 | 渲染一个 `<div>`，`width/height` 是**纯数字字符串**时会被转成 `number`（`:146-150`）；ref 通过 `useMergeRefs` 合并 | Vue：`<div ref="host" :style="{ width, height, ...style }">`；`'100%'` 保持字符串，`'640'` 转数字这条对 Vue 不必要（Vue 会原样给 CSS，`width: '640'` 也合法） |

**Vue 版骨架（伪代码，供实现参考，不是要照抄的成品）**：

```ts
// src/features/immersive/backgrounds/shared/paperShaderMount.ts
import { ShaderMount, type ShaderMountUniforms, type PaperShaderElement } from '@paper-design/shaders';

export interface PaperShaderOptions {
  fragmentShader: string;
  uniforms: ShaderMountUniforms;              // 允许 string，挂载器内部转 Image
  speed?: number;
  frame?: number;
  minPixelRatio?: number;
  maxPixelCount?: number;
  mipmaps?: string[];
  contextAttributes?: WebGLContextAttributes;
}

// 1) 字符串 uniform → HTMLImageElement。语义与 shaders-react 的 processUniforms 对齐。
const loadImage = (url: string, external: boolean) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  if (external) img.crossOrigin = 'anonymous';
  img.onload = () => { resizeToMin(img); resolve(img); };
  img.onerror = () => reject(new Error(`Failed to load shader image: ${url}`));
  img.src = url;
});

// 2) 释放：paper 的 dispose() 不 lose context，卸载时必须自己丢一次。
const releaseContext = (host: PaperShaderElement | null) => {
  const canvas = host?.paperShaderMount?.canvasElement;
  if (!canvas) return;
  const gl = canvas.getContext('webgl2');
  queueMicrotask(() => {
    if (!gl || canvas.isConnected || gl.isContextLost()) return;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  });
};
```

挂载顺序与卸载顺序（与 Folia 的差异要写清楚）：

```ts
// 挂载
onMounted(async () => {
  const host = hostRef.value;
  if (!host) return;
  const resolved = await resolveUniformImages(options.uniforms);   // 有 await，宿主可能已卸载
  if (!hostRef.value || hostRef.value !== host) return;            // 竞态守卫
  mount = new ShaderMount(host, options.fragmentShader, resolved, options.contextAttributes,
                          options.speed ?? 0, options.frame ?? 0,
                          options.minPixelRatio, options.maxPixelCount, options.mipmaps ?? []);
});

// 卸载：Folia 的 createPaperShaderReleaseRef 是「ref 清理先跑，dispose 后跑」，
// 所以 lose context 一定发生在 dispose 之前那一个 microtask 里被排好队；
// Vue 里没有 ref 清理时机，等价做法是自己控制顺序：
onBeforeUnmount(() => {
  const host = hostRef.value;
  mount?.dispose();          // 删 program / 纹理 / observer，移除 canvas
  releaseContext(host);      // dispose 后 canvas 已被 remove()，isConnected 为 false，可以安全 lose
  mount = null;
});
```

**关于顺序的说明（重要）**：Folia 的注释（`paperShaderContext.ts:23-26`）写的是「ref 在 paper 自己的 effect cleanup 之前被 detach，所以这里还能拿到 mount」，并且用 `queueMicrotask` + `canvas.isConnected` 判定，保证只在 canvas 真正离开文档后 lose。React 里 ref 清理与 effect 清理的相对顺序决定了这个技巧可行。**Vue 里没有这个隐式顺序，必须显式 `dispose()` 再 `releaseContext()`**；因为 `dispose()` 末尾会 `canvasElement.remove()`（`shader-mount.js:416`），随后 `canvas.isConnected === false` 成立，`loseContext` 可安全执行。这与 Folia 的效果一致，但实现路径不同 —— 移植文档里要写明，避免照抄 `queueMicrotask` 却把顺序搞反。

**不要做的事**：

- 不要在 mount 之前把宿主 `display: none` / 尺寸 0：`getContext` 能成功，但 `handleResize` 会把 canvas 定成很小或 0 像素，之后只有靠 ResizeObserver 恢复
- 不要自己给宿主加 `overflow: hidden` 之外的定位 hack：paper 注入的样式已经处理 canvas 定位，宿主只需要 `position: relative`（paper 自己会给 `data-paper-shader` 元素加 `position: relative`）和确定尺寸
- 不要在 `dispose()` 之后继续调用 `setUniforms`：`program` 变 `null` 后 `render` 会 `console.warn('Tried to render before program or gl was initialized')` 然后 return（`:195-198`），WebGL 调用在已 lose 的 context 上是 no-op
- 不要复用同一个宿主挂两个 mount：`parentElement.paperShaderMount` 会被后一个覆盖，前一个就再也找不到（Folia 的层都是各自独立 div）

### 8.7 本仓库要用的导出名与版本差异

本仓库 `@paper-design/shaders@0.0.81`（`node_modules/@paper-design/shaders/package.json`：`license: Apache-2.0`、`type: module`、`sideEffects: false`；`exports` **只有 `.` 一个入口**：`{".": {"types": "./dist/index.d.ts", "import": "./dist/index.js", "default": "./dist/index.js"}}`）。

六个模式需要的导出（`dist/index.d.ts` 行号）：

| shader | 导出名 | 行 | 备注 |
| ------ | ------ | -- | ---- |
| latent mesh | `meshGradientFragmentShader`、`meshGradientMeta` | `:7` | `meshGradientMeta.maxColorCount = 10` |
| latent dithering | `ditheringFragmentShader`、`DitheringShapes`、`DitheringTypes` | `:35` | `u_shape` 需要 `DitheringShapes.warp = 2` |
| nomand fluted | `flutedGlassFragmentShader`、`GlassDistortionShapes`、`GlassGridShapes` | `:51` | `prism` / `lines` |
| nomand image dithering | `imageDitheringFragmentShader` | `:53` | |
| nomand lens | `lensDistortionFragmentShader`、`lensDistortionMeta` | `:55` | `lensDistortionMeta.maxSamples = 50` |
| nomand halftone | `halftoneDotsFragmentShader`、`HalftoneDotsTypes`、`HalftoneDotsGrids` | `:61` | `gooey` / `hex` |
| nomand paper | `paperTextureFragmentShader`、`paperTextureMeta` | `:47` | `maxCrumpleCount = 15`（0.0.81 才有） |
| 工具 | `ShaderMount`、`isPaperShaderElement`（`:2`），`defaultObjectSizing`、`defaultPatternSizing`、`ShaderFitOptions`（`:5`），`getShaderColorFromString`（`:66`），`getShaderNoiseTexture`（`:67`），`emptyPixel`（`:68`） | | |

**`getShaderColorFromString`**（`dist/get-shader-color-from-string.js`，两版一致）：支持数组（长度 3 → 末位补 `1`；长度 4 → 原样）、hex 3/4/6/8 位、`rgb()/rgba()`、`hsl()/hsla()`；**其它格式 `console.error('Unsupported color format')` 并回退 `[0.5, 0.5, 0.5, 1]`**。返回 0–1 的 4 通道。正则很严格（`rgb` 只接受整数、`hsl` 只接受 `Ndeg` 与百分比）—— 主题色统一用 6 位 hex 最稳。

**`getShaderNoiseTexture()`**（`dist/get-shader-noise-texture.js:6-13`）：返回一个 `new Image()`，`src` 是内嵌的 50×50 PNG base64。**0.0.81 的 shader 包内部没有任何文件 import 它**（已 grep 确认），只有 `shaders-react` 的 `paper-texture` 组件用它 —— 所以 Vue 版做 `paper-texture` 时必须自己调它并塞进 `u_noiseTexture`。

**0.0.80 → 0.0.81 逐文件差异（用 `Compare-Object` + 文件 hash 实测）**：

| 文件 | 行数 0.0.80 → 0.0.81 | 差异 | 是否影响本项目的视觉效果 |
| ---- | -------------------- | ---- | ------------------------ |
| `shader-mount.js` | 419 → 419 | **hash 相同** | 无 |
| `vertex-shader.js` | — | **hash 相同** | 无 |
| `get-shader-color-from-string.js` | — | **hash 相同** | 无 |
| `dithering.js` | 272 → 272 | **hash 相同** | 无（latent dithering 可安心用 0.0.81） |
| `lens-distortion.js` | 277 → 277 | **hash 相同** | 无（overscan 反解可沿用） |
| `mesh-gradient.js` | 128 → 132 | 26 行 | 数值等价：0.0.81 给 grain 加 `if (u_grainMixer > 0)` / `if (u_grainOverlay > 0)` 早退。latent 用 `grainMixer = 0` / `grainOverlay = 0.01`，**结果不变** |
| `image-dithering.js` | 202 → 200 | 2 行 | 数值无差：删掉未使用的 `u_worldWidth` / `u_worldHeight` 声明；Folia 本来也不设这两个 |
| `fluted-glass.js` | 359 → 362 | 33 行 | 数值等价：grain 早退 + 移除未使用的 `u_rotation`（0.0.80/0.0.81 里 `u_noiseTexture` **都没有被声明使用**）。Folia 不设 rotation → 无差 |
| `halftone-dots.js` | 322 → 322 | 34 行 | 数值等价：grain 早退 + 移除未使用的 `u_rotation` / `u_time`。`grainSize` 仍参与 `grainUV *= mix(2000, 200, u_grainSize)` |
| `paper-texture.js` | **249 → 528** | **571 行（整段重写）** | **完全不等价**，见 `§5.6` |

**这条差异表的结论**：六个模式里 **只有 `nomand` 的 `paper-texture` 一路不能直接用 0.0.81**；其余五个 shader 在 0.0.81 上的渲染结果与 Folia 跑的 0.0.80 一致。

**深链问题（未确认）**：`exports` 只暴露 `.`，`@paper-design/shaders/dist/shaders/xxx.js` 这类深链在被 Node/打包器按 `exports` 解析时会**被拒绝**。想按需引入只能：① 依赖打包器的 tree-shaking（包是 `sideEffects: false`，但 `dist/index.js` 是 barrel，`import { x } from '@paper-design/shaders'` 后能否摇掉其它 30 多个 shader **未实测**）；② 用 `resolve.alias` / `optimizeDeps` 指向具体文件；③ 直接内联 fragmentShader 字符串。**本项目必须实测一次产物体积**（见 `§10.4`）。
---

## 9. twgl.js 在本项目的用法与体积（sora 专用）

来源：本仓库 `twgl.js@7.0.0`（`node_modules/twgl.js/package.json`，license MIT）。

### 9.1 类型与实现入口

`node_modules/twgl.js/dist/7.x/twgl-full.d.ts`：

| 函数 | 行 | 签名要点 |
| ---- | -- | -------- |
| `getContext` | `:161` | `(canvas, attribs?) => WebGLRenderingContext \| WebGL2RenderingContext \| null` |
| `resizeCanvasToDisplaySize` | `:169` | `(canvas, multiplier?) => boolean`，有缩放时返回 `true` |
| `createProgramInfo` | `:1237` | `(gl, shaderSources, errorCallback?) => ProgramInfo`；`shaderSources` 可为 `[vertex, fragment]` |
| `createBufferInfoFromArrays` | `:1078` | `(gl, arrays) => BufferInfo` |
| `setBuffersAndAttributes` | `:1579` | `(gl, programInfo, buffers) => void` |
| `setUniforms` | `:1537` | `(programInfo, uniforms) => void`（也可传 `(gl, programInfo, uniforms)`） |
| `drawBufferInfo` | `:1095` | `(gl, bufferInfo, type?, count?, offset?) => void`，`type` 省略时用索引缓冲（本项目传 `gl.POINTS`） |

实现（`node_modules/twgl.js/dist/7.x/twgl-full.module.js`）：

- `getContext`（`:10524-10527`）= `createContext(canvas, opt_attribs)`，**拿不到就返回 `null`**，不会 throw。sora 里 `if (!gl) return` 正是为这条兜底
- `resizeCanvasToDisplaySize`（`:10536-10547`）：`width = canvas.clientWidth * multiplier | 0`（`multiplier` 默认 1），**只有 `canvas.width/height` 变化时才写入并返回 `true`**
- `getContext` 默认**不请求 WebGL2**：它按 `webgl2 → webgl → experimental-webgl` 顺序尝试（`createContext`）。sora 只用 GLSL 1.00（`attribute`/`varying`/`gl_FragColor`），WebGL1 就能跑，**这点与 paper shaders 不同**（后者硬要 `webgl2`）

### 9.2 本项目怎么用

sora 的实现是**纯手工 GL，除了这 5 个函数几乎没用 twgl 的其它能力**（顶点属性也是自己 `{ numComponents: 1, data: Float32Array }`）。Vue 版建议：

- 保留 `twgl.getContext`（它的回退链比自己写舒服），但**显式加 `{ alpha: false, depth: false, antialias: false }`**，与 Folia 一致
- 保留 `resizeCanvasToDisplaySize` + `ResizeObserver` 组合；注意它读的是 `clientWidth/clientHeight`，所以 canvas 必须有 CSS 尺寸
- 卸载时按 Folia 的做法 `gl.deleteProgram` / `gl.deleteBuffer`，**并额外加 `WEBGL_lose_context`**（twgl 不管这个；Folia 和 paper 都不管）

### 9.3 打包体积

本仓库 `node_modules/twgl.js/dist/7.x/` 实测（raw / gzip）：

| 文件 | raw | gzip |
| ---- | --- | ---- |
| `twgl-full.module.js` | 397,379 B | 76,688 B |
| `twgl-full.js`（UMD） | 438,812 B | — |
| `twgl.js`（精简入口） | 316,008 B | — |

**tree-shaking 可行性**：`twgl.js@7.0.0` 的 `package.json` 是 `main: dist/7.x/twgl-full.js`（UMD）、`module: dist/7.x/twgl-full.module.js`（ESM）、**没有 `exports` 字段**（已实测），所以打包器会走 `module` 那条 ESM 入口，具名导入（`import { getContext, createProgramInfo, setBuffersAndAttributes, setUniforms, drawBufferInfo } from 'twgl.js'`）理论上可以被摇掉未使用的导出。

但**仍必须实测**：`twgl.js` 内部有模块级单例（`s_ctx = s_ctx || ...`，`twgl-full.module.js:4146` 附近的 2D canvas 探测）与 `defaults` 对象，`sideEffects` 也没有声明，Rollup 有可能保守地保留一部分。两条降风险路线：① 用具名导入而不是 `import * as twgl`；② 只保留 `getContext`，自己写剩下四步（`createProgramInfo`/`setBuffersAndAttributes`/`setUniforms`/`drawBufferInfo` 加起来不到 60 行 GL 代码）。

另外记录一条实现事实：`getContext` 的底层 `createContext`（`twgl-full.module.js` 内）按 `["webgl2", "webgl", "experimental-webgl"]` 顺序尝试，**拿不到就返回 `null`**（不 throw）；这与 paper 的 `ShaderMount` 硬要 `webgl2` 且失败即 throw 形成对比。sora 的 GLSL 是 ES 1.00（`attribute`/`varying`/`gl_FragColor`），WebGL1 也能跑。

---

## 10. 本仓库的取舍建议

前置结论：**Folia 是 AGPL-3.0，本项目是 MIT**。仓库既有原则（`docs/refactor-plan.md:433`、`docs/folia-integration.md:687`）是「只借鉴算法思路，代码全部 Vue 重写」。本文只记录从源码阅读中提炼的算法与参数，不含 Folia 源码片段，这是一份**算法规格**而不是可编译的副本。

### 10.1 六种模式的许可与可行性

| 模式 | 依赖 | 许可 | 建议 |
| ---- | ---- | ---- | ---- |
| `common` 的 `FluidBackground` | Canvas 2D + CSS | 无第三方 | **算法重写**：结构简单（本文 §2.2 已给全部数值），没有复用价值，直接按规格写 Vue 版 |
| `common` 的 `GeometricBackground` | framer-motion + lucide | framer-motion 用于 React | **已有独立重写**（`src/features/immersive/backgrounds/geometric-model.ts` + `GeometricBackground.vue`），只需按 §10.5 对照表补齐差异 |
| `latent` | `@paper-design/shaders`（Apache-2.0） | ✅ 可直接依赖 | **直接搬 shader**：`dithering.js` 与 0.0.80 逐字节相同，`mesh-gradient.js` 数值等价。Vue 侧只写挂载器 + 取色 + 音频映射 |
| `monet` | 无 | 无第三方 | **算法重写**：全是 Canvas 2D + CSS，没有可复用代码 |
| `nomand` 的 4 种 effect | `@paper-design/shaders`（Apache-2.0） | ✅ | **直接搬 shader**；`paper-texture` 见 `§5.6` |
| `nomand` 的 `paper-texture` | 同上但版本重写 | ⚠️ | **要么锁 0.0.80，要么重新推导**（`§5.6`）。这是唯一的「不能直接复用」点 |
| `sora` | `twgl.js`（MIT） | ✅ | **算法重写 + 复用 twgl**：GLSL 字符串按 §6.2 重写（GLSL 是算法表达，且极短），不要整段复制 Folia 的 TSX |
| `url` | 无 | 无第三方 | **算法重写**：iframe + sanitize，代码量最小 |

### 10.2 每模式的打包体积评估

以本仓库 0.0.81 的实测尺寸为基数（raw / gzip，gzip 为 `gzip -9` 单文件结果，非构建产物实际值）：

| 模式 | 需要的包内文件 | raw 合计 | gzip 合计 |
| ---- | -------------- | -------- | --------- |
| 公共 | `shader-mount.js` 21,549 / 5,930；`vertex-shader.js` 5,370 / 1,349；`get-shader-color-from-string.js` 3,299 / 1,068；`shader-sizing.js` 758 / 288；`shader-utils.js` 3,669 / 1,370；`types.js` 264 / 122 | ≈ 34.9 KB | ≈ 10.1 KB |
| `latent` | 公共 + `dithering.js` 7,402 / 2,375 + `mesh-gradient.js` 3,627 / 1,317 | ≈ 45.9 KB | ≈ 13.8 KB |
| `nomand` | 公共 + `image-dithering.js` 5,532 / 1,915 + `fluted-glass.js` 10,761 / 3,040 + `halftone-dots.js` 8,517 / 2,500 + `lens-distortion.js` 8,975 / 2,936 + `paper-texture.js` 16,610 / 5,133 | ≈ 85.3 KB | ≈ 28.6 KB |
| `sora` | `twgl.js` 入口 | 316–397 KB raw | 76.7 KB gzip |
| `monet` / `url` / `common` | 无第三方 | 0 | 0 |
| （参考）`get-shader-noise-texture.js` | 只在 `paper-texture` 用 | 23,748 | 17,765（内含 PNG base64，**gzip 效果差**） |

`@paper-design/shaders/dist` 全部 `.js` 合计 270,573 B；`dist/shaders/*.js` 合计 203,724 B。**如果 barrel 入口摇不掉，整个包会多出约 200 KB raw / 60 KB gzip**（未压缩 ShaderMount 全部 40 多个 shader）。

两条降体积路线：

1. **懒加载每种模式**：`defineAsyncComponent(() => import('./latent/...'))`，把 `nomand` 的五个 shader 与 `sora` 的 twgl 拆到各自 chunk。代价是第一次切过去有一帧空白 —— 用主题底色兜底即可（所有模式本来就都有底色层）
2. **只内联用到的 fragmentShader 字符串**：`raw` 最小，但等于把 shader 从依赖里复制出来，**失去依赖升级能力**。不推荐作为默认方案，只适合 `sora` 那种自写 GLSL

### 10.3 目录落点建议

沿用仓库既有约定（`src/features/immersive/backgrounds/`，一个背景一个 `.vue` + 同名 `.scss`）：

```
src/features/immersive/backgrounds/
  registry.ts                 # 6 个 entry 的静态表：mode / order / label / component / defaults
  types.ts                    # VisualizerBackgroundConfig / RenderProps / RegistryEntry 的 Vue 版
  common/                     # 现有 FluidBackground.vue + GeometricBackground.vue 合并进这一档
  latent/LatentBackground.vue
  monet/MonetBackground.vue
  monet/monet-background-pipeline.ts
  monet/monet-background-drift.ts
  nomand/NomandBackground.vue
  nomand/nomand-shader-adjustments.ts
  nomand/nomand-presets.ts     # 五种 effect 的固定参数表
  sora/SoraBackground.vue
  url/UrlBackground.vue
  shared/paper-shader-mount.ts # Vue 版挂载器（§8.6）
  shared/paper-shader-context.ts
  shared/cover-palette.ts      # 4-bit 加权中位切分（可选，见 §11 风险 4）
  shared/audio-bands.ts        # 四频带 → 六频带 + 0–1 → 0–255
```

规则约束（`AGENTS.md`）：单组件 ≤ 400 行；仅当前页面用的组件放本页 `components/`；一个页面一个文件夹。上面每个 `.vue` 都远低于 400 行，`use-*` / `*-model.ts` 这种纯逻辑放同目录平级即可。

### 10.4 Electron 环境（Chromium 42.4.1，`file://`）注意点

| 话题 | 事实 | 影响 |
| ---- | ---- | ---- |
| WebGL2 | Electron 42 的 Chromium 完整支持下限远高于 WebGL2；`canvas.getContext('webgl2')` 可用 | paper 的 `ShaderMount` 硬依赖 `webgl2`（拿不到直接 `throw new Error('Paper Shaders: WebGL is not supported in this browser')`，`shader-mount.js:64-67`）。**仍要包一层 try/catch 并降级**（见下） |
| `file://` 与 CORS | 生产环境 `win.loadFile(.../renderer/index.html)`（`electron/main/index.ts:1046`），页面 origin 是 `file://` | `fetch` / `XHR` 对 `file://` 有额外限制；图片 `crossOrigin='anonymous'` + `texImage2D` 在 `file://` 下**行为与 http(s) 不同**，必须实测 |
| `muice-cover://` 协议 | `registerSchemesAsPrivileged` 注册（`electron/main/index.ts:70-106`）：`muice-cache://` 与 `muice-file://` = standard / secure / supportFetchAPI / stream / corsEnabled / bypassCSP；**`muice-cover://` 只有 standard / secure / supportFetchAPI / stream / corsEnabled**（无 bypassCSP） | 封面若走 `muice-cover://`，`crossOrigin='anonymous'` 的取色与 WebGL 纹理上传**未实测**。需要一次实测：`<img crossOrigin="anonymous" src="muice-cover://...">` 能否 `getImageData` / `texImage2D`。若不行，备选是走 `muice-cache://` 或把封面转成 blob/data URL |
| 网易云封面 | `session.defaultSession.webRequest.onHeadersReceived` 给 `*://*.music.126.net/*` 与 `*://*.music.126.com/*` 注入 `Access-Control-Allow-Origin: *`（`electron/main/index.ts:1057-1068`） | 网络封面取色/纹理上传**风险低**；但本地缓存封面仍需实测 |
| `backgroundThrottling` | `webPreferences.backgroundThrottling: false`（`index.ts:1006-1012` 附近） | 窗口失焦时 rAF 仍跑。注意 paper 的 `updateCurrentSpeed` 会在 `document.hidden` 或元素离屏时压到 0；sora 自己用 `paused` 控制 |
| 设备像素比 | 桌面常见 1× / 1.25× / 1.5× / 2× | `minPixelRatio` 默认值是 **2**！本项目若不显式传 `1`，在 1× 屏上会按 2 倍分辨率渲染每一个 shader，GPU 开销翻 4 倍 |
| `prefers-reduced-motion` | Chromium 支持，Windows 的「动画效果」开关会映射 | monet 的漂移已经读它（Folia 走 store）；本项目几何层已用媒体查询 |

**降级链建议（必须做，因为默认模式就是 `latent`）**：

```
1. 尝试 new ShaderMount(...)（每个模式独立 try/catch）
2. 失败 → 回退到该模式的主色渐变底色（theme.backgroundColor + accent/primary 的 linear-gradient）
3. 记录一次 console.warn（带 mode 名与错误），不要每帧重试
4. 全局维护一个 "webgl2Unavailable" 标记，第二次进入同一模式直接走回退，不再 new
```

### 10.5 与现有几何层的对照

本仓库已有 `geometric-model.ts` / `GeometricBackground.vue`（同为 `common` 模式的几何层，独立重写）。与 Folia 的差异（**有意为之，不要「修正」**）：

| 项 | Folia | 本项目 |
| -- | ----- | ------ |
| 随机源 | `Math.random()`，无语种，每次进页面都变 | `seededRandom`（哈希式，同 seed 恒等）；种子索引从 `SEED_BASE = 1000` 起 |
| 频带 | 五个独立频带（`bass/lowMid/mid/vocal/treble`） | 四频带（`low/mid/high/power`）映射到五个键 |
| 缩放曲线 | `useSpring(stiffness: 300, damping: 30)` + `useTransform([10, 200] → [0.95, 1.45])` | CSS `transition 0.12s` + 一阶映射（输入上限 0.6） |
| 动画载体 | 每个形状一个 `motion.div` 关键帧 | CSS 变量 + `@keyframes`，避免逐帧内联 style |
| 暂停 | `paused` 时切成 `StaticGeometricScene`（形状静止） | 保留动画（刻意差异，`GeometricBackground.vue` 头部注释有说明） |
| 暗角末色 | 固定 `rgba(0,0,0,0.6)` | `var(--rnp-accent-color-overlay)` |
| 无障碍 | 无 | `@media (prefers-reduced-motion: reduce)` 关闭动画 |

存量数值常量与本项目一致且已对齐：`SHAPE_COUNT = 15`、`PARTICLE_COUNT = 20`、`ICON_LIMIT = 6`、图标概率 `0.3`、尺寸 `40 + random*100`、时长 `30 + random*30`、延迟 `0–5s`、透明度 `0.11 + random*0.08`、填充概率 `0.3`、粒子 `1 + random*4 px` / 透明度 `0.3` / 时长 `15 + random*20` / 延迟 `0–10s`、漂移 `X ±15 / Y ±30`、粒子上升 `100px`、缩放 `0.95 → 1.45`。

**唯一建议补的两点**：① 图标可用名单 `BACKGROUND_ICON_NAMES` 与 Folia 的 `lyricsIcons` 机制无关（Folia 从主题读名字），如果将来要支持主题自定义图标，接口要留在 registry 层；② `getLucideIconStatus === 'loading'` 时 Folia 会 `return null`（留空不闪方块），本项目若用静态导入就不存在这个状态，可以忽略。

---

## 11. 移植风险 Top 5（按严重度排序）

### 风险 1（最高）：`paper-texture` 在 0.0.80 → 0.0.81 被整段重写

- **事实**：文件 249 → 528 行，571 行差异；uniform 与参数对象**全部换名**；`normalImage` 五项系数消失；`u_fade` 被删除；新增 `colorPaper / colorShadow / blending / distortion / clip / angle / roughnessSize / roughnessRows / foldSizeX / foldSizeY / foldOffsetX / foldOffsetY / wrinkles / wrinkleSize / crumpleCount`。见 `§5.6`。
- **连带失效**：`getPaperTextureOverscan`（`nomandShaderAdjustments.ts:75-83`）的系数 `2*folds + 1.5*crumples + 0.2*drops + 0.75*roughness + 0.1*fiber` 对应的是 0.0.80 的 `normalImage`，在 0.0.81 上**没有对应项**，必须回到 0.0.81 的片元里重新推导位移上界（或者接受固定 overscan）。
- **编译影响**：`NomandBackgroundLayer.tsx:88-90` 传的 `colorFront` 与 `:90` 的 `contrast` 在 0.0.81 的 `PaperTextureParams` 里**不存在**，TypeScript 直接报错。
- **处置**：三选一 —— 锁 `@paper-design/shaders@0.0.80`、按 0.0.81 重新推导映射、或做观感近似并**在代码里写明这是已知偏差**。无论选哪条，都不能当作「直接搬」。

### 风险 2：`file://` + WebGL2 纹理上传 / CORS

- **事实**：`ShaderMount` 硬依赖 `getContext('webgl2')`，失败即 `throw`（`shader-mount.js:64-67`）；`setTextureUniform` 还要求 `image.complete && naturalWidth > 0`，否则**再 throw 一次**（`:226-229`）。
- **两条取图路径**：`shaders-react` 会对字符串 URL 自动 `crossOrigin='anonymous'`（`:45-47`），`monetBackgroundPipeline.loadImage` 只对 `http(s)` 设 `crossOrigin`（`:52-58`）。本地封面若走自定义协议，`crossOrigin` 会让请求变成 CORS 模式，而 `muice-cover://` 在 `registerSchemesAsPrivileged` 里**没有 `bypassCSP`**（`electron/main/index.ts:82-90`）。
- **未实测项**：`<img crossOrigin='anonymous' src='muice-cover://...'>` 能否通过 `texImage2D`；`file://` 页面自身 origin 对 `data:` / `blob:` / 本地路径的判定。
- **必须做的验证**：写一个一次性页面，依次验证「网络封面（有 ACAO 注入）→ `muice-cover://` 本地封面 → 用户上传图片（可能是 `blob:` / `data:`）→ 无封面」，每个都跑一遍 `texImage2D` + `getImageData`，把结果写进实现注释。

### 风险 3：本项目四频带（0–1）→ Folia 六频带（0–255）的近似误差

- **事实**：Folia 的 `audioPower` / `audioBands.*` 是**逐帧 MotionValue**，值域 0–255（`LatentBackground.tsx:31` 的 `normalizeAudio = v/255` 就是证据）；本项目 `use-audio-bands.ts` 只有四个 0–1 值（`low` 20–250Hz、`mid` 250–2000、`high` 2000–8000、`power` 20–8000），并且 rAF 由订阅计数启停。
- **最脆弱的公式**：`resolveLatentOnsetPulse` 的 `(cur - prev) * 7`（`LatentBackground.tsx:60`）是**帧间差分**。如果值域从 0–255 换成 0–1 而系数不同步，onset 会放大 255 倍或被压成 0；两种错误都表现为「enhancedBeatResponse 开关没效果」，很难 debug。
- **平滑窗口**：`easeTowards` 的系数（0.12 / 0.16 / 0.13 / 0.42 / 0.14）是**按 60fps 每帧一次**设计的。本项目若 rAF 频率不同（或暂停时仍跑但目标恒 0），观感会整体走样。
- **处置**：在 `shared/audio-bands.ts` 里集中做一次换算，写一份「Folia 0–255 域 ↔ 本项目 0–1 域」的对照测试；不要把这些系数散落在各模式组件里。

### 风险 4：封面取色链路完全不同，六色顺序必然不同

- **事实**：Folia 用 `loadImagePixels`（50×50 缩图 + `crossOrigin='Anonymous'`）+ `extractRepresentativeColorsFromPixels`（**4-bit 量化直方图 + 加权中位切分**，按权重降序输出），见 `colorExtractor.ts:15-50` / `colorPalette.ts:77-142`；本项目用 Material You 的 `QuantizerCelebi`（`use-color-extraction.ts`），输出的是 `--rnp-accent-color*` 系列 CSS 变量。
- **影响面**：`resolveLatentShaderColors` 的 `cover-only` 模式**用六色做六个不同的槽位**（primary/secondary/tertiary/quaternary/quinary/senary），`cover-theme` 用前四色。顺序不同 → 整张 mesh 的颜色分布不同；即使取到的颜色集合相同，视觉也不一样。
- **附加坑**：Folia 的 `extractRepresentativeColors` 依赖画布不被污染，`file://` + 自定义协议下很容易整条失败并静默回退到主题色（`coverColors = []`），现象是「主题色永远生效、封面完全没影响」。
- **处置**：要么把 `colorPalette.ts` 的算法按规格重写一遍（`shared/cover-palette.ts`），要么接受差异并在文档里明确记录。**不要**用 Material You 的输出直接填六个槽位还声称「一样」。

### 风险 5：WebGL context 泄漏（paper 的 `dispose()` 不释放 context）

- **事实**：`ShaderMount.dispose()`（`shader-mount.js:386-418`）删纹理、删 program、解绑 buffer/renderbuffer/framebuffer、断开两个 observer、移除事件监听、`canvasElement.remove()`、`delete parentElement.paperShaderMount` —— **从头到尾没有 `WEBGL_lose_context`**。绘制缓冲要等 canvas 被 GC 才回收，而大量 WebGL canvas 的 GC 时机非常晚。
- **Folia 的对策**：只管了 `latent`（两个 shader 都用了 `createPaperShaderReleaseRef`）；**`nomand` 没用**（`NomandBackgroundLayer.tsx` 全文没有该 ref），而 nomand 的 shader `key` 是 `` `${sourceUrl}:<effect>` ``，换图/换 effect 都会重建 → **每切一次 effect 漏一个 context**。
- **sora 也有同类问题**：卸载时只 `deleteProgram` + `deleteBuffer`（`SoraBackground.tsx:202-205`），同样不 lose context。
- **处置**：本项目所有 WebGL 背景（latent 两个 + nomand 五个 + sora 一个）在卸载与重建时统一走一个 `releaseWebglContext(host)` 帮助函数；并且在开发期加一个计数器（`webglcontextlost` / `createContext` 次数）验证「切 20 次模式后 context 数不增长」。

---

## 12. 未确认清单（不要当成结论用）

| # | 项 | 为什么未确认 | 怎么确认 |
| - | -- | ------------ | -------- |
| 1 | `@paper-design/shaders/dist/shaders/xxx.js` 能否深链 | `package.json` 的 `exports` 只有 `"."` 一个键（`{".": {"types": ..., "import": ..., "default": ...}}`），按 Node 的 exports 规则深链会被拒绝；打包器是否放行**未实测** | 在 `vite.config.ts` 里写一次 `import { ditheringFragmentShader } from '@paper-design/shaders/dist/shaders/dithering.js'` 并跑 `pnpm build` 看是否报错 |
| 2 | barrel 入口（`dist/index.js`）的 tree-shaking 效果 | `sideEffects: false` 只是声明，实际摇掉多少**未实测** | 构建后看 chunk 里是否出现 `liquid-metal` / `gem-smoke` 这类没用到的 shader 字符串 |
| 3 | `muice-cover://` 封面的 `texImage2D` 可不可用 | 该协议注册了 `standard/secure/supportFetchAPI/stream/corsEnabled`，但**没有 `bypassCSP`**；Chromium 对自定义 secure 协议的图片是否参与 CORS **未实测** | 见风险 2 的验证页面 |
| 4 | `file://` 页面下 `crossOrigin='anonymous'` 的 `<img>` 行为 | Chromium 对 `file://` 的 CORS 有特例（`--allow-file-access-from-files` 等），Electron 默认配置下的行为**未实测** | 同样在风险 2 的验证页面里测 |
| 5 | 0.0.81 `paper-texture` 的 `normalImage` 等价项与新的最大位移公式 | 需要通读 528 行片元逐项推导，本次只确认了「旧的五系数不存在」 | 读 `node_modules/@paper-design/shaders/dist/shaders/paper-texture.js` 全文，把 `imageUV` 相关的所有加法列出来 |
| 6 | 0.0.81 里 `colorPaper` 该取什么主题色 | 0.0.80 没有对应参数，Folia 的映射不存在 | 对比 preset（`colorPaper: '#ffffff'` 之类）与实际观感，人工定一个映射并记录 |
| 7 | `@paper-design/shaders@0.0.80` 与 `0.0.81` 在**视觉输出**上是否逐像素相同（除 paper-texture） | 本次只比对源码文本与导出符号，没有跑渲染对比 | 用同一组输入分别构建两张 PNG 做像素 diff（`§5.6` 之外的 6 个 shader） |
| 8 | 本项目 `session.defaultSession.webRequest` 是否覆盖了 `muice-cover://` | 只确认了 `*.music.126.net` / `*.music.126.com` 的 ACAO 注入（`electron/main/index.ts:1057-1068`） | 读 `electron/main/index.ts` 全部 `onHeadersReceived` 注册点 |
| 9 | Folia 的 `useReducedMotionFor('monetBackground')` 在本项目对应哪个开关 | Folia 走 `useMotionSettingsStore` 的多 surface 机制；本项目只有全局 `prefers-reduced-motion` 媒体查询 | 决定是否需要引入 per-surface 开关，或者沿用全局媒体查询 |
| 10 | `shaders-react` 的 `setMinImageSize`（小图放大到 1024）对画面观感的影响 | 只读了实现（`set-min-image-size.js:6-15`），没有对比过「放大 / 不放大」两种结果的视觉差异 | 拿一张 512×512 的封面测试 |

---

## 13. 附：一页速查（implementation checklist）

- [ ] Vue 版 `ShaderMount` 挂载器（§8.6）：字符串 URL → Image（外部才 `crossOrigin`）→ `setMinImageSize`(1024) → `new ShaderMount` → 卸载时 `dispose()` + `releaseContext()`
- [ ] 统一 `PAPER_SHADER_CONTEXT_ATTRIBUTES = { antialias: false, depth: false }`（§3.6）
- [ ] 统一像素上限：latent / nomand `minPixelRatio = 1`、`maxPixelCount = 1280*720`（latent）与 `1920*1080`（nomand）
- [ ] `updatePaperShaderUniforms(mount, uniforms, speed !== 0)` 的等价实现（§8.3）
- [ ] 六种模式的 `order`：common 10 / monet 20 / nomand 30 / latent 35 / url 40 / sora 50，默认 `latent`（§1.5）
- [ ] `transparent` 在最外层直接不渲染（连几何层与暗角一起），不要实现成「背景透明但装饰还在」（§1.6）
- [ ] `staticMode` 与 `paused` 分开：前者「不挂动态层 / speed 0 / 冻结」，后者只是「音频归零 + 低速」（§0.3）
- [ ] 各模式 tuning 默认值逐字对齐 `DEFAULT_*`（§3.3 / §4.5 / §5.5 / §6.5），即使没有设置面板
- [ ] 取色链路（若追求一致）：4-bit 量化直方图 + 加权中位切分（§3.4）
- [ ] 音频换算（若追求一致）：本项目 0–1 → Folia 0–255 六频带，集中一处（§3.5）
- [ ] WebGL 降级：每个模式独立 try/catch，失败回落到主色渐变；全局标记避免反复重试（§10.4）
- [ ] 开发期验漏：模式切换 20 次后 WebGL context 数量不增长（§11 风险 5）