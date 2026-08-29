import AdmZip from 'adm-zip'
import { execFile, fork, spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, createWriteStream, mkdirSync, statSync, truncateSync } from 'node:fs'
import { cp, mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createConnection } from 'node:net'
import { Readable } from 'node:stream'

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  screen,
  session,
  shell,
  Tray
} from 'electron'

import { getCoverPath, saveCover } from './cover-cache'
import { registerDownloadIpcHandlers } from './downloads'
import {
  checkForAppUpdate,
  downloadAppUpdate,
  initAutoUpdater,
  onDownloadProgress,
  quitAndInstallUpdate,
  setBeforeInstallHook,
  type UpdateChannel
} from './updater'
import {
  clearPlaybackCache,
  enforcePlaybackCacheLimit,
  getPlaybackCacheInfo,
  removePlaybackCacheEntry,
  resolveCacheFileForKey,
  resolvePlaybackCache,
  warmPlaybackCache
} from './playback-cache'
import type {
  PlaybackCacheResolveRequest,
  PlaybackCacheWarmRequest
} from '../../src/domain/playback-cache'

// Squirrel.Windows installer hooks spawn the app with special argv; quit early
// so we do not open a window during install/uninstall shortcut setup.
const nodeRequire = createRequire(import.meta.url)
try {
  if (nodeRequire('electron-squirrel-startup')) {
    app.quit()
  }
} catch {
  // Package missing in incomplete installs; ignore outside packaged Squirrel runs.
}

// 音频输出设备枚举:enumerateDevices 的设备名(label)需要 media permission granted,
// 否则 label 为空用户无法区分设备。use-fake-ui-for-media-stream 让 media permission
// 自动授予(不弹 UI),设置页输出设备列表显示真实设备名。应用不调用 getUserMedia,仅枚举设备。
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')

// 注册 muice-cache:// 为 privileged scheme:renderer 通过该协议播放本地缓存文件,
// 避免 file:// 被 webSecurity 阻止(renderer 从 http://localhost(dev) 或 file://index.html
// (prod) 加载时,跨源 file:// 资源会被 Chromium 拒绝 —— "Not allowed to load local
// resource")。registerSchemesAsPrivileged 必须在 app.ready 前调用。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'muice-cache',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: true
    }
  },
  {
    scheme: 'muice-cover',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  },
  {
    // 已下载到本地的音频文件通过 muice-file:// 播放,理由同 muice-cache://:
    // 避免 file:// 被 webSecurity 阻止。
    // corsEnabled/bypassCSP: 媒体元素跨 origin 加载自定义协议时需要,否则会静默解码失败。
    scheme: 'muice-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: true
    }
  }
])

/** 嗅探音频文件头获取 MIME(缓存文件 .cache 无扩展名,不能靠扩展名映射,避免 m4a/flac
 *  被当成 audio/mpeg 导致 audio 元素拒绝解码)。读前 16 字节匹配 magic bytes。 */
async function sniffAudioMime(filePath: string): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(filePath, 'r')
    const buf = Buffer.alloc(16)
    const { bytesRead } = await handle.read(buf, 0, 16, 0)
    if (bytesRead >= 4) {
      if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'audio/mpeg' // ID3(mp3)
      if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg' // mp3 帧同步
      if (buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43)
        return 'audio/flac' // fLaC
      if (
        bytesRead >= 8 &&
        buf[4] === 0x66 &&
        buf[5] === 0x74 &&
        buf[6] === 0x79 &&
        buf[7] === 0x70
      )
        return 'audio/mp4' // ftyp(m4a/aac)
      if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53)
        return 'audio/ogg' // OggS
    }
  } catch {
    // 嗅探失败降级 octet-stream,audio 仍可尝试嗅探内容
  } finally {
    await handle?.close()
  }
  return 'application/octet-stream'
}

/** 读取本地音频文件并构造 HTTP 响应,支持 Range 请求(206 Partial Content)以支持 audio seek。
 *  muice-cache:// 与 muice-file:// 协议共用:前者按 cache key 查索引定位文件,后者直接按路径播放下载文件。
 *  net.fetch 透传 Range 不可靠(FileURLLoader 仍返回完整 200 → audio seek 失败重置到 0),改用
 *  createReadStream 按字节范围读取,配合 Content-Range/Accept-Ranges 让 audio 正确 seek。 */
async function serveAudioFile(filePath: string, request: Request): Promise<Response> {
  let total: number
  try {
    total = (await stat(filePath)).size
  } catch {
    return new Response('file not found', { status: 404 })
  }
  if (total === 0) return new Response('empty file', { status: 404 })

  const mime = await sniffAudioMime(filePath)
  const range = request.headers.get('range')

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    if (m) {
      let start: number
      let end: number
      if (m[1] === '') {
        // 后缀范围 bytes=-N(RFC 7233):返回最后 N 字节。m[2] 为空(bytes=-)非法。
        const suffix = m[2] ? parseInt(m[2], 10) : 0
        if (suffix <= 0) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${total}` }
          })
        }
        start = Math.max(0, total - suffix)
        end = total - 1
      } else {
        start = parseInt(m[1], 10)
        const requestedEnd = m[2] ? parseInt(m[2], 10) : total - 1
        if (start >= total) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${total}` }
          })
        }
        end = Math.min(requestedEnd, total - 1)
      }
      const stream = createReadStream(filePath, { start, end })
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes'
        }
      })
    }
  }

  const stream = createReadStream(filePath)
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(total),
      'Accept-Ranges': 'bytes'
    }
  })
}

function registerCacheProtocol(): void {
  protocol.handle('muice-cache', async (request) => {
    const url = new URL(request.url)
    const key = decodeURIComponent(url.pathname.slice(1))
    const filePath = await resolveCacheFileForKey(key)
    if (!filePath) return new Response('cache not found', { status: 404 })
    return serveAudioFile(filePath, request)
  })
}

/** muice-file:// 允许播放的音频扩展名白名单:路径直接来自 URL,白名单避免被当成任意文件读取入口。 */
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.wma'])

