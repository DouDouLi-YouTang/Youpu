/**
 * Unified error model for the API layer. Every failure that crosses the
 * `api-client` boundary is normalized into an `ApiError` so that stores and
 * UI only ever deal with a stable, user-actionable shape.
 *
 */

export type ApiErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'COPYRIGHT_RESTRICTED'
  | 'VIP_REQUIRED'
  | 'SERVER_ERROR'
  | 'UNKNOWN'

export interface ApiErrorOptions {
  code: ApiErrorCode
  message: string
  status?: number
  raw?: unknown
  retryable?: boolean
  requestId?: string
}

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status?: number
  readonly raw?: unknown
  readonly retryable: boolean
  readonly requestId?: string

  constructor(options: ApiErrorOptions) {
    super(options.message)
    this.name = 'ApiError'
    this.code = options.code
    this.status = options.status
    this.raw = options.raw
    this.retryable = options.retryable ?? false
    this.requestId = options.requestId
  }
}

/**
 * Map a NetEase business `code` (the `code` field inside `body`) to an
 * `ApiErrorCode`. `200` is success and should not reach here.
 */
function codeFromBusinessCode(code: number): { code: ApiErrorCode; retryable: boolean } {
  switch (code) {
    case 301:
    case -460:
      return { code: 'UNAUTHORIZED', retryable: false }
    case 701:
      return { code: 'COPYRIGHT_RESTRICTED', retryable: false }
    case 702:
      return { code: 'VIP_REQUIRED', retryable: false }
    case 404:
      return { code: 'NOT_FOUND', retryable: false }
    default:
      return { code: 'SERVER_ERROR', retryable: false }
  }
}

/**
 * Map an HTTP status code to an `ApiErrorCode`. Only called when the server
 * responded with a non-2xx status.
 */
function codeFromHttpStatus(status: number): { code: ApiErrorCode; retryable: boolean } {
  if (status === 401) return { code: 'UNAUTHORIZED', retryable: false }
  if (status === 403) return { code: 'FORBIDDEN', retryable: false }
  if (status === 404) return { code: 'NOT_FOUND', retryable: false }
  if (status === 429) return { code: 'RATE_LIMITED', retryable: true }
  if (status >= 500) return { code: 'SERVER_ERROR', retryable: true }
  return { code: 'UNKNOWN', retryable: false }
}

export interface NormalizedApiError {
  code: ApiErrorCode
  message: string
  status?: number
  raw?: unknown
  retryable: boolean
  requestId?: string
}

/**
 * Convert any thrown value into a normalized `ApiError`. Accepts:
 *  - an existing `ApiError` (passed through)
 *  - an `Error` with `name === 'TimeoutError'` / an AbortController timeout
 *  - a `TypeError` (fetch network failure)
 *  - a value carrying an HTTP `status`
 *  - a value carrying a NetEase business `body.code`
 *  - anything else → `UNKNOWN`
 */
export function toApiError(error: unknown, requestId?: string): ApiError {
  if (error instanceof ApiError) {
    return error
  }

  // AbortController / fetch timeout.
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new ApiError({
      code: 'TIMEOUT',
      message: '请求超时，请稍后重试',
      retryable: true,
      requestId
    })
  }

  if (error instanceof Error) {
    // fetch throws TypeError on network failure.
    if (error.name === 'TypeError' || error.constructor.name === 'TypeError') {
      return new ApiError({
        code: 'NETWORK_ERROR',
        message: '网络连接失败，请检查网络或后端服务',
        retryable: true,
        raw: error,
        requestId
      })
    }

    if (error.name === 'TimeoutError') {
      return new ApiError({
        code: 'TIMEOUT',
        message: '请求超时，请稍后重试',
        retryable: true,
        raw: error,
        requestId
      })
    }
  }

  // Objects carrying an HTTP status (from our own fetch path).
  if (error && typeof error === 'object' && 'status' in error) {
    const status = Number((error as { status: unknown }).status)
    if (Number.isFinite(status)) {
      const { code, retryable } = codeFromHttpStatus(status)
      return new ApiError({
        code,
        message: humanMessageForCode(code),
        status,
        retryable,
        raw: error,
        requestId
      })
    }
  }

  // Objects carrying a NetEase business code.
  if (error && typeof error === 'object' && 'code' in error) {
    const businessCode = Number((error as { code: unknown }).code)
    if (Number.isFinite(businessCode) && businessCode !== 200) {
      const { code, retryable } = codeFromBusinessCode(businessCode)
      const rawMessage = (error as { message?: unknown }).message
      return new ApiError({
        code,
        message:
          typeof rawMessage === 'string' && rawMessage.trim()
            ? rawMessage
            : humanMessageForCode(code),
        status: businessCode,
        retryable,
        raw: error,
        requestId
      })
    }
  }

  const message = error instanceof Error ? error.message : '发生未知错误'
  return new ApiError({
    code: 'UNKNOWN',
    message,
    retryable: false,
    raw: error,
    requestId
  })
}

function humanMessageForCode(code: ApiErrorCode): string {
  switch (code) {
    case 'NETWORK_ERROR':
      return '网络连接失败，请检查网络或后端服务'
    case 'TIMEOUT':
      return '请求超时，请稍后重试'
    case 'UNAUTHORIZED':
      return '登录已过期，请重新登录'
    case 'FORBIDDEN':
      return '没有权限访问该资源'
    case 'NOT_FOUND':
      return '未找到请求的资源'
    case 'RATE_LIMITED':
      return '请求过于频繁，请稍后再试'
    case 'COPYRIGHT_RESTRICTED':
      return '因版权限制，该内容不可用'
    case 'VIP_REQUIRED':
      return '需要开通 VIP 才可访问'
    case 'SERVER_ERROR':
      return '服务器出错，请稍后重试'
    case 'UNKNOWN':
    default:
      return '发生未知错误'
  }
}
