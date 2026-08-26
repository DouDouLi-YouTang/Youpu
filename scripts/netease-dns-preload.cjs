/**
 * DNS preload for the api-enhanced server process.
 *
 * 背景: 本机系统 DNS (路由器) 对 NetEase 音乐域名只返回 IPv6 (AAAA) 记录,
 * 而该 IPv6 地址在本网络不可达; 外部 DNS (223.5.5.5 / 8.8.8.8) 的 UDP 53 又被屏蔽。
 * 因此 `--dns-result-order=ipv4first` 无效 (没有 IPv4 记录可优先), Node 解析到的
 * IPv6 全部 ENOTFOUND / 不可达。
 *
 * 本脚本通过 `NODE_OPTIONS=--require ./scripts/netease-dns-preload.cjs` 注入,
 * 不修改 `server/` 仓库源码。它做两件事:
 *   1. dns.setDefaultResultOrder('ipv4first') —— 兜底,若 DNS 偶发返回双栈则优先 IPv4。
 *   2. 劫持 dns.lookup: 对 NetEase 域名直接返回硬编码可达 IPv4 (111.124.200.67),
 *      其余域名回退原生 lookup,保持 verbatim 语义。
 *
 * 注意: 仅用于本地开发环境 (npm run dev)。生产/CI 不应依赖硬编码 IP。
 */
const dns = require('dns')

// 硬编码 NetEase 域名 -> 可达 IPv4。该 IP 在本网络稳定可达 (ping 26ms, https 200)。
// 如未来该 IP 失效,可通过 `NETEASE_IPV4` 环境变量覆盖,或在此更新。
const NETEASE_IPV4 = process.env.NETEASE_IPV4 || '111.124.200.67'
const NETEASE_DOMAINS = new Set([
  'interface.music.163.com',
  'interface3.music.163.com',
  'interface2.music.163.com',
  'interface9.music.163.com',
  'music.163.com'
])

try {
  dns.setDefaultResultOrder('ipv4first')
} catch {
  /* 旧版本 Node 可能不支持,忽略 */
}

const originalLookup = dns.lookup

/**
 * 劫持后的 lookup。签名兼容 Node 原生 dns.lookup(hostname, options, callback)。
 * 对 NetEase 域名直接回调硬编码 IPv4; 否则委托给原生 lookup。
 */
function patchedLookup(hostname, options, callback) {
  // 归一化参数: dns.lookup 允许 (hostname, callback) 或 (hostname, options, callback)
  if (typeof options === 'function') {
    callback = options
    options = {}
  }
  const opts = typeof options === 'number' ? { family: options } : options || {}

  const name = String(hostname).toLowerCase()
  if (NETEASE_DOMAINS.has(name)) {
    const family = opts.family
    // family=6 强制 IPv6 时不应劫持 (但我们网络 IPv6 不可达,此处保留原生行为以便诊断)
    if (family !== 6) {
      const addr = NETEASE_IPV4
      if (opts.all) {
        return process.nextTick(() => callback(null, [{ address: addr, family: 4 }]))
      }
      return process.nextTick(() => callback(null, addr, 4))
    }
  }

  return originalLookup.call(dns, hostname, options, callback)
}

// 替换 dns.lookup (同步属性描述符, 避免getter问题)
try {
  Object.defineProperty(dns, 'lookup', {
    value: patchedLookup,
    writable: true,
    configurable: true,
    enumerable: true
  })
} catch {
  /* 若不可配置则忽略 */
}

// 提示信息输出到 stderr, 不干扰 server 正常 stdout
process.stderr.write(
  `[netease-dns-preload] active: NetEase domains -> ${NETEASE_IPV4} (ipv4first)\n`
)
