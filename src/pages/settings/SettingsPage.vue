<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import {
  ApiOutlined,
  AudioOutlined,
  CloudDownloadOutlined,
  DatabaseOutlined,
  InfoCircleOutlined,
  SettingOutlined,
  UserOutlined
} from '@ant-design/icons-vue'

import {
  checkApiServerUpdate,
  getApiServerHealth,
  getApiServerVersion,
  restartApiServer,
  type ApiServerHealthResult
} from '@/platform/electron/api-server'
import {
  checkAppUpdate,
  downloadAppUpdate,
  installAppUpdate,
  onAppUpdateProgress,
  type AppUpdateStatus
} from '@/platform/electron/app-update'
import { performBackendUpdateBackground } from '@/services/api-server-maintenance'
import { logger } from '@/services/logger'
import { isElectronRuntime } from '@/platform/electron/commands'
import {
  clearPlaybackCache,
  enforcePlaybackCacheLimit,
  getPlaybackCacheInfo
} from '@/platform/electron/cache'
import type { PlayableLevel } from '@/domain/player'
import { QUALITY_OPTIONS } from '@/domain/quality'
import type { PlaybackCacheInfo } from '@/domain/playback-cache'
import { useAuthStore } from '@/stores/auth.store'
import { useDownloadStore } from '@/stores/download.store'
import { usePlayerStore } from '@/stores/player.store'
import {
  ACCENT_PRESETS,
  DEFAULT_PLAYBACK_CACHE_MAX_BYTES,
  useSettingsStore,
  type AccentPresetKey,
  type AppUpdateChannelMode,
  type BackendUpdateMode,
  type CloseAction
} from '@/stores/settings.store'
import packageJson from '../../../package.json'
import logoUrl from '@/assets/logo.png'

const router = useRouter()
const authStore = useAuthStore()
const downloadStore = useDownloadStore()
const settingsStore = useSettingsStore()

const audioQualityOptions = QUALITY_OPTIONS.map((o) => ({
  label: o.label,
  value: o.value as PlayableLevel
}))

const themeOptions = [
  { label: '暗色', value: 'dark' },
  { label: '亮色', value: 'light' },
  { label: '跟随系统', value: 'auto' }
]

const closeActionOptions = [
  { label: '每次询问', value: 'ask' as CloseAction },
  { label: '直接退出', value: 'quit' as CloseAction },
  { label: '最小化到托盘', value: 'tray' as CloseAction }
]

const backendUpdateModeOptions = [
  { label: '关闭', value: 'off' as BackendUpdateMode },
  { label: '有新版本时提示', value: 'notify' as BackendUpdateMode },
  { label: '自动更新', value: 'auto' as BackendUpdateMode }
]

const accentOptions: { label: string; value: AccentPresetKey }[] = [
  { label: '绿', value: 'green' },
  { label: '蓝', value: 'blue' },
  { label: '紫', value: 'purple' },
  { label: '粉', value: 'pink' },
  { label: '橙', value: 'orange' },
  { label: '红', value: 'red' }
]

const version = computed(() => packageJson.version)
const downloadDirectoryText = computed(() => {
  if (!isElectronRuntime()) return '当前环境不支持本地下载管理'
  if (downloadStore.loadingDirectory) return '获取中…'
  return downloadStore.effectiveDirectory ?? '未设置'
})
const downloadDirectoryStatus = computed(() => {
  if (!isElectronRuntime()) return 'error'
  if (downloadStore.directoryError) return 'error'
  return 'success'
})

// 播放缓存:路径、占用、上限、清理
const cacheInfo = ref<PlaybackCacheInfo | null>(null)
const cacheLimitMb = ref(Math.round(DEFAULT_PLAYBACK_CACHE_MAX_BYTES / 1024 / 1024))
const clearingCache = ref(false)
const applyingCacheLimit = ref(false)

