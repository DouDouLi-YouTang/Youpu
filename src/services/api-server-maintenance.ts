import { message } from 'ant-design-vue'

import { logger } from '@/services/logger'
import type { ApiError } from '@/services/api/errors'
import {
  getApiServerHealth,
  restartApiServer,
  type ApiServerRestartResult
} from '@/platform/electron/api-server'
import { isElectronRuntime } from '@/platform/electron/commands'

/**
 * 内嵌后端（api-enhanced）的运行维护。
 *
 * ⚠️ **后端不提供在线更新**（2026-10-20 移除）：它靠替换 `resources/server` 源码实现，
 * 却保留旧的 `node_modules` —— 上游一旦新增依赖（如 `fzstd` / `jsdom`），后端就会在
 * 启动时 `require` 失败，重启也无效，还会把唯一的 `node_modules.zip` 一并删掉。
 * 现在后端只随应用安装包更新（源码与依赖同一次构建），这里只保留「状态探测 + 重启」。
 */
const RECOVERABLE_BACKEND_ERROR_CODES: ReadonlySet<ApiError['code']> = new Set([
  'NETWORK_ERROR',
  'TIMEOUT',
  'SERVER_ERROR'
])
const AUTO_RESTART_COOLDOWN_MS = 30_000

let autoRestartPromise: Promise<ApiServerRestartResult | null> | null = null
let lastAutoRestartAt = 0

export function mayBeBackendUnavailable(error: ApiError): boolean {
  return RECOVERABLE_BACKEND_ERROR_CODES.has(error.code)
}

export async function recoverBackendForPlayback(
  error: ApiError
): Promise<ApiServerRestartResult | null> {
  if (!isElectronRuntime() || !mayBeBackendUnavailable(error)) return null

  const health = await getApiServerHealth().catch((healthError: unknown) => {
    logger.warn('后端健康检查失败', healthError)
    return null
  })
  if (!health || health.ok) return null

  const now = Date.now()
  if (autoRestartPromise) return autoRestartPromise
  if (now - lastAutoRestartAt < AUTO_RESTART_COOLDOWN_MS) return null

  message.warning('后端服务异常，正在重启…')
  autoRestartPromise = restartApiServer()
    .then((result) => {
      lastAutoRestartAt = Date.now()
      if (result.ok && result.restarted) {
        message.success(result.message || '后端已重启')
      } else if (result.needsManualAction) {
        message.warning(result.message)
      } else {
        message.error(result.message || '后端重启失败')
      }
      return result
    })
    .catch((restartError: unknown) => {
      lastAutoRestartAt = Date.now()
      logger.error('后端自动重启失败', restartError)
      message.error('后端重启失败，请稍后手动重试')
      return null
    })
    .finally(() => {
      autoRestartPromise = null
    })

  return autoRestartPromise
}
