import type { PlayableLevel } from '@/domain/player'
import { usePlayerStore } from '@/stores/player.store'
import { useImmersiveSettingsStore } from '../../immersive-settings.store'

/**
 * 播放传输控制层 —— seek / 音量 / 倍速 / 音质。
 * **所有皮肤共用的唯一实现**（硬约束：皮肤不许自己抄一份，逻辑层不能分叉）。
 *
 * 只转发「动作」；播放状态本身（isPlaying / currentTimeMs / level / volume）从
 * player store 直接读，不在此二次包装。
 */
export function useTransport() {
  const player = usePlayerStore()
  const settings = useImmersiveSettingsStore()

  return {
    play: (): void => player.play(),
    pause: (): void => player.pause(),
    togglePlay: (): void => player.togglePlay(),
    /** 绝对定位 seek（毫秒） */
    seek: (timeMs: number): void => player.seek(timeMs),
    /**
     * 歌词行跳转（毫秒）。正 offset 下行首时间戳可能小于 offset，差值为负；
     * audio 侧只对 currentTime 钳 0，却会把负值先写进 currentTimeMs 快照。
     * 与 ImmersiveControls 的歌词行跳转一致，在此钳 0。
     */
    seekLyric: (lineTimeMs: number): void =>
      player.seek(Math.max(0, lineTimeMs - settings.lyricOffset)),
    setVolume: (v: number): void => player.setVolume(v),
    toggleMute: (): void => player.toggleMute(),
    setPlaybackRate: (rate: number): void => player.setPlaybackRate(rate),
    setLevel: (level: PlayableLevel): void => player.setLevel(level)
  }
}
