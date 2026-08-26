import { once } from 'node:events'
import { createWriteStream, constants as fsConstants } from 'node:fs'
import { access, rename, rm, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, parse, relative, resolve } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'

interface DownloadDirectoryResult {
  path: string
}

interface SelectDirectoryPayload {
  currentPath?: string
}

interface SelectDirectoryResult {
  canceled: boolean
  path?: string
}

interface ValidateDirectoryPayload {
  directory: string
}

interface ValidateDirectoryResult {
  ok: boolean
  message?: string
}

interface DownloadSongPayload {
  jobId: string
  url: string
  filename: string
  directory: string
}

interface DownloadSongResult {
  success: true
  filePath: string
  filename: string
  bytes: number
}

interface DownloadProgressEvent {
  jobId: string
  receivedBytes: number
  totalBytes?: number
  progress?: number
}

interface FilePathPayload {
  filePath: string
}

interface DeleteFilePayload {
  filePath: string
  directory: string
}

interface FileOperationResult {
  ok: boolean
  message?: string
}

interface DeleteFileResult {
  deleted: boolean
  missing?: boolean
  message?: string
}

interface FileExistsResult {
  exists: boolean
  sizeBytes?: number
}

interface FileUrlResult {
  url: string
}

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

function sanitizeFilename(input: string): string {
  const onlyName = basename(input)
    .replace(/[\\/:*?"<>|]/g, '_')
    .split('')
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code >= 32 && code !== 127
    })
    .join('')
  const trimmed = onlyName.replace(/[. ]+$/g, '').trim()
  const safe = trimmed && !WINDOWS_RESERVED_NAMES.test(trimmed) ? trimmed : '下载文件'
  return safe.slice(0, 180)
}

function resolveDirectory(directory: string): string {
  if (!directory || !isAbsolute(directory)) {
    throw new Error('下载目录无效')
  }
  return resolve(directory)
}

function assertPathInsideDirectory(filePath: string, directory: string): void {
  const dir = resolveDirectory(directory)
  const file = resolve(filePath)
  const rel = relative(dir, file)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('文件不在下载目录中')
  }
}

async function validateDirectoryPath(directory: string): Promise<ValidateDirectoryResult> {
  try {
    const dir = resolveDirectory(directory)
    const info = await stat(dir)
    if (!info.isDirectory()) return { ok: false, message: '所选位置不是文件夹' }
    await access(dir, fsConstants.W_OK)
    return { ok: true }
  } catch {
    return { ok: false, message: '下载目录不存在或不可写' }
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath)
    return info.isFile()
  } catch {
    return false
  }
}

async function uniqueTargetPath(directory: string, filename: string): Promise<string> {
  const dir = resolveDirectory(directory)
  const safeName = sanitizeFilename(filename)
  const ext = extname(safeName)
  const stem = safeName.slice(0, safeName.length - ext.length) || parse(safeName).name || '下载文件'

  for (let index = 0; index < 1000; index += 1) {
    const candidateName = index === 0 ? safeName : `${stem} (${index})${ext}`
    const candidate = resolve(dir, candidateName)
    assertPathInsideDirectory(candidate, dir)
    if (!(await pathExists(candidate))) return candidate
  }

  throw new Error('无法生成可用文件名')
}

function sendProgress(sender: Electron.WebContents, event: DownloadProgressEvent): void {
  if (!sender.isDestroyed()) sender.send('download:progress', event)
}

async function finishWrite(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  const finished = once(stream, 'finish')
  const failed = once(stream, 'error').then(([error]) => {
    throw error
  })
  stream.end()
  await Promise.race([finished, failed])
}

