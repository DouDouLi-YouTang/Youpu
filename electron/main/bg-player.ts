import { EventEmitter } from 'node:events'

import { BrowserWindow, ipcMain, protocol, type IpcMainEvent } from 'electron'
import { join } from 'node:path'

/**
 * 后台播放器:一个隐藏的极小 BrowserWindow,页面里只有一个 <audio> 元素。
 *
 * 低内存模式回收主渲染进程时,正在播放的音频移交给它继续播:
 * Electron 主进程没有媒体栈,音频解码只能在某个渲染进程里做 —— 这个窗口
 * 就是“最小可能的渲染进程”(无 Vue/无 UI,内存几十 MB,远小于主渲染进程的
 * 200–400MB)。窗口由主进程音频引擎(electron/main/audio-engine.ts)编排,自己不做任何决策。
 *
 * 页面经 muice-bg:// 自定义协议提供(HTML 由主进程内存直接返回,不需要
 * 构建产物里多一个静态文件),preload 暴露 bgBridge 供页面收发 IPC。
 */

export type BgPlayerEvent =
  | {
      type: 'state'
      state: 'ready' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error'
      positionMs: number
      durationMs: number
    }
  | { type: 'position'; positionMs: number }
  /** play/pause 统一为切换语义(接收方按当前状态处理)。 */
  | { type: 'media-action'; action: 'play-pause' | 'prev' | 'next' }

export interface BgLoadOptions {
  url: string
  /** 加载后 seek 到的位置(ms),0 表示从头播。 */
  resumeAtMs?: number
  autoplay: boolean
  volume: number
  muted: boolean
  /** 播放倍速(页面沿用主渲染进程的“绝对顺滑”设置:preservesPitch=false)。 */
  rate: number
  /** 音频输出设备 id(空串=系统默认)。 */
  sinkId?: string
}

export interface BgMetaOptions {
  title: string
  artist: string
  album: string
  /** 系统 SMTC 通知封面(https 直链,muice-cover:// 它读不了)。 */
  artworkUrl: string | null
}

type BgCommand =
  | { type: 'load'; payload: BgLoadOptions }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'seek'; ms: number }
  | { type: 'volume'; value: number; muted: boolean }
  | { type: 'rate'; value: number }
  | { type: 'sink'; id: string }
  | { type: 'meta'; payload: BgMetaOptions }

const BG_EVENT_CHANNEL = 'bg-player:event'
const BG_COMMAND_CHANNEL = 'bg-player:command'
const BG_PAGE_URL = 'muice-bg://player/index.html'

/** 当前活跃的后台播放器窗口;同一时刻最多一个。 */
let activeWindow: BgPlayerWindow | null = null

let ipcRouted = false
function ensureIpcRouting(): void {
  if (ipcRouted) return
  ipcRouted = true
  ipcMain.on(BG_EVENT_CHANNEL, (event: IpcMainEvent, payload: unknown) => {
    const win = activeWindow
    // 只信任后台播放器窗口自己发来的事件,主窗口/renderer 无法伪造。
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return
    win.events.emit('event', payload as BgPlayerEvent)
  })
}

