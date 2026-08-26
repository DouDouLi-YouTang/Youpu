import { Modal, message } from 'ant-design-vue'

import { logger } from '@/services/logger'
import type { ApiError } from '@/services/api/errors'
import {
  checkApiServerUpdate,
  getApiServerHealth,
  restartApiServer,
  updateApiServer,
  type ApiServerRestartResult,
  type ApiServerUpdateResult
} from '@/platform/electron/api-server'
import { isElectronRuntime } from '@/platform/electron/commands'
import { useSettingsStore } from '@/stores/settings.store'

const RECOVERABLE_BACKEND_ERROR_CODES: ReadonlySet<ApiError['code']> = new Set([
  'NETWORK_ERROR',
  'TIMEOUT',
  'SERVER_ERROR'
])
const AUTO_RESTART_COOLDOWN_MS = 30_000

let startupUpdateCheckStarted = false
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

/**
 * 后台执行后端更新:先提示"后台运行"不阻塞调用方,完成后 message 通知结果。
 * 返回更新结果(失败返回 null),供调用方刷新版本/状态。
 */
export function performBackendUpdateBackground(): Promise<ApiServerUpdateResult | null> {
  message.info('后端更新在后台运行，完成后会通知你')
  return updateApiServer()
    .then((result) => {
      message.success(`后端已更新 ${result.oldVersion} → ${result.newVersion}`)
      if (!result.restarted) {
        message.warning('开发模式需手动重启应用后生效')
      }
      return result
    })
    .catch((error: unknown) => {
      logger.error('后端更新失败', error)
      message.error('更新失败，请稍后重试')
      return null
    })
}

export function runStartupBackendUpdateCheck(): void {
  if (startupUpdateCheckStarted || !isElectronRuntime()) return
  startupUpdateCheckStarted = true

  const mode = useSettingsStore().backendUpdateMode
  if (mode === 'off') return

  void checkApiServerUpdate()
    .then((result) => {
      if (!result.hasUpdate) return
      if (mode === 'auto') {
        // 自动更新:无需确认,直接后台更新
        void performBackendUpdateBackground()
        return
      }
      // notify:有新版本时提示,由用户决定是否更新
      Modal.confirm({
        title: '发现后端新版本',
        content: `当前 ${result.current}，最新 ${result.latest}，是否立即更新？`,
        okText: '立即更新',
        cancelText: '稍后',
        centered: true,
        onOk: () => {
          // 不返回 Promise:Modal 立即关闭,更新转入后台,完成后 message 提示
          void performBackendUpdateBackground()
        }
      })
    })
    .catch((error: unknown) => {
      logger.warn('启动检查后端更新失败', error)
    })
}