/**
 * 从 muice-file 请求 URL 解析本地绝对路径。
 * 新格式: muice-file://local/?path=<encodeURIComponent(absPath)>
 * 旧格式兼容: muice-file://local/<encodeURIComponent(absPath)>
 */
function resolveMuiceFilePath(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl)
    const fromQuery = url.searchParams.get('path')
    if (fromQuery && fromQuery.trim()) {
      // searchParams 已自动 decode;再 resolve 规范化 Windows 路径
      return resolve(fromQuery)
    }
    // 旧 pathname 格式
    let raw = url.pathname || ''
    if (raw.startsWith('/')) raw = raw.slice(1)
    if (!raw) return null
    const decoded = decodeURIComponent(raw)
    return resolve(decoded)
  } catch (error) {
    console.warn('[muice-file] resolve path failed', requestUrl, error)
    return null
  }
}

/**
 * 为本地下载文件提供音频响应。
 * 不用 Node Readable→Web Stream(媒体管道在部分 Electron/Windows 上会解码失败),
 * 改为读入 Buffer 后按 Range 切片返回 —— 下载文件通常几十 MB,可接受。
 */
async function serveDownloadedAudioFile(filePath: string, request: Request): Promise<Response> {
  let buffer: Buffer
  try {
    buffer = await readFile(filePath)
  } catch (error) {
    console.warn('[muice-file] read failed', filePath, error)
    return new Response('file not found', { status: 404 })
  }
  if (buffer.length === 0) return new Response('empty file', { status: 404 })

  const total = buffer.length
  const mime = await sniffAudioMime(filePath)
  const commonHeaders: Record<string, string> = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    // 自定义协议跨 origin 时,媒体元素可能要求 CORS 头
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range',
    'Cache-Control': 'no-cache'
  }

  const range = request.headers.get('range')
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    if (m) {
      let start: number
      let end: number
      if (m[1] === '') {
        const suffix = m[2] ? parseInt(m[2], 10) : 0
        if (suffix <= 0) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: { ...commonHeaders, 'Content-Range': `bytes */${total}` }
          })
        }
        start = Math.max(0, total - suffix)
        end = total - 1
      } else {
        start = parseInt(m[1], 10)
        const requestedEnd = m[2] ? parseInt(m[2], 10) : total - 1
        if (start >= total) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: { ...commonHeaders, 'Content-Range': `bytes */${total}` }
          })
        }
        end = Math.min(requestedEnd, total - 1)
      }
      const slice = buffer.subarray(start, end + 1)
      // BodyInit 不接受 Node Buffer 类型,转成 Uint8Array
      return new Response(new Uint8Array(slice), {
        status: 206,
        headers: {
          ...commonHeaders,
          'Content-Length': String(slice.length),
          'Content-Range': `bytes ${start}-${end}/${total}`
        }
      })
    }
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      ...commonHeaders,
      'Content-Length': String(total)
    }
  })
}

/** 注册 muice-file:// protocol handler:renderer 通过该协议播放已下载到本地的音频文件。 */
function registerFileProtocol(): void {
  protocol.handle('muice-file', async (request) => {
    const filePath = resolveMuiceFilePath(request.url)
    console.info('[muice-file] request', request.url, '→', filePath)
    if (!filePath || !isAbsolute(filePath)) {
      console.warn('[muice-file] invalid path', { url: request.url, filePath })
      return new Response('invalid path', { status: 400 })
    }
    const ext = extname(filePath).toLowerCase()
    if (!AUDIO_EXTENSIONS.has(ext)) {
      console.warn('[muice-file] blocked non-audio', ext, filePath)
      return new Response('not an audio file', { status: 403 })
    }
    return serveDownloadedAudioFile(filePath, request)
  })
}

/** 注册 muice-cover:// protocol handler:按 songId 缓存封面图片。
 *  URL 格式 muice-cover://<songId>?url=<encoded remoteUrl>。先查本地(userData/cover-cache),
 *  命中返回本地文件;未命中 net.fetch 远程 URL 并写入缓存后返回。断网时已缓存封面仍可显示。 */
function registerCoverProtocol(): void {
  protocol.handle('muice-cover', async (request) => {
    const url = new URL(request.url)
    const songId = Number(url.hostname)
    const remoteUrl = url.searchParams.get('url')

    if (Number.isFinite(songId) && songId > 0) {
      const localPath = await getCoverPath(songId)
      if (localPath) {
        return net.fetch(pathToFileURL(localPath).toString())
      }
    }

    if (!remoteUrl) return new Response('cover url missing', { status: 404 })
    try {
      const resp = await net.fetch(remoteUrl)
      if (!resp.ok) return resp
      const buffer = Buffer.from(await resp.arrayBuffer())
      if (Number.isFinite(songId) && songId > 0) void saveCover(songId, buffer)
      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': resp.headers.get('content-type') || 'image/jpeg',
          'Cache-Control': 'no-cache'
        }
      })
    } catch {
      return new Response('cover fetch failed', { status: 502 })
    }
  })
}

let mainWindow: BrowserWindow | null = null
let apiServerProcess: ChildProcess | null = null
let tray: Tray | null = null
/** 迷你模式尺寸(含进度条行) */
const MINI_SIZE = { width: 320, height: 80 } as const
/** 正常模式尺寸(与 createMainWindow 初始值一致) */
const NORMAL_SIZE = { width: 1200, height: 780 } as const
let isMini = false
/** 每次窗口尺寸动画递增；旧动画的 tick 会自动失效，防止迷你/正常模式快速切换时互相抢写 bounds。 */
let windowResizeAnimationVersion = 0
/** 最新播放状态(renderer 推过来),供重建托盘菜单用 */
let lastPlayerState: string = 'idle'

function getProjectRoot(): string {
  return app.isPackaged ? process.resourcesPath : join(__dirname, '../..')
}

/** server 目录:dev 为项目根/server,打包后为 resources/server。 */
function getServerDir(): string {
  return join(getProjectRoot(), 'server')
}

/** gh-proxy 加速前缀(直连 GitHub 国内超时)。 */
const GH_PROXY = 'https://gh-proxy.com/'
/** api-enhanced 源仓库全名(owner/repo)。 */
const API_ENHANCED_REPO = 'NeteaseCloudMusicApiEnhanced/api-enhanced'

