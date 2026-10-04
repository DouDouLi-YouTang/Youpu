import { contextBridge, ipcRenderer } from 'electron'

const allowedChannels = [
  'window:minimize',
  'window:toggle-maximize',
  'window:close',
  'window:is-maximized',
  'window:toggle-mini',
  'window:toggle-always-on-top',
  'api-server:start',
  'api-server:stop',
  'api-server:get-version',
  'api-server:check-update',
  'api-server:update',
  'api-server:health',
  'api-server:is-running',
  'api-server:restart',
  'font:query-system-fonts',
  'font:download',
  'download:get-default-directory',
  'download:select-directory',
  'download:validate-directory',
  'download:song',
  'download:open-file',
  'download:open-directory',
  'download:show-in-folder',
  'download:delete-file',
  'download:file-exists',
  'download:get-file-url',
  'playback-cache:get-info',
  'playback-cache:resolve',
  'playback-cache:warm',
  'playback-cache:enforce-limit',
  'playback-cache:clear',
  'playback-cache:remove-entry',
  'theme:set-source',
  'low-memory:get-status',
  'low-memory:set-mode',
  'app-update:check',
  'app-update:download',
  'app-update:install'
] as const

type DesktopChannel = (typeof allowedChannels)[number]

type ApiServerMode = 'development' | 'packaged'

interface DownloadProgressEvent {
  jobId: string
  receivedBytes: number
  totalBytes?: number
  progress?: number
}

interface DownloadSongPayload {
  jobId: string
  url: string
  filename: string
  directory: string
}

interface DownloadSongResult {
  success: true
  filePath: string
  filename: string
  bytes: number
}

interface FileOperationResult {
  ok: boolean
  message?: string
}

interface DeleteDownloadFileResult {
  deleted: boolean
  missing?: boolean
  message?: string
}

interface DownloadFileExistsResult {
  exists: boolean
  sizeBytes?: number
}

interface DownloadFileUrlResult {
  url: string
}

interface PlaybackCacheInfo {
  available: boolean
  directory: string | null
  location: 'userData' | 'unavailable'
  maxBytes: number
  usedBytes: number
  entryCount: number
  lastError?: string
}

interface PlaybackCacheResolveRequest {
  songId: number
  level: string
  maxBytes: number
}

interface PlaybackCacheResolveResult {
  hit: boolean
  sourceUrl?: string
  key?: string
  reason?: 'missing-index' | 'missing-file' | 'empty-file' | 'unavailable'
}

interface PlaybackCacheWarmRequest {
  songId: number
  level: string
  remoteUrl: string
  bitrate?: number
  durationMs?: number
  sourceExpiresAt?: number
  maxBytes: number
}

interface PlaybackCacheWarmResult {
  cached: boolean
  key?: string
  sizeBytes?: number
  reason?: 'disabled' | 'unavailable' | 'fetch-failed' | 'too-large' | 'empty-file' | 'write-failed'
}

interface ApiServerHealthResult {
  ok: boolean
  port: number
  host: string
  checkedAt: number
  latencyMs: number
  trackedProcess: boolean
  mode: ApiServerMode
  message: string
}

interface ApiServerRestartResult {
  ok: boolean
  restarted: boolean
  needsManualAction: boolean
  health: ApiServerHealthResult
  message: string
}

type AppUpdateChannel = 'latest' | 'beta'

interface AppUpdateStatus {
  currentVersion: string
  channel: AppUpdateChannel
  available: boolean
  version: string | null
  releaseNotes: string | null
  releaseUrl: string | null
  installSupported: boolean
  error?: string
}

interface AppUpdateProgress {
  receivedBytes: number
  totalBytes: number
  percent: number
  bytesPerSecond: number
}

interface AppUpdateActionResult {
  ok: boolean
  error?: string
}

/** 低内存模式:与主进程 memory-mode.ts、src/domain/low-memory.ts 及 src/types/global.d.ts 保持同步。 */
type LowMemoryMode = 'off' | 'on'

interface RestoreQueueState {
  items: unknown[]
  currentIndex: number
  mode: string
  shuffleOrder: number[]
}