const cacheLocationText = computed(() => {
  if (!isElectronRuntime()) return '当前环境不支持本地播放缓存'
  if (!cacheInfo.value) return '获取中…'
  if (!cacheInfo.value.available) return cacheInfo.value.lastError || '不可用'
  switch (cacheInfo.value.location) {
    case 'software':
      return '软件目录缓存'
    case 'userData':
      return '用户数据目录缓存'
    default:
      return '不可用'
  }
})
const cacheDirectoryText = computed(() => {
  if (!isElectronRuntime()) return '当前环境不支持本地播放缓存'
  if (!cacheInfo.value?.available) return '—'
  return cacheInfo.value.directory ?? '—'
})
const cacheUsedText = computed(() => {
  if (!cacheInfo.value?.available) return '—'
  return formatBytes(cacheInfo.value.usedBytes)
})
const cacheEntryText = computed(() => {
  if (!cacheInfo.value?.available) return '—'
  return String(cacheInfo.value.entryCount)
})
const cacheLimitOptions = [
  { label: '512 MB', value: 512 },
  { label: '1 GB', value: 1024 },
  { label: '2 GB', value: 2048 },
  { label: '4 GB', value: 4096 },
  { label: '8 GB', value: 8192 }
]

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

async function loadCacheInfo(): Promise<void> {
  if (!isElectronRuntime()) return
  try {
    const maxBytes = settingsStore.playbackCacheMaxBytes || DEFAULT_PLAYBACK_CACHE_MAX_BYTES
    cacheInfo.value = await getPlaybackCacheInfo(maxBytes)
    cacheLimitMb.value = Math.round(maxBytes / 1024 / 1024)
  } catch (error) {
    logger.error('获取播放缓存信息失败', error)
  }
}

async function applyCacheLimit(): Promise<void> {
  if (!isElectronRuntime()) return
  const maxBytes = cacheLimitMb.value * 1024 * 1024
  applyingCacheLimit.value = true
  try {
    settingsStore.playbackCacheMaxBytes = maxBytes
    cacheInfo.value = await enforcePlaybackCacheLimit(maxBytes)
    message.success('缓存上限已更新')
  } catch (error) {
    logger.error('调整播放缓存上限失败', error)
    message.error('调整缓存上限失败，请稍后重试')
  } finally {
    applyingCacheLimit.value = false
  }
}

async function clearCache(): Promise<void> {
  if (!isElectronRuntime()) return
  Modal.confirm({
    title: '清理播放缓存',
    content: '会删除所有已缓存的播放文件和索引，不会影响下载历史或本地下载文件。确定继续吗？',
    okText: '清理缓存',
    okType: 'danger',
    cancelText: '取消',
    centered: true,
    onOk: async () => {
      clearingCache.value = true
      try {
        const maxBytes = settingsStore.playbackCacheMaxBytes || DEFAULT_PLAYBACK_CACHE_MAX_BYTES
        cacheInfo.value = await clearPlaybackCache(maxBytes)
        message.success('播放缓存已清理')
      } catch (error) {
        logger.error('清理播放缓存失败', error)
        message.error('清理缓存失败，请稍后重试')
      } finally {
        clearingCache.value = false
      }
    }
  })
}
const backendStatusText = computed(() => {
  if (!isElectronRuntime()) return '桌面运行时不可用'
  if (checkingHealth.value) return '检查中…'
  if (!apiHealth.value) return '未检查'
  if (apiHealth.value.ok) return '运行中'
  return apiHealth.value.message || '不可用'
})
const backendStatusColor = computed(() => {
  if (!isElectronRuntime()) return 'default'
  if (checkingHealth.value || !apiHealth.value) return 'processing'
  return apiHealth.value.ok ? 'success' : 'error'
})

// 后端 api-enhanced:版本展示 + 检查更新 + 在线更新
const BACKEND_REPO_URL = 'https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced'
const apiVersion = ref<string | null>(null)
const apiHealth = ref<ApiServerHealthResult | null>(null)
const checking = ref(false)
const updating = ref(false)
const checkingHealth = ref(false)
const restarting = ref(false)

const player = usePlayerStore()
const outputDevices = ref<MediaDeviceInfo[]>([])