const API_SERVER_HOST = '127.0.0.1'
const API_SERVER_PORT = 3000

type ApiServerMode = 'development' | 'packaged'

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

function apiServerMode(): ApiServerMode {
  return app.isPackaged ? 'packaged' : 'development'
}

function hasTrackedApiServerProcess(): boolean {
  return Boolean(apiServerProcess && !apiServerProcess.killed)
}

function probeApiServerPort(timeoutMs = 1500): Promise<{ ok: boolean; latencyMs: number }> {
  const startedAt = Date.now()
  return new Promise((resolve) => {
    let settled = false
    const socket = createConnection(API_SERVER_PORT, API_SERVER_HOST)
    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ ok, latencyMs: Date.now() - startedAt })
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** HTTP 探测后端是否真正在处理请求(区别于 probeApiServerPort 的纯 TCP 连通):
 *  server 假死时端口仍监听、TCP 能连上但不响应 HTTP —— 只有 HTTP 探测能识别,
 *  从而触发 recoverBackendForPlayback 自动重启。任意 HTTP 响应(含 404/500)都算存活,
 *  假死/未启动/超时均判定不可用。 */
async function probeApiServerHttp(timeoutMs = 1500): Promise<{ ok: boolean; latencyMs: number }> {
  const startedAt = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    await fetch(`http://${API_SERVER_HOST}:${API_SERVER_PORT}/`, {
      signal: controller.signal,
      method: 'GET'
    })
    clearTimeout(timer)
    return { ok: true, latencyMs: Date.now() - startedAt }
  } catch {
    return { ok: false, latencyMs: Date.now() - startedAt }
  }
}

async function getApiServerHealth(timeoutMs?: number): Promise<ApiServerHealthResult> {
  const probe = await probeApiServerHttp(timeoutMs)
  return {
    ok: probe.ok,
    port: API_SERVER_PORT,
    host: API_SERVER_HOST,
    checkedAt: Date.now(),
    latencyMs: probe.latencyMs,
    trackedProcess: hasTrackedApiServerProcess(),
    mode: apiServerMode(),
    message: probe.ok ? '后端运行中' : '后端不可用'
  }
}

async function waitForPortState(open: boolean, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const probe = await probeApiServerPort(500)
    if (probe.ok === open) return true
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

async function waitForChildExit(child: ChildProcess, timeoutMs = 3000): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup()
      resolve(false)
    }, timeoutMs)
    const onExit = (): void => {
      cleanup()
      resolve(true)
    }
    const cleanup = (): void => {
      clearTimeout(timeout)
      child.removeListener('exit', onExit)
    }
    child.once('exit', onExit)
  })
}

/** 杀掉子进程:Windows 上 child.kill() 只杀直接子进程(spawn shell:true 时是 cmd.exe),
 *  孙进程 node.exe 成孤儿继续占端口。taskkill /T /F 杀整棵进程树(含 npm.cmd->node.exe)。 */
function killProcessTree(child: ChildProcess): void {
  if (process.platform === 'win32' && typeof child.pid === 'number') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      return
    } catch {
      // taskkill 失败降级普通 kill
    }
  }
  child.kill()
}

/** 兜底杀掉除主进程外的所有同名进程(后端 fork 与主进程同名 Youpu.exe)。
 *  NSIS 的 CHECK_APP_RUNNING 也是同一思路(taskkill /IM <name> /FI "PID ne <pid>")。
 *  若 stopTrackedApiServer 因跟踪丢失/超时而残留后端,其仍持有 $INSTDIR 内文件句柄,
 *  会令卸载旧版本时报 "Failed to uninstall old application files: 2"。 */
function killSameNameProcessesExceptSelf(): Promise<void> {
  if (process.platform !== 'win32' || typeof process.pid !== 'number') return Promise.resolve()
  const exeName = basename(process.execPath)
  return new Promise((resolve) => {
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    try {
      const killer = spawn(
        'taskkill',
        ['/IM', exeName, '/T', '/F', '/FI', `PID ne ${process.pid}`],
        { windowsHide: true }
      )
      killer.once('exit', done)
      killer.once('error', done)
    } catch {
      done()
    }
    setTimeout(done, 8000)
  })
}

async function stopTrackedApiServer(): Promise<boolean> {
  const child = apiServerProcess
  if (!child || child.killed) return true

  killProcessTree(child)
  let exited = await waitForChildExit(child)
  // 第一次没退干净就补杀一次,避免 taskkill 偶发漏杀,后端仍持有安装目录文件句柄
  if (!exited) {
    killProcessTree(child)
    exited = await waitForChildExit(child, 5000)
  }
  if (apiServerProcess === child) apiServerProcess = null

  const portClosed = await waitForPortState(false, 5000)
  if (!exited || !portClosed) {
    console.warn('[api-server] 停止后端未完全完成', { exited, portClosed })
  }
  return exited && portClosed
}

/** api-server 日志文件上限:超过则清空,避免长期运行无限增长,只保留近期日志。 */
const API_SERVER_LOG_MAX_BYTES = 5 * 1024 * 1024
let apiServerLogStream: ReturnType<typeof createWriteStream> | null = null

/** 打开(必要时创建)api-server 日志文件流,追加写入 userData/logs/api-server.log。
 *  打包 GUI 下 process.stdout 不可见,日志落盘后才能在出问题时定位 server 崩溃原因。 */
function getApiServerLogStream(): ReturnType<typeof createWriteStream> | null {
  const logDir = join(app.getPath('userData'), 'logs')
  const logPath = join(logDir, 'api-server.log')
  // 复用已开流前先检查文件大小,超限则关流截断重开:server 重启间复用同一流,
  // 若不检查,5MB 上限在重启间失效、日志无限增长;append 流直接 truncate 会写入位置错乱。
  if (apiServerLogStream) {
    try {
      if (statSync(logPath).size > API_SERVER_LOG_MAX_BYTES) {
        apiServerLogStream.end()
        apiServerLogStream = null
        truncateSync(logPath, 0)
      } else {
        return apiServerLogStream
      }
    } catch {
      return apiServerLogStream
    }
  }
  try {
    mkdirSync(logDir, { recursive: true })
    apiServerLogStream = createWriteStream(logPath, { flags: 'a' })
    apiServerLogStream.on('error', (error) => {
      console.warn('[api-server] 日志文件写入失败', error)
      apiServerLogStream = null
    })
    return apiServerLogStream
  } catch (error) {
    console.warn('[api-server] 无法创建日志文件', error)
    return null
  }
}

