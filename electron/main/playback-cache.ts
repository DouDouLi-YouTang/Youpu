/**
 * Electron 主进程播放缓存管理器。
 *
 * 职责：
 *  - 选择缓存目录：软件目录 `cache` 写入探针成功则使用，否则 fallback 到
 *    `userData/cache`。
 *  - 维护 `index.json`：加载、创建、原子写入（临时文件 + rename）、损坏恢复。
 *  - resolve：校验索引条目、文件存在、文件非空，返回本地 `file://` source。
 *  - warm：按缓存键去重 in-flight 任务，流式 fetch 远程音频到临时文件，
 *    成功后原子移动并更新索引，再按 `cachedAt` 升序淘汰超限条目。
 *  - clear / removeEntry：只操作播放缓存目录与索引，不触碰下载目录。
 *
 * 所有返回值都是可序列化对象；异常由 renderer 捕获并降级为远程播放。
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { app } from 'electron'

import type {
  PlaybackCacheEntry,
  PlaybackCacheInfo,
  PlaybackCacheLocation,
  PlaybackCacheResolveRequest,
  PlaybackCacheResolveResult,
  PlaybackCacheWarmRequest,
  PlaybackCacheWarmResult
} from '../../src/domain/playback-cache'
import { buildPlaybackCacheKey } from '../../src/domain/playback-cache'

const INDEX_FILE_NAME = 'index.json'
const INDEX_SCHEMA_VERSION = 1
const PROBE_FILE_NAME = '.muice-cache-probe'
const CACHE_FILE_SUFFIX = '.cache'

/**
 * 把缓存键转为 Windows 安全文件名。
 *
 * 缓存键 `song:{songId}:level:{level}` 含冒号,而 Windows 文件名禁止
 * `:`(会被解析为驱动器分隔符/备用数据流),必须替换。同时过滤其它
 * 非法字符与控制字符。
 */
