/**
 * url 模式的 URL 校验与列表管理 —— 规格 §7.3（Folia `src/utils/urlBackground.ts`）的算法重写。
 *
 * 安全边界（为什么只放行 http/https）：iframe 会把任意页面拉进渲染进程。
 * `file:` / `javascript:` / `data:` / 自定义协议（如本仓库的 `muice-file://`）一律拒绝 ——
 * 它们要么能读本地文件、要么能执行脚本，作为「背景图源」没有任何正当用途。
 *
 * 这些函数是纯函数，可在 node 环境直接单测。
 */

import type { FoliaUrlBackgroundItem } from '../types'

/** 校验并规范化：补 https:// → `new URL()` → 只接受 http/https。 */
export function normalizeUrlBackgroundUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  /*
   * ⚠️ 补协议这一步**必须先判「有没有 scheme」**，不能只看有没有 `://`。
   *
   * `javascript:alert(1)` 里没有 `://`，照 Folia 的写法会被补成
   * `https://javascript:alert(1)` —— 解析成 host=`javascript`、port 非法…
   * 更糟的是 `javascript:1` 会被 `new URL()` 收下成合法 https URL，
   * 于是「只放行 http/https」这条白名单被绕过（本仓库单测就是抓这个的）。
   * 判定用 RFC 3986 的 scheme 形状：`ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"`。
   */
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  const candidate = hasScheme ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

/** 单项清洗：id 非空 + url 合法；note 为空时回退成 url。 */
export function sanitizeUrlBackgroundItem(value: unknown): FoliaUrlBackgroundItem | null {
  if (!value || typeof value !== 'object') return null

  const item = value as Partial<FoliaUrlBackgroundItem>
  const id = typeof item.id === 'string' ? item.id.trim() : ''
  const url = normalizeUrlBackgroundUrl(item.url)
  if (!id || !url) return null

  const note = typeof item.note === 'string' && item.note.trim() ? item.note.trim() : url
  return { id, url, note }
}

/**
 * 按 id 合并（导入的项覆盖同 id 的 url/note，**不删除已有项**）。
 *
 * 为什么只增不减：这个函数服务于「导入配置」—— 确认框承诺的是「加上这些」，
 * 如果顺手删掉本地已有的项，用户按一次导入就丢一批背景。
 */
export function mergeUrlBackgroundList(
  current: FoliaUrlBackgroundItem[],
  incoming: unknown
): FoliaUrlBackgroundItem[] {
  const merged = new Map(current.map((item) => [item.id, { ...item }]))

  if (Array.isArray(incoming)) {
    for (const raw of incoming) {
      const sanitized = sanitizeUrlBackgroundItem(raw)
      if (!sanitized) continue
      merged.set(sanitized.id, {
        ...(merged.get(sanitized.id) ?? { id: sanitized.id }),
        url: sanitized.url,
        note: sanitized.note
      })
    }
  }

  return Array.from(merged.values())
}

/** 列表清洗：非数组 → `[]`，逐项 sanitize，按首次出现的 id 去重。 */
export function sanitizeUrlBackgroundList(items: unknown): FoliaUrlBackgroundItem[] {
  if (!Array.isArray(items)) return []

  const next: FoliaUrlBackgroundItem[] = []
  const seenIds = new Set<string>()
  for (const item of items) {
    const sanitized = sanitizeUrlBackgroundItem(item)
    if (!sanitized || seenIds.has(sanitized.id)) continue
    seenIds.add(sanitized.id)
    next.push(sanitized)
  }
  return next
}
