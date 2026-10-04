// 静默安装的执行与进度回执。
// 引导界面点「开始安装」后:
//   1. 写出 result.ini(安装目录 + 快捷方式开关 + 是否启动),路径同时用
//      /youpu-result= 告诉 NSIS 实例,它按路径读回执;
//   2. 用 /S /youpu-nested 拉起外层安装包(继承本进程的令牌,不再弹 UAC),
//      并用 /youpu-response= 指定进度回执文件;
//   3. 每 300ms 读取该 JSON,把阶段与百分比推给界面;
//   4. 进程退出码为 0 即安装成功;勾了「安装完成后启动有谱」就顺手把应用拉起来。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Windows.Forms;
using System.Web.Script.Serialization;

namespace YoupuSetupHost
{
    internal sealed class InstallRunner
    {
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();

        private readonly WebView2Host _host;
        private readonly InstallPayload _payload;
        private readonly Timer _timer = new Timer();
        private Process _process;
        private SetupProtocol.Options _options;
        private DateTime _startedAt;
        private int _lastPercent;
        private string _lastMessage = string.Empty;
        private int _ticks;
        private bool _finished;
        private bool _succeeded;
        private bool _launched;
        private string _installDir = string.Empty;

        public InstallRunner(WebView2Host host, InstallPayload payload)
        {
            _host = host;
            _payload = payload;
            _timer.Interval = 300;
            _timer.Tick += OnTick;
        }

        /// <summary>本次安装是否已经有结论(失败后界面允许「返回重试」)。</summary>
        public bool IsFinished
        {
            get { return _finished; }
        }

        public bool Succeeded
        {
            get { return _succeeded; }
        }

        public string InstallDir
        {
            get { return _installDir; }
        }

        /// <summary>安装阶段的中文/英文文案占位:NSIS 只回报阶段名,百分比由这里平滑插值。</summary>
        public static string EstimateMessage(int percent)
        {
            if (percent < 40)
            {
                return "正在写入程序文件";
            }
            return "正在完成安装";
        }

        public void Begin(SetupProtocol.Options options)
        {
            _options = options;
            if (string.IsNullOrEmpty(_payload.InstallerPath) || !File.Exists(_payload.InstallerPath))
            {
                Fail("找不到安装包文件:" + _payload.InstallerPath);
                return;
            }
            if (string.IsNullOrEmpty(_payload.ResultPath))
            {
                Fail("安装程序内部错误:缺少回执文件路径");
                return;
            }

            try
            {
                WriteResult(_payload.ResultPath, options);
            }
            catch (Exception ex)
            {
                SetupLog.Write("install: 写出回执失败 " + ex);
                Fail("无法写入安装回执:" + ex.Message);
                return;
            }

            try
            {
                StartSilentInstaller(options.InstallDir);
            }
            catch (Exception ex)
            {
                SetupLog.Write("install: 启动静默安装失败 " + ex);
                Fail("无法启动安装程序:" + ex.Message);
                return;
            }

            _host.PostMessage(SetupProtocol.Json(new
            {
                type = "installStarted",
                installDir = options.InstallDir
            }));

            _startedAt = DateTime.UtcNow;
            _lastPercent = 5;
            _lastMessage = string.Empty;
            _ticks = 0;
            _timer.Start();
        }

        public void Stop()
        {
            _timer.Stop();
            _timer.Dispose();
        }

