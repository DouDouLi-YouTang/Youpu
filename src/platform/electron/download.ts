import type {
  DeleteDownloadFileResult,
  DownloadDirectoryResult,
  DownloadFileExistsResult,
  DownloadFileUrlResult,
  DownloadProgressEvent,
  DownloadSongPayload,
  DownloadSongResult,
  FileOperationResult,
  SelectDownloadDirectoryResult,
  ValidateDownloadDirectoryResult
} from '@/domain/download'

export async function getDefaultDownloadDirectory(): Promise<DownloadDirectoryResult> {
  return (
    window.muiceDesktop?.download.getDefaultDirectory() ??
    Promise.reject(new Error('桌面运行时不可用'))
  )
}

export async function selectDownloadDirectory(
  currentPath?: string
): Promise<SelectDownloadDirectoryResult> {
  return (
    window.muiceDesktop?.download.selectDirectory(currentPath) ??
    Promise.reject(new Error('桌面运行时不可用'))
  )
}

export async function validateDownloadDirectory(
  directory: string
): Promise<ValidateDownloadDirectoryResult> {
  return (
    window.muiceDesktop?.download.validateDirectory(directory) ??
    Promise.reject(new Error('桌面运行时不可用'))
  )
}

export async function downloadSongToDirectory(
  payload: DownloadSongPayload
): Promise<DownloadSongResult> {
  return (
    window.muiceDesktop?.download.song(payload) ?? Promise.reject(new Error('桌面运行时不可用'))
  )
}

export function onDownloadProgress(callback: (event: DownloadProgressEvent) => void): () => void {
  return window.muiceDesktop?.download.onProgress(callback) ?? (() => undefined)
}

export async function openDownloadedFile(filePath: string): Promise<FileOperationResult> {
  return (
    window.muiceDesktop?.download.openFile(filePath) ??
    Promise.reject(new Error('桌面运行时不可用'))
  )
}

export async function openDownloadDirectory(directory: string): Promise<FileOperationResult> {
  return (
    window.muiceDesktop?.download.openDirectory(directory) ??
    Promise.reject(new Error('桌面运行时不可用'))
  )
}

export async function showDownloadedFileInFolder(filePath: string): Promise<FileOperationResult> {
  return (
    window.muiceDesktop?.download.showInFolder(filePath) ??
    Promise.reject(new Error('桌面运行时不可用'))
  )
}

export async function deleteDownloadedFile(
  filePath: string,
  directory: string
): Promise<DeleteDownloadFileResult> {
  return (
    window.muiceDesktop?.download.deleteFile(filePath, directory) ??
    Promise.reject(new Error('桌面运行时不可用'))
  )
}

export async function downloadedFileExists(filePath: string): Promise<DownloadFileExistsResult> {
  return (
    window.muiceDesktop?.download.fileExists(filePath) ??
    Promise.reject(new Error('桌面运行时不可用'))
  )
}

export async function getDownloadedFileUrl(filePath: string): Promise<DownloadFileUrlResult> {
  return (
    window.muiceDesktop?.download.getFileUrl(filePath) ??
    Promise.reject(new Error('桌面运行时不可用'))
  )
}
