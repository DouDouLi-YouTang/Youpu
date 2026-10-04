// 安装引导程序的最小日志工具。引导程序以 /target:winexe 编译,没有控制台,
// 出错时唯一可见的线索就是这个日志文件;同时它也是构建期冒烟测试的断言依据。
using System;
using System.IO;
using System.Text;

namespace YoupuSetupHost
{
    internal static class SetupLog
    {
        private static readonly object Gate = new object();
        private static string _path;

        public static string Path
        {
            get
            {
                if (_path == null)
                {
                    _path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "youpu-setup-host.log");
                }
                return _path;
            }
        }

        public static void Write(string message)
        {
            try
            {
                lock (Gate)
                {
                    File.AppendAllText(
                        Path,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + message + Environment.NewLine,
                        new UTF8Encoding(false));
                }
            }
            catch
            {
                // 日志失败不能影响安装流程。
            }
        }

        public static void Write(string format, params object[] args)
        {
            Write(string.Format(format, args));
        }
    }
}
