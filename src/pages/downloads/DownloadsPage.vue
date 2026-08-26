<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Modal } from 'ant-design-vue'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  DeleteOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  ReloadOutlined
} from '@ant-design/icons-vue'

import type { DownloadRecord, DownloadStatus } from '@/domain/download'
import { isElectronRuntime } from '@/platform/electron/commands'
import { useDownloadStore } from '@/stores/download.store'

const downloadStore = useDownloadStore()
const activeRecords = computed(() => downloadStore.activeRecords)
const historyRecords = computed(() => downloadStore.historyRecords)
const hasRecords = computed(() => activeRecords.value.length > 0 || historyRecords.value.length > 0)
const hasHistory = computed(() => downloadStore.historyCount > 0)

onMounted(() => {
  void downloadStore.init()
})

function artistsText(record: DownloadRecord): string {
  const names = record.song.artists.map((artist) => artist.name).filter(Boolean)
  return names.length > 0 ? names.join(' / ') : '未知歌手'
}

function statusText(status: DownloadStatus): string {
  switch (status) {
    case 'queued':
      return '等待中'
    case 'downloading':
      return '下载中'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    case 'deleted':
      return '已删除'
    case 'missing':
      return '文件缺失'
    default:
      return '未知'
  }
}

function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatTime(ms?: number): string {
  if (!ms) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(ms))
}

function progressPercent(record: DownloadRecord): number {
  if (record.progress > 0) return Math.min(100, Math.round(record.progress))
  if (record.totalBytes && record.receivedBytes) {
    return Math.min(100, Math.round((record.receivedBytes / record.totalBytes) * 100))
  }
  return 0
}

