/**
 * Renderer 侧低内存模式平台封装。
 *
 * 页面/store 只通过本模块访问桌面低内存能力,不直接读 `window.muiceDesktop`;
 * 非 Electron 环境返回"关闭"语义,避免浏览器里调试时抛错。
 */
import { isElectronRuntime } from './commands'

export type { LowMemoryMode, LowMemoryStatus } from '@/domain/low-memory'

/** 非 Electron 环境的兜底状态:模式关闭且从未回收。 */
const UNAVAILABLE_STATUS: LowMemoryStatus = {
  mode: 'off',
  released: false,
  releasedAt: null,
  releaseCount: 0,
  backgroundPlaying: false
}

export async function getLowMemoryStatus(): Promise<LowMemoryStatus> {
  if (!isElectronRuntime() || !window.muiceDesktop?.lowMemory) return UNAVAILABLE_STATUS
  return window.muiceDesktop.lowMemory.getStatus()
}

export async function setLowMemoryMode(mode: LowMemoryMode): Promise<LowMemoryStatus> {
  if (!isElectronRuntime() || !window.muiceDesktop?.lowMemory) {
    return { ...UNAVAILABLE_STATUS, mode }
  }
  return window.muiceDesktop.lowMemory.setMode(mode)
}
