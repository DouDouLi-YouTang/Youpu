import { querySystemFonts } from '@/platform/electron/font'

/**
 * 系统字体查询走主进程 PowerShell，耗时较长；缓存 promise 保证整个会话只查一次。
 * （面板每次打开都会重建 FontTab，若无缓存则每次开面板都要重新 spawn PowerShell。）
 */
let systemFontsPromise: Promise<string[]> | null = null

export function loadSystemFonts(): Promise<string[]> {
  systemFontsPromise ??= querySystemFonts()
  return systemFontsPromise
}
