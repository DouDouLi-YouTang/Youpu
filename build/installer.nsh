# ============================================================================
#  有谱 · 自定义安装界面(引导程序主导,安装包只当启动器与静默安装器)
# ----------------------------------------------------------------------------
#  ⚠ 本文件只服务于"安装器"构建。electron-builder 会把同一个 include 同时喂给
#    "卸载器"和"安装器"两次编译,而卸载器脚本里没有安装流程。未被引用的函数会
#    触发 warning 6010,electron-builder 又把警告当错误 —— 所以卸载器阶段整体跳过。
#
#  本安装包只有两种身份:
#
#   ① 启动器:用户双击安装包(非 /S、非 /youpu-classic)时,.onInit 把引导程序
#      YoupuSetupHost.exe 释放到 $TEMP\youpu-setup-host,写出 youpu-payload.ini,
#      Exec 拉起引导程序,随即 Quit。界面、目录选择、进度、完成页全部由引导程序负责。
#
#      ⚠ 这里必须是"拉起就走",不能像上一版那样 ExecWait 等引导程序结束:
#        electron-builder 的 ALLOW_ONLY_ONE_INSTALLER_INSTANCE 在本进程 .onInit 里
#        创建 ${APP_GUID} 单实例互斥体,并持有到本进程结束。只要本进程还活着,
#        引导程序随后用 /S /youpu-nested 拉起的静默安装就会在它自己的 .onInit 里
#        判定「已有安装程序在运行」→ Abort → 退出码 2(实测 0.6 秒退出、一个文件
#        都没写、F:\SoftwareData\youpu 只留下一个空目录)。这正是 2.0.4 安装时
#        「界面未响应、安装失败」的根因,别再改回 ExecWait 等待。
#
#   ② 安装器:引导程序以 /S /youpu-nested 拉起本安装包 → 静默安装,全程无窗口;
#      安装过程中把阶段与进度写进 youpu-response.json,引导界面据此推进进度条;
#      用户勾选的安装位置与快捷方式经 youpu-result.ini 回传
#      (result / response 两个路径由 /youpu-result= /youpu-response= 指定)。
#
#  回退:引导程序发现 WebView2 运行时缺失或宿主初始化失败时,用 /youpu-classic
#  重新拉起本安装包。此时本进程走 electron-builder 原生向导,绝不阻断安装。
#
#  自动更新:electron-updater 用 /S 调用本安装包,此时不弹任何界面,直接静默安装。
#
#  改动指引:
#    · 退出码约定  tools/setup-host/src/SetupExitCodes.cs
#    · 文案与协议  tools/setup-host/src/SetupProtocol.cs
#    · payload / result / response 三个中转文件的字段与 C# 侧一一对应,改一处必须同步
# ============================================================================
!ifdef BUILD_UNINSTALLER
  !echo "installer.nsh: 卸载器构建,跳过自定义安装界面"
