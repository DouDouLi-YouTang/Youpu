import { contextBridge, ipcRenderer } from 'electron'

/**
 * 后台播放器窗口的 preload:只暴露一个极小的 bgBridge,
 * 页面(见 electron/main/bg-player.ts 的内联 HTML)用它收命令、报事件。
 * 与主 preload(index.ts)完全隔离,不暴露任何桌面 API。
 */

contextBridge.exposeInMainWorld('bgBridge', {
  onCommand(callback: (command: unknown) => void): void {
    ipcRenderer.on('bg-player:command', (_event, command) => callback(command))
  },
  emit(event: unknown): void {
    ipcRenderer.send('bg-player:event', event)
  }
})
