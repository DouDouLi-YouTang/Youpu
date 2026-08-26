import type { Song } from './song'

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'deleted'
  | 'missing'

export interface DownloadRecord {
  id: string
  song: Song
  filename: string
  directory: string
  filePath?: string
  fileSizeBytes?: number
  totalBytes?: number
  receivedBytes?: number
  status: DownloadStatus
  progress: number
  errorMessage?: string
  createdAt: number
  completedAt?: number
  updatedAt: number
  createdByApp: true
}

export interface DownloadProgressEvent {
  jobId: string
  receivedBytes: number
  totalBytes?: number
  progress?: number
}

export interface DownloadDirectoryResult {
  path: string
}

export interface SelectDownloadDirectoryResult {
  canceled: boolean
  path?: string
}

export interface ValidateDownloadDirectoryResult {
  ok: boolean
  message?: string
}

export interface DownloadSongPayload {
  jobId: string
  url: string
  filename: string
  directory: string
}

export interface DownloadSongResult {
  success: true
  filePath: string
  filename: string
  bytes: number
}

export interface FileOperationResult {
  ok: boolean
  message?: string
}

export interface DeleteDownloadFileResult {
  deleted: boolean
  missing?: boolean
  message?: string
}

export interface DownloadFileExistsResult {
  exists: boolean
  sizeBytes?: number
}

export interface DownloadFileUrlResult {
  url: string
}
