import { invokeCommand } from './commands'

export type ApiServerMode = 'development' | 'packaged'

export interface ApiServerHealthResult {
  ok: boolean
  port: number
  host: string
  checkedAt: number
  latencyMs: number
  trackedProcess: boolean
  mode: ApiServerMode
  message: string
}

export interface ApiServerRestartResult {
  ok: boolean
  restarted: boolean
  needsManualAction: boolean
  health: ApiServerHealthResult
  message: string
}

export async function startApiServer(): Promise<string> {
  return invokeCommand<string>('api-server:start')
}

export async function stopApiServer(): Promise<string> {
  return invokeCommand<string>('api-server:stop')
}

export async function getApiServerVersion(): Promise<string | null> {
  return invokeCommand<string | null>('api-server:get-version')
}

export interface ApiServerCheckResult {
  current: string
  latest: string
  hasUpdate: boolean
}

export async function checkApiServerUpdate(): Promise<ApiServerCheckResult> {
  return invokeCommand<ApiServerCheckResult>('api-server:check-update')
}

export interface ApiServerUpdateResult {
  oldVersion: string
  newVersion: string
  restarted: boolean
}

export async function updateApiServer(): Promise<ApiServerUpdateResult> {
  return invokeCommand<ApiServerUpdateResult>('api-server:update')
}

export async function getApiServerHealth(): Promise<ApiServerHealthResult> {
  return invokeCommand<ApiServerHealthResult>('api-server:health')
}

export async function isApiServerRunning(): Promise<boolean> {
  return invokeCommand<boolean>('api-server:is-running')
}

export async function restartApiServer(): Promise<ApiServerRestartResult> {
  return invokeCommand<ApiServerRestartResult>('api-server:restart')
}
