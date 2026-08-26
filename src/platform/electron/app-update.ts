// 应用自动更新平台层：包装 window.muiceDesktop.appUpdate，浏览器环境安全降级。
import { isElectronRuntime } from './commands'

export type AppUpdateChannel = 'latest' | 'beta'

export interface AppUpdateStatus {
  currentVersion: string
  channel: AppUpdateChannel
  available: boolean
  version: string | null
  releaseNotes: string | null
  releaseUrl: string | null
  /** 安装版支持"重启并安装"；便携版(zip)不支持。 */
  installSupported: boolean
  error?: string
}

export interface AppUpdateProgress {
  receivedBytes: number
  totalBytes: number
  percent: number
  bytesPerSecond: number
}

export interface AppUpdateActionResult {
  ok: boolean
  error?: string
}

const NOT_AVAILABLE: AppUpdateStatus = {
  currentVersion: '0.0.0',
  channel: 'latest',
  available: false,
  version: null,
  releaseNotes: null,
  releaseUrl: null,
  installSupported: false,
  error: '当前环境不支持应用内更新'
}

export async function checkAppUpdate(channel: AppUpdateChannel): Promise<AppUpdateStatus> {
  const api = window.muiceDesktop
  if (!api) return NOT_AVAILABLE
  try {
    return await api.appUpdate.check(channel)
  } catch (error) {
    return { ...NOT_AVAILABLE, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function downloadAppUpdate(): Promise<AppUpdateActionResult> {
  const api = window.muiceDesktop
  if (!api) return { ok: false, error: '当前环境不支持应用内更新' }
  return api.appUpdate.download()
}

export async function installAppUpdate(): Promise<AppUpdateActionResult> {
  const api = window.muiceDesktop
  if (!api) return { ok: false, error: '当前环境不支持应用内更新' }
  return api.appUpdate.install()
}

export function onAppUpdateProgress(callback: (progress: AppUpdateProgress) => void): () => void {
  const api = window.muiceDesktop
  if (!api) return () => undefined
  return api.appUpdate.onProgress(callback)
}

export function isAppUpdateSupported(): boolean {
  return isElectronRuntime()
}
