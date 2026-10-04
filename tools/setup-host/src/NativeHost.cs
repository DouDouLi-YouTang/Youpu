// 原生 Win32 窗口宿主。
//
// 为什么不用 WinForms:实测在装有虚拟显示适配器(远程控制、安卓模拟器自带的那种)
// 的机器上,WebView2 的合成画面无法上屏到 WinForms 窗体 —— 页面加载正常、
// postMessage 正常,窗口里却只有窗体底色。官方对 CreateCoreWebView2Controller 的
// 支持路径是"原生顶层窗口 + 自己的消息循环",本文件就是这条路径的实现,
// 顺带把无边框、圆角、拖拽与 DPI 一并处理掉。
//
// 尺寸约定:界面按 960x680 CSS 像素设计(SetupProtocol.DesignWidth/Height),
// 窗口保证"客户区"恰好等于 设计尺寸 × (系统 DPI / 96) 物理像素,
// 这样任何缩放比例下,网页拿到的 viewport 都是 960x680 逻辑像素。
using System;
using System.Drawing;
using System.Runtime.InteropServices;

namespace YoupuSetupHost
{
    internal sealed class NativeHost : IDisposable
    {
        // 窗口样式
        // 用 WS_POPUP 而不是 WS_OVERLAPPEDWINDOW:WS_POPUP 没有系统外框与阴影,
        // 尺寸完全由我们控制(配合 WM_NCCALCSIZE 得到干净的无边框窗口)。
        private const int WsPopupWindow = unchecked((int)0x80000000);
        private const int WsClipChildren = 0x02000000;
        private const int WsClipSiblings = 0x04000000;
        private const int WsExAppWindow = 0x00040000;

        // 窗口消息
        private const int WmDestroy = 0x0002;
        private const int WmSize = 0x0005;
        private const int WmClose = 0x0010;
        private const int WmPaint = 0x000F;
        private const int WmEraseBkgnd = 0x0014;
        private const int WmKeyDown = 0x0100;
        private const int WmNcCalcSize = 0x0083;
        private const int WmNcActivate = 0x0086;
        private const int WmNcPaint = 0x0085;
        private const int WmNcHitTest = 0x0084;
        private const int WmNcLButtonDown = 0x00A1;

        private const int HtClient = 1;
        private const int HtCaption = 2;
        private const int VkEscape = 0x1B;

        private const int SwShow = 5;
        private const int SwMinimize = 6;
        private const int SwpNoActivate = 0x0010;
        private const int SwpNoMove = 0x0002;
        private const int SwpNoSize = 0x0001;
        private const int SmCxScreen = 0;
        private const int SmCyScreen = 1;
        private const int DwmwaUseImmersiveDarkMode = 20;
        private const int DwmwaWindowCornerPreference = 33;
        private const int DwmcpRound = 2;
        private const int PatCopy = 0x00F00021;
        private const int LogPixelsX = 88;
        private const int ColorBackground = 0x160C09;   // #090C16,注意是 BGR

