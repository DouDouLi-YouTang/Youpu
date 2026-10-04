// 引导程序命令行参数。参数名必须与 build/installer.nsh 中的调用保持一致。
//   /payload=<file>  初始界面数据(key=value 行格式,UTF-16LE,由 NSIS 写出;见 InstallPayload.cs)
//   /result=<file>   选项回执:NSIS 读取安装目录/快捷方式/是否启动,并据此执行安装
//   /response=<file> 安装进度回执:NSIS 安装过程中/结束后写出,引导界面据此推进进度
using System;

namespace YoupuSetupHost
{
    internal sealed class LauncherOptions
    {
        public string PayloadPath = string.Empty;
        public string ResultPath = string.Empty;
        public string ResponsePath = string.Empty;

        public static LauncherOptions Parse(string[] args)
        {
            LauncherOptions options = new LauncherOptions();
            foreach (string arg in args)
            {
                if (string.IsNullOrEmpty(arg))
                {
                    continue;
                }
                int eq = arg.IndexOf('=');
                if (eq <= 0)
                {
                    continue;
                }
                string key = arg.Substring(0, eq).TrimStart('-', '/').ToLowerInvariant();
                string value = arg.Substring(eq + 1).Trim('"');
                switch (key)
                {
                    case "payload":
                        options.PayloadPath = value;
                        break;
                    case "result":
                        options.ResultPath = value;
                        break;
                    case "response":
                        options.ResponsePath = value;
                        break;
                }
            }
            return options;
        }

        public bool IsValid
        {
            get { return !string.IsNullOrEmpty(PayloadPath); }
        }
    }
}
