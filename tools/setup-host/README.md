# 有谱 · 自定义安装界面宿主(YoupuSetupHost)

## 这是什么

electron-builder 的 NSIS 安装包默认走「欢迎页 → 安装模式 → 安装目录 → 进度 → 完成」
五步向导,控件是系统风格,做不出品牌感和动画。这个目录里的程序就是**替换掉那套向导**
的安装界面宿主:

- 一个原生 Win32 无边框窗口,内部用 **WebView2**(Win10+ 随 Edge 提供)渲染
  `ui/` 下那份自包含的 HTML/CSS/JS;
- 界面分三段:选项(功能轮播 + 安装位置/磁盘空间/快捷方式)、进度(环形进度 + 阶段清单)、
  完成(彩带 + 立即启动);
- 选项页上半部是六幕 2D 矢量动画轮播:自动播放(每页 6 秒,底部进度条),可点左右箭头 /
  圆点 / 方向键手动切换,鼠标悬停暂停;**只有当前页的动画在跑**,其余页被暂停;
- **单窗口**:全程只有本窗口,不会出现"关掉一个再弹一个"。

## 安装过程怎么串起来的(改 install 流程前必读)

安装包(`build/installer.nsh`)有两个身份,宿主只跟第二个身份打交道:

1. **启动器**:用户双击安装包 → 安装包在 `.onInit` 里把本宿主释放到
   `%TEMP%\youpu-setup-host`,写出 `youpu-payload.ini`,拉起宿主后**立即退出**。
   宿主建好窗口就写出 `youpu-host-started` 标记文件;安装包只等 5 秒,
   等不到就结束宿主进程并回退到 electron-builder 原生向导。
   > ⚠ 启动器**必须立刻退出**。electron-builder 的 `ALLOW_ONLY_ONE_INSTALLER_INSTANCE`
   > 在 `.onInit` 里创建 `${APP_GUID}` 单实例互斥体并持有到进程结束;启动器只要还活着,
   > 下面第 2 步的静默安装就会在它自己的 `.onInit` 里被判成"已有安装程序在运行",
   > 直接 `Abort` 并以退出码 2 结束(0.6 秒退出、一个文件都不写)。
   > 这是 2.0.4 版"安装没反应、界面未响应"的根因,别再改回 `ExecWait` 等待宿主结束。
2. **静默安装器**:用户点「开始安装」→ 宿主写出 `youpu-result.ini`(安装目录 +
   快捷方式开关 + 是否启动),然后以
   `/S /youpu-nested /youpu-result="…" /youpu-response="…" /D=<目录>` 拉起**同一份安装包**。
   静默实例全程无窗口,把阶段与百分比写进 `youpu-response.json`,宿主轮询它推进界面,
   安装结束后按勾选决定要不要拉起应用。
3. **回退**:宿主检测到 WebView2 缺失或初始化失败(退出码 3 / 4)时,用
   `/youpu-classic` 重新拉起安装包走原生向导 —— 那条路径不会再启动宿主,不会成环。

三个中转文件(payload / result / response)都放在 `%TEMP%\youpu-setup-host`,与宿主
exe/dll 同目录:**不能放 `$PLUGINSDIR`**,安装器一退出它就会被删掉。

宿主退出码见 `src/SetupExitCodes.cs`:`2` 用户取消、`3` 缺 WebView2(回退原生向导)、
`4` 初始化失败(回退)、`5` 安装失败、`10` 安装完成、`11` 已有界面在运行。
**WebView2 缺失时安装照常进行**,只是换成 electron-builder 的原生向导。

## 视觉规范(改界面前必读)

- **配色只有一处真源**:`ui/index.html` 的 `:root`。中性底取自产品图标
  `build/icon-preview.png` 的底色 `#090D1A`,强调色取自图标音点的 `#7460E8`;
  **全站只有一个色相**,用同色相的三级明度(accent / accent-2 / accent-3)代替第二个颜色。
  想加新颜色前先问:现有色阶能不能表达?语义色(失败红、空间不足琥珀、Windows 关闭红)
  只用于状态,不参与品牌表达。
