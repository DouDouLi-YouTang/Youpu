// 应用自身更新：启动时按设置的通道自动检查一次。
//   - 有新版本 -> Modal 提示，用户确认后进入设置页下载
// 选择"提示 + 引导到设置页"而不是静默下载：应用更新需要重启，
// 用户应自主选择时机。
//
// 注：内嵌后端不单独更新（2026-10-20 移除了它的在线更新能力），
// 后端随安装包一起更新，因此这里不再有"与后端更新保持一致"的约束。
import { Modal } from 'ant-design-vue'
import { useRouter } from 'vue-router'

import { logger } from '@/services/logger'
import { checkAppUpdate } from '@/platform/electron/app-update'
import { isElectronRuntime } from '@/platform/electron/commands'
import { useSettingsStore } from '@/stores/settings.store'
import { routes } from '@/constants/routes'

let startupCheckStarted = false

export function runStartupAppUpdateCheck(router: ReturnType<typeof useRouter>): void {
  if (startupCheckStarted || !isElectronRuntime()) return
  startupCheckStarted = true

  const channel = useSettingsStore().appUpdateChannel
  if (channel === 'off') return

  void checkAppUpdate(channel)
    .then((result) => {
      if (!result.available) return
      Modal.confirm({
        title: '发现应用新版本',
        content: `当前 ${result.currentVersion}，最新 ${result.version}。可前往 设置 -> 应用更新 下载安装。`,
        okText: '查看更新',
        cancelText: '稍后',
        centered: true,
        onOk: () => {
          void router.push(routes.settings)
        }
      })
    })
    .catch((error: unknown) => {
      logger.warn('启动检查应用更新失败', error)
    })
}
