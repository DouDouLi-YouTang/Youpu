import { invokeCommand } from './commands'

export async function minimizeWindow(): Promise<void> {
  await invokeCommand<void>('window:minimize')
}

export async function toggleMaximizeWindow(): Promise<boolean> {
  return invokeCommand<boolean>('window:toggle-maximize')
}

export async function closeWindow(): Promise<void> {
  // 触发 BrowserWindow 的 close 事件:主进程 on('close') 拦截后发 close-requested,
  // 由 App.vue 弹"退出 / 最小化到托盘"确认框。不能走 invoke('window:close'):
  // 那个 handler 是 mainWindow.destroy(),直接销毁窗口绕过确认流程。
  window.close()
}

export async function isWindowMaximized(): Promise<boolean> {
  return invokeCommand<boolean>('window:is-maximized')
}

export async function toggleMiniWindow(): Promise<boolean> {
  return invokeCommand<boolean>('window:toggle-mini')
}

export async function toggleAlwaysOnTop(): Promise<boolean> {
  return invokeCommand<boolean>('window:toggle-always-on-top')
}

/**
 * Subscribe to maximize-state changes pushed from the main process. The
 * returned function unsubscribes; pair it with `onUnmounted` to avoid leaking
 * listeners on HMR. Returns a no-op unsubscribe when not running under
 * Electron (e.g. the renderer dev server in a regular browser).
 */
export function onMaximizeChange(callback: (isMaximized: boolean) => void): () => void {
  const api = window.muiceDesktop
  if (!api) return () => undefined
  return api.window.onMaximizeChange(callback)
}
