import { describe, expect, it } from 'vitest'

import { createLogLineForwarder, redactLogText } from './log-redact'

describe('redactLogText', () => {
  it('抹掉请求 URL 里的 cookie 查询参数值', () => {
    const line =
      '[INFO] Request Success: [eapi] /likelist?uid=1939786873&cookie=MUSIC_R_T=1565420819587;+Max-Age=2147483647;+MUSIC_U=00C307D8;+__csrf=923059e8;&_=17925065629312'
    const out = redactLogText(line)

    expect(out).not.toContain('MUSIC_U=00C307D8')
    expect(out).not.toContain('__csrf=923059e8')
    expect(out).toContain('cookie=<已脱敏>')
    // 非凭据部分照旧保留,否则日志失去排查价值
    expect(out).toContain('/likelist?uid=1939786873')
    expect(out).toContain('&_=17925065629312')
  })

  it('抹掉 HTTP 头形态的 token / authorization', () => {
    expect(redactLogText('authorization: Bearer abc.def')).not.toContain('abc.def')
    expect(redactLogText('token=abcdef123')).toBe('token=<已脱敏>')
  })

  it('单独出现的网易云会话字段也一并抹掉', () => {
    const out = redactLogText('Set-Cookie: MUSIC_A_T=1565420773893; Path=/')

    expect(out).not.toContain('1565420773893')
    expect(out).toContain('MUSIC_A_T=<已脱敏>')
    expect(out).toContain('Path=/')
  })

  it('抹掉手机号与一次性校验凭据', () => {
    const out = redactLogText(
      "  unikey: 'qrcode_login_verify_e6f4ebc4-7662',\n  msg: '手机号 13812345678 已被使用'"
    )

    expect(out).not.toContain('qrcode_login_verify_e6f4ebc4-7662')
    expect(out).not.toContain('13812345678')
    expect(out).toContain("unikey: '<已脱敏>'")
  })

  it('不含凭据的日志原样通过', () => {
    const line = '[INFO] Server started successfully @ http://127.0.0.1:3010'

    expect(redactLogText(line)).toBe(line)
  })

  it('一次调用处理多行日志', () => {
    const chunk =
      'Request Success: [weapi] /personalized?limit=30\nNMTID=00Os-fFcmmjySWqYUTfkDSajjiGCOoAAAGhWUYECA\n'
    const out = redactLogText(chunk)

    expect(out).toContain('/personalized?limit=30')
    expect(out).toContain('NMTID=<已脱敏>')
    expect(out).not.toContain('00Os-fFcmmjySWqYUTfkDSajjiGCOoAAAGhWUYECA')
  })
})

describe('createLogLineForwarder', () => {
  function collect(): { chunks: string[]; forwarder: ReturnType<typeof createLogLineForwarder> } {
    const chunks: string[] = []
    return { chunks, forwarder: createLogLineForwarder((text) => chunks.push(text)) }
  }

  it('凭据被 pipe 切成两块时也不会漏', () => {
    const { chunks, forwarder } = collect()

    forwarder.push('Request Success: /likelist?cookie=MUSIC_R_T=15654')
    expect(chunks).toEqual([])
    forwarder.push('20819587;+MUSIC_U=00C307\n')
    forwarder.flush()

    const out = chunks.join('')
    expect(out).not.toContain('1565420819587')
    expect(out).not.toContain('00C307')
    expect(out).toBe('Request Success: /likelist?cookie=<已脱敏>\n')
  })

  it('末尾没有换行的残余在 flush 时补出', () => {
    const { chunks, forwarder } = collect()

    forwarder.push('token=abcdef')
    expect(chunks).toEqual([])
    forwarder.flush()

    expect(chunks.join('')).toBe('token=<已脱敏>')
  })

  it('多行块逐行转发,不合并', () => {
    const { chunks, forwarder } = collect()

    forwarder.push('a\nb\n')
    forwarder.flush()

    expect(chunks).toEqual(['a\n', 'b\n'])
  })
})
