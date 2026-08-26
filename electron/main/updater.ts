// 应用自动更新(electron-updater + GitHub Releases)。
// 通道约定：
//   正式版 0.2.0       -> latest.yml，客户端 allowPrerelease=false 只认正式 Release
//   Beta  0.2.0-beta.1 -> beta.yml，客户端 allowPrerelease=true 认最新(含预发布)Release
// 开发环境(非 packaged)autoUpdater 不工作，所有方法安全返回不可用。
import { app } from 'electron'
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
  // GitHub provider：allowPrerelease 决定是否接受 pre-release Release；
  // 更新元数据文件名由 provider 按 tag 的 prerelease 段自动推导(latest.yml/beta.yml)。
  autoUpdater.allowPrerelease = channel === 'beta'
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
}

export function initAutoUpdater(): void {
  if (!isPackaged()) return
  applyChannel('latest')
  autoUpdater.logger = console
}

export async function checkForAppUpdate(channel: UpdateChannel): Promise<UpdateStatus> {
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
    return { ok: true }
  } catch (error) {
    return { ok: false, error: toMessage(error) }
  }
}

/** 退出并安装已下载的更新。isSilent=false 时由 NSIS 安装器自行展示界面。 */
export function quitAndInstallUpdate(): { ok: boolean; error?: string } {
  if (!isPackaged()) {
    return { ok: false, error: '开发环境不支持应用内更新' }
  }
  if (!isInstalledBuild()) {
    return { ok: false, error: '便携版不支持应用内自动安装，请手动下载新版本替换' }
  }
  try {
    autoUpdater.quitAndInstall(false, true)
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
