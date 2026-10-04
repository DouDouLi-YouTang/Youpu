// 引导程序入口。构建产物 = 单个 YoupuSetupHost.exe + WebView2Loader.dll。
// 用法(由 build/installer.nsh 调用):
//   YoupuSetupHost.exe /payload="<youpu-payload.ini>"
//
// 本进程是安装过程中唯一可见的界面:选项页 → 进度页 → 完成页。
// 真正往磁盘写程序文件的是同一份安装包的 /S /youpu-nested 静默实例
// (由 InstallRunner 拉起并轮询进度,见 InstallRunner.cs)。
using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace YoupuSetupHost
{
    internal static class Program
    {
        /// <summary>
        /// 界面单实例互斥体。名称必须与 build/installer.nsh 的 YOUPU_MUTEX 一致:
        /// 安装包启动器靠它判断"界面已经开着",避免重复释放/覆盖正在使用的宿主文件。
        /// 由本进程持有到退出。
        /// </summary>
        private const string HostMutexName = "Global\\YoupuSetupHostMutex";

        /// <summary>
        /// 窗口标题。必须与 WebView2Host 构造 NativeHost 时用的标题一致:
        /// 第二次启动安装包时用它在进程外找到已有窗口并前置。
        /// </summary>
        private const string HostWindowTitle = "有谱 安装程序 — Youpu Setup";

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr FindWindow(string className, string windowName);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [STAThread]
        private static int Main(string[] args)
        {
            AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
            Application.ThreadException += OnThreadException;
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);

            SetupLog.Write("==== 有谱安装引导程序启动 pid=" + System.Diagnostics.Process.GetCurrentProcess().Id + " ====");
            SetupLog.Write("args: " + string.Join(" ", args));

            LauncherOptions options = LauncherOptions.Parse(args);
            if (!options.IsValid)
            {
                SetupLog.Write("参数不完整,退出");
                return SetupExitCodes.WebView2InitFailed;
            }

            // 单实例:用户重复双击安装包时不再开第二个界面,只把已有窗口拿到前面。
            // 注意安装包启动器(.onInit)也检查同一个互斥体,但它在 Exec 本进程后就退出,
            // 所以"谁在运行"始终由本进程持有,不会出现两个界面同时改同一份安装。
            Mutex singleInstance = null;
            bool isFirstInstance;
            try
            {
                singleInstance = new Mutex(true, HostMutexName, out isFirstInstance);
            }
            catch (Exception ex)
            {
                SetupLog.Write("单实例互斥体创建失败(按首次启动处理): " + ex.Message);
                isFirstInstance = true;
            }

            if (!isFirstInstance)
            {
                SetupLog.Write("已有安装界面在运行,前置后退出");
                FocusExistingWindow();
                return SetupExitCodes.AlreadyRunning;
            }

            try
            {
                return Run(options);
            }
            finally
            {
                if (singleInstance != null)
                {
                    try
                    {
                        singleInstance.ReleaseMutex();
                    }
                    catch (Exception ex)
                    {
                        SetupLog.Write("释放单实例互斥体失败(忽略): " + ex.Message);
                    }
                    singleInstance.Dispose();
                }
            }
        }

        private static int Run(LauncherOptions options)
        {
            // WebView2Loader.dll 与本 exe 同目录,显式指定搜索路径
            WebView2Loader.SetDllDirectory(AppDomain.CurrentDomain.BaseDirectory);

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            try
            {
                InstallPayload payload = InstallPayload.Load(options.PayloadPath);
                // 命令行参数优先(便于自动化测试),否则用 NSIS 写进 payload 的路径
                if (!string.IsNullOrEmpty(options.ResultPath))
                {
                    payload.ResultPath = options.ResultPath;
                }
                if (!string.IsNullOrEmpty(options.ResponsePath))
                {
                    payload.ResponsePath = options.ResponsePath;
                }

                string language = string.Equals(payload.Language, "auto", StringComparison.OrdinalIgnoreCase)
                    ? WebView2Availability.DetectLanguage()
                    : payload.Language;

                WebView2Host host = new WebView2Host(payload, SetupProtocol.DesignWidth, SetupProtocol.DesignHeight);
                host.SetBootstrapJson(SetupProtocol.BuildBootstrap(payload, language));
                host.LoadHtml(LoadUiDocument());
                // 窗口一建好就写标记文件:安装包启动器正靠它判断本进程起没起来,
                // 5 秒拿不到标记就会结束本进程并回退到原生安装界面。
                host.ReadyMarkerPath = ReadyMarkerPath(options.PayloadPath);

                host.Start();

                int exitCode = host.ExitCode;
                if (exitCode == SetupExitCodes.WebView2Missing || exitCode == SetupExitCodes.WebView2InitFailed)
                {
                    // 界面渲染不出来:用 /youpu-classic 拉起原生向导,绝不阻断安装
                    RelaunchClassicInstaller(payload, exitCode);
                }
                return exitCode;
            }
            catch (Exception ex)
            {
                SetupLog.Write("致命错误: " + ex);
                return SetupExitCodes.WebView2InitFailed;
            }
        }

        /// <summary>「窗口已就绪」标记文件:与 payload 同目录(安装包启动器指定的运行目录)。</summary>
        private static string ReadyMarkerPath(string payloadPath)
        {
            try
            {
                string directory = Path.GetDirectoryName(Path.GetFullPath(payloadPath));
                if (!string.IsNullOrEmpty(directory))
                {
                    return Path.Combine(directory, "youpu-host-started");
                }
            }
            catch (Exception ex)
            {
                SetupLog.Write("计算就绪标记路径失败: " + ex.Message);
            }
            return null;
        }

        private static void FocusExistingWindow()
        {
            try
            {
                IntPtr window = FindWindow(null, HostWindowTitle);
                if (window == IntPtr.Zero)
                {
                    return;
                }
                ShowWindow(window, 9); // SW_RESTORE
                SetForegroundWindow(window);
            }
            catch (Exception ex)
            {
                SetupLog.Write("前置已有窗口失败: " + ex.Message);
            }
        }

        /// <summary>
        /// WebView2 缺失/初始化失败时的回退:重新拉起安装包并带上 /youpu-classic,
        /// 由它走 electron-builder 原生向导(那条路径不会再启动本界面,不会成环)。
        /// </summary>
        private static void RelaunchClassicInstaller(InstallPayload payload, int exitCode)
        {
            string installer = payload.InstallerPath;
            if (string.IsNullOrEmpty(installer) || !File.Exists(installer))
            {
                SetupLog.Write("回退失败:找不到安装包 " + (installer ?? "(空)"));
                return;
            }
            try
            {
                System.Diagnostics.ProcessStartInfo info = new System.Diagnostics.ProcessStartInfo();
                info.FileName = installer;
                info.Arguments = "/youpu-classic";
                info.UseShellExecute = false;
                info.WorkingDirectory = Path.GetDirectoryName(installer);
                System.Diagnostics.Process.Start(info);
                SetupLog.Write("界面不可用(exitCode=" + exitCode + "),已用 /youpu-classic 回退到原生安装界面");
            }
            catch (Exception ex)
            {
                SetupLog.Write("回退原生安装界面失败: " + ex.Message);
            }
        }

        /// <summary>读取构建期嵌入的界面文档(build-setup-host.mjs 用 /resource: 嵌入)。</summary>
        private static string LoadUiDocument()
        {
            Assembly assembly = Assembly.GetExecutingAssembly();
            string[] names = assembly.GetManifestResourceNames();
            foreach (string name in names)
            {
                if (name.EndsWith("YoupuSetupUi.html", StringComparison.OrdinalIgnoreCase))
                {
                    using (Stream stream = assembly.GetManifestResourceStream(name))
                    using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                    {
                        return reader.ReadToEnd();
                    }
                }
            }
            throw new InvalidOperationException("缺少内嵌资源 YoupuSetupUi.html,现有: " + string.Join(", ", names));
        }

        private static void OnUnhandledException(object sender, UnhandledExceptionEventArgs e)
        {
            SetupLog.Write("未处理异常: " + e.ExceptionObject);
        }

        private static void OnThreadException(object sender, System.Threading.ThreadExceptionEventArgs e)
        {
            SetupLog.Write("界面线程异常: " + e.Exception);
        }
    }
}