function trackApiServerProcess(child: ChildProcess): void {
  apiServerProcess = child
  // 消费子进程 stdout/stderr:fork 用 stdio:'pipe',若不读取,数据堆积在 pipe buffer
  // (约 64KB),写满后子进程 console 阻塞、事件循环卡死 —— 表现为后端假死(端口仍监听
  // 但 HTTP 无响应)。FM 连续播放每首歌都产生请求日志(server.js 的 logger.info),最易
  // 积累触发。日志同时转发到主进程 stdout/stderr(dev 可见)并落盘 userData/logs/api-server.log
  // (打包后可诊断);exit 原因也一并记录。
  // 每次写日志都重新取流:日志流出错后 getApiServerLogStream 会重建新流,若闭包捕获一次
  // 会持续写已 errored 的旧流(静默丢弃)且旧流未 destroy。
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout?.write(`[api-server] ${chunk}`)
    getApiServerLogStream()?.write(chunk)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr?.write(`[api-server] ${chunk}`)
    getApiServerLogStream()?.write(chunk)
  })
  child.once('exit', (code, signal) => {
    if (apiServerProcess === child) apiServerProcess = null
    const msg = `[api-server] 后端进程退出, code=${code} signal=${signal}\n`
    console.warn(msg)
    getApiServerLogStream()?.write(msg)
  })
}

function startDevelopmentApiServer(): ChildProcess {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const child = spawn(npmCommand, ['run', 'server:dev'], {
    cwd: getProjectRoot(),
    windowsHide: true,
    stdio: 'ignore',
    // Windows 上 npm 是 .cmd 脚本,Node 18+ 起(CVE-2024-27980 补丁)不带 shell 直接 spawn
    // .cmd/.bat 会抛 spawn EINVAL(errno -4071)。开 shell 让 cmd.exe 解析 .cmd 脚本。
    shell: process.platform === 'win32'
  })
  trackApiServerProcess(child)
  return child
}

async function startManagedApiServer(): Promise<boolean> {
  if (hasTrackedApiServerProcess()) return true
  // 端口已被占用(可能是 dev 的 concurrently server 或外部进程)时不重复启动:
  // 否则 dev 下 spawn 的 server 因 EADDRINUSE 立即退出,而 waitForPortState(true)
  // 探到的是 concurrently 的 server,误报启动成功。
  const portProbe = await probeApiServerPort(500)
  if (portProbe.ok) return true
  if (app.isPackaged) return startPackagedApiServer()
  startDevelopmentApiServer()
  const ready = await waitForPortState(true, 20000)
  if (!ready) console.warn('[api-server] 开发后端启动后端口未就绪')
  return ready
}

async function restartApiServer(): Promise<ApiServerRestartResult> {
  const before = await getApiServerHealth()
  if (before.ok && !before.trackedProcess) {
    return {
      ok: before.ok,
      restarted: false,
      needsManualAction: true,
      health: before,
      message: app.isPackaged
        ? '后端端口已被应用外部进程占用，请关闭占用端口的程序后重试'
        : '开发模式下后端由开发脚本管理，请手动重启开发服务'
    }
  }

  const stopped = await stopTrackedApiServer()
  if (!stopped) {
    const health = await getApiServerHealth()
    return {
      ok: health.ok,
      restarted: false,
      needsManualAction: true,
      health,
      message: '无法安全停止当前后端，请手动重启应用后重试'
    }
  }

  const started = await startManagedApiServer()
  const health = await getApiServerHealth()
  const restarted = started && health.ok
  return {
    ok: health.ok,
    restarted,
    needsManualAction: !restarted,
    health,
    message: restarted ? '后端已重启' : '后端重启失败，请稍后手动重试'
  }
}

/** 下载 zip 到内存。 */
async function downloadBuffer(url: string, timeoutMs = 120_000): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`下载后端代码失败: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * 获取 api-enhanced 仓库 main 分支最新 commit SHA(供应链加固)。
 *
 * 用 SHA 下载 archive 而非浮动 main 分支 zip,可防止代理在 main 指向变化期间
 * 篡改/回滚 zip 内容:SHA 经 GitHub API(独立端点)获取,下载走 codeload 端点,
 * 代理需同时攻破两个端点且 SHA 一致才能注入恶意代码。
 *
 * 双源:gh-proxy 代理(主)+ 直连 api.github.com(备,api.github.com 国内一般可达)。
 * 任一拿到 SHA 即可;都失败则抛错(不降级到无 SHA 下载,安全优先)。
 */
async function fetchMainCommitSha(): Promise<string> {
  const sources = [
    `${GH_PROXY}https://api.github.com/repos/${API_ENHANCED_REPO}/commits/main`,
    `https://api.github.com/repos/${API_ENHANCED_REPO}/commits/main`
  ]
  for (const url of sources) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15_000)
      })
      if (!res.ok) continue
      const data = (await res.json()) as { sha?: string }
      if (data.sha) return data.sha
    } catch {
      // 试下一个源
    }
  }
  throw new Error('无法获取远程 commit SHA,请检查网络')
}

/**
 * 用解压出的代码替换 server 目录,保留 node_modules 与 .git。
 *
 * 原子性:先把当前可替换内容备份到 backupDir(cp,跨盘安全),再删旧 + cp 新;
 * cp 中途失败(磁盘满/权限)时从备份回滚,避免 server 处于半更新损坏态导致下次
 * 启动 fork 失败。备份步骤本身失败则直接抛错(此时 serverDir 尚未被修改)。
 */