async function loadOutputDevices(): Promise<void> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    outputDevices.value = devices.filter((d) => d.kind === 'audiooutput')
  } catch {
    outputDevices.value = []
  }
}

async function handleOutputDeviceChange(deviceId: string): Promise<void> {
  settingsStore.audioOutputDeviceId = deviceId
  await player.applyOutputDevice(deviceId).catch(() => undefined)
}

async function loadApiVersion(): Promise<void> {
  if (!isElectronRuntime()) return
  try {
    apiVersion.value = await getApiServerVersion()
  } catch {
    apiVersion.value = null
  }
}

async function refreshBackendHealth(): Promise<void> {
  if (!isElectronRuntime()) return
  checkingHealth.value = true
  try {
    apiHealth.value = await getApiServerHealth()
  } catch {
    apiHealth.value = null
    message.error('后端状态检查失败')
  } finally {
    checkingHealth.value = false
  }
}

async function handleRestartBackend(): Promise<void> {
  if (!isElectronRuntime()) return
  restarting.value = true
  try {
    const result = await restartApiServer()
    apiHealth.value = result.health
    if (result.ok && result.restarted) {
      message.success(result.message || '后端已重启')
    } else if (result.needsManualAction) {
      message.warning(result.message)
    } else {
      message.error(result.message || '后端重启失败')
    }
    await loadApiVersion()
  } catch (e) {
    logger.error('重启后端失败', e)
    message.error('重启后端失败，请稍后重试')
  } finally {
    restarting.value = false
  }
}

async function handleCheckUpdate(): Promise<void> {
  if (!isElectronRuntime()) return
  checking.value = true
  try {
    const result = await checkApiServerUpdate()
    apiVersion.value = result.current
    if (result.hasUpdate) {
      Modal.confirm({
        title: '发现新版本',
        content: `当前 ${result.current}，最新 ${result.latest}，是否立即更新？`,
        okText: '立即更新',
        cancelText: '稍后',
        centered: true,
        onOk: () => {
          // 不返回 Promise:Modal 立即关闭,更新转入后台,完成后 message 提示
          void doUpdate()
        }
      })
    } else {
      message.success(`已是最新版本 (${result.current})`)
    }
  } catch (e) {
    logger.error('检查后端更新失败', e)
    message.error('检查更新失败，请稍后重试')
  } finally {
    checking.value = false
  }
}

async function doUpdate(): Promise<void> {
  if (!isElectronRuntime()) return
  updating.value = true
  try {
    // 共享函数负责"后台运行"提示与完成通知,这里仅刷新版本与状态
    const result = await performBackendUpdateBackground()
    if (result) {
      apiVersion.value = result.newVersion
      await refreshBackendHealth()
    }
  } finally {
    updating.value = false
  }
}

// 应用自身更新(electron-updater/GitHub Releases)
const appUpdateChannelOptions: { label: string; value: AppUpdateChannelMode }[] = [
  { label: '关闭检查', value: 'off' },
  { label: '正式版', value: 'latest' },
  { label: 'Beta 版', value: 'beta' }
]

const appUpdateChecking = ref(false)
const appUpdateDownloading = ref(false)
const appUpdateStatus = ref<AppUpdateStatus | null>(null)
const appUpdateProgressPercent = ref<number | null>(null)
const appUpdateLastSpeed = ref(0)
const appUpdateReceivedBytes = ref(0)
const appUpdateTotalBytes = ref(0)
const appUpdateDownloaded = ref(false)
let unsubAppUpdateProgress: (() => void) | null = null

const appUpdateChannel = computed({
  get: () => settingsStore.appUpdateChannel,
  set: (value: AppUpdateChannelMode) => {
    settingsStore.appUpdateChannel = value
    // 切换通道后立即用新通道检查一次，让用户看到当前通道最新版本
    if (value !== 'off') void handleAppUpdateCheck(value)
    else appUpdateStatus.value = null
  }
})

