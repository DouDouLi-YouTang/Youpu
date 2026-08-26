/**
 * 封面图片本地缓存(主进程)。
 *
 * 配合 muice-cover:// 自定义协议:renderer 通过 `muice-cover://<songId>?url=<encoded>`
 * 加载封面,本模块按 songId 缓存图片文件到 userData/cover-cache/<songId>.jpg,
 * 命中返回本地,未命中由协议 handler fetch 远程 URL 并写入缓存。断网时已缓存封面仍可显示。
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { app } from 'electron'

let coverDir: string | null = null

async function ensureCoverDir(): Promise<string | null> {
  if (coverDir) return coverDir
  try {
    const dir = join(app.getPath('userData'), 'cover-cache')
    await mkdir(dir, { recursive: true })
    coverDir = dir
    return dir
  } catch {
    return null
  }
}

/** 查询 songId 对应的本地封面路径;不存在/空文件返回 null。 */
export async function getCoverPath(songId: number): Promise<string | null> {
  const dir = await ensureCoverDir()
  if (!dir) return null
  const filePath = join(dir, `${songId}.jpg`)
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size === 0) return null
    return filePath
  } catch {
    return null
  }
}

/** 写入封面缓存。失败静默返回 null(不影响播放,仅不缓存)。 */
export async function saveCover(songId: number, buffer: Buffer): Promise<string | null> {
  const dir = await ensureCoverDir()
  if (!dir) return null
  const filePath = join(dir, `${songId}.jpg`)
  try {
    await writeFile(filePath, buffer)
    return filePath
  } catch {
    return null
  }
}
