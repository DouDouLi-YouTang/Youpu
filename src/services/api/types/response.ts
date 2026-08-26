/**
 * Outer envelope returned by every api-enhanced endpoint. The real NetEase
 * response lives in `body` (which itself carries a `code` field). `cookie`
 * is the session cookie set by the upstream call and is ignored by the
 * renderer for now.
 */
export interface ApiResponse<T> {
  status: number
  body: T
  cookie: unknown[]
}
