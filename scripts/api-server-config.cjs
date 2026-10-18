/**
 * 内嵌 API 服务的端口配置读取器。
 *
 * 唯一配置源是仓库根的 `config/api-server.json`；开发后端、Electron 健康探活、
 * 渲染层请求地址都从这里派生。打包后脚本位于 `resources/scripts/`，配置位于
 * `resources/config/`，两者的相对位置不变。
 *
 * `YOUPU_API_HOST` / `YOUPU_API_PORT` 只用于临时覆盖（例如同时在两个工作区跑 dev），
 * 不写进仓库配置。
 */
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 3000

function parsePort(raw) {
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return port
}

function readApiServerConfig(rootDir = path.resolve(__dirname, '..')) {
  let fileConfig = {}
  try {
    fileConfig = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'config', 'api-server.json'), 'utf-8')
    )
  } catch (error) {
    console.warn(
      '[api-server-config] 读取 config/api-server.json 失败，使用默认端口 3000:',
      error.message
    )
  }

  const host =
    process.env.YOUPU_API_HOST?.trim() ||
    (typeof fileConfig.host === 'string' ? fileConfig.host.trim() : '') ||
    DEFAULT_HOST
  const port = parsePort(process.env.YOUPU_API_PORT) ?? parsePort(fileConfig.port) ?? DEFAULT_PORT

  return { host, port }
}

module.exports = { readApiServerConfig }
