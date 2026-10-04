// WebView2 生命周期与消息通道。所有原生调用集中在此,出错时便于定位。
// 初始化顺序:CreateCoreWebView2EnvironmentWithOptions -> 环境就绪 ->
// CreateCoreWebView2Controller -> 控制器就绪 -> 取 ICoreWebView2 -> 订阅消息/导航事件。
// 宿主是原生 Win32 顶层窗口(NativeHost),不再依赖 System.Windows.Forms。
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

namespace YoupuSetupHost
{
    internal sealed class WebView2Bridge : IDisposable
    {
        private readonly WebView2Host _host;
        private ICoreWebView2Environment _environment;
        private ICoreWebView2Controller _controller;
        private ICoreWebView2 _webView;
        private string _userDataFolder;
        private bool _ready;
        private bool _disposed;
        private string _pendingHtml;

        private EnvironmentCreatedHandler _environmentHandler;
        private ControllerCreatedHandler _controllerHandler;
        private WebMessageReceivedHandler _messageHandler;
        private NavigationCompletedHandler _navigationHandler;

        public WebView2Bridge(WebView2Host host)
        {
            _host = host;
        }

        public void Initialize()
        {
            try
            {
                SetupLog.Write("bridge: 运行时检测 = " + (WebView2Availability.IsRuntimeInstalled() ? "已安装" : "缺失"));
                if (!WebView2Availability.IsRuntimeInstalled())
                {
                    SetupLog.Write("bridge: 未检测到 WebView2 运行时");
                    _host.Shutdown(SetupExitCodes.WebView2Missing);
                    return;
                }

                _userDataFolder = Path.Combine(
                    Path.GetTempPath(),
                    "youpu-setup-wv2-" + System.Diagnostics.Process.GetCurrentProcess().Id);
                Directory.CreateDirectory(_userDataFolder);

                _environmentHandler = new EnvironmentCreatedHandler(this);
                IntPtr handlerPtr = WebView2Loader.GetInterfacePointer(
                    _environmentHandler, new Guid("4e8a3389-c9d8-4bd2-b6b5-124fee6cc14d"));
                // 环境参数指针固定为 IntPtr.Zero:本宿主不需要任何附加浏览器参数。
                // 曾经的 --remote-debugging-port(经 ICoreWebView2EnvironmentOptions)在这条
                // 路径上拿不到接口指针,会让环境创建直接失败,详见 README「环境约束 5」。
                int hr = WebView2Loader.CreateCoreWebView2EnvironmentWithOptions(
                    null, _userDataFolder, IntPtr.Zero, handlerPtr);
                if (hr != WebView2Loader.S_OK)
                {
                    SetupLog.Write("bridge: CreateCoreWebView2EnvironmentWithOptions hr=0x" + hr.ToString("X8"));
                    _host.Shutdown(SetupExitCodes.WebView2InitFailed);
                }
            }
            catch (Exception ex)
            {
                SetupLog.Write("bridge: Initialize 异常 " + ex);
                _host.Shutdown(SetupExitCodes.WebView2InitFailed);
            }
        }

        public void NavigateToString(string html)
        {
            if (!_ready)
            {
                _pendingHtml = html;
                return;
            }
            int hr = _webView.NavigateToString(html);
            if (hr != WebView2Loader.S_OK)
            {
                SetupLog.Write("bridge: NavigateToString hr=0x" + hr.ToString("X8"));
            }
        }

        public void PostMessage(string json)
        {
            if (!_ready || _disposed)
            {
                return;
            }
            int hr = _webView.PostWebMessageAsJson(json);
            if (hr != WebView2Loader.S_OK)
            {
                SetupLog.Write("bridge: PostWebMessageAsJson hr=0x" + hr.ToString("X8"));
            }
        }

        public void SyncBounds(System.Drawing.Size size)
        {
            if (_controller == null || size.Width <= 0 || size.Height <= 0)
            {
                return;
            }
            RECT rect = new RECT { Left = 0, Top = 0, Right = size.Width, Bottom = size.Height };
            _controller.Put_Bounds(rect);
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }
            _disposed = true;
            try
            {
                if (_controller != null)
                {
                    _controller.Close();
                    Marshal.ReleaseComObject(_controller);
                    _controller = null;
                }
                if (_webView != null)
                {
                    Marshal.ReleaseComObject(_webView);
                    _webView = null;
                }
                if (_environment != null)
                {
                    Marshal.ReleaseComObject(_environment);
                    _environment = null;
                }
            }
            catch (Exception ex)
            {
                SetupLog.Write("bridge: Dispose 异常 " + ex.Message);
            }
            _ready = false;
            TryDeleteUserDataFolder();
        }

