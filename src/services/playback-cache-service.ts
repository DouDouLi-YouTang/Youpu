/**
 * 播放缓存 renderer 服务。
 *
 * 在 `player.store` 解析出可播放远程资源后调用:
 *  - `resolveCachedSource` 尝试命中本地缓存,命中则返回本地 file URL。
 *  - `warmFromRemoteUrl` 后台写入缓存,不阻塞播放。
 *
 * 缓存不可用或任何失败都静默降级为远程播放,不触发播放器错误态。
 */
import type { PlayableLevel, PlayableTrack } from '@/domain/player'
import type { Song } from '@/domain/song'
import { logger } from '@/services/logger'
import { resolvePlaybackCache, warmPlaybackCache } from '@/platform/electron/cache'
import { useSettingsStore } from '@/stores/settings.store'

const DEFAULT_PLAYBACK_CACHE_MAX_BYTES = 1073741824 // 1GB

/** 读取用户设置的缓存上限,缺省/异常时回退默认 1GB。 */
export function getPlaybackCacheMaxBytes(): number {
  const max = useSettingsStore().playbackCacheMaxBytes
  if (!max || !Number.isFinite(max) || max <= 0) return DEFAULT_PLAYBACK_CACHE_MAX_BYTES
  return max
}

export interface CachedSourceResolution {
  hit: boolean
  /** 本地 file URL,仅 hit=true 时有值。 */
  sourceUrl?: string
  /** 缓存键,用于失败回退时删除条目。 */
  cacheKey?: string
}

/**
 * 尝试为已解析的远程播放资源命中本地缓存。
 *
 * 设计约束:缓存命中不绕过 `resolvePlayableTrack()` 的可播放性校验 ——
 * 调用方必须先确认歌曲可播放,再调用本方法。
 */
export async function resolveCachedSource(
  song: Song,
  level: PlayableLevel
): Promise<CachedSourceResolution> {
  // 用户关闭缓存时直接走远程播放,不读本地缓存
  if (!useSettingsStore().playbackCacheEnabled) {
    return { hit: false }
  }
  try {
    const result = await resolvePlaybackCache({
      songId: song.id,
      level,
      maxBytes: getPlaybackCacheMaxBytes()
    })
    if (result.hit && result.sourceUrl) {
      return { hit: true, sourceUrl: result.sourceUrl, cacheKey: result.key }
    }
    return { hit: false }
  } catch (error) {
    logger.warn('播放缓存命中检查失败,回退远程播放', error)
    return { hit: false }
  }
}

/**
 * 后台预热缓存:远程 URL 被用于播放后调用,不抛错、不阻塞播放。
 */
export function warmFromRemoteUrl(track: PlayableTrack, level: PlayableLevel): void {
  // 用户关闭缓存时不写入
  if (!useSettingsStore().playbackCacheEnabled) return
  void warmPlaybackCache({
    songId: track.song.id,
    level,
    remoteUrl: track.url,
    bitrate: track.bitrate,
    durationMs: track.song.durationMs || undefined,
    sourceExpiresAt: track.expiresAt,
    maxBytes: getPlaybackCacheMaxBytes()
  }).catch((error) => {
    logger.warn('播放缓存写入失败', error)
  })
}