        /// <summary>
        /// 启动安装好的应用。安装失败过就不启动;userRequested = 用户点了「立即启动」,
        /// 否则按界面上的「安装完成后启动有谱」勾选决定。
        /// </summary>
        public void LaunchApp(bool userRequested)
        {
            if (_launched || !_succeeded)
            {
                return;
            }
            if (!userRequested && (_options == null || !_options.LaunchAfterInstall))
            {
                return;
            }

            string directory = string.IsNullOrEmpty(_installDir) ? _payload.DefaultInstallDir : _installDir;
            string executable = string.IsNullOrEmpty(_payload.AppExe) ? "Youpu.exe" : _payload.AppExe;
            string path = Path.Combine(directory ?? string.Empty, executable);
            if (!File.Exists(path))
            {
                SetupLog.Write("install: 未找到要启动的程序 " + path);
                return;
            }
            try
            {
                ProcessStartInfo info = new ProcessStartInfo();
                info.FileName = path;
                info.WorkingDirectory = Path.GetDirectoryName(path);
                info.UseShellExecute = true;
                Process.Start(info);
                _launched = true;
                SetupLog.Write("install: 已启动应用 " + path);
            }
            catch (Exception ex)
            {
                SetupLog.Write("install: 启动应用失败 " + ex.Message);
            }
        }

        private void StartSilentInstaller(string installDir)
        {
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = _payload.InstallerPath;
            // /youpu-result= /youpu-response= 让静默实例知道回执文件在哪(它自己的
            // $PLUGINSDIR 与本进程无关,不传路径它只能靠猜);/D= 必须是最后一个参数
            // 且不加引号 —— 这是 NSIS 对 /D 的硬性要求。
            StringBuilder arguments = new StringBuilder();
            arguments.Append("/S /youpu-nested");
            arguments.Append(" /youpu-result=\"").Append(_payload.ResultPath).Append('"');
            if (!string.IsNullOrEmpty(_payload.ResponsePath))
            {
                arguments.Append(" /youpu-response=\"").Append(_payload.ResponsePath).Append('"');
            }
            arguments.Append(" /D=").Append(installDir);
            info.Arguments = arguments.ToString();
            info.UseShellExecute = false;
            info.WorkingDirectory = Path.GetDirectoryName(_payload.InstallerPath);
            SetupLog.Write("install: 启动 " + info.FileName + " " + info.Arguments);
            _process = Process.Start(info);
            if (_process == null)
            {
                throw new InvalidOperationException("Process.Start 返回 null");
            }
        }

        private void OnTick(object sender, EventArgs e)
        {
            _ticks++;

            if (_process != null && _process.HasExited)
            {
                Finish();
                return;
            }

            // 读 NSIS 写出的阶段进度;读不到就按已耗时平滑推进(纯视觉,不影响真实进度判定)
            ProgressState state = TryReadResponse();
            int percent;
            string message;
            if (state != null && state.Percent > 0)
            {
                percent = Math.Max(_lastPercent, Math.Min(96, state.Percent));
                message = string.IsNullOrEmpty(state.Message) ? EstimateMessage(percent) : state.Message;
            }
            else
            {
                double elapsed = (DateTime.UtcNow - _startedAt).TotalSeconds;
                // 45 秒内从 8% 平滑爬到 85%,之后停在 92% 等待真实完成
                double synthetic = 8 + Math.Min(1.0, elapsed / 45.0) * 77;
                percent = (int)Math.Max(_lastPercent, Math.Min(92, synthetic));
                message = EstimateMessage(percent);
            }

            _lastPercent = percent;
            if (message != _lastMessage || _ticks % 4 == 0)
            {
                _lastMessage = message;
                _host.PostMessage(SetupProtocol.Json(new
                {
                    type = "progress",
                    percent = percent,
                    message = message
                }));
            }
        }

