// 应用自动更新(electron-updater + GitHub Releases)。
// 通道约定：
//   正式版 0.2.0       -> latest.yml，客户端 allowPrerelease=false 只认正式 Release
//   Beta  0.2.0-beta.1 -> beta.yml，客户端 allowPrerelease=true 认最新(含预发布)Release
// 开发环境(非 packaged)autoUpdater 不工作，所有方法安全返回不可用。
//
// 安装采用"两阶段更新"(看门狗)而不是 electron-updater 的 quitAndInstall：
//   quitAndInstall 会【先】spawn NSIS 安装器、【后】app.quit()，安装器启动时主进程
//   (以及 fork 的后端，两者同名 Youpu.exe)往往还没退出。NSIS 卸载旧版文件时文件被
//   占用，重试 5 次后报「无法关闭/卸载失败」。
//   两阶段更新：先清理子进程 → 拉起独立的 powershell 看门狗 → 主进程硬退出 →
//   看门狗确认主进程消失后才启动安装器(静默 /S + --force-run 装完自动重启应用)。
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import electronUpdater, { type UpdateInfo } from 'electron-updater'

const { autoUpdater } = electronUpdater

export type UpdateChannel = 'latest' | 'beta'

export interface UpdateStatus {
  currentVersion: string
  channel: UpdateChannel
  available: boolean
  version: string | null
  /** GitHub Release 正文(更新说明)。 */
  releaseNotes: string | null
  releaseUrl: string | null
  /** 是否支持应用内"重启并安装"(安装版支持；便携版 zip 无安装器)。 */
  installSupported: boolean
  error?: string
}

export interface DownloadProgress {
  receivedBytes: number
  totalBytes: number
  percent: number
  bytesPerSecond: number
}

const GITHUB_REPO_RELEASES = 'https://github.com/DouDouLi-YouTang/Youpu/releases'

function isPackaged(): boolean {
  return app.isPackaged
}