async function replaceServerCode(
  extractedDir: string,
  serverDir: string,
  backupDir: string
): Promise<void> {
  const keep = new Set(['node_modules', '.git'])
  await mkdir(backupDir, { recursive: true })
  // 1. 备份当前可替换内容
  for (const entry of await readdir(serverDir, { withFileTypes: true })) {
    if (keep.has(entry.name)) continue
    await cp(join(serverDir, entry.name), join(backupDir, entry.name), { recursive: true })
  }
  try {
    // 2. 删除当前内容
    for (const entry of await readdir(serverDir, { withFileTypes: true })) {
      if (keep.has(entry.name)) continue
      await rm(join(serverDir, entry.name), { recursive: true, force: true })
    }
    // 3. 复制新内容
    for (const entry of await readdir(extractedDir, { withFileTypes: true })) {
      if (keep.has(entry.name)) continue
      await cp(join(extractedDir, entry.name), join(serverDir, entry.name), { recursive: true })
    }
  } catch (error) {
    // 回滚:删掉已写入的残留新内容,从备份恢复
    for (const entry of await readdir(serverDir, { withFileTypes: true })) {
      if (keep.has(entry.name)) continue
      await rm(join(serverDir, entry.name), { recursive: true, force: true }).catch(() => undefined)
    }
    for (const entry of await readdir(backupDir, { withFileTypes: true })) {
      await cp(join(backupDir, entry.name), join(serverDir, entry.name), { recursive: true })
    }
    throw error
  }
}

/** 停止主进程管理的 server。 */
async function stopPackagedApiServer(): Promise<void> {
  await stopTrackedApiServer()
}

/** 构建托盘右键菜单,isPlaying 决定第一项文字。 */
function buildTrayMenu(isPlaying: boolean): Electron.Menu {
  return Menu.buildFromTemplate([
    {
      label: isPlaying ? '暂停' : '播放',
      click: () => mainWindow?.webContents.send('tray:command', 'play-pause')
    },
    {
      label: '上一首',
      click: () => mainWindow?.webContents.send('tray:command', 'prev')
    },
    {
      label: '下一首',
      click: () => mainWindow?.webContents.send('tray:command', 'next')
    },
    { type: 'separator' },
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    {
      label: '退出',
      click: () => app.quit()
    }
  ])
}

function createTray(): void {
  try {
    // 图标:打包后用 resources 里的 icon,dev 用项目根 build/icon.ico
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, 'icon.ico')
      : join(app.getAppPath(), 'build/icon.ico')

    tray = new Tray(iconPath)
    tray.setToolTip('有谱')
    tray.setContextMenu(buildTrayMenu(lastPlayerState === 'playing'))

    // 左键单击托盘图标显示/隐藏主窗口
    tray.on('click', () => {
      if (!mainWindow) return
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    })
  } catch (err) {
    console.error('[tray] 创建托盘图标失败:', err)
  }
}

/** easeInOutCubic:两端慢中间快,比 easeOutCubic 更柔和,适合窗口位移。 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * 窗口尺寸+位置动画。用 setBounds 一次调用同步位置和尺寸。
 * align='top-right': 以原窗口右上角为锚,向左下缩小(迷你模式,窗口不跨屏跳);
 * align='center': 屏幕居中(退出迷你)。
 * duration 短(150ms)减轻 Windows 每帧 setBounds + renderer reflow 的卡顿感知。
 */
function animateWindowResize(
  win: BrowserWindow,
  targetW: number,
  targetH: number,
  options?: { onDone?: () => void; align?: 'top-right' | 'center'; duration?: number }
): void {
  const { onDone, align, duration = 150 } = options ?? {}
  const animationVersion = ++windowResizeAnimationVersion
  const start = win.getBounds()
  const anchorRight = start.x + start.width
  const anchorTop = start.y
  const startTime = Date.now()
  const tick = (): void => {
    // 新模式启动动画或窗口已销毁时，旧 tick 立即退出，不能再把窗口写回旧尺寸。
    if (animationVersion !== windowResizeAnimationVersion || win.isDestroyed()) return
    const elapsed = Date.now() - startTime
    const t = Math.min(1, elapsed / duration)
    const eased = easeInOutCubic(t)
    const w = Math.round(start.width + (targetW - start.width) * eased)
    const h = Math.round(start.height + (targetH - start.height) * eased)
    let x = start.x
    let y = start.y
    if (align === 'top-right') {
      x = anchorRight - w
      y = anchorTop
    } else if (align === 'center') {
      const area = screen.getDisplayNearestPoint({ x: start.x, y: start.y }).workArea
      x = area.x + Math.round((area.width - w) / 2)
      y = area.y + Math.round((area.height - h) / 2)
    }
    win.setBounds({ x, y, width: w, height: h })
    if (t < 1) setTimeout(tick, 16)
    else onDone?.()
  }
  tick()
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: NORMAL_SIZE.width,
    height: NORMAL_SIZE.height,
    minWidth: 960,
    minHeight: 640,
    show: false,
    // Frameless: we draw the title bar ourselves in renderer (TitleBar.vue).
    // The CSS region `-webkit-app-region: drag` on that bar handles window
    // dragging; the min/max/close buttons sit in a `no-drag` zone and call
    // the IPC channels declared below.
    frame: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      // electron-vite emits the preload bundle as `index.mjs` (ESM), not `.js`.
      // Mis-pointing this leaves `window.muiceDesktop` undefined in renderer
      // and every titlebar button click resolves to a no-op via the catch.
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // 外部链接(<a target="_blank">)用系统浏览器打开,而不是在应用内开新 Electron 窗口。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // 拦截关闭事件:发 IPC 给 renderer 弹确认框,由 renderer 决定是退出还是最小化到托盘。
  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.webContents.send('window:close-requested')
  })

  // Bubble maximize state changes back to the renderer so the title bar can
  // swap its "最大化 ↔ 还原" icon without polling.
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximize-change', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximize-change', false)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerImageCors(): void {
  // 网易云音乐图片域名注入 Access-Control-Allow-Origin，使 renderer 的
  // crossOrigin='anonymous' 图片可被 canvas getImageData 读取（沉浸页主色提取所需）。
  // 不加此头，跨域图片会污染 canvas，getImageData 抛 SecurityError，主色降级为灰色。
  // 网易云图片本身已带 Access-Control-Allow-Origin，直接追加会变成 '*, *'
  // 被浏览器拒绝（"contains multiple values"），故先剔除原有同名头再注入单个。
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['*://*.music.126.net/*', '*://*.music.126.com/*'] },
    (details, callback) => {
      const responseHeaders: Record<string, string[]> = {}
      for (const [key, value] of Object.entries(details.responseHeaders ?? {})) {
        if (key.toLowerCase() !== 'access-control-allow-origin') {
          responseHeaders[key] = value
        }
      }
      responseHeaders['Access-Control-Allow-Origin'] = ['*']
      callback({ responseHeaders })
    }
  )
}