interface LowMemoryRestorePayload {
  playing: boolean
  positionMs: number
  url: string | null
  queue: RestoreQueueState | null
  currentItem: unknown | null
  fmMode: boolean
  sourcePlaylistId: number | null
  volume: number
  muted: boolean
  playbackRate: number
}

interface LowMemoryStatus {
  mode: LowMemoryMode
  released: boolean
  releasedAt: number | null
  releaseCount: number
  backgroundPlaying: boolean
}

/** SMTC 媒体通知元数据(渲染层推送/引擎降级时自行构造)。 */
interface AudioMeta {
  title: string
  artist: string
  album: string
  artworkUrl: string | null
}

/** 引擎推送的播放事件(与 electron/main/bg-player.ts 的 BgPlayerEvent 对应)。 */
type AudioEngineEvent =
  | {
      type: 'state'
      state: 'ready' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error'
      positionMs: number
      durationMs: number
    }
  | { type: 'position'; positionMs: number }

function assertAllowedChannel(channel: string): asserts channel is DesktopChannel {
  if (!allowedChannels.includes(channel as DesktopChannel)) {
    throw new Error(`Unsupported desktop channel: ${channel}`)
  }
}

const desktopApi = {
  invoke<T>(channel: DesktopChannel): Promise<T> {
    assertAllowedChannel(channel)
    return ipcRenderer.invoke(channel) as Promise<T>
  },
  window: {
    minimize(): Promise<void> {
      return ipcRenderer.invoke('window:minimize') as Promise<void>
    },
    toggleMaximize(): Promise<boolean> {
      return ipcRenderer.invoke('window:toggle-maximize') as Promise<boolean>
    },
    close(): Promise<void> {
      return ipcRenderer.invoke('window:close') as Promise<void>
    },
    isMaximized(): Promise<boolean> {
      return ipcRenderer.invoke('window:is-maximized') as Promise<boolean>
    },
    toggleMini(): Promise<boolean> {
      return ipcRenderer.invoke('window:toggle-mini') as Promise<boolean>
    },
    toggleAlwaysOnTop(): Promise<boolean> {
      return ipcRenderer.invoke('window:toggle-always-on-top') as Promise<boolean>
    },
    /**
     * Subscribe to maximize-state changes pushed from the main process. The
     * returned function unsubscribes — pin it to `onUnmounted` in callers.
     */
    onMaximizeChange(callback: (isMaximized: boolean) => void): () => void {
      const listener = (_event: unknown, value: boolean): void => callback(value)
      ipcRenderer.on('window:maximize-change', listener)
      return () => ipcRenderer.removeListener('window:maximize-change', listener)
    },
    onMiniChange(callback: (isMini: boolean) => void): () => void {
      const listener = (_event: unknown, value: boolean): void => callback(value)
      ipcRenderer.on('window:mini-change', listener)
      return () => ipcRenderer.removeListener('window:mini-change', listener)
    },
    onCloseRequested(callback: () => void): () => void {
      const listener = (): void => callback()
      ipcRenderer.on('window:close-requested', listener)
      return () => ipcRenderer.removeListener('window:close-requested', listener)
    },
    sendCloseAction(action: 'quit' | 'tray'): void {
      ipcRenderer.send('window:close-action', action)
    }
  },
  player: {
    pushState(state: string): void {
      ipcRenderer.send('player:state-push', state)
    },
    onTrayCommand(callback: (cmd: string) => void): () => void {
      const listener = (_event: unknown, cmd: string): void => callback(cmd)
      ipcRenderer.on('tray:command', listener)
      return () => ipcRenderer.removeListener('tray:command', listener)
    }
  },
  apiServer: {
    start(): Promise<string> {
      return ipcRenderer.invoke('api-server:start') as Promise<string>
    },
    stop(): Promise<string> {
      return ipcRenderer.invoke('api-server:stop') as Promise<string>
    },
    getVersion(): Promise<string | null> {
      return ipcRenderer.invoke('api-server:get-version') as Promise<string | null>
    },
    checkUpdate(): Promise<{ current: string; latest: string; hasUpdate: boolean }> {
      return ipcRenderer.invoke('api-server:check-update') as Promise<{
        current: string
        latest: string
        hasUpdate: boolean
      }>
    },
    update(): Promise<{ oldVersion: string; newVersion: string; restarted: boolean }> {
      return ipcRenderer.invoke('api-server:update') as Promise<{
        oldVersion: string
        newVersion: string
        restarted: boolean
      }>
    },
    health(): Promise<ApiServerHealthResult> {
      return ipcRenderer.invoke('api-server:health') as Promise<ApiServerHealthResult>
    },
    isRunning(): Promise<boolean> {
      return ipcRenderer.invoke('api-server:is-running') as Promise<boolean>
    },
    restart(): Promise<ApiServerRestartResult> {
      return ipcRenderer.invoke('api-server:restart') as Promise<ApiServerRestartResult>
    }
  },
  font: {
    querySystemFonts(): Promise<string[]> {
      return ipcRenderer.invoke('font:query-system-fonts') as Promise<string[]>
    },
    downloadFont(url: string): Promise<void> {
      return ipcRenderer.invoke('font:download', url) as Promise<void>
    }
  },
  download: {
    getDefaultDirectory(): Promise<{ path: string }> {
      return ipcRenderer.invoke('download:get-default-directory') as Promise<{ path: string }>
    },
    selectDirectory(currentPath?: string): Promise<{ canceled: boolean; path?: string }> {
      return ipcRenderer.invoke('download:select-directory', { currentPath }) as Promise<{
        canceled: boolean
        path?: string
      }>
    },
    validateDirectory(directory: string): Promise<{ ok: boolean; message?: string }> {
      return ipcRenderer.invoke('download:validate-directory', { directory }) as Promise<{
        ok: boolean
        message?: string
      }>
    },
    song(payload: DownloadSongPayload): Promise<DownloadSongResult> {
      return ipcRenderer.invoke('download:song', payload) as Promise<DownloadSongResult>
    },
    onProgress(callback: (event: DownloadProgressEvent) => void): () => void {
      const listener = (_event: unknown, value: DownloadProgressEvent): void => callback(value)
      ipcRenderer.on('download:progress', listener)
      return () => ipcRenderer.removeListener('download:progress', listener)
    },
    openFile(filePath: string): Promise<FileOperationResult> {
      return ipcRenderer.invoke('download:open-file', { filePath }) as Promise<FileOperationResult>
    },
    openDirectory(directory: string): Promise<FileOperationResult> {
      return ipcRenderer.invoke('download:open-directory', {
        directory
      }) as Promise<FileOperationResult>
    },
    showInFolder(filePath: string): Promise<FileOperationResult> {
      return ipcRenderer.invoke('download:show-in-folder', {
        filePath
      }) as Promise<FileOperationResult>
    },
    deleteFile(filePath: string, directory: string): Promise<DeleteDownloadFileResult> {
      return ipcRenderer.invoke('download:delete-file', {
        filePath,
        directory
      }) as Promise<DeleteDownloadFileResult>
    },
    fileExists(filePath: string): Promise<DownloadFileExistsResult> {
      return ipcRenderer.invoke('download:file-exists', {
        filePath
      }) as Promise<DownloadFileExistsResult>
    },
    getFileUrl(filePath: string): Promise<DownloadFileUrlResult> {
      return ipcRenderer.invoke('download:get-file-url', {
        filePath
      }) as Promise<DownloadFileUrlResult>
    }
  },
  cache: {
    getInfo(maxBytes: number): Promise<PlaybackCacheInfo> {
      return ipcRenderer.invoke('playback-cache:get-info', maxBytes) as Promise<PlaybackCacheInfo>
    },
    resolve(request: PlaybackCacheResolveRequest): Promise<PlaybackCacheResolveResult> {
      return ipcRenderer.invoke(
        'playback-cache:resolve',
        request
      ) as Promise<PlaybackCacheResolveResult>
    },
    warm(request: PlaybackCacheWarmRequest): Promise<PlaybackCacheWarmResult> {
      return ipcRenderer.invoke('playback-cache:warm', request) as Promise<PlaybackCacheWarmResult>
    },
    enforceLimit(maxBytes: number): Promise<PlaybackCacheInfo> {
      return ipcRenderer.invoke(
        'playback-cache:enforce-limit',
        maxBytes
      ) as Promise<PlaybackCacheInfo>
    },
    clear(maxBytes: number): Promise<PlaybackCacheInfo> {
      return ipcRenderer.invoke('playback-cache:clear', maxBytes) as Promise<PlaybackCacheInfo>
    },
    removeEntry(key: string, maxBytes: number): Promise<PlaybackCacheInfo> {
      return ipcRenderer.invoke('playback-cache:remove-entry', {
        key,
        maxBytes
      }) as Promise<PlaybackCacheInfo>
    }
  },
  theme: {
    setSource(mode: 'light' | 'dark' | 'system'): Promise<void> {
      return ipcRenderer.invoke('theme:set-source', mode) as Promise<void>
    }
  },
  lowMemory: {
    getStatus(): Promise<LowMemoryStatus> {
      return ipcRenderer.invoke('low-memory:get-status') as Promise<LowMemoryStatus>
    },
    setMode(mode: LowMemoryMode): Promise<LowMemoryStatus> {
      return ipcRenderer.invoke('low-memory:set-mode', mode) as Promise<LowMemoryStatus>
    }
  },
  /**
   * 音频引擎控制:音频永远在主进程的引擎窗口播放,渲染层只发命令、收状态。
   * load 携带队列项与 SMTC 元数据,渲染层不在时主进程也能知道当前曲目。
   */
  audio: {
    load(payload: {
      url: string
      resumeAtMs?: number
      autoplay: boolean
      volume: number
      muted: boolean
      rate: number
      sinkId?: string
      item?: unknown
      meta?: AudioMeta
    }): Promise<boolean> {
      return ipcRenderer.invoke('audio:load', payload) as Promise<boolean>
    },
    play(): Promise<void> {
      return ipcRenderer.invoke('audio:play') as Promise<void>
    },
    pause(): Promise<void> {
      return ipcRenderer.invoke('audio:pause') as Promise<void>
    },
    stop(): Promise<void> {
      return ipcRenderer.invoke('audio:stop') as Promise<void>
    },
    seek(ms: number): Promise<void> {
      return ipcRenderer.invoke('audio:seek', ms) as Promise<void>
    },
    setVolume(value: number, muted: boolean): Promise<void> {
      return ipcRenderer.invoke('audio:volume', { value, muted }) as Promise<void>
    },
    setRate(value: number): Promise<void> {
      return ipcRenderer.invoke('audio:rate', value) as Promise<void>
    },
    setSink(id: string): Promise<void> {
      return ipcRenderer.invoke('audio:sink', id) as Promise<void>
    },
    setMeta(meta: AudioMeta): Promise<void> {
      return ipcRenderer.invoke('audio:set-meta', meta) as Promise<void>
    },
    /** 渲染层启动完成:接管控制权(主进程清除降级会话),返回引擎当前状态。 */
    attach(): Promise<LowMemoryRestorePayload | null> {
      return ipcRenderer.invoke('audio:attach') as Promise<LowMemoryRestorePayload | null>
    },
    /** 订阅引擎播放事件(状态/进度)。返回取消订阅函数。 */
    onEvent(callback: (event: AudioEngineEvent) => void): () => void {
      const listener = (_event: unknown, value: AudioEngineEvent): void => callback(value)
      ipcRenderer.on('audio:event', listener)
      return () => ipcRenderer.removeListener('audio:event', listener)
    }
  },
  appUpdate: {
    check(channel: AppUpdateChannel, allowDowngrade?: boolean): Promise<AppUpdateStatus> {
      return ipcRenderer.invoke(
        'app-update:check',
        channel,
        allowDowngrade
      ) as Promise<AppUpdateStatus>
    },
    download(): Promise<AppUpdateActionResult> {
      return ipcRenderer.invoke('app-update:download') as Promise<AppUpdateActionResult>
    },
    install(): Promise<AppUpdateActionResult> {
      return ipcRenderer.invoke('app-update:install') as Promise<AppUpdateActionResult>
    },
    onProgress(callback: (progress: AppUpdateProgress) => void): () => void {
      const listener = (_event: unknown, value: AppUpdateProgress): void => callback(value)
      ipcRenderer.on('app-update:progress', listener)
      return () => ipcRenderer.removeListener('app-update:progress', listener)
    }
  }
}

contextBridge.exposeInMainWorld('muiceDesktop', desktopApi)