const appUpdateStatusText = computed(() => {
  if (!appUpdateStatus.value) return '未检查'
  if (appUpdateStatus.value.error) return appUpdateStatus.value.error
  if (appUpdateStatus.value.available) return '发现新版本 ' + appUpdateStatus.value.version
  return '已是最新 (' + appUpdateStatus.value.currentVersion + ')'
})

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return ''
  const mb = bytesPerSecond / 1024 / 1024
  return mb >= 1 ? mb.toFixed(1) + ' MB/s' : (bytesPerSecond / 1024).toFixed(0) + ' KB/s'
}

const appUpdateProgressText = computed(() => {
  const current = appUpdateStatus.value
  if (!current) return appUpdateStatusText.value
  if (appUpdateDownloaded.value) {
    return current.installSupported
      ? '已下载完成，可点击「重启并安装」'
      : '已下载完成（便携版请手动下载安装包替换）'
  }
  if (appUpdateDownloading.value && appUpdateProgressPercent.value !== null) {
    const percent = Math.round(appUpdateProgressPercent.value)
    const parts = ['正在下载 ' + percent + '%']
    if (appUpdateTotalBytes.value > 0) {
      parts.push(
        formatBytes(appUpdateReceivedBytes.value) + ' / ' + formatBytes(appUpdateTotalBytes.value)
      )
    }
    const speed = formatSpeed(appUpdateLastSpeed.value)
    if (speed) parts.push(speed)
    return parts.join(' · ')
  }
  return appUpdateStatusText.value
})

async function handleAppUpdateCheck(target?: AppUpdateChannelMode): Promise<void> {
  const mode = target ?? settingsStore.appUpdateChannel
  if (mode === 'off') {
    appUpdateStatus.value = null
    return
  }
  appUpdateChecking.value = true
  appUpdateProgressPercent.value = null
  appUpdateDownloaded.value = false
  try {
    const result = await checkAppUpdate(mode === 'beta' ? 'beta' : 'latest')
    appUpdateStatus.value = result
    if (result.error) {
      message.warning(result.error)
    } else if (result.available) {
      confirmAppUpdateDownload(result)
    } else {
      message.success('当前已是最新版本 (' + result.currentVersion + ')')
    }
  } catch (error) {
    logger.error('检查应用更新失败', error)
    message.error('检查更新失败，请稍后重试')
  } finally {
    appUpdateChecking.value = false
  }
}

function confirmAppUpdateDownload(result: AppUpdateStatus): void {
  Modal.confirm({
    title: '发现应用新版本',
    content: '当前 ' + result.currentVersion + '，最新 ' + result.version + '，是否下载更新？',
    okText: '下载更新',
    cancelText: '稍后',
    centered: true,
    onOk: () => downloadAppUpdateSelf()
  })
}

async function downloadAppUpdateSelf(): Promise<void> {
  appUpdateDownloading.value = true
  appUpdateDownloaded.value = false
  appUpdateProgressPercent.value = 0
  appUpdateReceivedBytes.value = 0
  appUpdateTotalBytes.value = 0
  appUpdateLastSpeed.value = 0
  try {
    const result = await downloadAppUpdate()
    if (!result.ok) {
      message.error(result.error || '下载更新失败')
    } else {
      appUpdateDownloaded.value = true
    }
  } catch (error) {
    logger.error('下载应用更新失败', error)
    message.error('下载更新失败，请稍后重试')
  } finally {
    appUpdateDownloading.value = false
    appUpdateProgressPercent.value = null
  }
}

async function handleInstallAppUpdate(): Promise<void> {
  if (!appUpdateDownloaded.value) {
    message.warning('请先下载更新')
    return
  }
  const result = await installAppUpdate()
  if (!result.ok) {
    message.error(result.error || '安装更新失败')
  }
}

async function handleLogout(): Promise<void> {
  await router.push('/')
  await authStore.logout()
}

onMounted(() => {
  void downloadStore.init()
  void loadApiVersion()
  void refreshBackendHealth()
  void loadCacheInfo()
  void loadOutputDevices()
  navigator.mediaDevices?.addEventListener('devicechange', loadOutputDevices)
  unsubAppUpdateProgress = onAppUpdateProgress((p) => {
    appUpdateProgressPercent.value = p.percent
    appUpdateLastSpeed.value = p.bytesPerSecond
    appUpdateReceivedBytes.value = p.receivedBytes
    appUpdateTotalBytes.value = p.totalBytes
  })
  if (settingsStore.appUpdateChannel !== 'off') void handleAppUpdateCheck()
})

