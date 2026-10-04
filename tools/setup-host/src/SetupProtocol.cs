// HTML 页面 <-> 引导程序宿主 的消息协议。
//   宿主 -> 页面:init / progress / installStarted / installComplete / installFailed /
//                 browseResult / spaceInfo / bridgeReady
//   页面 -> 宿主:ready / browse / querySpace / dragStart / beginInstall / openExternal /
//                 minimize / cancel / close
// 每条消息都是一个 JSON 对象,type 字段决定动作。
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Web.Script.Serialization;

namespace YoupuSetupHost
{
    internal static class SetupProtocol
    {
        /// <summary>
        /// 界面设计尺寸(CSS 像素)。宿主客户区 = 该尺寸 × 系统 DPI/96,页面按同尺寸排版。
        /// 改这里即可整体缩放窗口;页面从 init 的 bridge 字段读取,不要再写第二份。
        /// </summary>
        public const int DesignWidth = 960;
        public const int DesignHeight = 680;

        /// <summary>标题栏高度(CSS 像素),页面顶部的可拖动区域按它换算。</summary>
        public const int DragZoneHeight = 52;

        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();

        public static string Json(object payload)
        {
            return Serializer.Serialize(payload);
        }

        /// <summary>页面初始数据:应用信息 + 默认安装参数 + 界面文案。</summary>
        public static string BuildBootstrap(InstallPayload payload, string language)
        {
            Dictionary<string, object> message = new Dictionary<string, object>();
            message["type"] = "init";
            message["appName"] = payload.AppName;
            message["appNameEn"] = payload.AppNameEn;
            message["version"] = payload.Version;
            message["publisher"] = payload.Publisher;
            message["description"] = payload.Description;
            message["defaultInstallDir"] = payload.DefaultInstallDir;
            message["requiredBytes"] = payload.RequiredBytes;
            message["isUpdate"] = payload.IsUpdate;
            message["language"] = language;
            message["bridge"] = new Dictionary<string, object>
            {
                { "dragZoneHeight", DragZoneHeight },
                { "designWidth", DesignWidth },
                { "designHeight", DesignHeight }
            };
            message["strings"] = Strings(language);
            return Serializer.Serialize(message);
        }

        /// <summary>界面文案。新增文案时同步补齐三套,缺项会回落到中文。</summary>
        public static Dictionary<string, object> Strings(string language)
        {
            Dictionary<string, object> zh = new Dictionary<string, object>
            {
                { "windowTitle", "有谱 安装程序" },
                { "taglineLine1", "在电脑上,把听歌这件事" },
                { "taglineLine2", "做得更舒服一点" },
                { "featuresTitle", "核心功能" },
                { "installDirLabel", "安装位置" },
                { "browse", "浏览" },
                { "resetDir", "恢复默认" },
                { "prev", "上一项" },
                { "next", "下一项" },
                { "requiredSpace", "需要空间" },
                { "availableSpace", "可用空间" },
                { "spaceInsufficient", "空间不足" },
                { "optionsTitle", "安装选项" },
                { "desktopShortcut", "创建桌面快捷方式" },
                { "startMenuShortcut", "创建开始菜单快捷方式" },
                { "launchAfterInstall", "安装完成后启动有谱" },
                { "install", "开始安装" },
                { "installing", "正在安装" },
                { "finish", "完成" },
                { "installed", "安装完成" },
                { "installedHint", "已经可以使用了,祝你听歌愉快。" },
                { "launchNow", "立即启动" },
                { "close", "关闭" },
                { "updateTitle", "检测到已安装的版本" },
                { "updateHint", "将安装到原目录,你的歌单与设置都会保留。" },
                { "installFailed", "安装失败" },
                { "retry", "返回重试" },
                { "cancel", "取消安装" },
                { "cancelConfirm", "确定要取消安装吗?" },
                { "minimize", "最小化" },
                { "stageWriting", "正在写入程序文件" },
                { "stageFinishing", "正在完成安装" },
                { "preparing", "正在准备安装" },
                { "spaceUnknown", "未知" },
                { "ready", "准备就绪" },
                { "featurePlayback", "在线播放" },
                { "featurePlaybackDesc", "搜索、歌单、排行榜、每日推荐、私人 FM 与心动模式" },
                { "featureLyrics", "沉浸歌词" },
                { "featureLyricsDesc", "逐字卡拉OK、翻译与罗马音,封面取色铺满整屏" },
                { "featureDesktop", "桌面体验" },
                { "featureDesktopDesc", "迷你模式、系统托盘、倍速播放与多档音质" },
                { "featureOffline", "离线缓存" },
                { "featureOfflineDesc", "边听边缓存,断网也能继续播放" },
                { "featureTheme", "外观随心" },
                { "featureThemeDesc", "多套主题色与跟随封面的强调色" },
                { "featureUpdate", "自动更新" },
                { "featureUpdateDesc", "正式版 / Beta 双通道,新功能第一时间用上" }
            };

            if (language == "en")
            {
                return new Dictionary<string, object>
                {
                    { "windowTitle", "Youpu Setup" },
                    { "taglineLine1", "Your music, made" },
                    { "taglineLine2", "comfortable on desktop" },
                    { "featuresTitle", "Highlights" },
                    { "installDirLabel", "Install location" },
                    { "browse", "Browse" },
                    { "resetDir", "Reset" },
                    { "prev", "Previous" },
                    { "next", "Next" },
                    { "requiredSpace", "Required" },
                    { "availableSpace", "Available" },
                    { "spaceInsufficient", "Not enough space" },
                    { "optionsTitle", "Options" },
                    { "desktopShortcut", "Create a desktop shortcut" },
                    { "startMenuShortcut", "Create a Start menu shortcut" },
                    { "launchAfterInstall", "Launch Youpu when done" },
                    { "install", "Install" },
                    { "installing", "Installing" },
                    { "finish", "Finish" },
                    { "installed", "Installation complete" },
                    { "installedHint", "You are all set. Enjoy the music." },
                    { "launchNow", "Launch now" },
                    { "close", "Close" },
                    { "updateTitle", "Existing installation found" },
                    { "updateHint", "It will be updated in place; your playlists stay untouched." },
                    { "installFailed", "Installation failed" },
                    { "retry", "Back" },
                    { "cancel", "Cancel" },
                    { "cancelConfirm", "Cancel the installation?" },
                    { "minimize", "Minimize" },
                    { "stageWriting", "Writing application files" },
                    { "stageFinishing", "Finishing up" },
                    { "preparing", "Preparing" },
                    { "spaceUnknown", "unknown" },
                    { "ready", "Ready" },
                    { "featurePlayback", "Streaming" },
                    { "featurePlaybackDesc", "Search, playlists, charts, daily picks, personal FM" },
                    { "featureLyrics", "Immersive lyrics" },
                    { "featureLyricsDesc", "Word-by-word karaoke with translation and romaji" },
                    { "featureDesktop", "Desktop native" },
                    { "featureDesktopDesc", "Mini mode, tray control, speed and quality switches" },
                    { "featureOffline", "Offline cache" },
                    { "featureOfflineDesc", "Caches while you listen, keeps playing offline" },
                    { "featureTheme", "Yours to theme" },
                    { "featureThemeDesc", "Multiple accents, or follow the album cover" },
                    { "featureUpdate", "Auto update" },
                    { "featureUpdateDesc", "Stable and beta channels, always up to date" }
                };
            }

            return zh;
        }

