export {}

declare global {
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

  interface ApiServerHealthResult {
    ok: boolean
    port: number
    host: string
    checkedAt: number
    latencyMs: number
    trackedProcess: boolean
    mode: 'development' | 'packaged'
    message: string
  }

  interface ApiServerRestartResult {
    ok: boolean
    restarted: boolean
    needsManualAction: boolean
    health: ApiServerHealthResult
    message: string
  }

  interface PlaybackCacheInfo {
    available: boolean
    directory: string | null
    location: 'software' | 'userData' | 'unavailable'
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
    reason?:
      | 'disabled'
      | 'unavailable'
      | 'fetch-failed'
      | 'too-large'
      | 'empty-file'
      | 'write-failed'
  }

  interface AppUpdateStatus {
    currentVersion: string
    channel: 'latest' | 'beta'
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

  interface MuiceDesktopApi {
    invoke<T>(
      channel:
        | 'window:minimize'
        | 'window:toggle-maximize'
        | 'window:close'
        | 'window:is-maximized'
        | 'window:toggle-mini'
        | 'window:toggle-always-on-top'
        | 'api-server:start'
        | 'api-server:stop'
        | 'api-server:get-version'
        | 'api-server:check-update'
        | 'api-server:update'
        | 'api-server:health'
        | 'api-server:is-running'
        | 'api-server:restart'
        | 'font:query-system-fonts'
        | 'font:download'
        | 'download:get-default-directory'
        | 'download:select-directory'
        | 'download:validate-directory'
        | 'download:song'
        | 'download:open-file'
        | 'download:open-directory'
        | 'download:show-in-folder'
        | 'download:delete-file'
        | 'download:file-exists'
        | 'download:get-file-url'
        | 'playback-cache:get-info'
        | 'playback-cache:resolve'
        | 'playback-cache:warm'
        | 'playback-cache:enforce-limit'
        | 'playback-cache:clear'
        | 'playback-cache:remove-entry'
        | 'theme:set-source'
        | 'app-update:check'
        | 'app-update:download'
        | 'app-update:install'
    ): Promise<T>
    window: {
      minimize(): Promise<void>
      toggleMaximize(): Promise<boolean>
      close(): Promise<void>
      isMaximized(): Promise<boolean>
      toggleMini(): Promise<boolean>
      toggleAlwaysOnTop(): Promise<boolean>
      onMaximizeChange(callback: (isMaximized: boolean) => void): () => void
      onMiniChange(callback: (isMini: boolean) => void): () => void
      onCloseRequested(callback: () => void): () => void
      sendCloseAction(action: 'quit' | 'tray'): void
    }
    player: {
      pushState(state: string): void
      onTrayCommand(callback: (cmd: string) => void): () => void
    }
    apiServer: {
      start(): Promise<string>
      stop(): Promise<string>
      getVersion(): Promise<string | null>
      checkUpdate(): Promise<{ current: string; latest: string; hasUpdate: boolean }>
      update(): Promise<{ oldVersion: string; newVersion: string; restarted: boolean }>
      health(): Promise<ApiServerHealthResult>
      isRunning(): Promise<boolean>
      restart(): Promise<ApiServerRestartResult>
    }
    font: {
      querySystemFonts(): Promise<string[]>
      downloadFont(url: string): Promise<void>
    }
    download: {
      getDefaultDirectory(): Promise<{ path: string }>
      selectDirectory(currentPath?: string): Promise<{ canceled: boolean; path?: string }>
      validateDirectory(directory: string): Promise<{ ok: boolean; message?: string }>
      song(payload: DownloadSongPayload): Promise<DownloadSongResult>
      onProgress(callback: (event: DownloadProgressEvent) => void): () => void
      openFile(filePath: string): Promise<FileOperationResult>
      openDirectory(directory: string): Promise<FileOperationResult>
      showInFolder(filePath: string): Promise<FileOperationResult>
      deleteFile(filePath: string, directory: string): Promise<DeleteDownloadFileResult>
      fileExists(filePath: string): Promise<DownloadFileExistsResult>
      getFileUrl(filePath: string): Promise<DownloadFileUrlResult>
    }
    cache: {
      getInfo(maxBytes: number): Promise<PlaybackCacheInfo>
      resolve(request: PlaybackCacheResolveRequest): Promise<PlaybackCacheResolveResult>
      warm(request: PlaybackCacheWarmRequest): Promise<PlaybackCacheWarmResult>
      enforceLimit(maxBytes: number): Promise<PlaybackCacheInfo>
      clear(maxBytes: number): Promise<PlaybackCacheInfo>
      removeEntry(key: string, maxBytes: number): Promise<PlaybackCacheInfo>
    }
    theme: {
      setSource(mode: 'light' | 'dark' | 'system'): Promise<void>
    }
    appUpdate: {
      check(channel: 'latest' | 'beta', allowDowngrade?: boolean): Promise<AppUpdateStatus>
      download(): Promise<AppUpdateActionResult>
      install(): Promise<AppUpdateActionResult>
      onProgress(callback: (progress: AppUpdateProgress) => void): () => void
    }
  }

  interface Window {
    muiceDesktop?: MuiceDesktopApi
  }
}