        private void TryDeleteUserDataFolder()
        {
            if (string.IsNullOrEmpty(_userDataFolder))
            {
                return;
            }
            for (int attempt = 0; attempt < 3; attempt++)
            {
                try
                {
                    Directory.Delete(_userDataFolder, true);
                    return;
                }
                catch
                {
                    System.Threading.Thread.Sleep(120);
                }
            }
            SetupLog.Write("bridge: 临时数据目录未能清理(可忽略): " + _userDataFolder);
        }

        // ---- WebView2 回调 ----

        private sealed class EnvironmentCreatedHandler : IEnvironmentCreatedHandler
        {
            private readonly WebView2Bridge _owner;

            public EnvironmentCreatedHandler(WebView2Bridge owner)
            {
                _owner = owner;
            }

            public int Invoke(int errorCode, IntPtr environment)
            {
                try
                {
                    _owner.OnEnvironmentCreated(errorCode, environment);
                }
                catch (Exception ex)
                {
                    SetupLog.Write("bridge: 环境回调异常 " + ex);
                }
                return 0;
            }
        }

        private sealed class ControllerCreatedHandler : IControllerCreatedHandler
        {
            private readonly WebView2Bridge _owner;

            public ControllerCreatedHandler(WebView2Bridge owner)
            {
                _owner = owner;
            }

            public int Invoke(int errorCode, IntPtr controller)
            {
                try
                {
                    _owner.OnControllerCreated(errorCode, controller);
                }
                catch (Exception ex)
                {
                    SetupLog.Write("bridge: 控制器回调异常 " + ex);
                }
                return 0;
            }
        }

        private sealed class WebMessageReceivedHandler : IWebMessageReceivedHandler
        {
            private readonly WebView2Bridge _owner;

            public WebMessageReceivedHandler(WebView2Bridge owner)
            {
                _owner = owner;
            }

            public int Invoke(IntPtr sender, IntPtr args)
            {
                try
                {
                    _owner.OnWebMessageReceived(args);
                }
                catch (Exception ex)
                {
                    SetupLog.Write("bridge: 消息回调异常 " + ex);
                }
                return 0;
            }
        }

        private sealed class NavigationCompletedHandler : INavigationCompletedHandler
        {
            private readonly WebView2Bridge _owner;

            public NavigationCompletedHandler(WebView2Bridge owner)
            {
                _owner = owner;
            }

            public int Invoke(IntPtr sender, IntPtr args)
            {
                try
                {
                    _owner.OnNavigationCompleted();
                }
                catch (Exception ex)
                {
                    SetupLog.Write("bridge: 导航回调异常 " + ex);
                }
                return 0;
            }
        }

        private void OnEnvironmentCreated(int errorCode, IntPtr environment)
        {
            if (errorCode != 0 || environment == IntPtr.Zero)
            {
                SetupLog.Write("bridge: 环境创建失败 errorCode=0x" + errorCode.ToString("X8"));
                _host.Shutdown(SetupExitCodes.WebView2InitFailed);
                return;
            }

            _environment = (ICoreWebView2Environment)Marshal.GetObjectForIUnknown(environment);
            string version;
            if (_environment.Get_BrowserVersionString(out version) == WebView2Loader.S_OK)
            {
                SetupLog.Write("bridge: WebView2 runtime " + version);
            }

            _controllerHandler = new ControllerCreatedHandler(this);
            IntPtr handlerPtr = WebView2Loader.GetInterfacePointer(
                _controllerHandler, new Guid("6c4819f3-c9b7-4260-8127-c9f5bde7f68c"));
            int hr = _environment.CreateCoreWebView2Controller(_host.Handle, handlerPtr);
            if (hr != WebView2Loader.S_OK)
            {
                SetupLog.Write("bridge: CreateCoreWebView2Controller hr=0x" + hr.ToString("X8"));
                _host.Shutdown(SetupExitCodes.WebView2InitFailed);
            }
        }