/** NSIS 安装版会在安装目录生成 "Uninstall <productName>.exe"，便携版(zip 解压)没有。 */
function isInstalledBuild(): boolean {
  if (!app.isPackaged) return true
  try {
    const dir = dirname(process.execPath)
    return readdirSync(dir).some(
      (name) => name.toLowerCase().startsWith('uninstall') && name.toLowerCase().endsWith('.exe')
    )
  } catch {
    return false
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function releaseUrlFor(version: string | null): string | null {
  return version ? `${GITHUB_REPO_RELEASES}/tag/v${version}` : GITHUB_REPO_RELEASES
}

function notesToString(notes: UpdateInfo['releaseNotes']): string | null {
  if (typeof notes === 'string') return notes
  // github provider 可能给 ReleaseNoteInfo[] 结构，拼接每条 note
  if (Array.isArray(notes)) {
    return (
      notes
        .map((note) => (typeof note.note === 'string' ? note.note : ''))
        .filter(Boolean)
        .join('\n') || null
    )
  }
  return null
}

type StatusListener = (status: UpdateStatus) => void
type ProgressListener = (progress: DownloadProgress) => void

let statusListeners: StatusListener[] = []
let progressListeners: ProgressListener[] = []
/** 最近一次 checkForUpdates 得到的新版本信息，下载完成后用它上报版本号。 */
let pendingUpdate: { version: string; notes: string | null; channel: UpdateChannel } | null = null
/** 是否已下载完成、等待安装。防止未下载时点击"重启并安装"变成静默空操作。 */
let updateDownloaded = false
/** 是否已安排安装(看门狗已拉起、应用即将退出)。防止连点两次拉起两个安装器。 */
let installScheduled = false

/** 拉起安装器前的清理钩子:主进程注册用于在 quitAndInstall 前停掉子进程(后端 API 服务)
 *  并等待其退出,避免同名进程仍持有安装目录文件句柄,被 NSIS 误判为「应用还在运行」。 */
type BeforeInstallHook = () => void | Promise<void>
let beforeInstallHook: BeforeInstallHook | null = null

export function setBeforeInstallHook(hook: BeforeInstallHook): void {
  beforeInstallHook = hook
}

function emitStatus(status: UpdateStatus): void {
  for (const listener of statusListeners) {
    try {
      listener(status)
    } catch {
      // 单个监听器异常不影响其余分发
    }
  }
}

export function onUpdateStatus(listener: StatusListener): () => void {
  statusListeners.push(listener)
  return () => {
    statusListeners = statusListeners.filter((l) => l !== listener)
  }
}

export function onDownloadProgress(listener: ProgressListener): () => void {
  progressListeners.push(listener)
  return () => {
    progressListeners = progressListeners.filter((l) => l !== listener)
  }
}

function applyChannel(channel: UpdateChannel): void {
  // 打包时 publish.channel 会被 electron-builder 写进 app-update.yml，导致 autoUpdater.channel
  // 被固定成 beta；这里必须在运行时用用户选择的通道覆盖，否则「正式版」通道也会去拉 beta.yml。
  // 本地测试：设置 YOUPU_UPDATE_FEED_URL 后改用 generic provider 指向本地静态服务器
  // （例如 dist/0.2.1-beta.6/ 由 scripts/serve-updates.mjs 托管），离线验证更新流程，
  // 无需每次发到 GitHub Releases。
  const localFeedUrl = process.env.YOUPU_UPDATE_FEED_URL
  if (localFeedUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: localFeedUrl })
  }
  autoUpdater.channel = channel
  // electron-updater 的 channel setter 会自动把 allowDowngrade 置 true（为「从 beta 退回正式」设计），
  // 这会让同一通道内的旧版本也被当成可用更新（如 beta.7 提示降级到 beta.6）。这里显式关掉，
  // 只有用户主动切换通道时才在 checkForAppUpdate 里临时放开。
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = channel === 'beta'
  autoUpdater.autoDownload = false
  // 安装一律走「两阶段更新」看门狗(见 quitAndInstallUpdate),永久关闭 electron-updater
  // 自带的 install-on-quit:它是【先】启动安装器、【后】退应用,安装器启动时主进程与
  // 后端 fork(同名 Youpu.exe)往往还活着并持有安装目录文件句柄,NSIS 卸载旧版本因此
  // 失败报「卸载失败」——这正是原始故障的根因。
  // 另外它还会在退出钩子里再拉起第二个安装器(与看门狗抢着装),必须关掉。
  autoUpdater.autoInstallOnAppQuit = false
  updateDownloaded = false
}

export function initAutoUpdater(): void {
  if (!isPackaged()) return
  applyChannel('latest')
  autoUpdater.logger = console
}

export async function checkForAppUpdate(
  channel: UpdateChannel,
  allowDowngrade = false
): Promise<UpdateStatus> {
  const base = {
    currentVersion: app.getVersion(),
    channel,
    available: false,
    version: null,
    releaseNotes: null,
    releaseUrl: null as string | null,
    installSupported: isInstalledBuild()
  }
  if (!isPackaged()) {
    return { ...base, error: '开发环境不支持应用内更新，请安装打包版本' }
  }
  applyChannel(channel)
  // 用户主动切换通道（如 beta -> latest）时允许降级到目标通道的最新版；
  // 常规检查（进页面/手动点「检查更新」）不允许降级，避免 beta.7 反被提示更新到 beta.6。
  if (allowDowngrade) autoUpdater.allowDowngrade = true
  try {
    const result = await autoUpdater.checkForUpdates()
    const info = result?.updateInfo
    const available = result?.isUpdateAvailable === true
    if (info?.version) {
      pendingUpdate = {
        version: info.version,
        notes: notesToString(info.releaseNotes),
        channel
      }
    } else {
      pendingUpdate = null
    }
    return {
      ...base,
      available,
      version: info?.version ?? null,
      releaseNotes: notesToString(info?.releaseNotes),
      releaseUrl: releaseUrlFor(info?.version ?? null)
    }
  } catch (error) {
    pendingUpdate = null
    return { ...base, error: toMessage(error) }
  }
}

export async function downloadAppUpdate(): Promise<{ ok: boolean; error?: string }> {
  if (!isPackaged()) {
    return { ok: false, error: '开发环境不支持应用内更新' }
  }
  if (!pendingUpdate) {
    return { ok: false, error: '请先检查更新' }
  }
  try {
    await autoUpdater.downloadUpdate()
    updateDownloaded = true
    installScheduled = false
    return { ok: true }
  } catch (error) {
    return { ok: false, error: toMessage(error) }
  }
}