async function downloadToFile(
  payload: DownloadSongPayload,
  sender: Electron.WebContents
): Promise<DownloadSongResult> {
  // 仅允许 http/https:renderer 传入的 url 若为 file:// 等协议,Node fetch 会读取
  // 本地任意文件并写入下载目录(信息泄露)。url 正常来自网易云 CDN,必为 http(s)。
  if (!/^https?:\/\//i.test(payload.url)) {
    throw new Error('仅支持 http/https 下载链接')
  }
  const validation = await validateDirectoryPath(payload.directory)
  if (!validation.ok) throw new Error(validation.message || '下载目录不可用')

  const targetPath = await uniqueTargetPath(payload.directory, payload.filename)
  const tempPath = `${targetPath}.part-${payload.jobId}`
  let receivedBytes = 0
  let writeStream: ReturnType<typeof createWriteStream> | null = null

  try {
    const response = await fetch(payload.url, {
      headers: { Referer: 'https://music.163.com/' },
      signal: AbortSignal.timeout(300_000)
    })
    if (!response.ok) throw new Error(`下载失败: HTTP ${response.status}`)

    const totalHeader = response.headers.get('content-length')
    const totalBytes = totalHeader ? Number(totalHeader) : undefined
    const knownTotal =
      totalBytes && Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : undefined

    writeStream = createWriteStream(tempPath, { flags: 'wx' })
    // 同步注册 error listener:写循环期间磁盘满/权限/AV 锁文件会异步 emit 'error',
    // 若无 listener 则逃逸为主进程 uncaught exception(try/catch 捕获不到无 listener 的
    // 'error' 事件)。对齐 playback-cache.ts 的写法;finishWrite 末尾的 once('error')
    // 无法覆盖写循环期间已 emit 的错误。
    let streamError: Error | null = null
    writeStream.on('error', (err: Error) => {
      streamError = err
    })

    if (response.body) {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (streamError) throw streamError
        const chunk = Buffer.from(value)
        receivedBytes += chunk.byteLength
        if (!writeStream.write(chunk)) await once(writeStream, 'drain')
        if (streamError) throw streamError
        sendProgress(sender, {
          jobId: payload.jobId,
          receivedBytes,
          totalBytes: knownTotal,
          progress: knownTotal
            ? Math.min(100, Math.round((receivedBytes / knownTotal) * 100))
            : undefined
        })
      }
    } else {
      const buffer = Buffer.from(await response.arrayBuffer())
      receivedBytes = buffer.byteLength
      writeStream.write(buffer)
      if (streamError) throw streamError
      sendProgress(sender, {
        jobId: payload.jobId,
        receivedBytes,
        totalBytes: knownTotal,
        progress: knownTotal ? 100 : undefined
      })
    }

    if (streamError) throw streamError
    await finishWrite(writeStream)
    writeStream = null
    await rename(tempPath, targetPath)
    sendProgress(sender, {
      jobId: payload.jobId,
      receivedBytes,
      totalBytes: knownTotal ?? receivedBytes,
      progress: 100
    })

    return {
      success: true,
      filePath: targetPath,
      filename: basename(targetPath),
      bytes: receivedBytes
    }
  } catch (error) {
    writeStream?.destroy()
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export function registerDownloadIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('download:get-default-directory', (): DownloadDirectoryResult => {
    return { path: app.getPath('downloads') }
  })

  ipcMain.handle(
    'download:select-directory',
    async (_event, payload?: SelectDirectoryPayload): Promise<SelectDirectoryResult> => {
      const win = getMainWindow() ?? undefined
      const result = await dialog.showOpenDialog(win!, {
        title: '选择下载位置',
        defaultPath: payload?.currentPath || app.getPath('downloads'),
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || !result.filePaths[0]) return { canceled: true }
      return { canceled: false, path: result.filePaths[0] }
    }
  )

  ipcMain.handle(
    'download:validate-directory',
    (_event, payload: ValidateDirectoryPayload): Promise<ValidateDirectoryResult> => {
      return validateDirectoryPath(payload.directory)
    }
  )

  ipcMain.handle('download:song', (event, payload: DownloadSongPayload) => {
    return downloadToFile(payload, event.sender)
  })

  ipcMain.handle(
    'download:file-exists',
    async (_event, payload: FilePathPayload): Promise<FileExistsResult> => {
      try {
        const info = await stat(payload.filePath)
        return { exists: info.isFile(), sizeBytes: info.isFile() ? info.size : undefined }
      } catch {
        return { exists: false }
      }
    }
  )

  ipcMain.handle(
    'download:show-in-folder',
    async (_event, payload: FilePathPayload): Promise<FileOperationResult> => {
      if (!(await fileExists(payload.filePath))) return { ok: false, message: '文件不存在' }
      shell.showItemInFolder(payload.filePath)
      return { ok: true }
    }
  )

  ipcMain.handle(
    'download:open-file',
    async (_event, payload: FilePathPayload): Promise<FileOperationResult> => {
      if (!(await fileExists(payload.filePath))) return { ok: false, message: '文件不存在' }
      const error = await shell.openPath(payload.filePath)
      return error ? { ok: false, message: '打开文件失败' } : { ok: true }
    }
  )

  /** 在资源管理器中打开下载目录(Windows 为 shell.openPath 文件夹)。 */
  ipcMain.handle(
    'download:open-directory',
    async (_event, payload: ValidateDirectoryPayload): Promise<FileOperationResult> => {
      const validation = await validateDirectoryPath(payload.directory)
      if (!validation.ok) return { ok: false, message: validation.message || '下载目录不可用' }
      const error = await shell.openPath(resolveDirectory(payload.directory))
      return error ? { ok: false, message: '打开目录失败' } : { ok: true }
    }
  )

  ipcMain.handle(
    'download:delete-file',
    async (_event, payload: DeleteFilePayload): Promise<DeleteFileResult> => {
      try {
        assertPathInsideDirectory(payload.filePath, payload.directory)
        if (!(await fileExists(payload.filePath)))
          return { deleted: false, missing: true, message: '文件不存在' }
        await shell.trashItem(payload.filePath)
        return { deleted: true }
      } catch (error) {
        console.warn('[download] 删除文件失败', error)
        return { deleted: false, message: '删除文件失败' }
      }
    }
  )

  ipcMain.handle(
    'download:get-file-url',
    async (_event, payload: FilePathPayload): Promise<FileUrlResult> => {
      if (!(await fileExists(payload.filePath))) throw new Error('文件不存在')
      // 用 query 传路径,避免把 Windows 盘符/反斜杠塞进 pathname
      // (Chromium 会把 %5C 规范化成 /, 容易解析失败)。
      // 格式: muice-file://local/?path=<encodeURIComponent(绝对路径)>
      return {
        // 使用 path 作为唯一查询参数;host 固定 download 避免被当成路径
        url: `muice-file://download?path=${encodeURIComponent(payload.filePath)}`
      }
    }
  )
}