        private void OnControllerCreated(int errorCode, IntPtr controller)
        {
            if (errorCode != 0 || controller == IntPtr.Zero)
            {
                SetupLog.Write("bridge: 控制器创建失败 errorCode=0x" + errorCode.ToString("X8"));
                _host.Shutdown(SetupExitCodes.WebView2InitFailed);
                return;
            }

            _controller = (ICoreWebView2Controller)Marshal.GetObjectForIUnknown(controller);
            _controller.Put_IsVisible(1);
            SyncBounds(_host.ClientSize);

            IntPtr core;
            if (_controller.Get_CoreWebView2(out core) != WebView2Loader.S_OK || core == IntPtr.Zero)
            {
                SetupLog.Write("bridge: Get_CoreWebView2 返回空指针");
                _host.Shutdown(SetupExitCodes.WebView2InitFailed);
                return;
            }

            _webView = (ICoreWebView2)Marshal.GetObjectForIUnknown(core);
            ConfigureSettings();

            long token;
            _messageHandler = new WebMessageReceivedHandler(this);
            _webView.add_WebMessageReceived(
                WebView2Loader.GetInterfacePointer(_messageHandler, new Guid("57213f19-00e6-49fa-8e07-898ea01ecbd2")), out token);

            _navigationHandler = new NavigationCompletedHandler(this);
            _webView.add_NavigationCompleted(
                WebView2Loader.GetInterfacePointer(_navigationHandler, new Guid("d33a35bf-1c49-4f98-93ab-006e0533fe1c")), out token);

            _ready = true;
            SetupLog.Write("bridge: ready");

            if (_pendingHtml != null)
            {
                string html = _pendingHtml;
                _pendingHtml = null;
                NavigateToString(html);
            }
        }

        private void ConfigureSettings()
        {
            try
            {
                IntPtr settingsPtr;
                if (_webView.Get_Settings(out settingsPtr) != WebView2Loader.S_OK || settingsPtr == IntPtr.Zero)
                {
                    return;
                }
                ICoreWebView2Settings settings = (ICoreWebView2Settings)Marshal.GetObjectForIUnknown(settingsPtr);
                settings.Put_AreDefaultContextMenusEnabled(0);
                settings.Put_IsStatusBarEnabled(0);
                settings.Put_IsZoomControlEnabled(0);
                settings.Put_AreDevToolsEnabled(0);
                Marshal.ReleaseComObject(settings);
            }
            catch (Exception ex)
            {
                SetupLog.Write("bridge: ConfigureSettings 异常 " + ex.Message);
            }
        }

        private void OnWebMessageReceived(IntPtr argsPtr)
        {
            if (argsPtr == IntPtr.Zero)
            {
                return;
            }
            ICoreWebView2WebMessageReceivedEventArgs args =
                (ICoreWebView2WebMessageReceivedEventArgs)Marshal.GetObjectForIUnknown(argsPtr);
            string json;
            int hr = args.TryGetWebMessageAsString(out json);
            Marshal.ReleaseComObject(args);
            if (hr != WebView2Loader.S_OK || string.IsNullOrEmpty(json))
            {
                return;
            }
            SetupLog.Write("js->host " + Trim(json));
            SetupProtocol.Handle(_host, this, json);
        }

        /// <summary>日志里不希望出现完整的长路径,截断到 160 字符。</summary>
        internal static string Trim(string text)
        {
            if (string.IsNullOrEmpty(text) || text.Length <= 160)
            {
                return text;
            }
            return text.Substring(0, 160) + "…";
        }

        private void OnNavigationCompleted()
        {
            SetupLog.Write("bridge: navigation completed");
            // 已知问题:控制器若在窗口真正显示前创建,WebView2 的画面可能一直不上屏。
            // 这里在导航完成后做一次"隐藏 → 改尺寸 → 显示 → 复位"的唤醒序列。
            try
            {
                System.Drawing.Size size = _host.ClientSize;
                _controller.Put_IsVisible(0);
                _controller.Put_Bounds(new RECT { Left = 0, Top = 0, Right = size.Width - 1, Bottom = size.Height - 1 });
                _controller.Put_IsVisible(1);
                _controller.Put_Bounds(new RECT { Left = 0, Top = 0, Right = size.Width, Bottom = size.Height });
                _host.Refresh();
                SetupLog.Write("bridge: 已执行上屏唤醒序列 " + size.Width + "x" + size.Height);
            }
            catch (Exception ex)
            {
                SetupLog.Write("bridge: 上屏唤醒失败 " + ex.Message);
            }

            _host.PostMessage(SetupProtocol.Json(new Dictionary<string, object>
            {
                { "type", "bridgeReady" }
            }));
        }
    }
}
