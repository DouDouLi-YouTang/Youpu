import { ApiError, toApiError } from './errors'
import type { ApiResponse } from './types/response'

/**
 * 二维码登录轮询的业务态码。网易云的 800(过期)/801(等待扫码)/802(待确认)/803(授权成功)
 * 都是非 200 code，但它们是轮询的正常分支而非错误。requestWithCookie 在此白名单内放行，
 * 不抛 ApiError，把业务态交给 auth-service 用联合类型解读。
 */
const QR_FLOW_CODES = new Set([800, 801, 802, 803])

/**
 * 登录过期回调:api-client 检测到 UNAUTHORIZED 时调用,由 App.vue 注入
 * auth.handleUnauthorized(弹 Modal 引导重新登录)。用回调避免 api-client
 * 直接依赖 auth.store 形成循环依赖。
 */
let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn
}

export interface RequestResult<T> {
  data: T
  cookie?: string
}

/**
 * Default base URL for the local api-enhanced server started by `npm run dev`
 * via concurrently. Overridable through `VITE_API_BASE_URL`.
 */
const DEFAULT_BASE_URL = 'http://127.0.0.1:3000'

const DEFAULT_TIMEOUT_MS = 15_000

export interface RequestConfig {
  /** Path after baseURL, e.g. `/search`. Must start with `/`. */
  url: string
  method?: 'GET' | 'POST'
  /** Query params (GET) or JSON body (POST). */
  params?: Record<string, unknown>
  /** Request timeout in milliseconds. Defaults to 15000. */
  timeout?: number
  /** NetEase session cookie. Empty for public endpoints. */
  cookie?: string
  /**
   * Bypass the api-enhanced response cache (a 2-minute cache keyed on URL +
   * header-cookies, NOT on the request body). Appends a unique query param so
   * each call gets a fresh upstream read. Required for auth endpoints — login
   * status / QR polling must never read a stale cached state. The extra param
   * is ignored by the api-enhanced modules and never forwarded upstream.
   */
  noCache?: boolean
}

function resolveBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_BASE_URL
  return (fromEnv && fromEnv.trim()) || DEFAULT_BASE_URL
}

