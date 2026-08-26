import { defineStore } from 'pinia'
import { message } from 'ant-design-vue'

import type { DownloadRecord, DownloadProgressEvent } from '@/domain/download'
import type { Song } from '@/domain/song'
import { getSongDownloadUrl } from '@/services/api/endpoints/download.api'
import { ApiError } from '@/services/api/errors'
import { logger } from '@/services/logger'
import { isElectronRuntime } from '@/platform/electron/commands'
import {
  deleteDownloadedFile,
  downloadedFileExists,
  downloadSongToDirectory,
  getDefaultDownloadDirectory,
  getDownloadedFileUrl,
  onDownloadProgress,
  openDownloadDirectory,
  selectDownloadDirectory,
  showDownloadedFileInFolder,
  validateDownloadDirectory
} from '@/platform/electron/download'
import { useAuthStore } from './auth.store'
import { usePlayerStore } from './player.store'
import { useSettingsStore } from './settings.store'

const PERSIST_KEY = 'muice:downloads'

let unsubscribeProgress: (() => void) | null = null
let initialized = false

interface DownloadState {
  records: DownloadRecord[]
  systemDownloadDirectory: string | null
  directoryError: string | null
  loadingDirectory: boolean
}

function generateDownloadId(songId: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `dl_${songId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim() || '未知歌曲'
  )
}

function buildFilename(song: Song, extension: string): string {
  const artists = song.artists.map((artist) => artist.name).join(',') || '未知歌手'
  const safeExt = extension.replace(/[^a-zA-Z0-9]/g, '') || 'mp3'
  return sanitizeFilename(`${song.name} - ${artists}.${safeExt}`)
}

function isActive(status: DownloadRecord['status']): boolean {
  return status === 'queued' || status === 'downloading'
}

export const useDownloadStore = defineStore('download', {
  state: (): DownloadState => ({
    records: [],
    systemDownloadDirectory: null,
    directoryError: null,
    loadingDirectory: false
  }),

  getters: {
    effectiveDirectory(): string | null {
      const settings = useSettingsStore()
      return settings.customDownloadDirectory || this.systemDownloadDirectory
    },
    activeRecords(): DownloadRecord[] {
      return this.records
        .filter((record) => isActive(record.status))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
    historyRecords(): DownloadRecord[] {
      return this.records
        .filter((record) => !isActive(record.status))
        .sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt))
    },
    activeCount(): number {
      return this.records.filter((record) => isActive(record.status)).length
    },
    overallProgress(): number {
      const active = this.records.filter((record) => isActive(record.status))
      if (active.length === 0) return 0
      const sum = active.reduce((acc, record) => {
        if (record.totalBytes && record.totalBytes > 0 && record.receivedBytes != null) {
          return acc + Math.min(100, (record.receivedBytes / record.totalBytes) * 100)
        }
        return acc + (record.progress || 0)
      }, 0)
      return Math.round(sum / active.length)
    },
    failedCount(): number {
      return this.records.filter((record) => record.status === 'failed').length
    },
    historyCount(): number {
      return this.records.filter((record) => !isActive(record.status)).length
    }
  },

  actions: {
    async init(): Promise<void> {
      if (!isElectronRuntime()) return
      if (!initialized) {
        initialized = true
        this.records = this.records.map((record) => {
          if (!isActive(record.status)) return record
          return {
            ...record,
            status: 'failed',
            progress: 0,
            errorMessage: '上次下载未完成',
            updatedAt: Date.now()
          }
        })
        unsubscribeProgress = onDownloadProgress((event) => this.applyProgress(event))
      }
      await this.loadSystemDownloadDirectory()
      await this.validateEffectiveDirectory()
    },

    dispose(): void {
      unsubscribeProgress?.()
      unsubscribeProgress = null
      initialized = false
    },

    async loadSystemDownloadDirectory(): Promise<void> {
      if (!isElectronRuntime()) return
      this.loadingDirectory = true
      try {
        const result = await getDefaultDownloadDirectory()
        this.systemDownloadDirectory = result.path
      } catch (error) {
        logger.error('获取系统下载目录失败', error)
        this.directoryError = '无法获取系统下载目录'
      } finally {
        this.loadingDirectory = false
      }
    },

    async validateEffectiveDirectory(): Promise<boolean> {
      if (!isElectronRuntime()) {
        this.directoryError = '当前环境不支持本地下载管理'
        return false
      }
      const directory = this.effectiveDirectory
      if (!directory) {
        this.directoryError = '下载目录未设置'
        return false
      }
      try {
        const result = await validateDownloadDirectory(directory)
        this.directoryError = result.ok ? null : result.message || '下载目录不可用'
        return result.ok
      } catch (error) {
        logger.error('校验下载目录失败', error)
        this.directoryError = '下载目录不可用'
        return false
      }
    },

    async chooseDownloadDirectory(): Promise<void> {
      if (!isElectronRuntime()) {
        message.warning('当前环境不支持本地下载管理')
        return
      }
      const result = await selectDownloadDirectory(this.effectiveDirectory ?? undefined)
      if (result.canceled || !result.path) return
      const validation = await validateDownloadDirectory(result.path)
      if (!validation.ok) {
        this.directoryError = validation.message || '下载目录不可用'
        message.error(this.directoryError)
        return
      }
      useSettingsStore().customDownloadDirectory = result.path
      this.directoryError = null
      message.success('下载位置已更新')
    },

    async restoreDefaultDirectory(): Promise<void> {
      useSettingsStore().customDownloadDirectory = null
      await this.loadSystemDownloadDirectory()
      await this.validateEffectiveDirectory()
      message.success('已恢复为系统下载目录')
    },

    async openDownloadDirectory(): Promise<void> {
      if (!isElectronRuntime()) {
        message.warning('当前环境不支持本地下载管理')
        return
      }
      await this.init()
      const directory = this.effectiveDirectory
      if (!directory) {
        message.error(this.directoryError || '下载目录未设置')
        return
      }
      if (!(await this.validateEffectiveDirectory())) {
        message.error(this.directoryError || '下载目录不可用')
        return
      }
      try {
        const result = await openDownloadDirectory(directory)
        if (!result.ok) message.error(result.message || '打开目录失败')
      } catch (error) {
        logger.error('打开下载目录失败', error)
        message.error('打开目录失败，请稍后重试')
      }
    },

    applyProgress(event: DownloadProgressEvent): void {
      const index = this.records.findIndex((record) => record.id === event.jobId)
      if (index < 0) return
      const record = this.records[index]
      // 已完成/失败/删除的记录不要被迟到的 progress 事件打回 downloading
      if (
        record.status === 'completed' ||
        record.status === 'failed' ||
        record.status === 'deleted' ||
        record.status === 'missing'
      ) {
        return
      }
      this.records[index] = {
        ...record,
        status: 'downloading',
        receivedBytes: event.receivedBytes,
        totalBytes: event.totalBytes ?? record.totalBytes,
        progress: event.progress ?? record.progress,
        updatedAt: Date.now()
      }
    },

    async downloadSong(song: Song): Promise<void> {
      const auth = useAuthStore()
      if (!auth.isLoggedIn) {
        message.warning('需要登录后才能下载')
        return
      }
      if (!isElectronRuntime()) {
        message.warning('当前环境不支持本地下载管理')
        return
      }

      await this.init()
      if (!(await this.validateEffectiveDirectory()) || !this.effectiveDirectory) {
        message.error(this.directoryError || '下载目录不可用，请重新选择')
        return
      }

      const hide = message.loading('正在准备下载…', 0)
      const id = generateDownloadId(song.id)
      try {
        const info = await getSongDownloadUrl(song.id, auth.cookie)
        if (!info) {
          hide()
          message.warning('暂无下载权限或版权受限')
          return
        }

        const now = Date.now()
        const filename = buildFilename(song, info.type)
        this.records.unshift({
          id,
          song,
          filename,
          directory: this.effectiveDirectory,
          fileSizeBytes: info.size || undefined,
          totalBytes: info.size || undefined,
          receivedBytes: 0,
          status: 'queued',
          progress: 0,
          createdAt: now,
          updatedAt: now,
          createdByApp: true
        })
        hide()
        message.info('已开始下载')

        const result = await downloadSongToDirectory({
          jobId: id,
          url: info.url,
          filename,
          directory: this.effectiveDirectory
        })
        const index = this.records.findIndex((record) => record.id === id)
        if (index >= 0) {
          const completedAt = Date.now()
          this.records[index] = {
            ...this.records[index],
            filename: result.filename,
            filePath: result.filePath,
            fileSizeBytes: result.bytes,
            receivedBytes: result.bytes,
            totalBytes: result.bytes,
            status: 'completed',
            progress: 100,
            completedAt,
            updatedAt: completedAt,
            errorMessage: undefined
          }
        }
        message.success('下载完成')
      } catch (error) {
        hide()
        logger.error('下载歌曲失败', error)
        if (error instanceof ApiError && error.code === 'UNAUTHORIZED') {
          useAuthStore().handleUnauthorized()
          return
        }
        const index = this.records.findIndex((record) => record.id === id)
        if (index >= 0) {
          this.records[index] = {
            ...this.records[index],
            status: 'failed',
            errorMessage: '下载失败，请稍后重试',
            updatedAt: Date.now()
          }
        }
        message.error('下载失败，请稍后重试')
      }
    },

    /** 重试失败的下载:移除失败记录后重新发起下载。 */
    async retryDownload(record: DownloadRecord): Promise<void> {
      this.records = this.records.filter((r) => r.id !== record.id)
      await this.downloadSong(record.song)
    },

    async refreshRecordFileStatus(recordId: string): Promise<boolean> {
      const record = this.records.find((item) => item.id === recordId)
      if (!record?.filePath) return false
      if (record.status === 'deleted') return false
      try {
        const result = await downloadedFileExists(record.filePath)
        if (!result.exists) {
          this.markMissing(recordId)
          return false
        }
        if (result.sizeBytes != null) {
          this.updateRecord(recordId, { fileSizeBytes: result.sizeBytes })
        }
        return true
      } catch (error) {
        logger.error('刷新下载文件状态失败', error)
        message.error('刷新文件状态失败')
        return false
      }
    },

    async refreshAllFileStatus(): Promise<void> {
      const records = this.historyRecords.filter((record) => record.status !== 'deleted')
      await Promise.all(records.map((record) => this.refreshRecordFileStatus(record.id)))
    },

    async playRecord(record: DownloadRecord): Promise<void> {
      if (record.status === 'deleted') {
        message.warning('本地文件已删除')
        return
      }
      if (!record.filePath) {
        message.warning('文件路径缺失，请重新下载')
        this.markMissing(record.id)
        return
      }
      if (!(await this.refreshRecordFileStatus(record.id))) {
        message.warning('本地文件不存在，已更新状态')
        return
      }
      try {
        const { url } = await getDownloadedFileUrl(record.filePath)
        if (!url) {
          message.error('无法生成本地播放地址')
          return
        }
        usePlayerStore().playLocalFile(record.song, url, record.filePath)
      } catch (error) {
        logger.error('播放本地下载文件失败', error)
        const msg = error instanceof Error ? error.message : '播放本地文件失败'
        // 文件不存在时标记缺失;其它错误仅提示
        if (msg.includes('不存在') || msg.includes('ENOENT')) {
          this.markMissing(record.id)
          message.warning('文件不存在，已更新状态')
        } else {
          message.error('播放本地文件失败，请确认文件完整后重试')
        }
      }
    },

    async showRecordInFolder(record: DownloadRecord): Promise<void> {
      if (record.status === 'deleted') {
        message.warning('本地文件已删除')
        return
      }
      if (!record.filePath) {
        message.warning('文件不存在')
        this.markMissing(record.id)
        return
      }
      if (!(await this.refreshRecordFileStatus(record.id))) {
        message.warning('文件不存在，已更新状态')
        return
      }
      try {
        const result = await showDownloadedFileInFolder(record.filePath)
        if (!result.ok) {
          this.markMissing(record.id)
          message.warning(result.message || '文件不存在')
        }
      } catch {
        message.error('打开文件位置失败')
      }
    },

    async deleteRecordFile(record: DownloadRecord): Promise<void> {
      if (record.status === 'deleted') {
        message.warning('本地文件已删除')
        return
      }
      if (!record.createdByApp || !record.filePath) {
        message.warning('文件不存在')
        this.markMissing(record.id)
        return
      }
      try {
        const result = await deleteDownloadedFile(record.filePath, record.directory)
        if (result.deleted) {
          this.updateRecord(record.id, { status: 'deleted', updatedAt: Date.now() })
          message.success('本地文件已删除')
        } else if (result.missing) {
          this.markMissing(record.id)
          message.warning('文件不存在，已更新状态')
        } else {
          message.error(result.message || '删除文件失败')
        }
      } catch {
        message.error('删除文件失败')
      }
    },

    clearHistory(): void {
      this.records = this.records.filter((record) => isActive(record.status))
      message.success('下载历史已清空')
    },

    markMissing(recordId: string): void {
      this.updateRecord(recordId, { status: 'missing', updatedAt: Date.now() })
    },

    updateRecord(recordId: string, patch: Partial<DownloadRecord>): void {
      const index = this.records.findIndex((record) => record.id === recordId)
      if (index < 0) return
      this.records[index] = { ...this.records[index], ...patch }
    }
  },

  persist: {
    key: PERSIST_KEY,
    pick: ['records']
  }
})