// ---- 两阶段更新的看门狗:等主进程退出后再启动安装器 ----

/** electron-updater 内部字段(runtime 可访问,类型声明里未公开)。 */
interface AutoUpdaterInternals {
  installerPath?: string | null
  installDirectory?: string | null
  downloadedUpdateHelper?: { packageFile?: string | null } | null
}

function getDownloadedInstallerPath(): string | null {
  return (autoUpdater as unknown as AutoUpdaterInternals).installerPath ?? null
}

/** 与 electron-updater NsisUpdater.doInstall 的启动参数保持一致:
 *  --updated   告知 NSIS 这是更新(跳过全新安装流程、卸载旧版)
 *  /S          静默安装(无界面)
 *  --force-run 安装完成后自动重启应用 */
function buildInstallerArgs(): string[] {
  const args = ['--updated', '/S', '--force-run']
  const internals = autoUpdater as unknown as AutoUpdaterInternals
  // installDirectory/packageFile 未设置时无需传:安装器会从注册表读旧安装目录
  if (internals.installDirectory) args.push(`/D=${internals.installDirectory}`)
  const packageFile = internals.downloadedUpdateHelper?.packageFile
  if (packageFile) args.push(`--package-file=${packageFile}`)
  return args
}

/** 构建看门狗 PowerShell 代码(单行,全部使用单引号字符串)。
 *  关键:不写 .ps1 文件、不带 -ExecutionPolicy,而是把代码作为 -Command 内联传入。
 *  实测(本机 3/3 稳定复现):WMI 创建出来的 powershell 一旦带 -ExecutionPolicy
 *  Bypass/Unrestricted,进程会静默失败(ReturnValue 仍为 0 但代码不执行);而 -Command
 *  内联命令不受脚本执行策略限制(命令行输入永远允许执行),在 Restricted 策略的机器上
 *  同样可用,也不会有临时脚本残留。
 *  代码里只出现单引号,避免与 -Command 的双引号解析冲突。 */
function buildWatchdogCommand(installerPath: string): string {
  const psLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`
  const statements = [
    // 进程不存在时 Get-Process 会抛错,静默处理
    `$ErrorActionPreference='SilentlyContinue'`,
    `$TargetPid=${process.pid}`,
    `$InstallerPath=${psLiteral(installerPath)}`,
    `$InstallerArgs=@(${buildInstallerArgs().map(psLiteral).join(',')})`,
    // 等主进程彻底退出(最长 3 分钟兜底),确保安装目录文件句柄已释放
    `$deadline=(Get-Date).AddMinutes(3)`,
    `while((Get-Date) -lt $deadline){`,
    `if(-not (Get-Process -Id $TargetPid)){break}`,
    `Start-Sleep -Milliseconds 300`,
    `}`,
    // 再多等 1 秒,让系统把文件句柄释放干净
    `Start-Sleep -Seconds 1`,
    `Start-Process -FilePath $InstallerPath -ArgumentList $InstallerArgs -WorkingDirectory (Split-Path -Parent $InstallerPath)`
  ]
  return `powershell.exe -NoProfile -NonInteractive -Command "${statements.join('; ')}"`
}

/** 启动独立看门狗:轮询等待本进程 PID 消失(最长 3 分钟)后再静默启动安装器。
 *  启动方式用 WMI(Win32_Process.Create)而不是 child_process.spawn:实测 Electron 的
 *  Job Object 会在应用退出时杀掉所有子进程(detached: true 的子进程甚至根本不会执行),
 *  看门狗作为子进程会随应用一起死掉,永远来不及启动安装器。WMI 创建的新进程挂在
 *  WmiPrvSE 名下,完全脱离应用进程树,应用退出后仍继续运行。
 *  看门狗用 powershell.exe 而不是再起一个 Youpu.exe:NSIS 的 CHECK_APP_RUNNING 按
 *  进程名(IMAGENAME eq Youpu.exe)判断应用是否还在运行,看门狗若也叫 Youpu.exe,
 *  会被当成应用没退出而卡住/报错。 */
function spawnInstallerWatchdog(installerPath: string): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  const watchdogCmd = buildWatchdogCommand(installerPath)
  // 用 PS 单引号字符串包住整条 CommandLine:反斜杠原样保留,内层单引号按 PS 规则
  // 加倍转义。
  const wmi =
    `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments ` +
    `@{ CommandLine = '${watchdogCmd.replace(/'/g, "''")}' } ` +
    `| Select-Object -ExpandProperty ReturnValue`
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', wmi],
      { windowsHide: true, timeout: 15000 },
      (error, stdout) => {
        const returnValue = error ? null : parseInt(stdout.trim(), 10)
        const ok = returnValue === 0
        if (!ok) {
          console.warn(
            '[updater] WMI 启动看门狗失败',
            error ?? `ReturnValue=${stdout.trim()}`,
            ',退回 electron-updater 默认流程'
          )
        }
        resolve(ok)
      }
    )
  })
}