function registerIpcHandlers(): void {
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  ipcMain.handle('window:close', () => {
    // 直接退出:绕过 close 拦截(renderer 已确认)
    mainWindow?.destroy()
  })

  ipcMain.handle('window:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  // 迷你模式下右键切换窗口置顶
  ipcMain.handle('window:toggle-always-on-top', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    const next = !win.isAlwaysOnTop()
    win.setAlwaysOnTop(next)
    return next
  })

  // 主题同步:renderer 切换 light/dark 时通知主进程更新 nativeTheme,
  // 使 Windows 11 DWM 窗口边框颜色与应用主题一致。
  ipcMain.handle('theme:set-source', (_event, mode: 'light' | 'dark' | 'system') => {
    nativeTheme.themeSource = mode
  })

  // renderer 确认关闭行为后调用
  ipcMain.on('window:close-action', (_event, action: 'quit' | 'tray') => {
    if (action === 'quit') {
      app.quit()
    } else {
      mainWindow?.hide()
    }
  })

  // 切换迷你模式
  ipcMain.handle('window:toggle-mini', () => {
    if (!mainWindow) return false
    isMini = !isMini
    if (isMini) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize()
      // 先解除最小尺寸、立刻锁定不可拖拽；程序仍可 setBounds 动画，用户拖动进度时
      // 不会意外触发 frameless 窗口的边缘 resize。
      mainWindow.setMinimumSize(0, 0)
      mainWindow.setResizable(false)
      mainWindow.setAlwaysOnTop(true)
      animateWindowResize(mainWindow, MINI_SIZE.width, MINI_SIZE.height, {
        align: 'top-right'
      })
    } else {
      mainWindow.setResizable(true)
      mainWindow.setAlwaysOnTop(false)
      animateWindowResize(mainWindow, NORMAL_SIZE.width, NORMAL_SIZE.height, {
        align: 'center',
        onDone: () => {
          if (!isMini) mainWindow?.setMinimumSize(960, 640)
        }
      })
    }
    mainWindow.webContents.send('window:mini-change', isMini)
    return isMini
  })

  // 同步 nativeTheme:让 Windows 11 DWM 边框颜色跟随应用主题(深色主题时边框为深色,
  // 避免深色 UI 上出现浅色/白色边框线)。初始 dark,renderer 主题切换时通过 IPC 更新。
  nativeTheme.themeSource = 'dark'

  // renderer 推播放状态给主进程,供托盘菜单更新
  ipcMain.on('player:state-push', (_event, state: string) => {
    lastPlayerState = state
    tray?.setContextMenu(buildTrayMenu(state === 'playing'))
  })

  ipcMain.handle('api-server:start', async () => {
    if (hasTrackedApiServerProcess()) return '后端已在运行'
    const ok = await startManagedApiServer()
    return ok ? '后端启动请求已发送' : '后端启动失败'
  })

  ipcMain.handle('api-server:stop', async () => {
    if (!hasTrackedApiServerProcess()) return '后端未在运行'
    const ok = await stopTrackedApiServer()
    return ok ? '后端已停止' : '后端停止未完成,端口可能仍被占用'
  })

  // 读取内嵌 server 的 version(dev 读 server/package.json,打包读 resources/server/package.json)
  ipcMain.handle('api-server:get-version', async () => {
    try {
      const pkg = JSON.parse(await readFile(join(getServerDir(), 'package.json'), 'utf8'))
      return pkg.version as string
    } catch {
      return null
    }
  })

  // 检查 api-enhanced 是否有新版本:读当前版本 + fetch 远程 package.json 对比。
  ipcMain.handle('api-server:check-update', async () => {
    const currentPkg = JSON.parse(await readFile(join(getServerDir(), 'package.json'), 'utf8'))
    const current = currentPkg.version as string
    // jsdelivr 主源,gh-proxy raw 备源(任一拿到 version 即可)
    const sources = [
      'https://cdn.jsdelivr.net/gh/NeteaseCloudMusicApiEnhanced/api-enhanced@main/package.json',
      'https://gh-proxy.com/https://raw.githubusercontent.com/NeteaseCloudMusicApiEnhanced/api-enhanced/main/package.json'
    ]
    let latest: string | null = null
    for (const url of sources) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
        if (!res.ok) continue
        const remotePkg = (await res.json()) as { version?: string }
        if (remotePkg.version) {
          latest = remotePkg.version
          break
        }
      } catch {
        // 试下一个源
      }
    }
    if (!latest) throw new Error('无法获取远程版本,请检查网络')
    return { current, latest, hasUpdate: latest !== current }
  })

  // 从 api-enhanced 源仓库拉取最新代码,替换 server 目录(保留 node_modules)并重启。
  ipcMain.handle('api-server:update', async () => {
    const serverDir = getServerDir()
    const oldPkg = JSON.parse(await readFile(join(serverDir, 'package.json'), 'utf8'))
    const oldVersion = oldPkg.version as string

    // pin 到 main 最新 commit SHA 下载 archive,而非浮动 main 分支 zip(供应链加固):
    // SHA 经 GitHub API 独立端点获取,代理需同时攻破 API 与 codeload 两个端点且 SHA
    // 一致才能注入恶意代码。SHA 获取失败则中止(不降级到无 SHA 下载,安全优先)。
    const sha = await fetchMainCommitSha()
    const zipUrl = `${GH_PROXY}https://github.com/${API_ENHANCED_REPO}/archive/${sha}.zip`

    const zipBuf = await downloadBuffer(zipUrl)
    const tmpDir = join(app.getPath('temp'), `api-enhanced-update-${Date.now()}`)
    const backupDir = join(app.getPath('temp'), `api-enhanced-backup-${Date.now()}`)
    await mkdir(tmpDir, { recursive: true })
    try {
      new AdmZip(zipBuf).extractAllTo(tmpDir, true)
      // GitHub archive 顶层目录名为 `repo-<sha>`。校验该目录存在,防止代理返回
      // 篡改 zip(篡改 zip 的顶层目录名不会与该 SHA 对应,校验失败即拒绝替换)。
      const extractedDir = join(tmpDir, `api-enhanced-${sha}`)
      try {
        await readdir(extractedDir)
      } catch {
        throw new Error('解压目录校验失败,下载内容可能已被篡改')
      }

      await stopPackagedApiServer()
      await replaceServerCode(extractedDir, serverDir, backupDir)
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
      await rm(backupDir, { recursive: true, force: true }).catch(() => undefined)
    }

    // 打包模式自动重启 fork;dev 模式 server 由 concurrently 持有,无法自动重启
    await startPackagedApiServer()

    const newPkg = JSON.parse(await readFile(join(serverDir, 'package.json'), 'utf8'))
    return {
      oldVersion,
      newVersion: newPkg.version as string,
      restarted: app.isPackaged
    }
  })

  // 后端健康检查:HTTP 探测 + tracked 进程状态
  ipcMain.handle('api-server:health', () => getApiServerHealth())

  ipcMain.handle('api-server:is-running', () => hasTrackedApiServerProcess())

  ipcMain.handle('api-server:restart', () => restartApiServer())

  // 应用自身更新(electron-updater/GitHub Releases)。channel: latest 正式 / beta 预发布
  ipcMain.handle('app-update:check', (_event, channel: UpdateChannel, allowDowngrade?: boolean) =>
    checkForAppUpdate(channel, allowDowngrade === true)
  )
  ipcMain.handle('app-update:download', () => downloadAppUpdate())
  ipcMain.handle('app-update:install', () => quitAndInstallUpdate())

  // 下载进度推送(渲染层订阅;ipcRenderer.on 事件在 preload 中桥接)
  onDownloadProgress((progress) => {
    mainWindow?.webContents.send('app-update:progress', progress)
  })

  // 系统字体查询:Windows 用 PowerShell + System.Drawing 列出已装字体族名;
  // 非 Windows 暂返回空列表(沉浸页字体预设仍可手动输入)。
  ipcMain.handle('font:query-system-fonts', async () => querySystemFonts())

  // 下载字体:打开外链由用户在浏览器下载安装(对齐参考 betterncm.app.exec)。
  // 仅允许 http/https:shell.openExternal 对 file:// 等协议会打开系统资源管理器/任意
  // 程序,renderer 传入的 url 若被注入可借此打开本地资源。字体下载链接必为 http(s)。
  ipcMain.handle('font:download', (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('仅支持 http/https 链接')
    }
    return shell.openExternal(url)
  })

  // 播放缓存:renderer 读取缓存信息/解析命中/预热/限额收敛/清空/删除单条。
  ipcMain.handle('playback-cache:get-info', (_event, maxBytes: number) =>
    getPlaybackCacheInfo(maxBytes)
  )
  ipcMain.handle('playback-cache:resolve', (_event, request: PlaybackCacheResolveRequest) =>
    resolvePlaybackCache(request)
  )
  ipcMain.handle('playback-cache:warm', (_event, request: PlaybackCacheWarmRequest) =>
    warmPlaybackCache(request)
  )
  ipcMain.handle('playback-cache:enforce-limit', (_event, maxBytes: number) =>
    enforcePlaybackCacheLimit(maxBytes)
  )
  ipcMain.handle('playback-cache:clear', (_event, maxBytes: number) => clearPlaybackCache(maxBytes))
  ipcMain.handle(
    'playback-cache:remove-entry',
    (_event, payload: { key: string; maxBytes: number }) =>
      removePlaybackCacheEntry(payload.key, payload.maxBytes)
  )
}