        private void Finish()
        {
            _timer.Stop();
            _finished = true;
            int exitCode = -1;
            try
            {
                if (_process != null)
                {
                    exitCode = _process.ExitCode;
                }
            }
            catch (Exception ex)
            {
                SetupLog.Write("install: 读取退出码失败 " + ex.Message);
            }
            SetupLog.Write("install: 静默安装结束 exitCode=" + exitCode);

            ProgressState state = TryReadResponse();
            bool failed = exitCode != 0
                || (state != null && string.Equals(state.State, "failed", StringComparison.OrdinalIgnoreCase));

            if (failed)
            {
                _host.PostMessage(SetupProtocol.Json(new
                {
                    type = "installFailed",
                    message = state != null && !string.IsNullOrEmpty(state.Message)
                        ? state.Message
                        : "安装程序返回错误码 " + exitCode
                }));
                return;
            }

            _succeeded = true;
            // 界面显示用的目录以用户选的为准;NSIS 回报的目录只作为兜底
            _installDir = _options != null && !string.IsNullOrEmpty(_options.InstallDir)
                ? _options.InstallDir
                : (state != null && !string.IsNullOrEmpty(state.InstallDir)
                    ? state.InstallDir
                    : _payload.DefaultInstallDir);

            _host.PostMessage(SetupProtocol.Json(new
            {
                type = "installComplete",
                installDir = _installDir
            }));

            // 勾了「安装完成后启动有谱」:安装一结束就拉起来
            LaunchApp(false);
        }

        private void Fail(string message)
        {
            _finished = true;
            SetupLog.Write("install: " + message);
            _host.PostMessage(SetupProtocol.Json(new { type = "installFailed", message = message }));
        }

        private ProgressState TryReadResponse()
        {
            if (string.IsNullOrEmpty(_payload.ResponsePath) || !File.Exists(_payload.ResponsePath))
            {
                return null;
            }
            try
            {
                string json;
                using (FileStream stream = new FileStream(_payload.ResponsePath, FileMode.Open,
                    FileAccess.Read, FileShare.ReadWrite))
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8, true))
                {
                    json = reader.ReadToEnd();
                }
                if (string.IsNullOrWhiteSpace(json))
                {
                    return null;
                }
                Dictionary<string, object> map = Serializer.Deserialize<Dictionary<string, object>>(json);
                if (map == null)
                {
                    return null;
                }
                ProgressState state = new ProgressState();
                state.State = map.ContainsKey("state") ? Convert.ToString(map["state"], CultureInfo.InvariantCulture) : null;
                state.Message = map.ContainsKey("message") ? Convert.ToString(map["message"], CultureInfo.InvariantCulture) : null;
                state.InstallDir = map.ContainsKey("installDir") ? Convert.ToString(map["installDir"], CultureInfo.InvariantCulture) : null;
                if (!string.IsNullOrEmpty(state.InstallDir))
                {
                    // NSIS 侧为了保持 JSON 合法写的是正斜杠,这里换回 Windows 形式
                    state.InstallDir = state.InstallDir.Replace('/', '\\');
                }
                if (map.ContainsKey("percent"))
                {
                    double percent;
                    if (double.TryParse(Convert.ToString(map["percent"], CultureInfo.InvariantCulture),
                        NumberStyles.Any, CultureInfo.InvariantCulture, out percent))
                    {
                        state.Percent = (int)percent;
                    }
                }
                return state;
            }
            catch (Exception ex)
            {
                SetupLog.Write("install: 读取进度失败 " + ex.Message);
                return null;
            }
        }

        private static void WriteResult(string path, SetupProtocol.Options options)
        {
            StringBuilder builder = new StringBuilder();
            builder.Append("dir=").Append(options.InstallDir ?? string.Empty).Append('\n');
            builder.Append("desktop=").Append(options.DesktopShortcut ? "1" : "0").Append('\n');
            builder.Append("startmenu=").Append(options.StartMenuShortcut ? "1" : "0").Append('\n');
            builder.Append("launch=").Append(options.LaunchAfterInstall ? "1" : "0").Append('\n');

            string directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            // NSIS 侧用 FileReadUTF16LE 读取(BOM 会被自动跳过),固定 UTF-16LE + BOM
            File.WriteAllText(path, builder.ToString(), new UnicodeEncoding(false, true));
            SetupLog.Write("install: 已写出回执 " + path);
        }

        private sealed class ProgressState
        {
            public string State;
            public string Message;
            public string InstallDir;
            public int Percent;
        }
    }
}