function safeCacheFileName(key: string): string {
  const cleaned = key
    .replace(/[\\/:*?"<>|]/g, '_')
    .split('')
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
  return `${cleaned || 'cache'}${CACHE_FILE_SUFFIX}`
}

interface PlaybackCacheIndex {
  schemaVersion: number
  entries: Record<string, PlaybackCacheEntry>
}

interface CacheDirectoryState {
  directory: string
  location: PlaybackCacheLocation
}

let directoryState: CacheDirectoryState | null = null
let indexCache: PlaybackCacheIndex | null = null
const inflightWarms = new Map<string, Promise<PlaybackCacheWarmResult>>()

// --- 目录选择 ---

function getSoftwareCacheDir(): string {
  // dev: 项目根/cache(app.getAppPath 指向项目根)
  // 打包: resources/cache(process.resourcesPath 指向 extraResources 根)
  if (app.isPackaged) return resolve(process.resourcesPath, 'cache')
  return resolve(app.getAppPath(), 'cache')
}

function getUserDataCacheDir(): string {
  return resolve(app.getPath('userData'), 'cache')
}

async function tryWriteProbe(directory: string): Promise<boolean> {
  try {
    await mkdir(directory, { recursive: true })
    const probe = join(directory, PROBE_FILE_NAME)
    await writeFile(probe, String(Date.now()), { flag: 'wx' })
    await rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}

async function resolveCacheDirectory(): Promise<CacheDirectoryState> {
  if (directoryState) return directoryState

  const softwareDir = getSoftwareCacheDir()
  if (await tryWriteProbe(softwareDir)) {
    directoryState = { directory: softwareDir, location: 'software' }
    return directoryState
  }

  const userDataDir = getUserDataCacheDir()
  if (await tryWriteProbe(userDataDir)) {
    directoryState = { directory: userDataDir, location: 'userData' }
    return directoryState
  }

  directoryState = { directory: '', location: 'unavailable' }
  return directoryState
}

// --- 索引 ---

function emptyIndex(): PlaybackCacheIndex {
  return { schemaVersion: INDEX_SCHEMA_VERSION, entries: {} }
}

function indexPath(directory: string): string {
  return join(directory, INDEX_FILE_NAME)
}

async function loadIndex(directory: string): Promise<PlaybackCacheIndex> {
  try {
    const raw = await readFile(indexPath(directory), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PlaybackCacheIndex>
    if (parsed && parsed.schemaVersion === INDEX_SCHEMA_VERSION && parsed.entries) {
      return { schemaVersion: INDEX_SCHEMA_VERSION, entries: parsed.entries }
    }
    // schema 不匹配 → 重建(不删除已缓存文件,enforceLimit/clear 会处理孤儿)
    return emptyIndex()
  } catch {
    return emptyIndex()
  }
}

async function saveIndex(directory: string, index: PlaybackCacheIndex): Promise<void> {
  const target = indexPath(directory)
  const temp = `${target}.tmp`
  await writeFile(temp, JSON.stringify(index), 'utf8')
  await rename(temp, target)
}

async function ensureIndex(): Promise<{
  dir: CacheDirectoryState
  index: PlaybackCacheIndex
} | null> {
  const dir = await resolveCacheDirectory()
  if (dir.location === 'unavailable') return null
  if (!indexCache) {
    indexCache = await loadIndex(dir.directory)
  }
  return { dir, index: indexCache }
}

async function commitIndex(): Promise<void> {
  if (!directoryState || !indexCache) return
  await saveIndex(directoryState.directory, indexCache)
}

// --- 统计 ---

function computeStats(index: PlaybackCacheIndex): { usedBytes: number; entryCount: number } {
  let usedBytes = 0
  let entryCount = 0
  for (const entry of Object.values(index.entries)) {
    entryCount += 1
    usedBytes += entry.sizeBytes || 0
  }
  return { usedBytes, entryCount }
}

function buildInfo(
  dir: CacheDirectoryState,
  index: PlaybackCacheIndex,
  maxBytes: number,
  lastError?: string
): PlaybackCacheInfo {
  if (dir.location === 'unavailable') {
    return {
      available: false,
      directory: null,
      location: 'unavailable',
      maxBytes,
      usedBytes: 0,
      entryCount: 0,
      lastError: lastError ?? '当前环境不支持本地播放缓存'
    }
  }
  const stats = computeStats(index)
  return {
    available: true,
    directory: dir.directory,
    location: dir.location,
    maxBytes,
    usedBytes: stats.usedBytes,
    entryCount: stats.entryCount,
    lastError
  }
}

// --- 淘汰 ---

async function deleteEntryFiles(directory: string, entry: PlaybackCacheEntry): Promise<void> {
  const filePath = join(directory, entry.fileName)
  await rm(filePath, { force: true })
}

async function enforceLimit(
  directory: string,
  index: PlaybackCacheIndex,
  maxBytes: number
): Promise<void> {
  const stats = computeStats(index)
  if (stats.usedBytes <= maxBytes) return

  // 按 cachedAt 升序(最早缓存优先)删除,直到占用不超过上限或无条目可删。
  const sorted = Object.values(index.entries).sort((a, b) => a.cachedAt - b.cachedAt)
  let remaining = stats.usedBytes
  for (const entry of sorted) {
    if (remaining <= maxBytes) break
    await deleteEntryFiles(directory, entry)
    remaining -= entry.sizeBytes || 0
    delete index.entries[entry.key]
  }
}

// --- resolve ---

async function resolveCache(req: PlaybackCacheResolveRequest): Promise<PlaybackCacheResolveResult> {
  const ctx = await ensureIndex()
  if (!ctx) return { hit: false, reason: 'unavailable' }

  const key = buildPlaybackCacheKey(req.songId, req.level)
  const entry = ctx.index.entries[key]
  if (!entry) return { hit: false, reason: 'missing-index' }

  const filePath = join(ctx.dir.directory, entry.fileName)
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size === 0) {
      delete ctx.index.entries[key]
      await commitIndex()
      await rm(filePath, { force: true })
      return { hit: false, reason: info.size === 0 ? 'empty-file' : 'missing-file' }
    }
    // 命中:更新 lastAccessedAt(内存更新,下次写入时持久化)
    entry.lastAccessedAt = Date.now()
    return {
      hit: true,
      // 用自定义 muice-cache:// 协议而非 file://:renderer 从 http://localhost(dev)
      // 或 file://index.html(prod) 加载,跨源 file:// 资源会被 webSecurity 拒绝
      // (Not allowed to load local resource)。protocol.handle 在主进程读取文件
      // 并以流返回,绕过 renderer 同源限制。key 已是安全文件名(冒号→下划线)。
      sourceUrl: `muice-cache://cache/${encodeURIComponent(key)}`,
      key
    }
  } catch {
    delete ctx.index.entries[key]
    await commitIndex()
    return { hit: false, reason: 'missing-file' }
  }
}

/**
 * 供主进程 protocol handler 按 cache key 查文件路径。
 * 用于 muice-cache:// 协议:renderer 通过该协议播放本地缓存,避免直接 file://
 * 被 webSecurity 阻止。返回绝对路径或 null(条目缺失/文件无效)。
 */
export async function resolveCacheFileForKey(key: string): Promise<string | null> {
  const ctx = await ensureIndex()
  if (!ctx) return null
  const entry = ctx.index.entries[key]
  if (!entry) return null
  const filePath = join(ctx.dir.directory, entry.fileName)
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size === 0) return null
    return filePath
  } catch {
    return null
  }
}