- 品牌标记是构建期内联的 96x96 PNG(由 `build/icon-preview.png` 裁掉底部字标生成)。
  刻意不引外部文件:界面是单文件 HTML,整份内嵌进 exe,运行时不能依赖任何旁路资源。
- 圆角只有三档:卡片 18px、控件 10px、胶囊 999px。
- 动效只动 `transform` / `opacity`;只有当前轮播页在跑动画,其余页被暂停。

## 构建

```bash
node scripts/build-setup-host.mjs
```

产物:

| 文件 | 说明 |
| --- | --- |
| `build/setup-host/YoupuSetupHost.exe` | 引导程序,UI 已作为内嵌资源打进 exe |
| `build/setup-host/WebView2Loader.dll` | WebView2 原生加载器(x64,随仓库提交) |

它由 `electron-builder.ts` 的 `beforePack` 钩子在打包前自动调用,再由
`build/installer.nsh` 的 `SETUP_HOST_DIR` 引用。单独构建用于本地调试。

## 目录结构

| 路径 | 职责 |
| --- | --- |
| `src/Program.cs` | 入口:解析参数、加载 payload、建窗口、进消息循环 |
| `src/NativeHost.cs` | 原生 Win32 窗口:注册类、无边框、圆角、拖拽区、DPI、自绘背景 |
| `src/WebView2Host.cs` | 业务宿主:把窗口与 WebView2 桥接,处理关闭/取消/浏览目录 |
| `src/WebView2Bridge.cs` | WebView2 生命周期:环境 → 控制器 → ICoreWebView2 → 事件订阅 |
| `src/WebView2Interop.cs` | 手写 COM 互操作(vtable + GUID),含 `GetInterfacePointer` |
| `src/SetupProtocol.cs` | 与页面的 JSON 消息协议 + 界面文案(唯一真源) |
| `src/InstallRunner.cs` | 写选项回执、拉起静默安装、轮询进度回执 |
| `src/InstallPayload.cs` | 解析 NSIS 写出的 `youpu-payload.ini` |
| `src/LauncherOptions.cs` | 命令行参数 |
| `src/WebView2Availability.cs` | 注册表探测 WebView2 运行时 + 语言判定 |
| `src/FolderPicker.cs` | 系统"选择文件夹"对话框 |
| `src/SetupLog.cs` | 日志(唯一排障通道) |
| `src/SetupExitCodes.cs` | 退出码约定(改这里要跟着看 `build/installer.nsh` 的分流) |
| `ui/index.html` | 界面结构与样式(自包含,无外部资源),含全部场景动画关键帧 |
| `ui/scenes.js` | 轮播场景:六幕内联 SVG 与重复节点(均衡器/歌词行/火花)的生成 |
| `ui/youpu-setup.js` | 界面逻辑:轮播、视图切换、进度环、磁盘空间、拖动、消息收发 |
| `YoupuSetupHost.exe.manifest` | DPI 感知声明(PerMonitorV2),编译时 `/win32manifest:` |

### 消息协议

| 方向 | 消息 `type` |
| --- | --- |
| 宿主 → 页面 | `init` / `bridgeReady` / `browseResult` / `spaceInfo` / `installStarted` / `progress` / `installComplete` / `installFailed` |
| 页面 → 宿主 | `ready` / `browse` / `querySpace` / `dragStart` / `beginInstall` / `openExternal` / `minimize` / `cancel` / `close` |

以 `src/SetupProtocol.cs` 为唯一真源:字段、界面文案、分发都在那里;`ui/youpu-setup.js`
顶部的注释是页面侧的另一半。新增消息必须同时改这两处。

## 环境约束(改代码前必读)

这些都是踩过坑之后定下来的,**不要"顺手简化"**,否则会以很难定位的方式坏掉。

### 1. 必须用原生 Win32 顶层窗口,不能用 WinForms

