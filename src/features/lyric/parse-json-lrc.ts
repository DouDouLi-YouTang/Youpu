import type { RawLine } from './types'

/**
 * 网易云 /api/song/lyric/v1 返回的 lrc/yrc 字段是新版富文本 JSON 格式,
 * 不是传统 LRC/YRC 文本。逐行 `{"t":开始ms,"c":[{"tx":"字片段","li"?,"or"?}]}`,
 * c 数组各 tx 拼接得到该行文字。
 *
 * 这种行内没有逐字时间戳,但可作为行级歌词使用(对照参考项目用 lrc 的方式)。
 *
 * 解码步骤:
 * 1. 按 \n 拆成行,空行跳过
 * 2. 每行 JSON.parse → 取 t(ms)和 tx 拼接
 * 3. 异常行(JSON 解析失败)按备选规则尽力补:
 *    - 若长度 < 行级 12 行(开头元信息行可能不在 JSON 里)尝试正则提取
 *      `[mm:ss.xx]text` 兼容旧格式
 *
 * 返回与 parseLrc 一致的 RawLine[],按 timeMs 升序。
 */
const TIMESTAMP_FALLBACK = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/
/** 拉丁字母/数字:英文歌词、罗马音词边界判定 */
const LATIN_OR_DIGIT = /[A-Za-z0-9]/

function toMs(minStr: string, secStr: string, fracRaw?: string): number {
  const min = Number(minStr)
  const sec = Number(secStr)
  let ms = 0
  if (fracRaw) {
    ms = fracRaw.length === 2 ? Number(fracRaw) * 10 : Number(fracRaw.padEnd(3, '0').slice(0, 3))
  }
  return (min * 60 + sec) * 1000 + ms
}

/**
 * 拼接 JSON 歌词 `c[].tx` 片段。
 *
 * 网易云元信息/部分翻译行会把英文拆成多段且 **不带词间空格**:
 *   `[{"tx":"Hello"},{"tx":"World"}]` → 硬 join 会得到 `HelloWorld`。
 * 中文片段本就不该插空格,故仅在「两侧都是拉丁字母/数字、且两侧都没有空白」时补一个空格。
 * 已含首尾空格的片段(如 `"作曲: "`)保持原样,不会重复插空。
 */
export function joinJsonLyricSegments(segments: Array<{ tx?: string } | null | undefined>): string {
  let out = ''
  for (const seg of segments) {
    const tx = seg?.tx ?? ''
    if (!tx) continue
    if (
      out.length > 0 &&
      !/\s$/.test(out) &&
      !/^\s/.test(tx) &&
      LATIN_OR_DIGIT.test(out[out.length - 1]!) &&
      LATIN_OR_DIGIT.test(tx[0]!)
    ) {
      out += ' '
    }
    out += tx
  }
  return out.trim()
}

export function parseJsonLrc(raw: string): RawLine[] {
  if (!raw) return []
  const out: RawLine[] = []
  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue

    // 优先按 JSON 解析
    try {
      const obj = JSON.parse(trimmed) as { t?: number; c?: Array<{ tx?: string }> }
      if (typeof obj.t === 'number' && Array.isArray(obj.c)) {
        const text = joinJsonLyricSegments(obj.c)
        if (!text) continue
        out.push({ timeMs: obj.t, text })
        continue
      }
    } catch {
      // 不是 JSON,试 LRC 时间戳回退
    }

    // 回退:标准 LRC 行格式
    const m = trimmed.match(TIMESTAMP_FALLBACK)
    if (!m) continue
    const text = trimmed.slice(m[0].length).trim()
    if (!text) continue
    out.push({ timeMs: toMs(m[1], m[2], m[3]), text })
  }
  out.sort((a, b) => a.timeMs - b.timeMs)
  return out
}
