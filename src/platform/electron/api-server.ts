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

// ⚠️ 后端不提供在线更新（2026-10-20 移除）：它只替换源码、保留旧 node_modules，
// 上游新增依赖后后端会起不来且无法自愈。后端现在只随应用安装包更新，
// 这里只剩版本读取 / 健康检查 / 重启。
export async function getApiServerVersion(): Promise<string | null> {
  return invokeCommand<string | null>('api-server:get-version')
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