在装有**虚拟显示适配器**的机器上(远程控制软件、安卓模拟器自带的那种),把 WebView2
放进 WinForms `Form` 里画面**完全不上屏**:页面加载正常、`postMessage` 双向正常、
`NavigateToString` 返回 `S_OK`,但窗口里只有窗体底色。

诊断过程:先确认页面本身没问题(同一份 HTML 用 headless Edge 渲染正常),再退到
"最小 Win32 窗口 + CreateCoreWebView2Controller" —— 立刻正常。所以宿主是自己
`RegisterClassEx` + `CreateWindowEx` + `GetMessage` 循环,这是 WebView2 官方文档要求的
宿主形态。

### 2. 传给原生回调的接口必须是 `public`

`IEnvironmentCreatedHandler` / `IControllerCreatedHandler` / `IWebMessageReceivedHandler`
/ `INavigationCompletedHandler` 这些由托管类实现、再交回原生侧的接口,必须声明为
**`public interface`**。只加 `[ComVisible(true)]` 而保持 `internal` 不够:
`QueryInterface` 返回 `E_NOINTERFACE (0x80004002)`,表现为调用
`CreateCoreWebView2EnvironmentWithOptions` 之后毫无反应。

### 3. 用 `GetInterfacePointer`,不要用 `Marshal.GetComInterfaceForObject`

对这里手写的 `[ComImport]` 接口,`Marshal.GetComInterfaceForObject` 会抛
`ArgumentException: 指定类型必须在 COM 中可见`(它自己的可见性检查误判)。
`WebView2Loader.GetInterfacePointer`(`GetIUnknownForObject` + `QueryInterface`)
走的是同一套 CCW,但绕开了该检查。

### 4. COM 接口的 vtable 顺序不能凭记忆写

`src/WebView2Interop.cs` 里手写接口的方法顺序 = vtable 槽位顺序,**错一位就崩进程**
(不是抛异常,是直接退出)。现有顺序是反射官方 `Microsoft.Web.WebView2.Core.dll`
的 `Raw` 命名空间逐个核对出来的。改动前请用同样办法复核:

```powershell
$asm = [Reflection.Assembly]::LoadFrom('<nuget>\lib\net462\Microsoft.Web.WebView2.Core.dll')
$asm.GetTypes() | Where-Object { $_.Name -eq 'ICoreWebView2' } |
  ForEach-Object { $_.GetMethods() | ForEach-Object Name }
```

当前用到的接口与 IID:

| 接口 | IID |
| --- | --- |
| `ICoreWebView2Environment` | `b96d755e-0319-4e92-a296-23436f46a1fc` |
| `ICoreWebView2Controller` | `4d00c0d1-9434-4eb6-8078-8697a560334f` |
| `ICoreWebView2` | `76eceacb-0462-4d94-ac83-423a6793775e` |
| `ICoreWebView2Settings` | `e562e4f0-d7fa-43ac-8d71-c05150499f00` |
| `ICoreWebView2WebMessageReceivedEventArgs` | `0f99a40c-e962-4207-9e92-e3d542eff849` |
| `IControllerCreatedHandler`(官方名 `ICoreWebView2ControllerCreatedHandler`) | `6c4819f3-c9b7-4260-8127-c9f5bde7f68c` |
| `IEnvironmentCreatedHandler`(官方名 `ICoreWebView2EnvironmentCreatedHandler`) | `4e8a3389-c9d8-4bd2-b6b5-124fee6cc14d` |
| `IWebMessageReceivedHandler`(官方名 `ICoreWebView2WebMessageReceivedEventHandler`) | `57213f19-00e6-49fa-8e07-898ea01ecbd2` |
| `INavigationCompletedHandler`(官方名 `ICoreWebView2NavigationCompletedEventHandler`) | `d33a35bf-1c49-4f98-93ab-006e0533fe1c` |