/** 退出并静默安装已下载的更新(isSilent=true:NSIS 走 /S 无界面,装完自动重启应用)。
 *  两阶段更新:看门狗在应用彻底退出后才启动安装器,避免文件占用导致旧版卸载失败。 */
export async function quitAndInstallUpdate(): Promise<{ ok: boolean; error?: string }> {
  if (!isPackaged()) {
    return { ok: false, error: '开发环境不支持应用内更新' }
  }
  if (!isInstalledBuild()) {
    return { ok: false, error: '便携版不支持应用内自动安装，请手动下载新版本替换' }
  }
  if (!updateDownloaded) {
    return { ok: false, error: '更新尚未下载完成，请先点击「下载」' }
  }
  if (installScheduled) {
    // 已安排安装、应用即将退出,重复点击直接忽略
    return { ok: true }
  }
  try {
    // 先停掉子进程(后端 API 服务等)并等待退出,再拉起安装器,避免 NSIS 误报应用还在运行
    if (beforeInstallHook) await beforeInstallHook()
    const installerPath = getDownloadedInstallerPath()
    if (!installerPath || !(await spawnInstallerWatchdog(installerPath))) {
      // 拿不到安装器路径或看门狗启动失败时,退回 electron-updater 默认流程
      autoUpdater.quitAndInstall(true, true)
      installScheduled = true
      return { ok: true }
    }
    installScheduled = true
    // 双保险:applyChannel 已永久关闭 install-on-quit(渲染进程可能在应用退出前的
    // 这几百毫秒内再跑一次检查并调用 applyChannel),这里再设一次,确保退出钩子
    // 不会抢在看门狗前面拉起第二个安装器。
    autoUpdater.autoInstallOnAppQuit = false
    // 硬退出:主窗口的 close 事件被拦截(preventDefault + 弹窗),app.quit() 会卡在
    // 关窗环节,应用迟迟不退,看门狗只能等到 3 分钟兜底、甚至在应用仍运行时拉起安装器。
    // app.exit(0) 直接终止进程,文件句柄随之释放,正是看门狗等待的条件。
    // 延迟 300ms 让本 IPC 响应先送达渲染进程。
    setTimeout(() => app.exit(0), 300)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: toMessage(error) }
  }
}

// ---- 全局事件桥接(electron-updater 是单例，事件统一转发给当前监听器) ----

autoUpdater.on('download-progress', (progress) => {
  const payload: DownloadProgress = {
    receivedBytes: progress.transferred,
    totalBytes: progress.total,
    percent: progress.percent,
    bytesPerSecond: progress.bytesPerSecond
  }
  for (const listener of progressListeners) {
    try {
      listener(payload)
    } catch {
      // ignore
    }
  }
})

autoUpdater.on('update-downloaded', () => {
  updateDownloaded = true
  const version = pendingUpdate?.version ?? null
  emitStatus({
    currentVersion: app.getVersion(),
    channel: pendingUpdate?.channel ?? (autoUpdater.allowPrerelease ? 'beta' : 'latest'),
    available: true,
    version,
    releaseNotes: pendingUpdate?.notes ?? null,
    releaseUrl: releaseUrlFor(version),
    installSupported: isInstalledBuild()
  })
})