onUnmounted(() => {
  navigator.mediaDevices?.removeEventListener('devicechange', loadOutputDevices)
  unsubAppUpdateProgress?.()
})
</script>

<template>
  <section class="settings-page">
    <header class="settings-page__header">
      <div>
        <h2 class="settings-page__title">设置</h2>
        <p class="settings-page__desc">音频、外观、缓存与后端，按分组管理</p>
      </div>
    </header>

    <div class="settings-page__body">
      <!-- 音频 -->
      <section class="settings-card">
        <div class="settings-card__head">
          <span class="settings-card__icon"><AudioOutlined /></span>
          <div>
            <h3 class="settings-card__title">音频</h3>
            <p class="settings-card__sub">播放音质与输出设备</p>
          </div>
        </div>
        <div class="settings-card__rows">
          <div class="settings-row">
            <div class="settings-row__meta">
              <p class="settings-row__label">音质</p>
              <p class="settings-row__hint">影响在线播放码率，切换后立即重新加载当前歌曲</p>
            </div>
            <a-select
              :value="player.level"
              :options="audioQualityOptions"
              class="settings-row__control"
              placeholder="选择音质"
              @update:value="(v: PlayableLevel) => player.setLevel(v)"
            />
          </div>
          <div class="settings-row">
            <div class="settings-row__meta">
              <p class="settings-row__label">输出设备</p>
              <p class="settings-row__hint">选择系统音频输出，默认跟随系统</p>
            </div>
            <a-select
              :value="settingsStore.audioOutputDeviceId"
              class="settings-row__control"
              placeholder="系统默认"
              @update:value="handleOutputDeviceChange"
            >
              <a-select-option value="">系统默认</a-select-option>
              <a-select-option v-for="d in outputDevices" :key="d.deviceId" :value="d.deviceId">
                {{ d.label || `设备 ${d.deviceId.slice(0, 8)}` }}
              </a-select-option>
            </a-select>
          </div>
        </div>
      </section>

      <!-- 外观 -->
      <section class="settings-card">
        <div class="settings-card__head">
          <span class="settings-card__icon"><SettingOutlined /></span>
          <div>
            <h3 class="settings-card__title">外观</h3>
            <p class="settings-card__sub">主题、主色与窗口行为</p>
          </div>
        </div>
        <div class="settings-card__rows">
          <div class="settings-row settings-row--stack">
            <div class="settings-row__meta">
              <p class="settings-row__label">主题</p>
              <p class="settings-row__hint">暗色 / 亮色 / 跟随系统</p>
            </div>
            <a-segmented
              v-model:value="settingsStore.theme"
              :options="themeOptions"
              block
              class="settings-row__segmented"
            />
          </div>
          <div class="settings-row">
            <div class="settings-row__meta">
              <p class="settings-row__label">主色</p>
              <p class="settings-row__hint">界面强调色，按钮与进度条会跟随</p>
            </div>
            <div class="accent-swatches" role="listbox" aria-label="主色">
              <button
                v-for="opt in accentOptions"
                :key="opt.value"
                type="button"
                class="accent-swatch"
                :class="{ 'accent-swatch--on': settingsStore.accentColor === opt.value }"
                :style="{ backgroundColor: ACCENT_PRESETS[opt.value] }"
                :aria-label="opt.label"
                :title="opt.label"
                @click="settingsStore.accentColor = opt.value"
              />
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row__meta">
              <p class="settings-row__label">跟随专辑封面</p>
              <p class="settings-row__hint">开启后主色随当前歌曲封面变化</p>
            </div>
            <a-switch v-model:checked="settingsStore.accentFollowsCover" />
          </div>
          <div class="settings-row">
            <div class="settings-row__meta">
              <p class="settings-row__label">歌曲列表封面</p>
              <p class="settings-row__hint">在列表歌名旁显示封面缩略图</p>
            </div>
            <a-switch v-model:checked="settingsStore.showCoverInList" />
          </div>
          <div class="settings-row">
            <div class="settings-row__meta">
              <p class="settings-row__label">按钮气泡提示</p>
              <p class="settings-row__hint">悬停控制按钮时显示功能说明</p>
            </div>
            <a-switch v-model:checked="settingsStore.showButtonTooltips" />
          </div>
          <div class="settings-row">
            <div class="settings-row__meta">
              <p class="settings-row__label">关闭行为</p>
              <p class="settings-row__hint">点击窗口关闭按钮时的默认动作</p>
            </div>
            <a-select
              v-model:value="settingsStore.closeAction"
              :options="closeActionOptions"
              class="settings-row__control"
            />
          </div>
        </div>
      </section>

      <!-- 下载 -->
      <section class="settings-card">
        <div class="settings-card__head">
          <span class="settings-card__icon"><CloudDownloadOutlined /></span>
          <div>
            <h3 class="settings-card__title">下载</h3>
            <p class="settings-card__sub">本地下载目录</p>
          </div>
        </div>
        <div class="settings-card__rows">
          <a-alert
            v-if="!isElectronRuntime() || downloadStore.directoryError"
            class="settings-alert"
            :message="downloadStore.directoryError || '当前环境不支持本地下载管理'"
            type="warning"
            show-icon
          />
          <div class="settings-path-box">
            <div class="settings-path-box__top">
              <span class="settings-path-box__label">当前下载位置</span>
              <a-tag :color="downloadDirectoryStatus" class="!mr-0">
                {{ downloadStore.directoryError ? '不可用' : '可用' }}
              </a-tag>
            </div>
            <p class="settings-path-box__path">{{ downloadDirectoryText }}</p>
            <p class="settings-path-box__hint">下载歌曲会直接保存到此位置，不再弹出保存对话框。</p>
          </div>
          <div class="settings-actions">
            <a-button
              :disabled="!isElectronRuntime()"
              @click="downloadStore.openDownloadDirectory?.()"
            >
              打开下载目录
            </a-button>
            <a-button
              :disabled="!isElectronRuntime()"
              @click="downloadStore.chooseDownloadDirectory"
            >
              更改位置
            </a-button>
            <a-button
              :disabled="!isElectronRuntime()"
              @click="downloadStore.restoreDefaultDirectory"
            >
              恢复默认位置
            </a-button>
          </div>
        </div>
      </section>

      <!-- 播放缓存 -->
      <section class="settings-card">
        <div class="settings-card__head">
          <span class="settings-card__icon"><DatabaseOutlined /></span>
          <div>
            <h3 class="settings-card__title">播放缓存</h3>
            <p class="settings-card__sub">本地缓存可加速重复播放</p>
          </div>
        </div>
        <div class="settings-card__rows">
          <div class="settings-row">
            <div class="settings-row__meta">
              <p class="settings-row__label">启用播放缓存</p>
              <p class="settings-row__hint">关闭后始终走远程流播放，不再读写本地缓存</p>
            </div>
            <a-switch v-model:checked="settingsStore.playbackCacheEnabled" />
          </div>
          <div v-if="settingsStore.playbackCacheEnabled" class="settings-cache-detail">
            <a-alert
              v-if="!isElectronRuntime() || (cacheInfo && !cacheInfo.available)"
              class="settings-alert"
              :message="cacheInfo?.lastError || '当前环境不支持本地播放缓存'"
              type="warning"
              show-icon
            />
            <div class="settings-path-box">
              <div class="settings-path-box__top">
                <span class="settings-path-box__label">缓存位置</span>
                <span class="text-xs text-text-secondary">{{ cacheLocationText }}</span>
              </div>
              <p class="settings-path-box__path">{{ cacheDirectoryText }}</p>
            </div>
            <div class="settings-stats">
              <div class="settings-stat">
                <p class="settings-stat__label">已用容量</p>
                <p class="settings-stat__value">{{ cacheUsedText }}</p>
              </div>
              <div class="settings-stat">
                <p class="settings-stat__label">缓存数量</p>
                <p class="settings-stat__value">{{ cacheEntryText }}</p>
              </div>
            </div>
            <div class="settings-row settings-row--compact">
              <div class="settings-row__meta">
                <p class="settings-row__label">容量上限</p>
                <p class="settings-row__hint">超出上限时会自动删除最早缓存的文件</p>
              </div>
              <div class="settings-row__inline">
                <a-select
                  v-model:value="cacheLimitMb"
                  :options="cacheLimitOptions"
                  :disabled="!isElectronRuntime()"
                  style="width: 132px"
                />
                <a-button
                  type="primary"
                  :loading="applyingCacheLimit"
                  :disabled="!isElectronRuntime()"
                  @click="applyCacheLimit"
                >
                  应用
                </a-button>
              </div>
            </div>
            <div class="settings-actions">
              <a-button
                danger
                :loading="clearingCache"
                :disabled="!isElectronRuntime()"
                @click="clearCache"
              >
                清理播放缓存
              </a-button>
              <a-button :disabled="!isElectronRuntime()" @click="loadCacheInfo">刷新统计</a-button>
            </div>
          </div>
        </div>
      </section>

      <!-- 账号 -->
      <section class="settings-card">
        <div class="settings-card__head">
          <span class="settings-card__icon"><UserOutlined /></span>
          <div>
            <h3 class="settings-card__title">账号</h3>
            <p class="settings-card__sub">当前登录状态</p>
          </div>
        </div>
        <div class="settings-card__rows">
          <div v-if="authStore.isLoggedIn" class="settings-account">
            <a-avatar :src="authStore.avatarUrl || undefined" :size="52" class="!text-base">
              {{ authStore.nickname.charAt(0).toUpperCase() }}
            </a-avatar>
            <div class="min-w-0 flex-1">
              <p class="truncate text-[15px] font-semibold text-text-primary">
                {{ authStore.nickname }}
              </p>
              <p class="mt-0.5 text-xs text-text-secondary">已登录网易云账号</p>
            </div>
            <a-button danger @click="handleLogout">退出登录</a-button>
          </div>
          <div v-else class="settings-account settings-account--empty">
            <a-empty description="未登录" />
          </div>
        </div>
      </section>

      <!-- 后端 -->
      <section class="settings-card">
        <div class="settings-card__head">
          <span class="settings-card__icon"><ApiOutlined /></span>
          <div>
            <h3 class="settings-card__title">后端</h3>
            <p class="settings-card__sub">网易云 API 服务状态与更新</p>
          </div>
        </div>
        <div class="settings-card__rows">
          <div class="settings-stats settings-stats--backend">
            <div class="settings-stat">
              <p class="settings-stat__label">项目</p>
              <p class="settings-stat__value settings-stat__value--sm">API Enhanced</p>
            </div>
            <div class="settings-stat">
              <p class="settings-stat__label">版本</p>
              <p class="settings-stat__value settings-stat__value--sm">
                {{ apiVersion ?? '获取中…' }}
              </p>
            </div>
            <div class="settings-stat">
              <p class="settings-stat__label">状态</p>
              <a-tag :color="backendStatusColor" class="!mr-0 mt-1">{{ backendStatusText }}</a-tag>
            </div>
            <template v-if="apiHealth">
              <div class="settings-stat">
                <p class="settings-stat__label">地址</p>
                <p class="settings-stat__value settings-stat__value--sm">
                  {{ apiHealth.host }}:{{ apiHealth.port }}
                </p>
              </div>
              <div class="settings-stat">
                <p class="settings-stat__label">延迟</p>
                <p class="settings-stat__value settings-stat__value--sm">
                  {{ apiHealth.latencyMs }} ms
                </p>
              </div>
            </template>
          </div>
          <div class="settings-row">
            <div class="settings-row__meta">
              <p class="settings-row__label">更新检查</p>
              <p class="settings-row__hint">关闭 / 有新版本提示 / 自动更新</p>
            </div>
            <a-select
              v-model:value="settingsStore.backendUpdateMode"
              :options="backendUpdateModeOptions"
              class="settings-row__control"
            />
          </div>
          <div class="settings-row settings-row--stack">
            <div class="settings-row__meta">
              <p class="settings-row__label">源码仓库</p>
              <a :href="BACKEND_REPO_URL" target="_blank" rel="noreferrer" class="settings-link">
                NeteaseCloudMusicApiEnhanced/api-enhanced
              </a>
            </div>
          </div>
          <div class="settings-actions">
            <a-button :loading="checkingHealth" @click="refreshBackendHealth">刷新状态</a-button>
            <a-button :loading="restarting" danger @click="handleRestartBackend">重启后端</a-button>
            <a-button type="primary" :loading="checking || updating" @click="handleCheckUpdate">
              检查更新
            </a-button>
          </div>
        </div>
      </section>

      <!-- 关于（应用信息与更新） -->
      <section class="settings-card settings-card--about">
        <div class="settings-card__head">
          <span class="settings-card__icon"><InfoCircleOutlined /></span>
          <div>
            <h3 class="settings-card__title">关于</h3>
            <p class="settings-card__sub">应用信息与更新</p>
          </div>
        </div>
        <div class="settings-card__rows">
          <div class="settings-about">
            <div class="settings-about__brand">
              <img class="settings-about__logo" :src="logoUrl" alt="有谱" />
              <div>
                <p class="settings-about__name">有谱</p>
                <p class="settings-about__ver">版本 {{ version }}</p>
              </div>
            </div>
            <p class="settings-about__note">基于 Electron 的桌面音乐播放器</p>
          </div>

          <div class="settings-row">
            <div class="settings-row__meta">
              <p class="settings-row__label">更新通道</p>
              <p class="settings-row__hint">正式版稳定；Beta 版更早体验新功能</p>
            </div>
            <a-select
              v-model:value="appUpdateChannel"
              :options="appUpdateChannelOptions"
              class="settings-row__control"
            />
          </div>

          <div
            v-if="appUpdateStatus && !appUpdateStatus.error && appUpdateStatus.available"
            class="settings-row settings-row--stack"
          >
            <div class="settings-row__meta">
              <p class="settings-row__label">新版本</p>
              <p class="settings-row__hint">
                <a
                  :href="appUpdateStatus.releaseUrl || undefined"
                  target="_blank"
                  rel="noreferrer"
                  class="settings-link"
                >
                  查看更新说明
                </a>
              </p>
            </div>
            <div v-if="appUpdateStatus.releaseNotes" class="app-update__notes">
              {{ appUpdateStatus.releaseNotes }}
            </div>
            <div class="settings-row__inline">
              <a-button
                v-if="!appUpdateDownloaded"
                :loading="appUpdateDownloading"
                :disabled="appUpdateDownloading"
                @click="downloadAppUpdateSelf"
              >
                下载
              </a-button>
              <a-button
                v-if="appUpdateDownloaded && appUpdateStatus.installSupported"
                type="primary"
                @click="handleInstallAppUpdate"
                >重启并安装</a-button
              >
            </div>
          </div>

          <div v-if="appUpdateStatus" class="settings-row settings-row--stack">
            <div class="settings-row__meta">
              <p class="settings-row__label">状态</p>
              <p class="settings-row__hint">{{ appUpdateProgressText }}</p>
            </div>
          </div>

          <a-progress
            v-if="appUpdateProgressPercent !== null"
            :percent="Math.round(appUpdateProgressPercent)"
            size="small"
            status="active"
            class="!mb-0"
          />

          <div class="settings-actions">
            <a-button
              type="primary"
              :loading="appUpdateChecking"
              :disabled="appUpdateChannel === 'off'"
              @click="handleAppUpdateCheck()"
            >
              检查更新
            </a-button>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<!-- package-0.1.21 拆分样式（家族: settings-page）：原 #app 双前缀已改为 scoped，特异性不降且位于末位，赢家不变 -->
<style scoped lang="scss" src="./settings-page.scss"></style>