        private delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WNDCLASSEX
        {
            public int cbSize;
            public int style;
            public IntPtr lpfnWndProc;
            public int cbClsExtra;
            public int cbWndExtra;
            public IntPtr hInstance;
            public IntPtr hIcon;
            public IntPtr hCursor;
            public IntPtr hbrBackground;
            public string lpszMenuName;
            public string lpszClassName;
            public IntPtr hIconSm;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public POINT pt;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PAINTSTRUCT
        {
            public IntPtr hdc;
            public bool fErase;
            public RECT rcPaint;
            public bool fRestore;
            public bool fIncUpdate;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
            public byte[] rgbReserved;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct NCCALCSIZE_PARAMS
        {
            public RECT rgrc0;
            public RECT rgrc1;
            public RECT rgrc2;
            public IntPtr lppos;
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern ushort RegisterClassEx(ref WNDCLASSEX lpwcx);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateWindowEx(
            int dwExStyle, string lpClassName, string lpWindowName, int dwStyle,
            int x, int y, int nWidth, int nHeight,
            IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);

        // ⚠ 消息循环这三个必须显式用 Unicode 变体(CharSet.Unicode → *W)。
        //   它们默认按 ANSI 解析:DefWindowProcA 会把这条 Unicode 窗口的文本消息
        //   (WM_GETTEXT / WM_SETTEXT / WM_GETTEXTLENGTH / WM_CHAR…)当 ANSI 处理,
        //   于是窗口标题从创建起就是乱码 —— 实测标题 "有谱 安装程序 — Youpu Setup"
        //   读回来是 "\tg1?"(4 个字符),任务栏与任务管理器里也是乱码;GetMessageA /
        //   DispatchMessageA 还会把跨进程发来的文本消息降级成 ANSI。改回默认值前
        //   先看 tools/setup-host/README.md 的「环境约束 12」。
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr DefWindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool TranslateMessage(ref MSG lpMsg);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr DispatchMessage(ref MSG lpMsg);

        [DllImport("user32.dll")]
        private static extern void PostQuitMessage(int nExitCode);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool DestroyWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

        [DllImport("user32.dll")]
        private static extern IntPtr BeginPaint(IntPtr hWnd, out PAINTSTRUCT lpPaint);

        [DllImport("user32.dll")]
        private static extern bool EndPaint(IntPtr hWnd, ref PAINTSTRUCT lpPaint);

        [DllImport("user32.dll")]
        private static extern bool InvalidateRect(IntPtr hWnd, IntPtr lpRect, bool bErase);

        [DllImport("user32.dll")]
        private static extern bool UpdateWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern IntPtr LoadCursor(IntPtr hInstance, int lpCursorName);

        [DllImport("user32.dll")]
        private static extern int GetSystemMetrics(int nIndex);

        [DllImport("user32.dll")]
        private static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

        [DllImport("user32.dll")]
        private static extern bool AdjustWindowRectEx(ref RECT lpRect, int dwStyle, bool bMenu, int dwExStyle);

        [DllImport("gdi32.dll")]
        private static extern IntPtr CreateSolidBrush(int color);

        [DllImport("gdi32.dll")]
        private static extern IntPtr SelectObject(IntPtr hdc, IntPtr hObject);

        [DllImport("gdi32.dll")]
        private static extern bool DeleteObject(IntPtr hObject);

        [DllImport("gdi32.dll")]
        private static extern int GetDeviceCaps(IntPtr hdc, int nIndex);

        [DllImport("gdi32.dll")]
        private static extern bool PatBlt(IntPtr hdc, int x, int y, int w, int h, int rop);

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr LoadLibraryW(string lpFileName);

        [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true)]
        private static extern IntPtr GetProcAddress(IntPtr hModule, string lpProcName);

        [DllImport("kernel32.dll")]
        private static extern bool FreeLibrary(IntPtr hModule);

        private delegate bool AdjustWindowRectExForDpiDelegate(
            ref RECT lpRect, int dwStyle, bool bMenu, int dwExStyle, uint dpi);

        private readonly string _className;
        private readonly string _title;
        private readonly int _designWidth;
        private readonly int _designHeight;
        private readonly WndProcDelegate _wndProc;
        private WndProcDelegate _keepAlive;          // 必须持有引用,否则委托被回收后回调崩溃
        private IntPtr _hwnd;
        private IntPtr _backgroundBrush;
        private bool _closed;
        private int _dragZoneHeight = 52;

        public NativeHost(string title, int designWidth, int designHeight)
        {
            _title = title;
            _designWidth = designWidth;
            _designHeight = designHeight;
            _className = "YoupuSetupHostWnd_" + Guid.NewGuid().ToString("N");
            _wndProc = WindowProc;
            _keepAlive = _wndProc;
        }

        /// <summary>顶部可拖拽区域高度(CSS 像素,按 DPI 换算后生效)。</summary>
        public int DragZoneHeight
        {
            get { return _dragZoneHeight; }
            set { _dragZoneHeight = Math.Max(0, Math.Min(240, value)); }
        }

        public IntPtr Handle
        {
            get { return _hwnd; }
        }

        /// <summary>客户区尺寸(物理像素),即网页 viewport 的像素数。</summary>
        public Size ClientSize
        {
            get
            {
                RECT rect;
                GetClientRect(_hwnd, out rect);
                return new Size(rect.Right - rect.Left, rect.Bottom - rect.Top);
            }
        }

        public Action OnCloseRequested { get; set; }
        public Action OnEscapePressed { get; set; }
        public Action OnResized { get; set; }

        public void Create()
        {
            WNDCLASSEX wc = new WNDCLASSEX();
            wc.cbSize = Marshal.SizeOf(typeof(WNDCLASSEX));
            wc.lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_wndProc);
            wc.hInstance = GetModuleHandle(null);
            wc.hCursor = LoadCursor(IntPtr.Zero, 32512 /* IDC_ARROW */);
            wc.hbrBackground = IntPtr.Zero;    // 自绘,避免白闪
            wc.lpszClassName = _className;

            if (RegisterClassEx(ref wc) == 0)
            {
                throw new InvalidOperationException("RegisterClassEx 失败,err=" + Marshal.GetLastWin32Error());
            }
            SetupLog.Write("host(win32): 窗口类已注册 " + _className);

            int dpi = GetSystemDpi();
            int style = WsPopupWindow | WsClipChildren | WsClipSiblings | 0x10000000 /* WS_VISIBLE */;
            RECT frame = MeasureFrameMargins(style, dpi);
            int windowWidth = _designWidth * dpi / 96 + (frame.Right - frame.Left);
            int windowHeight = _designHeight * dpi / 96 + (frame.Bottom - frame.Top);

            // 这里不自己算居中坐标:先让系统给个默认位置,再由 CenterOnWorkArea 按实测外框
            // 重新居中。CreateWindowEx 请求的尺寸会被系统按 DPI 改写,用"请求尺寸"算出来的
            // 坐标在高缩放机器上会把窗口推到屏幕外。
            const int CwUseDefault = unchecked((int)0x80000000);
            int x = CwUseDefault;
            int y = CwUseDefault;

            _hwnd = CreateWindowEx(WsExAppWindow, _className, _title, style,
                x, y, windowWidth, windowHeight, IntPtr.Zero, IntPtr.Zero, wc.hInstance, IntPtr.Zero);
            if (_hwnd == IntPtr.Zero)
            {
                throw new InvalidOperationException("CreateWindowEx 失败,err=" + Marshal.GetLastWin32Error());
            }

            _backgroundBrush = CreateSolidBrush(ColorBackground);
            FitClientArea(style, dpi, 0, 0);
            CenterOnWorkArea();
            LogWindowState();
        }

        /// <summary>
        /// 迭代校正窗口外框,直到客户区等于 设计尺寸 × dpi/96。
        /// 直接读实测客户区再反推外框,不对系统边框宽度做任何假设。
        /// </summary>
        private void FitClientArea(int style, int dpi, int unusedX, int unusedY)
        {
            int targetWidth = _designWidth * dpi / 96;
            int targetHeight = _designHeight * dpi / 96;
            for (int pass = 0; pass < 3; pass++)
            {
                RECT client;
                GetClientRect(_hwnd, out client);
                int clientWidth = client.Right - client.Left;
                int clientHeight = client.Bottom - client.Top;
                if (clientWidth == targetWidth && clientHeight == targetHeight)
                {
                    return;
                }
                RECT fit = new RECT();
                fit.Right = targetWidth;
                fit.Bottom = targetHeight;
                AdjustWindowRectExForDpiSafe(ref fit, style, dpi);
                SetWindowPos(_hwnd, IntPtr.Zero, 0, 0, fit.Right - fit.Left, fit.Bottom - fit.Top, SwpNoActivate | SwpNoMove);
                SetupLog.Write("host(win32): 客户区校正 pass=" + pass
                    + " 实测=" + clientWidth + "x" + clientHeight
                    + " 目标=" + targetWidth + "x" + targetHeight);
            }
        }

        /// <summary>按实测外框把窗口居中到工作区。</summary>
        private void CenterOnWorkArea()
        {
            RECT window;
            GetWindowRect(_hwnd, out window);
            int width = window.Right - window.Left;
            int height = window.Bottom - window.Top;
            RECT work = GetWorkArea();
            int workWidth = work.Right - work.Left;
            int workHeight = work.Bottom - work.Top;
            int x = work.Left + Math.Max(0, (workWidth - width) / 2);
            int y = work.Top + Math.Max(0, (workHeight - height) / 2);
            SetWindowPos(_hwnd, IntPtr.Zero, x, y, 0, 0, SwpNoSize | SwpNoActivate);
            SetupLog.Write("host(win32): 居中 外框=" + width + "x" + height
                + " 工作区=" + workWidth + "x" + workHeight + " → " + x + "," + y);
        }
        private void LogWindowState()
        {
            RECT window;
            GetWindowRect(_hwnd, out window);
            RECT client;
            GetClientRect(_hwnd, out client);
            SetupLog.Write("host(win32): 窗口就绪 窗口=" + (window.Right - window.Left) + "x" + (window.Bottom - window.Top)
                + " 客户区=" + (client.Right - client.Left) + "x" + (client.Bottom - client.Top)
                + " dpi=" + GetSystemDpi());
        }

        public void ShowAndLoop()
        {
            ShowWindow(_hwnd, SwShow);
            UpdateWindow(_hwnd);
            ApplyChrome();

            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0))
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }
            SetupLog.Write("host(win32): 消息循环结束");
        }

        public void Minimize()
        {
            ShowWindow(_hwnd, SwMinimize);
        }

        /// <summary>
        /// 真正的窗口拖动。WebView2 的子窗口铺满客户区,父窗口的 WM_NCHITTEST
        /// 根本收不到鼠标消息,所以拖拽只能由页面发起:页面在标题栏按下时发
        /// dragStart,这里交回鼠标捕获再按 HTCAPTION 走系统拖动。
        /// </summary>
        public void StartWindowDrag()
        {
            if (_hwnd == IntPtr.Zero)
            {
                return;
            }
            ReleaseCapture();
            SendMessage(_hwnd, WmNcLButtonDown, new IntPtr(HtCaption), IntPtr.Zero);
        }

        public void Close()
        {
            if (_hwnd != IntPtr.Zero && !_closed)
            {
                _closed = true;
                DestroyWindow(_hwnd);
            }
        }

        public void Refresh()
        {
            if (_hwnd != IntPtr.Zero)
            {
                InvalidateRect(_hwnd, IntPtr.Zero, false);
                UpdateWindow(_hwnd);
            }
        }

        public void Dispose()
        {
            if (_backgroundBrush != IntPtr.Zero)
            {
                DeleteObject(_backgroundBrush);
                _backgroundBrush = IntPtr.Zero;
            }
        }

        // ---- 内部实现 ----

        private void ApplyChrome()
        {
            try
            {
                int dark = 1;
                DwmSetWindowAttribute(_hwnd, DwmwaUseImmersiveDarkMode, ref dark, sizeof(int));
                int corner = DwmcpRound;
                int hr = DwmSetWindowAttribute(_hwnd, DwmwaWindowCornerPreference, ref corner, sizeof(int));
                SetupLog.Write("host(win32): DWM 圆角=" + (hr == 0));
            }
            catch (Exception ex)
            {
                SetupLog.Write("host(win32): 应用窗口外观失败 " + ex.Message);
            }
        }

        private IntPtr WindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
        {
            switch (msg)
            {
                case WmEraseBkgnd:
                    PaintBackground(wParam);
                    return new IntPtr(1);

                case WmPaint:
                {
                    PAINTSTRUCT ps;
                    IntPtr hdc = BeginPaint(hWnd, out ps);
                    PaintBackground(hdc);
                    EndPaint(hWnd, ref ps);
                    return IntPtr.Zero;
                }

                case WmNcCalcSize:
                    // 干掉非客户区(标题栏 + 边框),界面完全自绘
                    if (wParam != IntPtr.Zero && lParam != IntPtr.Zero)
                    {
                        NCCALCSIZE_PARAMS p = (NCCALCSIZE_PARAMS)Marshal.PtrToStructure(lParam, typeof(NCCALCSIZE_PARAMS));
                        Marshal.StructureToPtr(p, lParam, false);
                    }
                    return IntPtr.Zero;

                case WmNcActivate:
                case WmNcPaint:
                    // 不绘制任何非客户区元素
                    return new IntPtr(1);

                case WmNcHitTest:
                {
                    int lp = lParam.ToInt32();
                    short px = (short)(lp & 0xFFFF);
                    short py = (short)((lp >> 16) & 0xFFFF);
                    RECT rect;
                    GetWindowRect(hWnd, out rect);
                    int dpi = GetSystemDpi();
                    int dragHeight = _dragZoneHeight * dpi / 96;
                    bool inTopZone = py >= rect.Top && py < rect.Top + dragHeight;
                    bool inWindowButtons = px >= rect.Right - (150 * dpi / 96);
                    if (inTopZone && !inWindowButtons)
                    {
                        return new IntPtr(HtCaption);
                    }
                    return new IntPtr(HtClient);
                }

                case WmNcLButtonDown:
                    // 交给 DefWindowProc:它按 HTCAPTION 执行系统级窗口拖动
                    break;

                case WmSize:
                    if (OnResized != null)
                    {
                        OnResized();
                    }
                    break;

                case WmKeyDown:
                    if (wParam.ToInt32() == VkEscape && OnEscapePressed != null)
                    {
                        OnEscapePressed();
                    }
                    return IntPtr.Zero;

                case WmClose:
                    if (OnCloseRequested != null)
                    {
                        OnCloseRequested();
                        return IntPtr.Zero;
                    }
                    break;

                case WmDestroy:
                    PostQuitMessage(0);
                    return IntPtr.Zero;
            }

            return DefWindowProc(hWnd, msg, wParam, lParam);
        }

        private void PaintBackground(IntPtr hdc)
        {
            RECT rect;
            GetClientRect(_hwnd, out rect);
            IntPtr brush = _backgroundBrush;
            bool temporary = false;
            if (brush == IntPtr.Zero)
            {
                brush = CreateSolidBrush(ColorBackground);
                temporary = true;
            }
            IntPtr oldBrush = SelectObject(hdc, brush);
            PatBlt(hdc, 0, 0, rect.Right, rect.Bottom, PatCopy);
            SelectObject(hdc, oldBrush);
            if (temporary)
            {
                DeleteObject(brush);
            }
        }

        /// <summary>主显示器工作区(排除任务栏)。</summary>
        private static RECT GetWorkArea()
        {
            RECT area = new RECT();
            area.Right = GetSystemMetrics(SmCxScreen);
            area.Bottom = GetSystemMetrics(SmCyScreen);
            try
            {
                MONITORINFO info = new MONITORINFO();
                info.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
                POINT origin = new POINT();
                IntPtr monitor = MonitorFromPoint(origin, MonitorDefaultToNearest);
                if (monitor != IntPtr.Zero && GetMonitorInfo(monitor, ref info))
                {
                    area = info.rcWork;
                }
            }
            catch
            {
                // 退回屏幕尺寸
            }
            return area;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MONITORINFO
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public int dwFlags;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromPoint(POINT pt, int dwFlags);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

        private const int MonitorDefaultToNearest = 2;
        private static int GetSystemDpi()
        {
            IntPtr dc = IntPtr.Zero;
            try
            {
                dc = GetDC(IntPtr.Zero);
                if (dc == IntPtr.Zero)
                {
                    return 96;
                }
                int dpi = GetDeviceCaps(dc, LogPixelsX);
                return dpi <= 0 ? 96 : dpi;
            }
            catch
            {
                return 96;
            }
            finally
            {
                if (dc != IntPtr.Zero)
                {
                    ReleaseDC(IntPtr.Zero, dc);
                }
            }
        }

        /// <summary>
        /// 量出非客户区外框(标题栏/边框)占用的像素。这里用
        /// AdjustWindowRectExForDpi,不要用 DwmGetWindowAttribute(EXTENDED_FRAME_BOUNDS)
        /// —— 后者把窗口阴影也算进去,尺寸会高矮不对。
        /// </summary>
        private static RECT MeasureFrameMargins(int style, int dpi)
        {
            RECT rect = new RECT();
            rect.Right = 800;
            rect.Bottom = 600;
            AdjustWindowRectExForDpiSafe(ref rect, style, dpi);
            RECT margins = new RECT();
            margins.Left = rect.Left;
            margins.Top = rect.Top;
            margins.Right = rect.Right - 800;
            margins.Bottom = rect.Bottom - 600;
            SetupLog.Write("host(win32): 外框余量=" + margins.Left + "," + margins.Top + ","
                + margins.Right + "," + margins.Bottom);
            return margins;
        }

        /// <summary>按 DPI 计算外框尺寸;老系统回退到 96dpi 版本再按比例缩放。</summary>
        private static void AdjustWindowRectExForDpiSafe(ref RECT rect, int style, int dpi)
        {
            try
            {
                IntPtr user32 = LoadLibraryW("user32.dll");
                if (user32 != IntPtr.Zero)
                {
                    IntPtr proc = GetProcAddress(user32, "AdjustWindowRectExForDpi");
                    if (proc != IntPtr.Zero)
                    {
                        AdjustWindowRectExForDpiDelegate del =
                            (AdjustWindowRectExForDpiDelegate)Marshal.GetDelegateForFunctionPointer(
                                proc, typeof(AdjustWindowRectExForDpiDelegate));
                        bool ok = del(ref rect, style, false, WsExAppWindow, (uint)dpi);
                        FreeLibrary(user32);
                        if (ok)
                        {
                            return;
                        }
                    }
                    else
                    {
                        FreeLibrary(user32);
                    }
                }
            }
            catch
            {
                // 落到下面的回退分支
            }

            RECT fallback = rect;
            if (AdjustWindowRectEx(ref fallback, style, false, WsExAppWindow))
            {
                int width = fallback.Right - fallback.Left;
                int height = fallback.Bottom - fallback.Top;
                int left = fallback.Left * dpi / 96;
                int top = fallback.Top * dpi / 96;
                rect.Left = left;
                rect.Top = top;
                rect.Right = left + width * dpi / 96;
                rect.Bottom = top + height * dpi / 96;
            }
        }
    }
}
