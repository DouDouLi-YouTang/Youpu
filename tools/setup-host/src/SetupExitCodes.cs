// 引导程序的进程退出码。
// 安装包(build/installer.nsh)不再阻塞等待本进程,这些码只用于日志与自检;
// 其中 3/4 会让本进程用 /youpu-classic 把安装包重新拉起来走原生向导。
namespace YoupuSetupHost
{
    internal static class SetupExitCodes
    {
        /// <summary>用户取消安装(直接关掉界面)。</summary>
        public const int UserCancelled = 2;

        /// <summary>WebView2 运行时缺失 → 回退原生安装界面。</summary>
        public const int WebView2Missing = 3;

        /// <summary>WebView2 初始化失败 → 回退原生安装界面。</summary>
        public const int WebView2InitFailed = 4;

        /// <summary>静默安装失败(界面已呈现失败原因)。</summary>
        public const int InstallFailed = 5;

        /// <summary>安装完成,结果已呈现在界面上。</summary>
        public const int Success = 10;

        /// <summary>已有界面在运行,本进程只把已有窗口前置后退出。</summary>
        public const int AlreadyRunning = 11;
    }
}
