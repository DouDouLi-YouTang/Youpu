/**
 * Owns the single global `HTMLAudioElement` used for playback.
 *
 * The audio element is created lazily via `initPlayerProvider()` and held in a
 * module-level singleton. This keeps audio-element creation in exactly one place
 * (per the architecture rule: "audio element created only in provider") so the
 * player store / composable never call `new Audio()` themselves — they receive
 * the element via `getAudioElement()`.
 *
 * `initPlayerProvider` must be called once after the renderer DOM is ready
 * (e.g. in `main.ts` before/after pinia is installed — `new Audio()` does not
 * require a mounted node). It is idempotent: repeated calls return the same
 * element.
 */
let audioEl: HTMLAudioElement | null = null

export function initPlayerProvider(): HTMLAudioElement {
  if (audioEl) return audioEl

  const el = new Audio()
  el.preload = 'auto'
  // The player composable drives all interaction; the element itself should
  // not start anything until we explicitly load + play.
  el.autoplay = false
  // 无条件设置 crossOrigin='anonymous'(必须在任何 src 赋值之前,加载开始后不可再改)。
  //
  // 取舍(风险最高的一处改动,已逐一核实):
  //  - 不设:元素一旦接入 Web Audio 图(沉浸式频谱)会被当作跨域资源,后果是
  //    **输出彻底静音**(不是频谱为 0,是听不到声音);
  //  - 设了:凡是不返回 ACAO 头的音源会**彻底加载失败**。本项目三类音源均已确认带 ACAO:
  //    1) 网易云 CDN 直链:实测 200/206 响应带 Access-Control-Allow-Origin: *
  //    2) muice-cache://(缓存,主播放路径):electron/main/index.ts 的 serveAudioFile 已补 ACAO
  //    3) muice-file://(已下载):electron/main/index.ts 同函数已带 ACAO
  el.crossOrigin = 'anonymous'
  // 绝对顺滑倍速:关闭保持音高(简单重采样,音高随速度变)
  const media = el as HTMLAudioElement & {
    preservesPitch?: boolean
    mozPreservesPitch?: boolean
    webkitPreservesPitch?: boolean
  }
  media.preservesPitch = false
  media.mozPreservesPitch = false
  media.webkitPreservesPitch = false
  media.defaultPlaybackRate = 1
  media.playbackRate = 1
  audioEl = el
  return el
}

export function getAudioElement(): HTMLAudioElement {
  if (!audioEl) {
    throw new Error(
      'player-provider not initialized — call initPlayerProvider() during app bootstrap'
    )
  }
  return audioEl
}

export function disposePlayerProvider(): void {
  if (audioEl) {
    audioEl.pause()
    audioEl.removeAttribute('src')
    audioEl.load()
    audioEl = null
  }
}
