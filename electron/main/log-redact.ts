/**
 * 日志脱敏:抹掉后端日志里的登录凭据。
 *
 * 后端把完整请求 URL 写进日志(server.js 的 `Request Success: [eapi] ${req.originalUrl}`),
 * 而本项目把 cookie 作为 query 参数传给 api-enhanced —— MUSIC_U / __csrf 等会话凭据
 * 因此会以明文进入 userData/logs/api-server.log,并随用户反馈的日志外泄。
 * 这里只替换敏感键的值、保留周围结构,便于排查问题。
 *
 * 纯函数、无 Electron 依赖,可直接单测。
 */
const COOKIE_KEY = /\b(cookie)=[^&\s"']*/gi
/** URL 参数形态的 token / authorization。 */
const TOKEN_PARAM = /\b(token|authorization)=[^&\s"']*/gi
/** HTTP 头形态(`token: xxx` / `authorization: Bearer xxx`):值一直延伸到行尾。 */
const TOKEN_HEADER = /^(\s*(?:token|authorization)\s*:\s*).*$/gim
/** 网易云会话字段:MUSIC_U / MUSIC_R_U / MUSIC_A_T / MUSIC_R_T / NMTID / __csrf。 */
const NETEASE_KEY = /\b(__csrf|NMTID|MUSIC_[A-Z0-9_]+)=[^&;\s"']*/g
/** 手机号登录:query 里的 phone,以及日志里带区号的 `138****0000` 形态。 */
const PHONE_PARAM = /\b(phone|cellphone)=[^&\s"']*/gi
const PHONE_NUMBER = /(?<!\d)1[3-9]\d{9}(?!\d)/g
/** 失败响应里的 unikey 是一次性校验凭据。 */
const UNIKEY = /\b(unikey)\s*:\s*'[^']*'/gi

export function redactLogText(text: string): string {
  return text
    .replace(COOKIE_KEY, '$1=<已脱敏>')
    .replace(TOKEN_PARAM, '$1=<已脱敏>')
    .replace(TOKEN_HEADER, '$1<已脱敏>')
    .replace(NETEASE_KEY, '$1=<已脱敏>')
    .replace(PHONE_PARAM, '$1=<已脱敏>')
    .replace(PHONE_NUMBER, '<手机号已脱敏>')
    .replace(UNIKEY, "$1: '<已脱敏>'")
}

export interface LogLineForwarder {
  push: (chunk: string) => void
  flush: () => void
}

/**
 * 按「整行」脱敏后转发子进程输出。
 *
 * 必须按行缓冲:pipe 的一次 `data` 不保证落在行边界上,逐块脱敏时被切开的一条请求
 * URL 会有一半(如 MUSIC_U 的后半段)原样漏进日志。未遇到换行的尾部先扣住,等下一块
 * 补齐;流结束时调 flush 冲刷残余。
 */
export function createLogLineForwarder(write: (text: string) => void): LogLineForwarder {
  let pending = ''
  return {
    push(chunk: string): void {
      pending += chunk
      const lines = pending.split('\n')
      // 最后一段可能还没收完,留到下一块
      pending = lines.pop() ?? ''
      for (const line of lines) write(`${redactLogText(line)}\n`)
    },
    flush(): void {
      if (!pending) return
      write(redactLogText(pending))
      pending = ''
    }
  }
}
