// 本地更新源:托管 electron-builder 产物目录(dist/<version>/)供 autoUpdater 离线拉取。
// 配合环境变量 YOUPU_UPDATE_FEED_URL 使用(见 electron/main/updater.ts applyChannel)。
//
// 用法:
//   node scripts/serve-updates.mjs [目录] [端口]
//   目录默认 dist/<package.json 的 version>,端口默认 8080。
//
// 支持 HTTP Range 请求:NSIS 差分更新会按 blockmap 分段拉取安装包,必须返回 206。
import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const target = resolve(process.argv[2] || resolve(root, 'dist', pkg.version))
const port = Number(process.argv[3] || 8080)
const host = '127.0.0.1'

const MIME = {
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
  '.zip': 'application/zip',
  '.json': 'application/json; charset=utf-8'
}

function mimeFor(filePath) {
  return MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
}

const server = createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0])
  const rel = pathname.replace(/^\/+/, '')
  const filePath = normalize(join(target, rel))
  // 防目录穿越:解析后必须仍在目标目录内
  if (!filePath.startsWith(target)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('forbidden')
    return
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('not found: ' + pathname)
    return
  }

  const { size } = statSync(filePath)
  const mime = mimeFor(filePath)
  const range = req.headers.range

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (match) {
      const start = match[1] === '' ? 0 : parseInt(match[1], 10)
      const end = match[2] === '' ? size - 1 : Math.min(parseInt(match[2], 10), size - 1)
      if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + size })
        res.end()
        return
      }
      res.writeHead(206, {
        'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': mime
      })
      createReadStream(filePath, { start, end }).pipe(res)
      return
    }
  }

  res.writeHead(200, {
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
    'Content-Type': mime
  })
  createReadStream(filePath).pipe(res)
})

server.listen(port, host, () => {
  console.log('[update-serve] 目录:', target)
  console.log('[update-serve] 地址: http://' + host + ':' + port + '/')
  console.log('[update-serve] beta.yml: http://' + host + ':' + port + '/beta.yml')
  console.log(
    '[update-serve] 打包应用启动时设 YOUPU_UPDATE_FEED_URL=http://' +
      host +
      ':' +
      port +
      ' 即走本地源'
  )
})