/** 查询系统已安装字体族名列表(仅 Windows;其他平台返回空数组)。 */
function querySystemFonts(): Promise<string[]> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve([])
      return
    }
    // 用 execFile 直接 spawn powershell + args 数组,避免 exec 经 cmd.exe 时
    // 双引号被剥离导致 PowerShell -Command 解析失败、字体列表返回空。
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Add-Type -AssemblyName System.Drawing; [System.Drawing.Text.InstalledFontCollection]::new().Families | ForEach-Object { $_.Name }'
    ]
    execFile('powershell', args, { windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve([])
        return
      }
      resolve(
        stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      )
    })
  })
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/**
 * 打包模式下首次启动或整体升级后,从 node_modules.zip 还原 node_modules。
 * 后端在线升级 replaceServerCode 保留 node_modules 目录,故仅当目录缺失时才解压:
 * 既不覆盖后端升级结果,也避免每次启动重复解压。解压用系统 tar(native、异步,
 * 不阻塞主进程);失败则清理残留目录,下次启动重试,避免半解压损坏态。
 */
async function ensureServerNodeModules(serverDir: string): Promise<void> {
  const modulesDir = join(serverDir, 'node_modules')
  if (await pathExists(modulesDir)) return
  const zipPath = join(serverDir, 'node_modules.zip')
  if (!(await pathExists(zipPath))) {
    throw new Error('server node_modules 缺失且未找到 node_modules.zip,安装包可能损坏')
  }
  await mkdir(modulesDir, { recursive: true })
  try {
    // 优先系统 tar:native 解压快、异步不阻塞主进程(Win10 1803+ 自带 bsdtar,支持
    // zip)。tar 不可用时 fallback 到 adm-zip 同步解压(慢但纯 JS,无外部依赖)。
    try {
      await new Promise<void>((resolve, reject) => {
        execFile('tar', ['-xf', zipPath, '-C', modulesDir], (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    } catch {
      new AdmZip(zipPath).extractAllTo(modulesDir, true)
    }
  } catch (error) {
    // 清理半解压残留,下次启动重新解压
    await rm(modulesDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * 打包后启动内嵌的 api-enhanced server。dev 模式下 server 由 concurrently 的
 * `npm run server:dev` 启动,此处不介入;打包后既无 npm 也无源码,由主进程 fork
 * resources/server/app.js 启动--ELECTRON_RUN_AS_NODE 让 electron 二进制以纯
 * node 运行该 CJS 脚本(server 无 native 依赖,可安全 fork)。stdio:'pipe' 由
 * trackApiServerProcess 消费 stdout/stderr,避免管道阻塞导致后端假死。
 */
async function startPackagedApiServer(): Promise<boolean> {
  if (!app.isPackaged) return false
  const serverDir = join(process.resourcesPath, 'server')
  await ensureServerNodeModules(serverDir)
  // 与 dev 的 server:dev 对齐:加载 netease-dns-preload.cjs 劫持网易云域名到
  // 可达 IPv4。用 execArgv 而非 NODE_OPTIONS,避免安装路径含空格时引号解析问题。
  const dnsPreload = join(process.resourcesPath, 'scripts', 'netease-dns-preload.cjs')
  // 若 3000 已被占用但 HTTP 探活失败(僵尸/半死进程),先尽力释放端口再 fork,
  // 否则子进程 listen EADDRINUSE → 立即 exit 1,前端一直显示后端连不上。
  const portBusy = await probeApiServerPort(500)
  if (portBusy.ok) {
    const httpAlive = await probeApiServerHttp(1500)
    if (httpAlive.ok) return true
    console.warn('[api-server] 端口 3000 被占用但 HTTP 无响应,尝试释放后重启')
    getApiServerLogStream()?.write('[api-server] 端口 3000 被占用但 HTTP 无响应,尝试释放后重启\n')
    if (process.platform === 'win32') {
      try {
        await new Promise<void>((resolve) => {
          execFile(
            'powershell',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `$c = Get-NetTCPConnection -LocalPort ${API_SERVER_PORT} -State Listen -ErrorAction SilentlyContinue; if ($c) { $c.OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }`
            ],
            { windowsHide: true },
            () => resolve()
          )
        })
      } catch {
        // 释放失败仍继续 fork,由子进程日志暴露 EADDRINUSE
      }
      await waitForPortState(false, 3000)
    }
  }
  const child = fork(join(process.resourcesPath, 'scripts', 'start-api-server.cjs'), [], {
    cwd: serverDir,
    stdio: 'pipe',
    execArgv: ['--require', dnsPreload, '--dns-result-order=ipv4first'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  trackApiServerProcess(child)
  const ready = await waitForPortState(true, 20000)
  if (!ready) {
    console.warn('[api-server] 打包后端 fork 后 20s 内端口未就绪')
    getApiServerLogStream()?.write('[api-server] 打包后端 fork 后 20s 内端口未就绪\n')
  }
  return ready
}

// Windows 任务栏/系统通知显示应用名需 AppUserModelId,与 electron-builder 的 appId 对齐。
// 必须在 app.ready 前调用,否则 SMTC 等系统组件显示"未知应用"。
app.setAppUserModelId('com.youpu.desktop')

// 单实例锁:用户二次双击桌面图标时,不再启动新进程,而是聚焦已有的主窗口。
// requestSingleInstanceLock 必须在 app.whenReady 前调用;未拿到锁(说明已有实例在跑)
// 的进程直接退出。
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    registerImageCors()
    initAutoUpdater()
    // 更新安装前先停掉后端 API 服务并等待退出:后端是 fork 出来的同名进程(Youpu.exe),
    // 若不等它退出,NSIS 会把它当成"应用还在运行"而误报「无法关闭」。
    setBeforeInstallHook(async () => {
      await stopTrackedApiServer()
      // 兜底:清掉除主进程外的同名进程(后端 fork 与主进程同名),避免残留进程
      // 锁住安装目录文件导致 NSIS 卸载旧版本报 "Failed to uninstall old application files: 2"
      await killSameNameProcessesExceptSelf()
      // 留一点时间让系统释放文件句柄,再拉起安装器
      await new Promise((resolve) => setTimeout(resolve, 500))
    })
    // enumerateDevices 的音频输出设备名(label)需 media permission granted,主动授予,
    // 让设置页输出设备列表显示真实设备名(应用不录音,仅枚举设备用于 setSinkId 切换输出)。
    session.defaultSession.setPermissionCheckHandler(() => {
      // enumerateDevices 的音频输出设备名(label)需 media permission granted 才可见,
      // 对 permission check 放行让设备列表显示真实设备名(本地桌面应用,不涉及第三方页面权限收敛)。
      return true
    })
    registerCacheProtocol()
    registerFileProtocol()
    registerCoverProtocol()
    registerIpcHandlers()
    registerDownloadIpcHandlers(() => mainWindow)
    try {
      const ready = await startPackagedApiServer()
      if (!ready) {
        console.warn('[api-server] 打包后端启动后端口未就绪(20s 内未监听到 3000)')
        getApiServerLogStream()?.write(
          '[api-server] 打包后端启动后端口未就绪(20s 内未监听到 3000)\n'
        )
      }
    } catch (error) {
      console.error('[api-server] 打包后端启动异常', error)
      getApiServerLogStream()?.write(
        `[api-server] 打包后端启动异常: ${error instanceof Error ? error.stack || error.message : String(error)}\n`
      )
    }
    createMainWindow()
    createTray()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
}

// 托盘模式下所有窗口隐藏不退出(close 已被拦截,此处只处理 macOS 的 all-closed)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 有托盘时不自动退出,托盘菜单"退出"会调 app.quit()
    if (!tray) app.quit()
  }
})

app.on('before-quit', () => {
  if (apiServerProcess) killProcessTree(apiServerProcess)
  apiServerProcess = null
  // before-quit 时允许 destroy mainWindow(绕过 close 拦截)
  mainWindow?.destroy()
  mainWindow = null
})
