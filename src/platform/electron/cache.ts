/**
 * Renderer 侧播放缓存平台封装。
 *
 * Vue 页面/store 只通过本模块调用桌面缓存能力，不直接访问
 * `window.muiceDesktop` 或 Electron/Node API。非 Electron 环境返回
 * unavailable 语义，由调用方降级为远程播放。
 */
import type {
  PlaybackCacheInfo,
  PlaybackCacheResolveRequest,
  PlaybackCacheResolveResult,
  PlaybackCacheWarmRequest,
  PlaybackCacheWarmResult
} from '@/domain/playback-cache'
import { isElectronRuntime } from './commands'

export async function getPlaybackCacheInfo(maxBytes: number): Promise<PlaybackCacheInfo> {
  if (!isElectronRuntime() || !window.muiceDesktop?.cache) {
    return {
      available: false,
      directory: null,
      location: 'unavailable',
      maxBytes,
      usedBytes: 0,
      entryCount: 0,
      lastError: '当前环境不支持本地播放缓存'
    }
  }
  return window.muiceDesktop.cache.getInfo(maxBytes)
}

export async function resolvePlaybackCache(
  request: PlaybackCacheResolveRequest
): Promise<PlaybackCacheResolveResult> {
  if (!isElectronRuntime() || !window.muiceDesktop?.cache) {
    return { hit: false, reason: 'unavailable' }
  }
  return window.muiceDesktop.cache.resolve(request)
}

export function warmPlaybackCache(
  request: PlaybackCacheWarmRequest
): Promise<PlaybackCacheWarmResult> {
  if (!isElectronRuntime() || !window.muiceDesktop?.cache) {
    return Promise.resolve({ cached: false, reason: 'unavailable' })
  }
  return window.muiceDesktop.cache.warm(request)
}

export async function enforcePlaybackCacheLimit(maxBytes: number): Promise<PlaybackCacheInfo> {
  if (!isElectronRuntime() || !window.muiceDesktop?.cache) {
    return {
      available: false,
      directory: null,
      location: 'unavailable',
      maxBytes,
      usedBytes: 0,
      entryCount: 0,
      lastError: '当前环境不支持本地播放缓存'
    }
  }
  return window.muiceDesktop.cache.enforceLimit(maxBytes)
}

export async function clearPlaybackCache(maxBytes: number): Promise<PlaybackCacheInfo> {
  if (!isElectronRuntime() || !window.muiceDesktop?.cache) {
    return {
      available: false,
      directory: null,
      location: 'unavailable',
      maxBytes,
      usedBytes: 0,
      entryCount: 0,
      lastError: '当前环境不支持本地播放缓存'
    }
  }
  return window.muiceDesktop.cache.clear(maxBytes)
}

export async function removePlaybackCacheEntry(
  key: string,
  maxBytes: number
): Promise<PlaybackCacheInfo> {
  if (!isElectronRuntime() || !window.muiceDesktop?.cache) {
    return {
      available: false,
      directory: null,
      location: 'unavailable',
      maxBytes,
      usedBytes: 0,
      entryCount: 0,
      lastError: '当前环境不支持本地播放缓存'
    }
  }
  return window.muiceDesktop.cache.removeEntry(key, maxBytes)
}