槽位只能**追加在末尾**:宿主当前用不到的槽位(`CapturePreview` / `ExecuteScript` /
`CallDevToolsProtocolMethod` 等)也必须原样留着 —— 删掉中间一个,它后面的所有调用
都会错到下一个槽位上。

### 5. CDP 与 `CapturePreview` 在本宿主里都不可用

- `--remote-debugging-port`(通过 `ICoreWebView2EnvironmentOptions`):QueryInterface
  拿不到接口指针,环境创建直接失败(`hr=0x80070002`),界面出不来。现在
  `CreateCoreWebView2EnvironmentWithOptions` 的环境参数固定传 `IntPtr.Zero`,
  `src/WebView2EnvironmentOptions.cs` 已随诊断代码一起删除,不要为了"临时调试"再加回来。
- `ICoreWebView2.CapturePreview`:返回 `S_OK` 但回调**永不触发**,拿不到画面。

要确认界面渲染是否正常,用最朴素的办法:看 `%TEMP%\youpu-setup-host.log` 里
`bridge: navigation completed` 与页面发来的消息,再用截图工具抓窗口。

同理,开发期那批环境变量开关(`YOUPU_SETUP_PROBE` / `_CAPTURE` / `_DIAGNOSE` /
`_AUTOFLOW` / `_DEBUG_PORT`)已经从源码里全部删掉,也不要加回来:它们会在正常安装
流程里插进只有开发机才走得到的分支,出问题时反而更难判断走的哪条路。

### 6. 窗口尺寸与 DPI

- 进程通过 `YoupuSetupHost.exe.manifest` 声明 **PerMonitorV2**;清单由构建脚本用
  `/win32manifest:` 传给 csc。不声明的话系统对 DPI 的处理不确定,窗口尺寸与网页
  viewport 的换算会对不上。
- 窗口用 `WS_POPUP` + `WM_NCCALCSIZE` 返回 0 得到真正的无边框;`FitClientArea` 会
  迭代校正外框,直到**客户区**等于 `设计尺寸 × 系统DPI/96`。
- 定位用 `CenterOnWorkArea`,在窗口创建**之后**按实测外框重新居中 ——
  `CreateWindowEx` 请求的尺寸会被系统按 DPI 改写,用请求尺寸算居中含偏出屏幕。

### 7. 窗口尺寸只有一处真源

设计尺寸写在 `SetupProtocol.DesignWidth/DesignHeight`(当前 960x680),宿主建窗口和页面排版
都从它取值(页面通过 `init.bridge.designWidth` 拿)。**改窗口大小只改这两个常量**,再在别处
写第二份尺寸一定会漂移。`init` 会被下发四到五次,页面侧的 `handleInit` 必须幂等:轮播只在
第一次构建,后续只刷新文案 —— 否则每次重发都把轮播打回第一页、并清空底部已回填的路径。

### 8. 拖动必须由页面发起

WebView2 的子窗口铺满整个客户区,父窗口的 `WM_NCHITTEST` **收不到**鼠标消息,所以"顶部区域
返回 HTCAPTION"这条常规路径在 WebView2 下永远不会触发(这是"窗口拖不动"的根因)。真正的
链路是:页面在标题栏按下(排除按钮/输入框)时发 `dragStart`,宿主 `ReleaseCapture()` 之后
`SendMessage(WM_NCLBUTTONDOWN, HTCAPTION)` 走系统拖动。`NativeHost.WindowProc` 里那条
`WM_NCHITTEST` 分支只作为无 WebView2 时的兜底保留。

### 9. 覆盖安装的默认目录来自注册表

`youpuPreparePayload` 写出的 `defaultInstallDir` 取的是 `$INSTDIR`。交互式安装路径里
`$INSTDIR` **不会**自动等于上次的安装位置,必须在启动器里(`youpuDetectExisting`)把
`${INSTALL_REGISTRY_KEY}` 的 `InstallLocation` 读回来、回写 `$INSTDIR`,并把
`$youpuExisting` 置 1(界面据此显示"升级安装",默认目录显示原位置)。漏掉这一步的表现是:
升级安装时默认路径仍是全新安装的路径,`isUpdate` 永远是 0。

