type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function shouldLog(level: LogLevel): boolean {
  const configuredLevel = import.meta.env.VITE_LOG_LEVEL ?? 'debug'
  const order: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
  }

  return order[level] >= order[configuredLevel as LogLevel]
}

export const logger = {
  debug(message: string, context?: unknown): void {
    if (shouldLog('debug')) console.debug(message, context)
  },
  info(message: string, context?: unknown): void {
    if (shouldLog('info')) console.info(message, context)
  },
  warn(message: string, context?: unknown): void {
    if (shouldLog('warn')) console.warn(message, context)
  },
  error(message: string, context?: unknown): void {
    if (shouldLog('error')) console.error(message, context)
  }
}