function toQueryParams(params: Record<string, unknown>): URLSearchParams {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    search.append(key, String(value))
  }
  return search
}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `req_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

// Monotonic-ish nonce for cache busting. The counter guards against collisions
// within the same millisecond (fast polling).
let nonceCounter = 0
function nextNonce(): string {
  nonceCounter = (nonceCounter + 1) % 1_000_000
  return `${Date.now()}${nonceCounter}`
}

/**
 * Shared fetch + parse + normalize logic. Returns the unwrapped body, the
 * response cookie (extracted from the body's `cookie` field, since cross-origin
 * fetch cannot read the `Set-Cookie` header), and the top-level business `code`.
 *
 * Does NOT throw on non-200 business codes — that policy is the caller's
 * responsibility (`request` throws, `requestWithCookie` whitelists QR flow codes).
 */
async function doRequest<T>(
  config: RequestConfig,
  requestId: string
): Promise<{ body: T; cookie?: string; bodyCode: number | undefined }> {
  const baseUrl = resolveBaseUrl()
  const method = config.method ?? 'GET'
  const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  // Cookie is passed as a query param for GET and in the JSON body for POST,
  // because api-enhanced assembles its `query` from req.query + req.body.
  const payload: Record<string, unknown> = { ...config.params }
  if (config.cookie) {
    payload.cookie = config.cookie
  }

  // No custom headers: the local api-enhanced server's CORS preflight only
  // allows `X-Requested-With,Content-Type`. A custom `X-Request-Id` would
  // trip the preflight and block every cross-origin request, so the request
  // id is kept purely for client-side error correlation (never sent).
  const headers: Record<string, string> = {}
  const init: RequestInit = { method, headers, signal: controller.signal }

  let targetUrl = `${baseUrl}${config.url}`
  if (method === 'GET') {
    const qs = toQueryParams(payload).toString()
    if (qs) targetUrl = `${targetUrl}?${qs}`
  } else {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(payload)
  }

  // Cache bust: api-enhanced keys its 2-minute cache on URL + header-cookies
  // (not the body), so same-route POSTs collide. A unique query param forces a
  // fresh read for auth endpoints. Appended last so it lands in the cache key.
  if (config.noCache) {
    const sep = targetUrl.includes('?') ? '&' : '?'
    targetUrl = `${targetUrl}${sep}_=${nextNonce()}`
  }

  let response: Response
  try {
    response = await fetch(targetUrl, init)
  } catch (error) {
    clearTimeout(timeoutId)
    throw toApiError(error, requestId)
  }
  clearTimeout(timeoutId)

  if (!response.ok) {
    // api-enhanced 把网易云业务错误(body.code)映射到了 HTTP 状态行(如 code:10004
    // -> HTTP 400)。这里先读 body,保留真实 code + message 交给 toApiError,否则会
    // 退化成"发生未知错误"这类无信息提示。解析失败再回退到 HTTP 状态。
    let errorBody: unknown
    try {
      errorBody = await response.json()
    } catch {
      errorBody = null
    }
    const b = errorBody as { code?: unknown; message?: unknown; msg?: unknown } | null
    const rawCode = b?.code
    const code = rawCode === null || rawCode === undefined ? undefined : Number(rawCode)
    const message =
      typeof b?.message === 'string' ? b.message : typeof b?.msg === 'string' ? b.msg : undefined
    if (code !== undefined && Number.isFinite(code) && code !== 200) {
      throw toApiError({ code, message }, requestId)
    }
    throw toApiError({ status: response.status }, requestId)
  }

  let parsed: unknown
  try {
    parsed = await response.json()
  } catch (error) {
    throw new ApiError({
      code: 'SERVER_ERROR',
      message: '服务器返回了无法解析的响应',
      status: response.status,
      raw: error,
      retryable: false,
      requestId
    })
  }

  // api-enhanced does NOT wrap responses consistently: the success path
  // (`res.send(moduleResponse.body)`) sends the raw NetEase body directly,
  // while the error path sends `{ status, body, cookie }`. Normalize both to
  // the NetEase body. NetEase signals success with a top-level `code === 200`.
  const body = (parsed as Partial<ApiResponse<T>>).body ?? (parsed as T)
  const bodyCode = (body as { code?: number }).code
  const cookie = (body as { cookie?: string }).cookie

  return { body, cookie, bodyCode }
}

/**
 * Low-level request function. Calls api-enhanced, unwraps the outer
 * `{ status, body, cookie }` envelope, checks `body.code === 200`, and returns
 * the typed `body`. Any failure is thrown as an `ApiError`.
 *
 * Endpoints call this with the DTO type and then map the result to a domain
 * model — stores and UI never see raw DTOs.
 */
export async function request<T>(config: RequestConfig): Promise<T> {
  const requestId = generateRequestId()
  const { body, bodyCode } = await doRequest<T>(config, requestId)

  if (typeof bodyCode === 'number' && bodyCode !== 200) {
    const b = body as { message?: string; msg?: string }
    throw toApiError({ code: bodyCode, message: b.message ?? b.msg }, requestId)
  }

  return body
}

/**
 * Cookie-aware request variant for auth endpoints. Behaves like `request` but:
 * 1. Returns `{ data, cookie }` so callers can capture the session cookie
 *    embedded in the NetEase body (cross-origin fetch can't read Set-Cookie).
 * 2. Whitelists `QR_FLOW_CODES` — 800/801/802/803 are normal QR polling
 *    states, not errors, so they are returned as data instead of thrown.
 *
 * All other non-200 business codes still throw `ApiError`, matching `request`.
 */
export async function requestWithCookie<T>(config: RequestConfig): Promise<RequestResult<T>> {
  const requestId = generateRequestId()
  let body: T
  let cookie: string | undefined
  let bodyCode: number | undefined
  try {
    const result = await doRequest<T>(config, requestId)
    body = result.body
    cookie = result.cookie
    bodyCode = result.bodyCode
  } catch (error) {
    // HTTP 层 401(doRequest 在 !response.ok 时抛):也触发登录过期回调
    if (error instanceof ApiError && error.code === 'UNAUTHORIZED') unauthorizedHandler?.()
    throw error
  }

  if (typeof bodyCode === 'number' && bodyCode !== 200 && !QR_FLOW_CODES.has(bodyCode)) {
    const b = body as { message?: string; msg?: string }
    const error = toApiError({ code: bodyCode, message: b.message ?? b.msg }, requestId)
    // 登录过期(301/-460):回调 handleUnauthorized 标记 expired,App.vue watch 弹 Modal
    if (error.code === 'UNAUTHORIZED') unauthorizedHandler?.()
    throw error
  }

  return { data: body, cookie }
}
