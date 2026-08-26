import { isElectronRuntime } from './commands'

/**
 * 字体相关 IPC 封装(对齐参考 font-settings.js 的 os.querySystemFonts 与 betterncm.app.exec)。
 *
 * - querySystemFonts:主进程用 PowerShell(Windows)+ System.Drawing 列出已装字体族名;
 *   非 Windows 或非 Electron 返回空数组,字体预设仍可手动输入。
 * - downloadFont:打开外链由用户在浏览器下载安装(参考用 betterncm.app.exec 打开 url)。
 */
export async function querySystemFonts(): Promise<string[]> {
  if (!isElectronRuntime()) return []
  return window.muiceDesktop!.font.querySystemFonts()
}

export async function downloadFont(url: string): Promise<void> {
  if (!isElectronRuntime()) return
  await window.muiceDesktop!.font.downloadFont(url)
}
