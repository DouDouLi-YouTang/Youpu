// WebView2 运行时探测。注册表位置与官方 WebView2Loader 的判定一致。
using System;
using System.Globalization;
using Microsoft.Win32;

namespace YoupuSetupHost
{
    internal static class WebView2Availability
    {
        private const string ClientGuid = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

        public static bool IsRuntimeInstalled()
        {
            return HasVersion(RegistryHive.LocalMachine, RegistryView.Registry32)
                || HasVersion(RegistryHive.LocalMachine, RegistryView.Registry64)
                || HasVersion(RegistryHive.CurrentUser, RegistryView.Registry32)
                || HasVersion(RegistryHive.CurrentUser, RegistryView.Registry64);
        }

        private static bool HasVersion(RegistryHive hive, RegistryView view)
        {
            try
            {
                using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, view))
                using (RegistryKey key = baseKey.OpenSubKey(
                    @"SOFTWARE\Microsoft\EdgeUpdate\Clients\" + ClientGuid))
                {
                    if (key == null)
                    {
                        return false;
                    }
                    string version = key.GetValue("pv") as string;
                    if (string.IsNullOrEmpty(version) || version == "0.0.0.0")
                    {
                        return false;
                    }
                    Version parsed;
                    return Version.TryParse(version, out parsed) && parsed.Major > 0;
                }
            }
            catch
            {
                return false;
            }
        }

        /// <summary>界面语言:简繁中文用中文,其余用英文。</summary>
        public static string DetectLanguage()
        {
            try
            {
                string name = CultureInfo.CurrentUICulture.Name ?? string.Empty;
                if (name.StartsWith("zh", StringComparison.OrdinalIgnoreCase))
                {
                    return name.IndexOf("TW", StringComparison.OrdinalIgnoreCase) >= 0
                        || name.IndexOf("HK", StringComparison.OrdinalIgnoreCase) >= 0
                        || name.IndexOf("Hant", StringComparison.OrdinalIgnoreCase) >= 0
                        ? "zh-Hant"
                        : "zh-Hans";
                }
            }
            catch
            {
                // 取不到语言就按英文处理
            }
            return "en";
        }
    }
}
