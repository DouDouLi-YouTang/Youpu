// 将 server/node_modules 流式压缩为单个 zip 供 extraResources 打包。
// node_modules 含 1.5 万+小文件,NSIS 安装/卸载逐文件处理极慢;压成单文件后
// 安装包文件数骤降,首启时由主进程 ensureServerNodeModules 解压还原。
// zip 内顶层即 node_modules 内容(非 node_modules/ 目录层),解压目标为 server/node_modules。
// 原实现用 adm-zip 一次性读入内存(143MB/1.5万文件,CI 默认 2GB 堆会 OOM);
// 改为 archiver 流式写入,内存占用恒定。
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { finished } from 'node:stream/promises'
import { ZipArchive } from 'archiver'

const root = process.cwd()
const modulesDir = join(root, 'server', 'node_modules')
const outZip = join(root, 'build', 'server-node-modules.zip')

if (!existsSync(modulesDir)) {
  console.error('[pack-modules] server/node_modules 不存在,请先执行 npm run server:install')
  process.exit(1)
}

// 压缩前先剔除符号链接。
// CI 上执行 `npm install --prefix server` 会把根包链接成 server/node_modules/youpu
// (指向仓库根目录)。该链接一旦打进 zip、解压进安装目录,NSIS 卸载旧版本时的
// un.atomicRMDir 就会跨盘"改名"失败并沿链接无限递归(实测把更新卡死几十分钟),
// 最终报「卸载失败」。安装目录内不允许出现符号链接。
const strippedLinks = []
function stripSymlinks(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      try {
        rmSync(full, { recursive: true, force: true })
        strippedLinks.push(full.slice(root.length + 1))
      } catch (error) {
        console.warn('[pack-modules] 警告(符号链接删除失败):', full, error.message)
      }
      continue
    }
    if (entry.isDirectory()) stripSymlinks(full)
  }
}
stripSymlinks(modulesDir)
if (strippedLinks.length > 0) {
  console.warn(
    `[pack-modules] 已剔除 ${strippedLinks.length} 个符号链接(打进安装包会导致更新时卸载失败):`
  )
  for (const link of strippedLinks) console.warn('  - ' + link)
} else {
  console.log('[pack-modules] 未发现符号链接')
}

mkdirSync(join(root, 'build'), { recursive: true })

const output = createWriteStream(outZip)
const outputDone = finished(output)
const archive = new ZipArchive({ zlib: { level: 9 } })

archive.on('warning', (err) => {
  if (err.code === 'ENOENT') {
    console.warn('[pack-modules] 警告(文件已不存在,已跳过):', err.message)
  } else {
    throw err
  }
})
archive.on('error', (err) => {
  throw err
})

archive.pipe(output)

// 第二个参数 false:内容平铺到 zip 根(与 adm-zip.addLocalFolder 行为一致)
archive.directory(modulesDir, false)

await archive.finalize()
await outputDone
console.log(`[pack-modules] 已生成 ${outZip} (${archive.pointer()} bytes)`)
