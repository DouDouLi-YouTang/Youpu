// 原生"选择文件夹"对话框(SHBrowseForFolder)。
// 不用 WinForms 的 FolderBrowserDialog:为弹一个选择框引入 System.Windows.Forms 不划算,
// 而且它的老版 UI 在深色系统上观感差;SHBrowseForFolder 是系统原生对话框,
// 支持新版样式(BIF_NEWDIALOGSTYLE),并能通过回调指定初始目录。
//
// 踩过的坑(改这个文件前先看):
//   · 释放 PIDL 用的 CoTaskMemFree **不在 shell32 里**(它是 ole32 的导出)。旧代码把它
//     DllImport 到 shell32,于是每次成功选完目录,finally 里都会抛
//     EntryPointNotFoundException —— 返回值被丢弃,宿主永远发不出 browseResult,
//     表现就是"选完安装位置,界面不刷新"。释放失败绝不能影响已选到的结果。
//   · BROWSEINFO.lParam 只在有回调(lpfn)时才有意义。想指定初始目录必须走回调里的
//     BFFM_SETSELECTION,直接往 lParam 塞字符串没有任何作用。
//   · pszDisplayName 是对话框写回的缓冲区,传 null 即可(我们不用显示名)。
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace YoupuSetupHost
{
    internal static class FolderPicker
    {
        private const uint BifReturnOnlyFsDirs = 0x0001;
        private const uint BifNewDialogStyle = 0x0040;
        private const uint BifEditBox = 0x0010;

        private const uint BffmInitialized = 0x0001;
        private const uint BffmSetSelectionW = 0x0400 + 103;   // WM_USER + 103

        private delegate int BrowseCallback(IntPtr hwnd, uint message, IntPtr lParam, IntPtr lpData);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct BROWSEINFO
        {
            public IntPtr hwndOwner;
            public IntPtr pidlRoot;
            public string pszDisplayName;
            public string lpszTitle;
            public uint ulFlags;
            public IntPtr lpfn;
            public IntPtr lParam;
            public int iImage;
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr SHBrowseForFolder(ref BROWSEINFO lpbi);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern bool SHGetPathFromIDList(IntPtr pidl, StringBuilder pszPath);

        [DllImport("ole32.dll")]
        private static extern void CoTaskMemFree(IntPtr pv);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

        [DllImport("ole32.dll")]
        private static extern int CoInitializeEx(IntPtr pvReserved, uint dwCoInit);

        /// <summary>弹出选择框并返回绝对路径;用户取消或失败返回 null(绝不抛异常)。</summary>
        public static string Pick(IntPtr owner, string title, string initialPath)
        {
            IntPtr pidl = IntPtr.Zero;
            IntPtr initial = IntPtr.Zero;
            try
            {
                try
                {
                    CoInitializeEx(IntPtr.Zero, 2 /* COINIT_APARTMENTTHREADED */);
                }
                catch
                {
                    // 已初始化过会返回错误码,忽略即可
                }

                BrowseCallback callback = null;
                BROWSEINFO info = new BROWSEINFO();
                info.hwndOwner = owner;
                info.lpszTitle = title;
                info.ulFlags = BifReturnOnlyFsDirs | BifNewDialogStyle | BifEditBox;
                if (!string.IsNullOrEmpty(initialPath))
                {
                    initial = Marshal.StringToHGlobalUni(initialPath);
                    info.lParam = initial;
                    callback = delegate(IntPtr hwnd, uint message, IntPtr lParam, IntPtr lpData)
                    {
                        if (message == BffmInitialized)
                        {
                            SendMessage(hwnd, BffmSetSelectionW, new IntPtr(1), lpData);
                        }
                        return 0;
                    };
                    info.lpfn = Marshal.GetFunctionPointerForDelegate(callback);
                }

                pidl = SHBrowseForFolder(ref info);
                GC.KeepAlive(callback);   // 对话框返回前不能让委托被回收
                if (pidl == IntPtr.Zero)
                {
                    return null;
                }
                StringBuilder buffer = new StringBuilder(260);
                if (!SHGetPathFromIDList(pidl, buffer))
                {
                    return null;
                }
                return buffer.ToString();
            }
            catch (Exception ex)
            {
                SetupLog.Write("folder: 选择目录失败 " + ex.Message);
                return null;
            }
            finally
            {
                // 释放阶段的任何失败都不允许影响上面的返回值
                try
                {
                    if (pidl != IntPtr.Zero)
                    {
                        CoTaskMemFree(pidl);
                    }
                }
                catch (Exception ex)
                {
                    SetupLog.Write("folder: 释放 PIDL 失败 " + ex.Message);
                }
                if (initial != IntPtr.Zero)
                {
                    try
                    {
                        Marshal.FreeHGlobal(initial);
                    }
                    catch
                    {
                        // 忽略
                    }
                }
            }
        }
    }
}