function thumbUrl(url?: string): string | undefined {
  if (!url) return undefined
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}param=80y80`
}

function hasRecordedFilePath(record: DownloadRecord): boolean {
  return Boolean(record.filePath)
}

function canDeleteFile(record: DownloadRecord): boolean {
  return Boolean(record.filePath) && record.status !== 'deleted'
}

function canPlay(record: DownloadRecord): boolean {
  return hasRecordedFilePath(record) && record.status === 'completed'
}

function confirmDelete(record: DownloadRecord): void {
  Modal.confirm({
    title: '删除本地文件',
    content: `确定要删除「${record.song.name}」的本地文件吗？文件会移入系统回收站。`,
    okText: '删除文件',
    okType: 'danger',
    cancelText: '取消',
    centered: true,
    onOk: () => downloadStore.deleteRecordFile(record)
  })
}

function confirmClearHistory(): void {
  Modal.confirm({
    title: '清空下载记录',
    content: '只会清空应用内下载记录（下载中的任务会保留），不会删除本地文件。确定继续吗？',
    okText: '清空记录',
    okType: 'danger',
    cancelText: '取消',
    centered: true,
    onOk: () => downloadStore.clearHistory()
  })
}
</script>

<template>
  <section class="downloads-page">
    <header class="downloads-page__header">
      <div>
        <h2 class="downloads-page__title">下载</h2>
        <p class="downloads-page__desc">
          <template v-if="activeRecords.length > 0">
            {{ activeRecords.length }} 个任务进行中
            <template v-if="historyRecords.length > 0">
              · {{ historyRecords.length }} 条历史
            </template>
          </template>
          <template v-else-if="historyRecords.length > 0"
            >共 {{ historyRecords.length }} 条记录</template
          >
          <template v-else>管理本地下载任务与已保存的文件</template>
        </p>
      </div>
      <div class="downloads-page__actions">
        <a-button
          size="small"
          :disabled="!isElectronRuntime() || !hasHistory"
          @click="downloadStore.refreshAllFileStatus"
        >
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button
          size="small"
          :disabled="!isElectronRuntime() || !hasHistory"
          @click="confirmClearHistory"
        >
          清空记录
        </a-button>
      </div>
    </header>

    <a-alert
      v-if="!isElectronRuntime()"
      class="downloads-alert"
      message="当前环境不支持本地下载管理"
      description="请在桌面应用中使用下载、打开位置和删除本地文件等功能。"
      type="warning"
      show-icon
    />

    <div class="downloads-page__body">
      <div v-if="!hasRecords" class="downloads-empty">
        <a-empty description="暂无下载记录" />
      </div>

      <template v-else>
        <section v-if="activeRecords.length > 0" class="downloads-section">
          <h3 class="downloads-section__title">
            正在下载 <span class="downloads-section__count">{{ activeRecords.length }}</span>
          </h3>
          <div class="downloads-list">
            <article
              v-for="record in activeRecords"
              :key="record.id"
              class="downloads-row downloads-row--active"
            >
              <div class="downloads-row__cover">
                <img
                  v-if="thumbUrl(record.song.coverUrl)"
                  :src="thumbUrl(record.song.coverUrl)"
                  alt=""
                  loading="lazy"
                  referrerpolicy="no-referrer"
                />
                <span v-else class="downloads-row__cover-ph">♪</span>
              </div>
              <div class="downloads-row__main">
                <div class="downloads-row__top">
                  <span class="downloads-row__name" :title="record.song.name">{{
                    record.song.name
                  }}</span>
                  <span class="downloads-row__badge downloads-row__badge--active">{{
                    statusText(record.status)
                  }}</span>
                </div>
                <p class="downloads-row__artist">{{ artistsText(record) }}</p>
                <div class="downloads-progress">
                  <div class="downloads-progress__track">
                    <div
                      class="downloads-progress__fill"
                      :style="{ width: `${progressPercent(record)}%` }"
                    />
                  </div>
                  <span class="downloads-progress__meta">
                    {{ formatBytes(record.receivedBytes) }} /
                    {{ formatBytes(record.totalBytes || record.fileSizeBytes) }} ·
                    {{ progressPercent(record) }}%
                  </span>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section v-if="historyRecords.length > 0" class="downloads-section">
          <h3 class="downloads-section__title">
            下载记录 <span class="downloads-section__count">{{ historyRecords.length }}</span>
          </h3>
          <div class="downloads-list">
            <article
              v-for="record in historyRecords"
              :key="record.id"
              class="downloads-row"
              :class="{
                'downloads-row--fail': record.status === 'failed' || record.status === 'missing',
                'downloads-row--gone': record.status === 'deleted'
              }"
            >
              <div class="downloads-row__cover">
                <img
                  v-if="thumbUrl(record.song.coverUrl)"
                  :src="thumbUrl(record.song.coverUrl)"
                  alt=""
                  loading="lazy"
                  referrerpolicy="no-referrer"
                />
                <span v-else class="downloads-row__cover-ph">♪</span>
                <span
                  v-if="record.status === 'completed'"
                  class="downloads-row__cover-mark downloads-row__cover-mark--ok"
                  ><CheckCircleFilled
                /></span>
                <span
                  v-else-if="record.status === 'failed' || record.status === 'missing'"
                  class="downloads-row__cover-mark downloads-row__cover-mark--err"
                  ><CloseCircleFilled
                /></span>
              </div>
              <div class="downloads-row__main">
                <div class="downloads-row__top">
                  <span class="downloads-row__name" :title="record.song.name">{{
                    record.song.name
                  }}</span>
                  <span
                    class="downloads-row__badge"
                    :class="{
                      'downloads-row__badge--ok': record.status === 'completed',
                      'downloads-row__badge--err':
                        record.status === 'failed' || record.status === 'missing',
                      'downloads-row__badge--muted': record.status === 'deleted'
                    }"
                    >{{ statusText(record.status) }}</span
                  >
                </div>
                <p class="downloads-row__artist">{{ artistsText(record) }}</p>
                <p class="downloads-row__meta">
                  <span>{{ formatBytes(record.fileSizeBytes) }}</span>
                  <span v-if="formatTime(record.completedAt ?? record.updatedAt)">
                    · {{ formatTime(record.completedAt ?? record.updatedAt) }}</span
                  >
                  <span v-if="record.filename" class="downloads-row__file" :title="record.filename">
                    · {{ record.filename }}</span
                  >
                </p>
                <p v-if="record.errorMessage" class="downloads-row__err">
                  {{ record.errorMessage }}
                </p>
              </div>
              <div class="downloads-row__actions">
                <a-tooltip v-if="record.status === 'failed'" title="重试下载">
                  <button
                    type="button"
                    class="downloads-action"
                    @click="downloadStore.retryDownload(record)"
                  >
                    <ReloadOutlined />
                  </button>
                </a-tooltip>
                <a-tooltip title="播放本地文件">
                  <button
                    type="button"
                    class="downloads-action"
                    :disabled="!canPlay(record)"
                    @click="downloadStore.playRecord(record)"
                  >
                    <PlayCircleOutlined />
                  </button>
                </a-tooltip>
                <a-tooltip title="打开文件位置">
                  <button
                    type="button"
                    class="downloads-action"
                    :disabled="!hasRecordedFilePath(record)"
                    @click="downloadStore.showRecordInFolder(record)"
                  >
                    <FolderOpenOutlined />
                  </button>
                </a-tooltip>
                <a-tooltip title="删除本地文件">
                  <button
                    type="button"
                    class="downloads-action downloads-action--danger"
                    :disabled="!canDeleteFile(record)"
                    @click="confirmDelete(record)"
                  >
                    <DeleteOutlined />
                  </button>
                </a-tooltip>
              </div>
            </article>
          </div>
        </section>
      </template>
    </div>
  </section>
</template>

<style scoped lang="scss" src="./downloads-page.scss"></style>
