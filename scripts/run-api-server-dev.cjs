#!/usr/bin/env node
/**
 * 开发模式的后端启动器。
 *
 * 不直接复用 `server:dev` 的 cross-env 字符串：端口来自 `config/api-server.json`，
 * 而 npm script 里的环境变量无法读取 JSON。这里统一解析后注入 PORT/HOST，再启动
 * 项目内 vendored 的 api-enhanced，避免三处各写一个默认端口。
 */
const path = require('node:path')
const { spawn } = require('node:child_process')
const { readApiServerConfig } = require('./api-server-config.cjs')

const projectRoot = path.resolve(__dirname, '..')
const { host, port } = readApiServerConfig(projectRoot)
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
/**
 * NODE_OPTIONS 由 Node 自己再按命令行语法解析一遍：Windows 路径里的反斜杠会被
 * 当成转义符吃掉（实测 `F:\Work\...` 变成 `F:Work...`），所以这里统一转成
 * 正斜杠。Node 在 Windows 上接受正斜杠路径。
 */
const dnsPreload = path.join(__dirname, 'netease-dns-preload.cjs').replace(/\\/g, '/')

const nodeOptions = [
  process.env.NODE_OPTIONS,
  `--require "${dnsPreload}"`,
  '--dns-result-order=ipv4first'
].filter(Boolean)

const child = spawn(npmCommand, ['run', '--prefix', 'server', 'start'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    HOST: host,
    PORT: String(port),
    NODE_OPTIONS: nodeOptions.join(' '),
    NPM_CONFIG_FETCH_TIMEOUT: '5000',
    NPM_CONFIG_FETCH_RETRIES: '0'
  },
  stdio: 'inherit',
  windowsHide: true,
  // Windows 上 npm 是 .cmd，Node 18+ 不能直接 spawn，需要 shell 解析。
  shell: process.platform === 'win32'
})

function forwardSignal(signal) {
  if (!child.killed) child.kill(signal)
}

process.once('SIGINT', () => forwardSignal('SIGINT'))
process.once('SIGTERM', () => forwardSignal('SIGTERM'))

child.once('error', (error) => {
  console.error('[api-server-dev] 启动失败:', error)
  process.exit(1)
})

child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