/** muice-bg:// 页面的 HTML。脚本逻辑保持极简:只执行命令、上报事件。 */
function buildPageHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src *; script-src 'unsafe-inline'; img-src https: data:" />
<title>bg-player</title>
</head>
<body>
<audio id="a" preload="auto"></audio>
<script>
(function () {
  var a = document.getElementById('a')
  var bridge = window.bgBridge
  var resumeAtMs = 0
  var autoplayPending = false
  var desiredRate = 1
  var lastPosSent = 0

  function ms() { return Math.round(a.currentTime * 1000) }
  function durMs() { return Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : 0 }

  // 与主渲染进程 useAudioElement 的“绝对顺滑”一致:关保持音高。
  function applyRate() {
    var r = Math.max(0.5, Math.min(1.5, desiredRate))
    a.preservesPitch = false
    a.defaultPlaybackRate = r
    if (Math.abs(a.playbackRate - r) > 0.001) a.playbackRate = r
  }

  function emit(ev) { bridge.emit(ev) }
  function emitState(state) { emit({ type: 'state', state: state, positionMs: ms(), durationMs: durMs() }) }

  function syncMediaSession(playing) {
    if (navigator.mediaSession) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  }

  a.addEventListener('loadedmetadata', function () {
    applyRate()
    if (resumeAtMs > 0) {
      try { a.currentTime = resumeAtMs / 1000 } catch (e) { /* seek 过头则忽略 */ }
    }
  })
  a.addEventListener('canplay', function () {
    applyRate()
    emitState('ready')
    if (autoplayPending) {
      autoplayPending = false
      a.play().catch(function () { emitState('paused') })
    }
  })
  a.addEventListener('playing', function () { applyRate(); emitState('playing'); syncMediaSession(true) })
  a.addEventListener('pause', function () {
    if (!a.ended) { emitState('paused'); syncMediaSession(false) }
  })
  a.addEventListener('waiting', function () { emitState('buffering') })
  a.addEventListener('ended', function () { emitState('ended'); syncMediaSession(false) })
  a.addEventListener('error', function () { emitState('error'); syncMediaSession(false) })
  a.addEventListener('timeupdate', function () {
    var now = Date.now()
    // 250ms:与渲染层原 useAudioElement 的节流一致,进度条体验不变
    if (now - lastPosSent >= 250) {
      lastPosSent = now
      emit({ type: 'position', positionMs: ms() })
    }
  })

  if (navigator.mediaSession) {
    var actions = { play: 'play-pause', pause: 'play-pause', previoustrack: 'prev', nexttrack: 'next' }
    Object.keys(actions).forEach(function (k) {
      navigator.mediaSession.setActionHandler(k, function () {
        emit({ type: 'media-action', action: actions[k] })
      })
    })
  }

  bridge.onCommand(function (cmd) {
    switch (cmd.type) {
      case 'load': {
        var p = cmd.payload
        a.pause()
        a.src = p.url
        resumeAtMs = p.resumeAtMs || 0
        autoplayPending = p.autoplay
        desiredRate = p.rate || 1
        a.volume = Math.max(0, Math.min(1, p.volume))
        a.muted = !!p.muted
        if (p.sinkId && a.setSinkId) a.setSinkId(p.sinkId).catch(function () { /* 设备不存在则默认输出 */ })
        a.load()
        applyRate()
        break
      }
      case 'play':
        a.play().catch(function () { emitState('paused') })
        break
      case 'pause':
        a.pause()
        break
      case 'stop':
        a.pause()
        a.removeAttribute('src')
        a.load()
        break
      case 'seek':
        try { a.currentTime = cmd.ms / 1000 } catch (e) { /* ignore */ }
        break
      case 'volume':
        a.volume = Math.max(0, Math.min(1, cmd.value))
        a.muted = !!cmd.muted
        break
      case 'rate':
        desiredRate = cmd.value || 1
        applyRate()
        break
      case 'sink':
        if (a.setSinkId && cmd.id) a.setSinkId(cmd.id).catch(function () { /* 设备不存在则默认输出 */ })
        break
      case 'meta': {
        if (!navigator.mediaSession) break
        var m = cmd.payload
        navigator.mediaSession.metadata = new MediaMetadata({
          title: m.title,
          artist: m.artist,
          album: m.album,
          artwork: m.artworkUrl ? [{ src: m.artworkUrl, sizes: '512x512' }] : []
        })
        break
      }
    }
  })

  emit({ type: 'state', state: 'paused', positionMs: 0, durationMs: 0 })
})()
</script>
</body>
</html>`
}

/** 注册 muice-bg:// 协议(app.ready 后调用;scheme 注册见 index.ts 的 privileged 列表)。 */
export function registerBgPlayerProtocol(): void {
  protocol.handle('muice-bg', (request) => {
    if (new URL(request.url).pathname !== '/index.html' && request.url !== BG_PAGE_URL) {
      return new Response('not found', { status: 404 })
    }
    return new Response(buildPageHtml(), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    })
  })
}

export class BgPlayerWindow {
  readonly events = new EventEmitter()
  private win: BrowserWindow | null = null
  /** 页面加载完成;创建失败时 reject。 */
  readonly ready: Promise<void>

  constructor() {
    ensureIpcRouting()
    // 模块级“当前活跃后台播放器”引用:IPC 事件路由(bg-player:event)需要用它
    // 校验事件来源,销毁时解除。no-this-alias 在此是刻意的模式而非坏味道。
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    activeWindow = this
    this.win = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/bg-player.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // 隐藏窗口默认会节流定时器;后台上报进度/处理命令需要正常节拍。
        backgroundThrottling: false
      }
    })
    this.ready = new Promise<void>((resolve, reject) => {
      const w = this.win
      if (!w) {
        reject(new Error('bg player window creation failed'))
        return
      }
      w.webContents.once('did-finish-load', () => resolve())
      w.webContents.once('did-fail-load', (_e, code, desc) =>
        reject(new Error(`bg player page load failed: ${code} ${desc ?? ''}`))
      )
      w.on('closed', () => {
        if (activeWindow === this) activeWindow = null
      })
    })
    void this.win.loadURL(BG_PAGE_URL)
  }

  get webContents(): Electron.WebContents | null {
    const w = this.win
    return w && !w.isDestroyed() ? w.webContents : null
  }

  isDestroyed(): boolean {
    return !this.win || this.win.isDestroyed()
  }

  private send(command: BgCommand): void {
    this.webContents?.send(BG_COMMAND_CHANNEL, command)
  }

  /** 加载音源并按参数恢复状态。resumeAtMs 在 loadedmetadata 后 seek。 */
  load(options: BgLoadOptions): void {
    this.send({ type: 'load', payload: options })
  }

  play(): void {
    this.send({ type: 'play' })
  }

  pause(): void {
    this.send({ type: 'pause' })
  }

  stop(): void {
    this.send({ type: 'stop' })
  }

  seek(ms: number): void {
    this.send({ type: 'seek', ms })
  }

  setVolume(value: number, muted: boolean): void {
    this.send({ type: 'volume', value, muted })
  }

  /** 独立设置播放倍速(不经过 load)。 */
  setRate(value: number): void {
    this.send({ type: 'rate', value })
  }

  /** 独立切换音频输出设备(空串=系统默认)。 */
  setSink(id: string): void {
    this.send({ type: 'sink', id })
  }

  /** 更新系统 SMTC 媒体通知(标题/艺术家/封面)。 */
  setMeta(meta: BgMetaOptions): void {
    this.send({ type: 'meta', payload: meta })
  }

  destroy(): void {
    if (activeWindow === this) activeWindow = null
    const w = this.win
    this.win = null
    if (w !== null && !w.isDestroyed()) w.destroy()
  }
}
