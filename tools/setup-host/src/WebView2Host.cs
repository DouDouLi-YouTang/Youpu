// 安装引导程序的窗口宿主:无边框圆角原生窗口 + WebView2 渲染安装界面。
//
// 历史教训:第一版用 WinForms 承载 WebView2,在装有虚拟显示适配器(远程控制、
// 安卓模拟器自带的那种)的机器上,WebView2 的画面完全不上屏 —— 页面加载正常、
// postMessage 正常,窗口里却只有窗体底色。改用原生 Win32 顶层窗口 + 自己的
// 消息循环后正常,这也是 WebView2 官方文档要求的宿主形态。
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Timers;

namespace YoupuSetupHost
{
    internal sealed class WebView2Host : IDisposable
    {
        private readonly WebView2Bridge _bridge;
        private readonly InstallPayload _payload;
        private readonly NativeHost _window;
        private InstallRunner _runner;
        private string _bootstrapJson = string.Empty;
        private bool _bootstrapDelivered;
        private bool _closing;
        private int _exitCode;

        public WebView2Host(InstallPayload payload, int width, int height)
        {
            _payload = payload;
            _bridge = new WebView2Bridge(this);
            _window = new NativeHost("有谱 安装程序 — Youpu Setup", width, height);
            _window.OnCloseRequested = OnWindowCloseRequested;
            _window.OnEscapePressed = OnEscapePressed;
            _window.OnResized = OnWindowResized;
        }

        public SetupProtocol.Options Options { get; set; }

        public int ExitCode
        {
            get { return _exitCode; }
        }

        public IntPtr Handle
        {
            get { return _window.Handle; }
        }

        public Size ClientSize
        {
            get { return _window.ClientSize; }
        }

        /// <summary>页面报告的顶部拖拽区高度(CSS 像素)。</summary>
        public int TerminalDragHeight
        {
            get { return _window.DragZoneHeight; }
            set { _window.DragZoneHeight = value; }
        }

        public void SetBootstrapJson(string json)
        {
            _bootstrapJson = json ?? string.Empty;
        }

        /// <summary>
        /// 「窗口已就绪」标记文件路径(由 Program 按 payload 所在目录给出)。
        /// 安装包启动器 Exec 本进程后只等这个文件:写出来它就退出并把界面交给本进程,
        /// 5 秒写不出来它就会结束本进程并回退到原生安装界面。所以必须在建窗口后立刻写。
        /// </summary>
        public string ReadyMarkerPath { get; set; }

        public void Start()
        {
            _window.Create();
            SignalReady();
            _bridge.Initialize();
            _window.ShowAndLoop();
            _bridge.Dispose();
            if (_runner != null)
            {
                _runner.Stop();
            }
        }

        private void SignalReady()
        {
            if (string.IsNullOrEmpty(ReadyMarkerPath))
            {
                return;
            }
            try
            {
                File.WriteAllText(ReadyMarkerPath, DateTime.Now.ToString("o"));
            }
            catch (Exception ex)
            {
                SetupLog.Write("host: 写出就绪标记失败 " + ex.Message);
            }
        }

        public void LoadHtml(string html)
        {
            _bridge.NavigateToString(html);
        }

        public void PostMessage(string json)
        {
            _bridge.PostMessage(json);
        }

        /// <summary>
        /// 下发初始数据。页面每次发 ready 都重发一次(页面侧 handleInit 幂等),
        /// 因为页面挂载消息监听与宿主收到 ready 之间存在竞态,首帧消息可能落空。
        /// </summary>
        public void ResendBootstrap()
        {
            if (string.IsNullOrEmpty(_bootstrapJson))
            {
                return;
            }
            PostMessage(_bootstrapJson);
            if (_bootstrapDelivered)
            {
                return;
            }
            _bootstrapDelivered = true;
            ScheduleBootstrapRetry(420);
            ScheduleBootstrapRetry(1300);
        }

        public void BeginInstall(SetupProtocol.Options options)
        {
            if (_runner != null)
            {
                // 上一次已经失败并回到选项页:允许重新安装(「返回重试」)
                if (!_runner.IsFinished)
                {
                    return;
                }
                _runner.Stop();
                _runner = null;
            }
            _runner = new InstallRunner(this, _payload);
            _runner.Begin(options);
        }

        public void CancelInstall()
        {
            if (_runner == null || _runner.IsFinished)
            {
                // 界面上的「取消安装」:没在装就直接退,退之前按用户取消记退出码
                Shutdown(SetupExitCodes.UserCancelled);
                return;
            }
            SetupLog.Write("host: 安装进行中收到取消请求,忽略");
        }

