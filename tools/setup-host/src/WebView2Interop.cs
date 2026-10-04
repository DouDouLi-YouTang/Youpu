// WebView2 原生 COM 互操作。使用手写 vtable 而非官方托管封装,原因:
// 1) 安装引导程序必须是单文件 PE,官方 Microsoft.Web.WebView2.Core/WinForms 是
//    两个托管 DLL,内嵌后还要做 AssemblyResolve 释放,徒增启动延迟与失败面;
// 2) 这里只需要"显示一个网页 + 收发 JSON 消息"这 6 个接口。
// vtable 顺序从官方 Microsoft.Web.WebView2.Core.dll 的 Raw 命名空间逐一反射校验过
// (见 tools/setup-host/README.md),顺序错位会导致进程直接崩溃,改动前务必复核。
using System;
using System.Runtime.InteropServices;

namespace YoupuSetupHost
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [ComImport, Guid("b96d755e-0319-4e92-a296-23436f46a1fc"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface ICoreWebView2Environment
    {
        [PreserveSig]
        int CreateCoreWebView2Controller(IntPtr parentWindow, IntPtr handler);

        [PreserveSig]
        int CreateWebResourceResponse(IntPtr content, int statusCode, [MarshalAs(UnmanagedType.LPWStr)] string reasonPhrase, [MarshalAs(UnmanagedType.LPWStr)] string headers, out IntPtr response);

        [PreserveSig]
        int Get_BrowserVersionString([MarshalAs(UnmanagedType.LPWStr)] out string version);

        [PreserveSig]
        int add_NewBrowserVersionAvailable(IntPtr handler, out long token);

        [PreserveSig]
        int remove_NewBrowserVersionAvailable(long token);
    }

    [ComImport, Guid("4d00c0d1-9434-4eb6-8078-8697a560334f"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface ICoreWebView2Controller
    {
        [PreserveSig]
        int Get_IsVisible(out int value);

        [PreserveSig]
        int Put_IsVisible(int value);

        [PreserveSig]
        int Get_Bounds(out RECT bounds);

        [PreserveSig]
        int Put_Bounds(RECT bounds);

        [PreserveSig]
        int Get_ZoomFactor(out double value);

        [PreserveSig]
        int Put_ZoomFactor(double value);

        [PreserveSig]
        int add_ZoomFactorChanged(IntPtr handler, out long token);

        [PreserveSig]
        int remove_ZoomFactorChanged(long token);

        [PreserveSig]
        int SetBoundsAndZoomFactor(RECT bounds, double zoomFactor);

        [PreserveSig]
        int MoveFocus(int reason);

        [PreserveSig]
        int add_MoveFocusRequested(IntPtr handler, out long token);

        [PreserveSig]
        int remove_MoveFocusRequested(long token);

        [PreserveSig]
        int add_GotFocus(IntPtr handler, out long token);

        [PreserveSig]
        int remove_GotFocus(long token);

        [PreserveSig]
        int add_LostFocus(IntPtr handler, out long token);

        [PreserveSig]
        int remove_LostFocus(long token);

        [PreserveSig]
        int add_AcceleratorKeyPressed(IntPtr handler, out long token);

        [PreserveSig]
        int remove_AcceleratorKeyPressed(long token);

        [PreserveSig]
        int Get_ParentWindow(out IntPtr value);

        [PreserveSig]
        int Put_ParentWindow(IntPtr value);

        [PreserveSig]
        int NotifyParentWindowPositionChanged();

        [PreserveSig]
        int Close();

        [PreserveSig]
        int Get_CoreWebView2(out IntPtr value);
    }

    // 手写接口的方法顺序 = 原生 vtable 槽位顺序,必须与官方 Raw 接口逐位一致
    // (见 README「环境约束 4」)。槽位只能追加在末尾:即使宿主用不到
    // (CapturePreview / ExecuteScript / CallDevToolsProtocolMethod 等)也必须原样保留,
    // 删掉一个槽位会让它后面的所有调用错位,进程直接崩溃而不是抛异常。
    [ComImport, Guid("76eceacb-0462-4d94-ac83-423a6793775e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface ICoreWebView2
    {
        [PreserveSig]
        int Get_Settings(out IntPtr value);
        [PreserveSig]
        int Get_Source([MarshalAs(UnmanagedType.LPWStr)] out string value);
        [PreserveSig]
        int Navigate([MarshalAs(UnmanagedType.LPWStr)] string uri);
        [PreserveSig]
        int NavigateToString([MarshalAs(UnmanagedType.LPWStr)] string html);
        [PreserveSig]
        int add_NavigationStarting(IntPtr handler, out long token);
        [PreserveSig]
        int remove_NavigationStarting(long token);
        [PreserveSig]
        int add_ContentLoading(IntPtr handler, out long token);
        [PreserveSig]
        int remove_ContentLoading(long token);
        [PreserveSig]
        int add_SourceChanged(IntPtr handler, out long token);
        [PreserveSig]
        int remove_SourceChanged(long token);
        [PreserveSig]
        int add_HistoryChanged(IntPtr handler, out long token);
        [PreserveSig]
        int remove_HistoryChanged(long token);
        [PreserveSig]
        int add_NavigationCompleted(IntPtr handler, out long token);
        [PreserveSig]
        int remove_NavigationCompleted(long token);
        [PreserveSig]
        int add_FrameNavigationStarting(IntPtr handler, out long token);
        [PreserveSig]
        int remove_FrameNavigationStarting(long token);
        [PreserveSig]
        int add_FrameNavigationCompleted(IntPtr handler, out long token);
        [PreserveSig]
        int remove_FrameNavigationCompleted(long token);
        [PreserveSig]
        int add_ScriptDialogOpening(IntPtr handler, out long token);
        [PreserveSig]
        int remove_ScriptDialogOpening(long token);
        [PreserveSig]
        int add_PermissionRequested(IntPtr handler, out long token);
        [PreserveSig]
        int remove_PermissionRequested(long token);
        [PreserveSig]
        int add_ProcessFailed(IntPtr handler, out long token);
        [PreserveSig]
        int remove_ProcessFailed(long token);
        [PreserveSig]
        int AddScriptToExecuteOnDocumentCreated([MarshalAs(UnmanagedType.LPWStr)] string javaScript, IntPtr handler);
        [PreserveSig]
        int RemoveScriptToExecuteOnDocumentCreated([MarshalAs(UnmanagedType.LPWStr)] string id);
        [PreserveSig]
        int ExecuteScript([MarshalAs(UnmanagedType.LPWStr)] string javaScript, IntPtr handler);
        [PreserveSig]
        int CapturePreview(int imageFormat, IntPtr imageStream, IntPtr handler, out long token);
        [PreserveSig]
        int Reload();
        [PreserveSig]
        int PostWebMessageAsJson([MarshalAs(UnmanagedType.LPWStr)] string webMessageAsJson);
        [PreserveSig]
        int PostWebMessageAsString([MarshalAs(UnmanagedType.LPWStr)] string webMessageAsString);
        [PreserveSig]
        int add_WebMessageReceived(IntPtr handler, out long token);
        [PreserveSig]
        int remove_WebMessageReceived(long token);
        [PreserveSig]
        int CallDevToolsProtocolMethod([MarshalAs(UnmanagedType.LPWStr)] string methodName, [MarshalAs(UnmanagedType.LPWStr)] string parametersAsJson, IntPtr handler);
        [PreserveSig]
        int Get_BrowserProcessId(out int value);
        [PreserveSig]
        int Get_CanGoBack(out int value);
        [PreserveSig]
        int Get_CanGoForward(out int value);
        [PreserveSig]
        int GoBack();
        [PreserveSig]
        int GoForward();
        [PreserveSig]
        int GetDevToolsProtocolEventReceiver([MarshalAs(UnmanagedType.LPWStr)] string eventName, out IntPtr receiver);
        [PreserveSig]
        int Stop();
        [PreserveSig]
        int add_NewWindowRequested(IntPtr handler, out long token);
        [PreserveSig]
        int remove_NewWindowRequested(long token);
        [PreserveSig]
        int add_DocumentTitleChanged(IntPtr handler, out long token);
        [PreserveSig]
        int remove_DocumentTitleChanged(long token);
        [PreserveSig]
        int Get_DocumentTitle([MarshalAs(UnmanagedType.LPWStr)] out string title);
    }

    [ComImport, Guid("e562e4f0-d7fa-43ac-8d71-c05150499f00"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface ICoreWebView2Settings
    {
        [PreserveSig]
        int Get_IsScriptEnabled(out int value);
        [PreserveSig]
        int Put_IsScriptEnabled(int value);
        [PreserveSig]
        int Get_IsWebMessageEnabled(out int value);
        [PreserveSig]
        int Put_IsWebMessageEnabled(int value);
        [PreserveSig]
        int Get_AreDefaultScriptDialogsEnabled(out int value);
        [PreserveSig]
        int Put_AreDefaultScriptDialogsEnabled(int value);
        [PreserveSig]
        int Get_IsStatusBarEnabled(out int value);
        [PreserveSig]
        int Put_IsStatusBarEnabled(int value);
        [PreserveSig]
        int Get_AreDevToolsEnabled(out int value);
        [PreserveSig]
        int Put_AreDevToolsEnabled(int value);
        [PreserveSig]
        int Get_AreDefaultContextMenusEnabled(out int value);
        [PreserveSig]
        int Put_AreDefaultContextMenusEnabled(int value);
        [PreserveSig]
        int Get_AreHostObjectsAllowed(out int value);
        [PreserveSig]
        int Put_AreHostObjectsAllowed(int value);
        [PreserveSig]
        int Get_IsZoomControlEnabled(out int value);
        [PreserveSig]
        int Put_IsZoomControlEnabled(int value);
        [PreserveSig]
        int Get_IsBuiltInErrorPageEnabled(out int value);
        [PreserveSig]
        int Put_IsBuiltInErrorPageEnabled(int value);
    }

    [ComImport, Guid("0f99a40c-e962-4207-9e92-e3d542eff849"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface ICoreWebView2WebMessageReceivedEventArgs
    {
        [PreserveSig]
        int Get_Source([MarshalAs(UnmanagedType.LPWStr)] out string value);
        [PreserveSig]
        int Get_webMessageAsJson([MarshalAs(UnmanagedType.LPWStr)] out string value);
        [PreserveSig]
        int TryGetWebMessageAsString([MarshalAs(UnmanagedType.LPWStr)] out string value);
    }

    // ---- 事件回调接口:由托管类实现,用 WebView2Loader.GetInterfacePointer 取指针交回原生侧。
    // 必须声明为 public(见 README「环境约束 2」),否则 QueryInterface 返回 E_NOINTERFACE。 ----

    [ComVisible(true)]
    [Guid("6c4819f3-c9b7-4260-8127-c9f5bde7f68c")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IControllerCreatedHandler
    {
        [PreserveSig]
        int Invoke(int errorCode, IntPtr controller);
    }

    [ComVisible(true)]
    [Guid("4e8a3389-c9d8-4bd2-b6b5-124fee6cc14d")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IEnvironmentCreatedHandler
    {
        [PreserveSig]
        int Invoke(int errorCode, IntPtr environment);
    }

    [ComVisible(true)]
    [Guid("57213f19-00e6-49fa-8e07-898ea01ecbd2")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IWebMessageReceivedHandler
    {
        [PreserveSig]
        int Invoke(IntPtr sender, IntPtr args);
    }

    [ComVisible(true)]
    [Guid("d33a35bf-1c49-4f98-93ab-006e0533fe1c")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface INavigationCompletedHandler
    {
        [PreserveSig]
        int Invoke(IntPtr sender, IntPtr args);
    }

    internal static class WebView2Loader
    {
        public const int S_OK = 0;

        [DllImport("WebView2Loader.dll", CharSet = CharSet.Unicode, ExactSpelling = true, PreserveSig = true)]
        public static extern int CreateCoreWebView2EnvironmentWithOptions(
            [MarshalAs(UnmanagedType.LPWStr)] string browserExecutableFolder,
            [MarshalAs(UnmanagedType.LPWStr)] string userDataFolder,
            IntPtr environmentOptions,
            IntPtr environmentCreatedHandler);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetDllDirectory(string lpPathName);

        /// <summary>
        /// 把实现了 COM 接口的托管对象转成原生接口指针。
        /// 不用 Marshal.GetComInterfaceForObject:它对"类型必须 COM 可见"的检查
        /// 在手写 [ComImport] 接口上会误判(实测抛 ArgumentException),
        /// GetIUnknownForObject + QueryInterface 走的是同一套 CCW,但绕开了该检查。
        /// </summary>
        public static IntPtr GetInterfacePointer(object instance, Guid iid)
        {
            IntPtr unknown = Marshal.GetIUnknownForObject(instance);
            try
            {
                IntPtr target;
                int hr = Marshal.QueryInterface(unknown, ref iid, out target);
                if (hr != S_OK)
                {
                    throw new InvalidOperationException(
                        "QueryInterface 失败 hr=0x" + hr.ToString("X8") + " iid=" + iid);
                }
                return target;
            }
            finally
            {
                Marshal.Release(unknown);
            }
        }
    }
}
