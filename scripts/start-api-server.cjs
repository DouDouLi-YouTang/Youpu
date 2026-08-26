#!/usr/bin/env node
/**
 * 打包后 Electron 主进程 fork 的后端入口。
 *
 * 故意放在 resources/scripts/ 而非 server/ 下:
 * - 应用内「后端在线更新」会整体替换 server/ 目录(保留 node_modules)
 * - 上游 api-enhanced 的 app.js 默认 checkVersion:true,会 exec 无超时的 `npm info`,
 *   在桌面端(无 npm / 国内网络)卡住 Promise.all,端口永远不 listen
 * - 本脚本固定 checkVersion:false 并监听 127.0.0.1,与前端 DEFAULT_BASE_URL 对齐
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

const serverDir = path.resolve(__dirname, '..', 'server')
const tmpPath = os.tmpdir()

async function start() {
  process.chdir(serverDir)
  // 让 require('./server') 等相对路径按 server 目录解析
  module.paths.unshift(path.join(serverDir, 'node_modules'))

  if (!fs.existsSync(path.resolve(tmpPath, 'anonymous_token'))) {
    fs.writeFileSync(path.resolve(tmpPath, 'anonymous_token'), '', 'utf-8')
  }

  // generateConfig / server 使用 server 目录下的相对 require
  const generateConfig = require(path.join(serverDir, 'generateConfig.js'))
  await generateConfig()

  const { serveNcmApi } = require(path.join(serverDir, 'server.js'))
  await serveNcmApi({
    checkVersion: false,
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 3000)
  })
}

start().catch((error) => {
  console.error('[api-server] 启动失败:', error)
  process.exit(1)
})
