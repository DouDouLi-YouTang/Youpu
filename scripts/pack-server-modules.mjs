// 将 server/node_modules 流式压缩为单个 zip 供 extraResources 打包。
// node_modules 含 1.5 万+小文件,NSIS 安装/卸载逐文件处理极慢;压成单文件后
// 安装包文件数骤降,首启时由主进程 ensureServerNodeModules 解压还原。
// zip 内顶层即 node_modules 内容(非 node_modules/ 目录层),解压目标为 server/node_modules。
// 原实现用 adm-zip 一次性读入内存(143MB/1.5万文件,CI 默认 2GB 堆会 OOM);
// 改为 archiver 流式写入,内存占用恒定。
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
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