// --- warm ---

async function warmCache(req: PlaybackCacheWarmRequest): Promise<PlaybackCacheWarmResult> {
  if (req.maxBytes <= 0) return { cached: false, reason: 'disabled' }
  const ctx = await ensureIndex()
  if (!ctx) return { cached: false, reason: 'unavailable' }

  const key = buildPlaybackCacheKey(req.songId, req.level)

  // 已存在且有效 → 直接返回命中
  const existing = ctx.index.entries[key]
  if (existing) {
    const existingPath = join(ctx.dir.directory, existing.fileName)
    try {
      const info = await stat(existingPath)
      if (info.isFile() && info.size > 0) {
        return { cached: true, key, sizeBytes: info.size }
      }
    } catch {
      // fall through to re-warm
    }
    delete ctx.index.entries[key]
  }

  const fileName = safeCacheFileName(key)
  const targetPath = join(ctx.dir.directory, fileName)
  const tempPath = `${targetPath}.tmp-${Date.now()}`
  let writeStream: ReturnType<typeof createWriteStream> | null = null

  try {
    const response = await fetch(req.remoteUrl, {
      headers: { Referer: 'https://music.163.com/' },
      signal: AbortSignal.timeout(300_000)
    })
    if (!response.ok) return { cached: false, reason: 'fetch-failed' }

    const totalHeader = response.headers.get('content-length')
    const totalBytes = totalHeader ? Number(totalHeader) : undefined
    if (totalBytes && Number.isFinite(totalBytes) && totalBytes > req.maxBytes) {
      return { cached: false, reason: 'too-large' }
    }

    writeStream = createWriteStream(tempPath, { flags: 'wx' })
    // 必须同步注册 error listener,否则 writeStream 的异步错误会逃逸为
    // 主进程 uncaught exception(try/catch 只能捕获同步错误与 awaited
    // rejection,捕获不到无 listener 的 'error' 事件)。
    let streamError: Error | null = null
    writeStream.on('error', (err: Error) => {
      streamError = err
    })
    let receivedBytes = 0

    if (response.body) {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (streamError) throw streamError
        const chunk = Buffer.from(value)
        receivedBytes += chunk.byteLength
        if (receivedBytes > req.maxBytes) {
          writeStream.destroy()
          await rm(tempPath, { force: true })
          return { cached: false, reason: 'too-large' }
        }
        if (!writeStream.write(chunk)) {
          await new Promise<void>((r) => writeStream!.once('drain', () => r()))
        }
        if (streamError) throw streamError
      }
    } else {
      const buffer = Buffer.from(await response.arrayBuffer())
      receivedBytes = buffer.byteLength
      if (receivedBytes > req.maxBytes) {
        writeStream.destroy()
        await rm(tempPath, { force: true })
        return { cached: false, reason: 'too-large' }
      }
      writeStream.write(buffer)
    }

    if (streamError) throw streamError
    await new Promise<void>((resolveP, rejectP) => {
      writeStream!.once('error', rejectP)
      writeStream!.end(() => {
        writeStream!.removeListener('error', rejectP)
        resolveP()
      })
    })
    writeStream = null

    if (receivedBytes === 0) {
      await rm(tempPath, { force: true })
      return { cached: false, reason: 'empty-file' }
    }

    await rm(targetPath, { force: true })
    await rename(tempPath, targetPath)

    const now = Date.now()
    ctx.index.entries[key] = {
      key,
      songId: req.songId,
      level: req.level,
      bitrate: req.bitrate,
      fileName: basename(targetPath),
      relativePath: fileName,
      sizeBytes: receivedBytes,
      cachedAt: now,
      lastAccessedAt: now,
      durationMs: req.durationMs,
      sourceExpiresAt: req.sourceExpiresAt
    }
    await enforceLimit(ctx.dir.directory, ctx.index, req.maxBytes)
    await commitIndex()

    return { cached: true, key, sizeBytes: receivedBytes }
  } catch {
    writeStream?.destroy()
    await rm(tempPath, { force: true })
    return { cached: false, reason: 'write-failed' }
  }
}