        public static void Handle(WebView2Host host, WebView2Bridge bridge, string json)
        {
            Dictionary<string, object> message;
            try
            {
                message = Serializer.Deserialize<Dictionary<string, object>>(json);
            }
            catch (Exception ex)
            {
                SetupLog.Write("protocol: 无法解析消息 " + ex.Message);
                return;
            }

            if (message == null)
            {
                return;
            }

            string type = Str(message, "type");
            switch (type)
            {
                case "ready":
                    SetupLog.Write("js: ready");
                    host.ResendBootstrap();
                    break;



                case "browse":
                    host.PromptForDirectory();
                    break;

                case "querySpace":
                    host.ReportDiskSpace(Str(message, "path"));
                    break;

                case "dragStart":
                    host.StartWindowDrag();
                    break;

                case "beginInstall":
                    Options options = ReadOptions(message);
                    if (string.IsNullOrEmpty(options.InstallDir))
                    {
                        host.PostMessage(Json(new { type = "installFailed", message = "请先选择安装位置" }));
                        return;
                    }
                    host.Options = options;
                    host.BeginInstall(options);
                    break;

                case "openExternal":
                    host.OpenExternal(Str(message, "url"));
                    break;

                case "minimize":
                    host.MinimizeToTaskbar();
                    break;

                case "cancel":
                    host.CancelInstall();
                    break;

                case "close":
                    host.CompleteAndClose(Bool(message, "launch", false));
                    break;

                default:
                    SetupLog.Write("protocol: 未处理的消息类型 " + type);
                    break;
            }
        }

        private static Options ReadOptions(Dictionary<string, object> message)
        {
            Options options = new Options();
            options.InstallDir = Str(message, "installDir");
            options.DesktopShortcut = Bool(message, "desktopShortcut", true);
            options.StartMenuShortcut = Bool(message, "startMenuShortcut", true);
            options.LaunchAfterInstall = Bool(message, "launchAfterInstall", true);
            return options;
        }

        private static string Str(Dictionary<string, object> message, string key)
        {
            object value;
            if (!message.TryGetValue(key, out value) || value == null)
            {
                return string.Empty;
            }
            return Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
        }

        private static bool Bool(Dictionary<string, object> message, string key, bool fallback)
        {
            object value;
            if (!message.TryGetValue(key, out value) || value == null)
            {
                return fallback;
            }
            if (value is bool)
            {
                return (bool)value;
            }
            bool parsed;
            return bool.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), out parsed)
                ? parsed
                : fallback;
        }

        internal sealed class Options
        {
            public string InstallDir = string.Empty;
            public bool DesktopShortcut = true;
            public bool StartMenuShortcut = true;
            public bool LaunchAfterInstall = true;
        }
    }
}
