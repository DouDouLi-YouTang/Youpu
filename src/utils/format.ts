/**
 * Small framework-independent formatting helpers shared across pages and
 * components.
 */

/**
 * Format a duration in milliseconds as `m:ss` (or `h:mm:ss` for long tracks).
 * Returns `0:00` for invalid input.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  const ss = String(seconds).padStart(2, '0')

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * Compact number formatting for play counts etc. (e.g. 12345 -> "1.2万").
 * Returns `0` for invalid input.
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 10000) return String(n)
  if (n < 100_000_000) {
    return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万`
  }
  return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, '')}亿`
}

/**
 * Format an epoch-ms timestamp as a Chinese relative time string. Useful for
 * comments, where exact dates are noise but recency matters:
 *
 *   < 1 min   → "刚刚"
 *   < 1 hour  → "X 分钟前"
 *   < 1 day   → "X 小时前"
 *   < 7 days  → "X 天前"
 *   < 1 year  → "MM-DD"
 *   else      → "YYYY-MM-DD"
 *
 * Returns an empty string for invalid input rather than the epoch itself.
 */
export function formatRelativeTime(ms: number, now: number = Date.now()): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const diff = now - ms
  if (diff < 0) return '刚刚'

  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  const year = 365 * day

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < week) return `${Math.floor(diff / day)} 天前`

  const date = new Date(ms)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  if (diff < year) return `${mm}-${dd}`
  return `${date.getFullYear()}-${mm}-${dd}`
}