!else
  !include "FileFunc.nsh"
  !include "LogicLib.nsh"   ; 显式引入:本文件可能在 MUI2 之前被 include

  # INSTALL_REGISTRY_KEY / UNINSTALL_REGISTRY_KEY 由 multiUser.nsh 定义,但 include 顺序
  # 决定了本文件可能先于它解析,直接引用会触发 warning 6000(被当作错误)。
  # 这里按同样的规则补一份,/ifndef 保证不会覆盖模板自己的定义。
  !define /ifndef INSTALL_REGISTRY_KEY "Software\${APP_GUID}"
  !define /ifndef UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"

  # 安装界面宿主的产物目录(beforePack 钩子生成)。File 指令的相对路径相对项目根解析。
  !ifndef SETUP_HOST_DIR
    !define SETUP_HOST_DIR "${PROJECT_DIR}\build\setup-host"
  !endif

  !define YOUPU_HOST_FILE  "YoupuSetupHost.exe"
  # 窗口标题用于「安装程序已经在运行」时前置已有窗口,必须与
  # tools/setup-host/src/WebView2Host.cs 里的窗口标题完全一致。
  !define YOUPU_HOST_TITLE "有谱 安装程序 — Youpu Setup"
  # 界面单实例互斥体:名称与 tools/setup-host/src/Program.cs 的 HostMutexName 一致。
  !define YOUPU_MUTEX      "Global\YoupuSetupHostMutex"
  # 宿主与三个中转文件的落地目录(不放 $PLUGINSDIR:本进程 Quit 后它会被删除,
  # 而引导程序要继续用它读 payload、写 result、轮询 response)。
  !define YOUPU_RUN_DIR    "$TEMP\youpu-setup-host"

  Var youpuMode              ; host = 引导程序接管 / nested = 静默安装 / silent / wizard
  Var youpuNested            ; "1" = 由引导程序拉起的静默安装
  Var youpuClassic           ; "1" = WebView2 不可用,走原生向导
  Var youpuExisting          ; "1" = 检测到已有安装(界面显示"升级安装")
  Var youpuRunDir
  Var youpuPayloadFile
  Var youpuResultFile
  Var youpuResponseFile
  Var youpuInstallDir
  Var youpuDesktopShortcut
  Var youpuStartMenuShortcut

  # ---------------------------------------------------------------------------
  # 启动初始化:解析命令行开关
  #   preInit 在 multiUser 初始化之前执行,只能做与注册表/安装模式无关的事
  # ---------------------------------------------------------------------------
  !macro preInit
    StrCpy $youpuMode "wizard"
    StrCpy $youpuNested ""
    StrCpy $youpuClassic ""
    StrCpy $youpuExisting ""
    StrCpy $youpuDesktopShortcut ""
    StrCpy $youpuStartMenuShortcut ""
    StrCpy $youpuRunDir "${YOUPU_RUN_DIR}"
    StrCpy $youpuPayloadFile "$youpuRunDir\youpu-payload.ini"
    StrCpy $youpuResultFile "$youpuRunDir\youpu-result.ini"
    StrCpy $youpuResponseFile "$youpuRunDir\youpu-response.json"

    ${GetParameters} $R0
    ${GetOptions} $R0 "/youpu-nested" $R1
    ${IfNot} ${Errors}
      StrCpy $youpuNested "1"
    ${EndIf}
    ${GetOptions} $R0 "/youpu-classic" $R1
    ${IfNot} ${Errors}
      StrCpy $youpuClassic "1"
    ${EndIf}
    # 中转文件路径由引导程序指定:它自己也是按这两个路径读写回执的
    ${GetOptions} $R0 "/youpu-result" $R1
    ${IfNot} ${Errors}
      StrCpy $youpuResultFile "$R1"
    ${EndIf}
    ${GetOptions} $R0 "/youpu-response" $R1
    ${IfNot} ${Errors}
      StrCpy $youpuResponseFile "$R1"
    ${EndIf}
  !macroend

  # ---------------------------------------------------------------------------
  # 分流(在 multiUser 初始化之后、任何 section 之前执行)
  #   · /S(silent,含 electron-updater 的自动更新) → 什么都不做,走标准静默安装
  #   · /youpu-nested                             → 静默安装 + 回执
  #   · /youpu-classic                            → 原生向导(WebView2 回退)
  #   · 其它(用户双击)                           → 启动引导程序后本进程立即退出
  # ---------------------------------------------------------------------------
  !macro customInit
    ${If} $youpuNested == "1"
      StrCpy $youpuMode "nested"
      Call youpuLoadResult
      ${If} $youpuInstallDir != ""
        # /D= 已经把 $INSTDIR 定到用户选的目录,这里以回执为准(两者本应一致)
        StrCpy $INSTDIR "$youpuInstallDir"
      ${EndIf}
    ${ElseIf} ${Silent}
      StrCpy $youpuMode "silent"
    ${ElseIf} $youpuClassic == "1"
      StrCpy $youpuMode "wizard"
      Call youpuDetectExisting
    ${Else}
      StrCpy $youpuMode "wizard"
      Call youpuDetectExisting
      Call youpuLaunchHostUi
      ${If} $youpuMode == "host"
        # 引导程序已接管界面:本进程立即退出,释放单实例互斥体(见文件头说明)。
        # SetErrorLevel 0 不能省:.onInit 走到这里时错误等级可能已被前面的模板
        # 代码留成非 0,Quit 会把那个值当成本进程退出码(实测拿到过 2)。
        SetErrorLevel 0
        Quit
      ${EndIf}
      # 引导程序起不来:继续走原生向导
      StrCpy $youpuMode "wizard"
    ${EndIf}
  !macroend

  # ---------------------------------------------------------------------------
  # 已有安装检测:沿用上次的安装位置,并让界面显示"升级安装"
  #   SHELL_CONTEXT 由 multiUser.nsh 按注册表/参数定好,此处一定已就绪
  # ---------------------------------------------------------------------------
  Function youpuDetectExisting
    StrCpy $youpuExisting ""
    ReadRegStr $youpuInstallDir SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $youpuInstallDir != ""
      StrCpy $INSTDIR "$youpuInstallDir"
      StrCpy $youpuExisting "1"
    ${EndIf}
  FunctionEnd

  # ---------------------------------------------------------------------------
  # 释放宿主 + 拉起界面
  #   退出时 $youpuMode:
  #     "host"   = 界面已由引导程序接管(新拉起 / 或已有界面被前置),本进程应立刻退出
  #     "wizard" = 宿主起不来或已是重复启动的失败路径,交回原生向导
  # ---------------------------------------------------------------------------
  Function youpuLaunchHostUi
    # 单实例:界面已经在运行时前置它,不重复释放宿主文件(它们可能正被占用)。
    # 这里必须把 $youpuMode 也置成 host —— 否则调用方会继续走原生向导,
    # 表现成"装到一半双击安装包,又弹出一个经典安装向导"。
    System::Call 'kernel32::OpenMutex(i 0x00100000, i 0, t "${YOUPU_MUTEX}") p .R1'
    ${If} $R1 != 0
      System::Call 'kernel32::CloseHandle(p R1)'
      StrCpy $youpuMode "host"
      FindWindow $R2 "" "${YOUPU_HOST_TITLE}"
      ${If} $R2 != 0
        SendMessage $R2 0x0112 0xF120 0 /TIMEOUT=2000 ; WM_SYSCOMMAND / SC_RESTORE
        System::Call 'user32::SetForegroundWindow(p R2)'
      ${Else}
        MessageBox MB_OK|MB_ICONINFORMATION "有谱安装程序已经在运行。"
      ${EndIf}
      Return
    ${EndIf}

    SetOutPath "$youpuRunDir"
    File /r "${SETUP_HOST_DIR}\*.*"
    Call youpuPreparePayload

    Delete "$youpuRunDir\youpu-host-started"
    # 注意:NSIS 的 Exec 拿不到子进程 PID(Exec 只接受一个参数),所以超时清理
    # 只能按映像名结束;此时已经确认没有别的界面在运行(上面的互斥体检查)。
    Exec '"$youpuRunDir\${YOUPU_HOST_FILE}" /payload="$youpuPayloadFile"'

    StrCpy $R3 0
    youpuWaitHostLoop:
      Sleep 200
      ${If} ${FileExists} "$youpuRunDir\youpu-host-started"
        StrCpy $youpuMode "host"
        Return
      ${EndIf}
      IntOp $R3 $R3 + 1
      ${If} $R3 < 25
        Goto youpuWaitHostLoop
      ${EndIf}

    # 超时(5 秒):宿主进程起不来,结束它并交回原生向导
    DetailPrint "引导程序未能就绪,回退到经典安装界面"
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM "${YOUPU_HOST_FILE}"'
    Pop $R4
  FunctionEnd

  # ---------------------------------------------------------------------------
  # 初始界面数据(youpu-payload.ini)
  #   用 UTF-16LE 的 key=value 行格式而不是 JSON:安装目录可能含中文、引号、
  #   反斜杠甚至控制字符,JSON 转义一旦漏项界面就渲染不出来;行格式最稳,
  #   读取端 InstallPayload.cs 逐行取 = 之后的内容,不做任何转义处理。
  # ---------------------------------------------------------------------------
  Function youpuPreparePayload
    CreateDirectory "$youpuRunDir"

    FileOpen $9 "$youpuPayloadFile" w
    FileWriteUTF16LE /BOM $9 "appName=${PRODUCT_NAME}$\r$\n"
    FileWriteUTF16LE $9 "appNameEn=${PRODUCT_FILENAME}$\r$\n"
    FileWriteUTF16LE $9 "version=${VERSION}$\r$\n"
    FileWriteUTF16LE $9 "publisher=${COMPANY_NAME}$\r$\n"
    FileWriteUTF16LE $9 "description=${APP_DESCRIPTION}$\r$\n"
    FileWriteUTF16LE $9 "defaultInstallDir=$INSTDIR$\r$\n"
    !ifdef APP_64_UNPACKED_SIZE
      # electron-builder 的 APP_64_UNPACKED_SIZE 单位是 KB(它的 SectionSetSize 就按 KB 用),
      # 而界面按字节显示;不换算的话 518MB 会显示成 1MB。
      IntOp $R1 ${APP_64_UNPACKED_SIZE} * 1024
      FileWriteUTF16LE $9 "requiredBytes=$R1$\r$\n"
    !else
      FileWriteUTF16LE $9 "requiredBytes=0$\r$\n"
    !endif
    ${If} $youpuExisting == "1"
      FileWriteUTF16LE $9 "isUpdate=1$\r$\n"
    ${Else}
      FileWriteUTF16LE $9 "isUpdate=0$\r$\n"
    ${EndIf}
    FileWriteUTF16LE $9 "installerPath=$EXEPATH$\r$\n"
    # ⚠ 本文件在 common.nsh 之前被 include,只能用 electron-builder 命令行传入的
    #   -D 定义(APP_FILENAME / PRODUCT_NAME / SHORTCUT_NAME …),不能引用模板
    #   内部才定义的名字(如 APP_EXECUTABLE_FILENAME),否则 warning 6000 被当错误。
    FileWriteUTF16LE $9 "appExe=${APP_FILENAME}.exe$\r$\n"
    FileWriteUTF16LE $9 "resultPath=$youpuResultFile$\r$\n"
    FileWriteUTF16LE $9 "responsePath=$youpuResponseFile$\r$\n"
    FileWriteUTF16LE $9 "language=auto$\r$\n"
    FileClose $9
  FunctionEnd

  # ---------------------------------------------------------------------------
  # 选项回执(youpu-result.ini,引导程序写、本安装包读)
  #   逐行解析 dir / desktop / startmenu / launch 四个字段。
  #   FileReadUTF16LE 会跳过 BOM,读到行尾自动去掉 CRLF。
  # ---------------------------------------------------------------------------
  Function youpuLoadResult
    ${IfNot} ${FileExists} "$youpuResultFile"
      Return
    ${EndIf}
    ClearErrors
    FileOpen $9 "$youpuResultFile" r
    ${If} ${Errors}
      Return
    ${EndIf}
    youpuResultLoop:
      ClearErrors
      FileReadUTF16LE $9 $R1
      ${If} ${Errors}
        Goto youpuResultDone
      ${EndIf}
      StrCpy $R2 "$R1" 4
      StrCmp $R2 "dir=" 0 youpuResultCheckDesktop
        StrCpy $youpuInstallDir "$R1" "" 4
        Goto youpuResultLoop
      youpuResultCheckDesktop:
      StrCpy $R2 "$R1" 8
      StrCmp $R2 "desktop=" 0 youpuResultCheckStartMenu
        StrCpy $youpuDesktopShortcut "$R1" "" 8
        Goto youpuResultLoop
      youpuResultCheckStartMenu:
      StrCpy $R2 "$R1" 10
      StrCmp $R2 "startmenu=" 0 youpuResultLoop
        StrCpy $youpuStartMenuShortcut "$R1" "" 10
        Goto youpuResultLoop
    youpuResultDone:
    FileClose $9
  FunctionEnd

  # ---------------------------------------------------------------------------
  # 跳过 electron-builder 的"安装模式(为谁安装)"页(仅原生向导路径需要)
  #   multiUserUi.nsh 的 customInstallMode 钩子:页面显示前设 isForceCurrentInstall=1,
  #   页面自行 Abort,落定为"仅为我安装"。
  #   ⚠ 不能在 .onInit 里 Abort —— 那会直接结束整个安装进程(实测退出码 2)。
  # ---------------------------------------------------------------------------
  !macro customInstallMode
    StrCpy $isForceCurrentInstall "1"
  !macroend

  # ---------------------------------------------------------------------------
  # 安装阶段:进度回执 + 按用户选择剔除快捷方式
  #   nested 模式下 electron-builder 默认把桌面/开始菜单快捷方式都建上,
  #   用户在界面里没勾的这里删掉(只有明确回传 "0" 才删,回执缺失时不动)。
  # ---------------------------------------------------------------------------
  !macro customInstall
    Push 45
    Push "正在写入程序文件"
    Call youpuWriteProgress

    ${If} $youpuMode == "nested"
      ${If} $youpuDesktopShortcut == "0"
        Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
      ${EndIf}
      ${If} $youpuStartMenuShortcut == "0"
        Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
      ${EndIf}
    ${EndIf}

    Push 90
    Push "正在完成安装"
    Call youpuWriteProgress

    # 终态:进度条可以冲到 100%;安装是否成功仍以本进程退出码为准
    Call youpuWriteDone
  !macroend

  # ---------------------------------------------------------------------------
  # 旧版本卸载结果的处理
  #   ⚠ 这个钩子会**接管** electron-builder 在 SHELL_CONTEXT 分支上的默认逻辑
  #     (installUtil.nsh 里插进来后立刻 Return),所以必须自己分辨两种情况:
  #       · 卸载器根本没启动起来(注册表残留、旧文件已被手工删掉):$R0 保持 0,
  #         当作"没有旧版本"继续安装 —— 这是最常见的升级场景;
  #       · 卸载器跑起来却返回非 0:真失败,回执 failed 并中止安装(等价于
  #         electron-builder 默认的弹窗 + SetErrorLevel 2,只是把提示交给界面)。
  #   早先这里无条件写 failed,于是前一种情况会在安装途中闪出"安装未完成"。
  # ---------------------------------------------------------------------------
  !macro customUnInstallCheck
    ${If} $R0 != 0
      ${If} $youpuMode == "nested"
        Call youpuWriteFailed
      ${Else}
        MessageBox MB_OK|MB_ICONEXCLAMATION "旧版本未能卸载,安装已中止(错误码 $R0)。"
      ${EndIf}
      SetErrorLevel 2
      Quit
    ${EndIf}
  !macroend

  # ---------------------------------------------------------------------------
  # 进度 / 终态回执(youpu-response.json,本安装包写、引导程序轮询)
  #   只在 nested 模式写:只有引导程序在盯着这个文件。
  # ---------------------------------------------------------------------------
  Function youpuWriteProgress
    Pop $R9                     ; 文案(后入栈)
    Pop $R8                     ; 百分比(先入栈)
    ${If} $youpuMode != "nested"
      Return
    ${EndIf}
    ClearErrors
    FileOpen $9 "$youpuResponseFile" w
    ${If} ${Errors}
      Return
    ${EndIf}
    FileWriteUTF16LE /BOM $9 '{$\r$\n'
    FileWriteUTF16LE $9 '  "state": "progress",$\r$\n'
    FileWriteUTF16LE $9 '  "percent": $R8,$\r$\n'
    FileWriteUTF16LE $9 '  "message": "$R9"$\r$\n'
    FileWriteUTF16LE $9 "}$\r$\n"
    FileClose $9
  FunctionEnd

  Function youpuWriteDone
    ${If} $youpuMode != "nested"
      Return
    ${EndIf}
    ClearErrors
    FileOpen $9 "$youpuResponseFile" w
    ${If} ${Errors}
      Return
    ${EndIf}
    # installDir 里的反斜杠会被当成 JSON 转义,统一写正斜杠,
    # C# 侧(ProgressState)再转回反斜杠;界面显示的目录以引导程序手里的为准。
    FileWriteUTF16LE /BOM $9 '{$\r$\n'
    FileWriteUTF16LE $9 '  "state": "done",$\r$\n'
    FileWriteUTF16LE $9 '  "percent": 100,$\r$\n'
    FileWriteUTF16LE $9 '  "installDir": "$INSTDIR"$\r$\n'
    FileWriteUTF16LE $9 "}$\r$\n"
    FileClose $9
  FunctionEnd

  Function youpuWriteFailed
    ${If} $youpuMode != "nested"
      Return
    ${EndIf}
    ClearErrors
    FileOpen $9 "$youpuResponseFile" w
    ${If} ${Errors}
      Return
    ${EndIf}
    FileWriteUTF16LE /BOM $9 '{$\r$\n'
    FileWriteUTF16LE $9 '  "state": "failed",$\r$\n'
    FileWriteUTF16LE $9 '  "percent": 100,$\r$\n'
    FileWriteUTF16LE $9 '  "message": "安装未完成"$\r$\n'
    FileWriteUTF16LE $9 "}$\r$\n"
    FileClose $9
  FunctionEnd
!endif # BUILD_UNINSTALLER