        /// <summary>
        /// 用户点了完成页的主按钮,或直接关掉窗口。launch = 完成页上点的是「立即启动」,
        /// 这时按用户意愿把应用拉起来(勾选框没勾也照样启动,是他自己点的)。
        /// </summary>
        public void CompleteAndClose(bool launch)
        {
            if (_runner == null)
            {
                // 还没开始安装就关窗口 = 用户取消
                Shutdown(SetupExitCodes.UserCancelled);
                return;
            }
            if (_runner.Succeeded)
            {
                _runner.LaunchApp(launch);
                Shutdown(SetupExitCodes.Success);
                return;
            }
            if (_runner.IsFinished)
            {
                // 失败页上的「完成」
                Shutdown(SetupExitCodes.InstallFailed);
                return;
            }
            SetupLog.Write("host: 安装进行中收到关闭请求,忽略");
        }

        public void MinimizeToTaskbar()
        {
            _window.Minimize();
        }

        public void Shutdown(int exitCode)
        {
            if (_closing)
            {
                return;
            }
            _closing = true;
            _exitCode = exitCode;
            SetupLog.Write("host: shutdown code=" + exitCode);
            _window.Close();
        }

        public void OpenExternal(string url)
        {
            if (string.IsNullOrEmpty(url) || !(url.StartsWith("http://") || url.StartsWith("https://")))
            {
                return;
            }
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                SetupLog.Write("host: openExternal 失败 " + ex.Message);
            }
        }

        /// <summary>由 C# 弹出系统文件夹选择框(网页侧拿不到真实路径)。</summary>
        public void PromptForDirectory()
        {
            string start = Options != null && !string.IsNullOrEmpty(Options.InstallDir)
                ? Options.InstallDir
                : _payload.DefaultInstallDir;
            string picked = null;
            try
            {
                picked = FolderPicker.Pick(Handle, "选择「有谱」的安装位置", start);
            }
            catch (Exception ex)
            {
                // 选择器本身已经吞掉异常,这里再兜一层:任何情况下都必须回执,
                // 否则界面会停在"点了浏览没反应"的状态。
                SetupLog.Write("host: 选择目录异常 " + ex.Message);
            }
            SetupLog.Write("host: 选择目录 -> " + (string.IsNullOrEmpty(picked) ? "(取消)" : picked));
            PostMessage(SetupProtocol.Json(new
            {
                type = "browseResult",
                canceled = string.IsNullOrEmpty(picked),
                path = picked ?? string.Empty
            }));
        }

        /// <summary>无边框窗口拖动:交回鼠标捕获后按 HTCAPTION 走系统拖动。</summary>
        public void StartWindowDrag()
        {
            _window.StartWindowDrag();
        }

        /// <summary>
        /// 查询安装目录所在卷的可用空间并回报给页面。
        /// 页面只拿得到路径,卷信息必须由宿主提供;取不到就回报 -1,页面显示「未知」。
        /// </summary>
        public void ReportDiskSpace(string path)
        {
            long free = -1;
            long total = 0;
            string drive = string.Empty;
            try
            {
                string probe = string.IsNullOrEmpty(path) ? _payload.DefaultInstallDir : path;
                string root = string.IsNullOrEmpty(probe) ? string.Empty : Path.GetPathRoot(probe);
                if (string.IsNullOrEmpty(root))
                {
                    root = Path.GetPathRoot(AppDomain.CurrentDomain.BaseDirectory);
                }
                if (!string.IsNullOrEmpty(root))
                {
                    DriveInfo info = new DriveInfo(root);
                    if (info.IsReady)
                    {
                        free = info.AvailableFreeSpace;
                        total = info.TotalSize;
                        drive = info.Name;
                    }
                }
            }
            catch (Exception ex)
            {
                SetupLog.Write("host: 查询磁盘空间失败 " + ex.Message);
            }
            PostMessage(SetupProtocol.Json(new
            {
                type = "spaceInfo",
                path = path ?? string.Empty,
                drive,
                freeBytes = free,
                totalBytes = total,
                requiredBytes = _payload.RequiredBytes
            }));
        }

        /// <summary>强制重绘宿主窗口(用于唤醒 WebView2 画面)。</summary>
        public void Refresh()
        {
            _window.Refresh();
        }

        public void Dispose()
        {
            _window.Dispose();
        }

        private void ScheduleBootstrapRetry(double delayMs)
        {
            Timer timer = new Timer(delayMs);
            timer.AutoReset = false;
            timer.Elapsed += delegate
            {
                timer.Dispose();
                PostMessage(_bootstrapJson);
            };
            timer.Start();
        }

        private void OnWindowCloseRequested()
        {
            if (_runner != null && !_runner.IsFinished)
            {
                SetupLog.Write("host: 安装进行中,忽略关闭请求");
                return;
            }
            CompleteAndClose(false);
        }

        private void OnEscapePressed()
        {
            if (_runner != null && !_runner.IsFinished)
            {
                return;
            }
            CompleteAndClose(false);
        }

        private void OnWindowResized()
        {
            _bridge.SyncBounds(_window.ClientSize);
        }
    }
}