function warmDedup(req: PlaybackCacheWarmRequest): Promise<PlaybackCacheWarmResult> {
  const key = buildPlaybackCacheKey(req.songId, req.level)
  const existing = inflightWarms.get(key)
  if (existing) return existing
  const promise = warmCache(req).finally(() => {
    inflightWarms.delete(key)
  })
  inflightWarms.set(key, promise)
  return promise
}

// --- 公开 API ---

export async function getPlaybackCacheInfo(maxBytes: number): Promise<PlaybackCacheInfo> {
  const ctx = await ensureIndex()
  if (!ctx) return buildInfo({ directory: '', location: 'unavailable' }, emptyIndex(), maxBytes)
  return buildInfo(ctx.dir, ctx.index, maxBytes)
}

export async function resolvePlaybackCache(
  req: PlaybackCacheResolveRequest
): Promise<PlaybackCacheResolveResult> {
  try {
    return await resolveCache(req)
  } catch {
    return { hit: false, reason: 'unavailable' }
  }
}

export function warmPlaybackCache(req: PlaybackCacheWarmRequest): Promise<PlaybackCacheWarmResult> {
  return warmDedup(req)
}

export async function enforcePlaybackCacheLimit(maxBytes: number): Promise<PlaybackCacheInfo> {
  const ctx = await ensureIndex()
  if (!ctx) return buildInfo({ directory: '', location: 'unavailable' }, emptyIndex(), maxBytes)
  try {
    await enforceLimit(ctx.dir.directory, ctx.index, maxBytes)
    await commitIndex()
  } catch {
    // 尽力收敛,返回当前统计
  }
  return buildInfo(ctx.dir, ctx.index, maxBytes)
}

export async function clearPlaybackCache(maxBytes: number): Promise<PlaybackCacheInfo> {
  const ctx = await ensureIndex()
  if (!ctx) return buildInfo({ directory: '', location: 'unavailable' }, emptyIndex(), maxBytes)
  try {
    const entries = Object.values(ctx.index.entries)
    ctx.index.entries = {}
    for (const entry of entries) {
      await deleteEntryFiles(ctx.dir.directory, entry)
    }
    // 清理目录中可能的孤儿缓存文件
    const files = await readdir(ctx.dir.directory)
    for (const file of files) {
      if (file.endsWith(CACHE_FILE_SUFFIX)) {
        await rm(join(ctx.dir.directory, file), { force: true })
      }
    }
    await commitIndex()
  } catch {
    // 尽力清理
  }
  return buildInfo(ctx.dir, ctx.index, maxBytes)
}

export async function removePlaybackCacheEntry(
  key: string,
  maxBytes: number
): Promise<PlaybackCacheInfo> {
  const ctx = await ensureIndex()
  if (!ctx) return buildInfo({ directory: '', location: 'unavailable' }, emptyIndex(), maxBytes)
  try {
    const entry = ctx.index.entries[key]
    if (entry) {
      await deleteEntryFiles(ctx.dir.directory, entry)
      delete ctx.index.entries[key]
      await commitIndex()
    }
  } catch {
    // 尽力删除
  }
  return buildInfo(ctx.dir, ctx.index, maxBytes)
}

// 测试/重置内部状态(主进程内使用,目前无调用方,保留以备诊断)
export function resetPlaybackCacheState(): void {
  directoryState = null
  indexCache = null
  inflightWarms.clear()
}
