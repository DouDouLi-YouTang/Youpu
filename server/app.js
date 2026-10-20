#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const tmpPath = require('os').tmpdir()

async function start() {
  // 检测是否存在 anonymous_token 文件,没有则生成
  if (!fs.existsSync(path.resolve(tmpPath, 'anonymous_token'))) {
    fs.writeFileSync(path.resolve(tmpPath, 'anonymous_token'), '', 'utf-8')
  }
  // 启动时更新anonymous_token
  const generateConfig = require('./generateConfig')
  await generateConfig()
  // Desktop 打包/本地一体启动: 关闭 npm 版本检查。
  // checkVersion 会 exec `npm info ...` 且无超时, 在桌面端(尤其国内网络 / 无 npm PATH)
  // 会卡住 serveNcmApi 的 Promise.all, 端口永远不 listen, 前端表现为“后端连不上”。
  // 版本不在此处检查：后端随应用安装包一起更新（2026-10-20 起不再有在线更新）。
  await require('./server').serveNcmApi({
    checkVersion: false,
    host: process.env.HOST || '127.0.0.1',
    // Desktop 默认端口由 config/api-server.json 经启动器注入；这里保留 3000
    // 只是独立运行 vendored server 时的历史默认值。
    port: Number(process.env.PORT || 3000),
  })
}
start().catch((error) => {
  console.error('[api-server] 启动失败:', error)
  process.exit(1)
})
