// 由 NSIS 写出的初始界面数据(youpu-payload.ini)。
// 采用 UTF-16LE 的 key=value 行格式而不是 JSON:安装目录可能包含中文、引号、
// 反斜杠与罕见的控制字符,JSON 转义一旦漏项就会解析失败,行格式最稳。
// 字段名与 build/installer.nsh 的 youpuPreparePayload 一一对应。
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace YoupuSetupHost
{
    internal sealed class InstallPayload
    {
        public string AppName = "有谱";
        public string AppNameEn = "Youpu";
        public string Version = string.Empty;
        public string Publisher = string.Empty;
        public string Description = string.Empty;
        public string DefaultInstallDir = string.Empty;
        public bool IsUpdate;
        public long RequiredBytes;
        public string Language = "auto";

        /// <summary>外层安装包自身路径:引导程序用它拉起静默安装。</summary>
        public string InstallerPath = string.Empty;

        /// <summary>安装完成后要启动的可执行文件名(Youpu.exe),与安装包内保持一致。</summary>
        public string AppExe = string.Empty;

        /// <summary>选项回执文件(引导程序写,NSIS 读)。</summary>
        public string ResultPath = string.Empty;

        /// <summary>进度回执文件(NSIS 写,引导程序读)。</summary>
        public string ResponsePath = string.Empty;

        public static InstallPayload Load(string path)
        {
            InstallPayload payload = new InstallPayload();
            if (string.IsNullOrEmpty(path) || !File.Exists(path))
            {
                SetupLog.Write("payload: 文件不存在 " + path);
                return payload;
            }

            try
            {
                foreach (KeyValuePair<string, string> pair in ReadPairs(path))
                {
                    switch (pair.Key)
                    {
                        case "appname":
                            payload.AppName = pair.Value;
                            break;
                        case "appnameen":
                            payload.AppNameEn = pair.Value;
                            break;
                        case "version":
                            payload.Version = pair.Value;
                            break;
                        case "publisher":
                            payload.Publisher = pair.Value;
                            break;
                        case "description":
                            payload.Description = pair.Value;
                            break;
                        case "defaultinstalldir":
                            payload.DefaultInstallDir = pair.Value;
                            break;
                        case "requiredbytes":
                            long bytes;
                            if (long.TryParse(pair.Value, out bytes))
                            {
                                payload.RequiredBytes = bytes;
                            }
                            break;
                        case "isupdate":
                            payload.IsUpdate = pair.Value == "1";
                            break;
                        case "installerpath":
                            payload.InstallerPath = pair.Value;
                            break;
                        case "appexe":
                            payload.AppExe = pair.Value;
                            break;
                        case "resultpath":
                            payload.ResultPath = pair.Value;
                            break;
                        case "responsepath":
                            payload.ResponsePath = pair.Value;
                            break;
                        case "language":
                            payload.Language = pair.Value;
                            break;
                    }
                }
            }
            catch (Exception ex)
            {
                SetupLog.Write("payload: 解析失败 " + ex.Message);
            }
            return payload;
        }

        private static IEnumerable<KeyValuePair<string, string>> ReadPairs(string path)
        {
            using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            using (StreamReader reader = new StreamReader(stream, Encoding.Unicode, true))
            {
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    if (line.Length == 0)
                    {
                        continue;
                    }
                    int eq = line.IndexOf('=');
                    if (eq <= 0)
                    {
                        continue;
                    }
                    string key = line.Substring(0, eq).Trim().ToLowerInvariant();
                    string value = line.Substring(eq + 1);
                    yield return new KeyValuePair<string, string>(key, value);
                }
            }
        }
    }
}