### 10. 只有主窗口可以结束消息循环

窗口尺寸测量曾用"建个探针窗口再销毁"的办法,结果探针的 `WM_DESTROY` 触发了
`PostQuitMessage`,主窗口刚建好就退出。现在宿主只有一个窗口,`NativeHost.WindowProc`
的 `WM_DESTROY` 直接 `PostQuitMessage(0)`;如果将来再引入任何辅助/探针窗口,
必须给它单独的消息处理(或加一个"是否主窗口"的判断),否则主窗口会被它的销毁带停。

### 11. 选择文件夹:CoTaskMemFree 不在 shell32 里

`SHBrowseForFolder` 返回的 PIDL 要用 `CoTaskMemFree` 释放,而这个导出属于 **ole32.dll**
(shell32 只导出 `ILFree`)。旧代码把它声明在 shell32,于是**每次成功选完目录**,`finally`
里都会抛 `EntryPointNotFoundException`;C# 的 finally 抛异常会丢弃返回值,于是
`PromptForDirectory` 走不到 `PostMessage` —— 页面永远收不到 `browseResult`,表现就是
"选完安装位置,界面不刷新"。现在:导入改到 ole32、释放单独 try/catch、
`PromptForDirectory` 无论成败都回执。

另外 `BROWSEINFO.lParam` 只在有回调(`lpfn`)时才有意义;要指定初始目录必须在
`BFFM_INITIALIZED` 回调里发 `BFFM_SETSELECTION`,直接往 `lParam` 塞字符串没有任何作用。

### 12. 消息循环必须显式用 Unicode 变体

`GetMessage` / `TranslateMessage` / `DispatchMessage` / `DefWindowProc` 这四个 P/Invoke
**必须带 `CharSet = CharSet.Unicode`**(即调用 `*W` 版本)。默认(不带 CharSet)会解析成
`*A`,于是这个 Unicode 窗口的文本消息全被按 ANSI 处理,表现为:

- 窗口标题从创建那一刻起就是乱码 —— `"有谱 安装程序 — Youpu Setup"` 读回来是
  `"\tg1?"`(4 个字符),任务栏、Alt-Tab、任务管理器里同样乱码;
- 本进程 `SetWindowText` 返回成功(错误码 0)却改不动标题,`GetWindowText` 也读不回来;
- 跨进程发来的文本消息(WM_SETTEXT、WM_CHAR、IME 相关)会被 `GetMessageA` /
  `DispatchMessageA` 降级成 ANSI。

定位办法:把标题写成一个最小 C# 复现程序(只做 RegisterClassEx + CreateWindowExW +
GetWindowTextW),分别转发 `DefWindowProcA` 与 `DefWindowProcW` 对比 —— 前者乱码、后者正确。
`build/installer.nsh` 里"安装程序已经在运行"时按标题 `FindWindow` 前置已有窗口,也依赖这一条。

## 排障

宿主日志:`%TEMP%\youpu-setup-host.log`(UTF-8)。关键行:

- `==== 有谱安装引导程序启动 pid=… ====` 与 `args:` —— 确认参数
- `bridge: WebView2 runtime <版本>` —— 运行时可用性
- `bridge: ready` / `bridge: navigation completed` —— 界面是否上屏
- `js->host {…}` —— 页面发来的消息(ready / browse / beginInstall / cancel / close …,类型见 `src/SetupProtocol.cs`)
- `窗口就绪 … dpi=…` —— 尺寸换算结果
- `install: 启动 <安装包> /S /youpu-nested …` —— 静默安装的完整命令行(排查参数问题看这行)
- `install: 静默安装结束 exitCode=<码>` —— **静默安装的退出码**:`2` 几乎总是"安装包进程还活着,
>   被单实例互斥体拦下"(见上面第 1 步的警告);`0` 才是成功
- `host: shutdown code=<退出码>` —— 结局
