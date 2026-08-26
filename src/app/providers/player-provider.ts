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
