/**
 * 播放缓存领域模型。
 *
 * 主进程是缓存文件与索引的唯一所有者；renderer 只通过 IPC 读取/写入
 * 这些可序列化结构。详见 backend quality-guidelines 的播放缓存场景。
 */

export type PlaybackCacheLocation = 'software' | 'userData' | 'unavailable'

export interface PlaybackCacheInfo {
  available: boolean
  directory: string | null
  location: PlaybackCacheLocation
  maxBytes: number
  usedBytes: number
  entryCount: number
  lastError?: string
}

export interface PlaybackCacheResolveRequest {
  songId: number
  level: string
  maxBytes: number
}

export type PlaybackCacheResolveReason =
  | 'missing-index'
  | 'missing-file'
  | 'empty-file'
  | 'unavailable'

export interface PlaybackCacheResolveResult {
  hit: boolean
  sourceUrl?: string
  key?: string
  reason?: PlaybackCacheResolveReason
}

export interface PlaybackCacheWarmRequest {
  songId: number
  level: string
  remoteUrl: string
  bitrate?: number
  durationMs?: number
  sourceExpiresAt?: number
  maxBytes: number
}

export type PlaybackCacheWarmReason =
  | 'disabled'
  | 'unavailable'
  | 'fetch-failed'
  | 'too-large'
  | 'empty-file'
  | 'write-failed'

export interface PlaybackCacheWarmResult {
  cached: boolean
  key?: string
  sizeBytes?: number
  reason?: PlaybackCacheWarmReason
}

export interface PlaybackCacheEntry {
  key: string
  songId: number
  level: string
  bitrate?: number
  fileName: string
  relativePath: string
  sizeBytes: number
  cachedAt: number
  lastAccessedAt: number
  durationMs?: number
  sourceExpiresAt?: number
}

/** 构造播放缓存键:`song:{songId}:level:{level}`。 */
export function buildPlaybackCacheKey(songId: number, level: string): string {
  return `song:${songId}:level:${level}`
}
