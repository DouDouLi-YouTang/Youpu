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
  // 版本更新已由 Electron 主进程的 api-server:check-update 负责。
  await require('./server').serveNcmApi({
    checkVersion: false,
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 3000),
  })
}
start().catch((error) => {
  console.error('[api-server] 启动失败:', error)
  process.exit(1)
})
