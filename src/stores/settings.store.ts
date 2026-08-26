import { defineStore } from 'pinia'

import type { PlayableLevel } from '@/domain/player'

export type AudioQuality = PlayableLevel
export type Theme = 'light' | 'dark' | 'auto'
export type AccentPresetKey = 'green' | 'blue' | 'purple' | 'pink' | 'orange' | 'red'
export type FmCardSize = 'large-h' | 'large-v' | 'medium-h' | 'small' | 'mini'

/** 预设主色板。每个色在 light/dark 下均可读(antd algorithm 自动调主色上文字对比)。 */
export const ACCENT_PRESETS: Record<AccentPresetKey, string> = {
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7',
  pink: '#ec4899',
  orange: '#f97316',
  red: '#ef4444'
}

export type CloseAction = 'ask' | 'quit' | 'tray'
export type BackendUpdateMode = 'off' | 'notify' | 'auto'
/** 应用更新通道：off 不检查 / notify 有新版提示 / beta 接收 Beta 预发布 / latest 只接收正式版 */
export type AppUpdateChannelMode = 'off' | 'latest' | 'beta'

interface SettingsState {
  audioQuality: AudioQuality
  theme: Theme
  accentColor: AccentPresetKey
  accentFollowsCover: boolean
  closeAction: CloseAction
  customDownloadDirectory: string | null
  /** 是否启用播放缓存。 */
  playbackCacheEnabled: boolean
  /** 播放缓存容量上限(字节),默认 1GB。 */
  playbackCacheMaxBytes: number
  /** FM 入口卡片尺寸。 */
  fmCardSize: FmCardSize
  /** 歌曲列表中是否在歌曲名前显示封面缩略图。 */
  showCoverInList: boolean
  /** 后端更新检查模式:off 关闭检查 / notify 有新版本时提示 / auto 自动更新。 */
  backendUpdateMode: BackendUpdateMode
  /** 音频输出设备 deviceId(空串=系统默认,来自 enumerateDevices)。 */
  audioOutputDeviceId: string
  /** 是否显示按钮悬停气泡提示。 */
  showButtonTooltips: boolean
  /** 应用自身更新通道：off 关闭检查 / latest 正式版 / beta 预发布。 */
  appUpdateChannel: AppUpdateChannelMode
}

export const DEFAULT_PLAYBACK_CACHE_MAX_BYTES = 1073741824 // 1GB

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    audioQuality: 'hires', // 默认 Hi-Res(持久化,启动时同步给 player.level)
    theme: 'light',
    accentColor: 'blue',
    accentFollowsCover: false,
    closeAction: 'ask',
    customDownloadDirectory: null,
    playbackCacheEnabled: false,
    playbackCacheMaxBytes: DEFAULT_PLAYBACK_CACHE_MAX_BYTES,
    fmCardSize: 'large-h',
    showCoverInList: true,
    backendUpdateMode: 'off',
    audioOutputDeviceId: '',
    showButtonTooltips: true,
    appUpdateChannel: 'latest'
  }),
  persist: true
})
