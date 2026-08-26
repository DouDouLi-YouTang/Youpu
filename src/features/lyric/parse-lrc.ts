import type { RawLine } from './types'

/**
 * Parse an LRC string into time-sorted lines.
 *
 * Handles:
 * - Multiple timestamps on one line (`[00:01.00][00:05.00]text` → two lines).
 * - 2- or 3-digit milliseconds (`.xx` → *10, `.xxx` → as-is), `:` or `.` separator.
 * - Drops metadata-only lines (`[ti:]`, `[ar:]`, `[al:]`, `[by:]`, `[offset:]`, …)
 *   and empty text.
 *
 * Returns `[]` for empty / unparseable input. Output is ascending by `timeMs`.
 */
const TIMESTAMP = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

export function parseLrc(lrc: string): RawLine[] {
  if (!lrc) return []

  const out: RawLine[] = []
  for (const rawLine of lrc.split(/\r?\n/)) {
    TIMESTAMP.lastIndex = 0
    const stamps: number[] = []
    let match: RegExpExecArray | null
    let lastEnd = 0
    while ((match = TIMESTAMP.exec(rawLine)) !== null) {
      const min = Number(match[1])
      const sec = Number(match[2])
      const fracRaw = match[3]
      let ms = 0
      if (fracRaw) {
        ms =
          fracRaw.length === 2 ? Number(fracRaw) * 10 : Number(fracRaw.padEnd(3, '0').slice(0, 3))
      }
      stamps.push((min * 60 + sec) * 1000 + ms)
      lastEnd = TIMESTAMP.lastIndex
    }
    if (stamps.length === 0) continue // metadata-only or untimed line

    const text = rawLine.slice(lastEnd).trim()
    if (!text) continue

    for (const timeMs of stamps) out.push({ timeMs, text })
  }

  out.sort((a, b) => a.timeMs - b.timeMs)
  return out
}
