export function structuredLogger(service: string) {
  function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, meta?: Record<string, unknown>) {
    const entry = {
      service,
      level,
      message,
      timestamp: new Date().toISOString(),
      ...meta,
    }
    if (level === 'error') {
      console.error(JSON.stringify(entry))
    } else if (level === 'warn') {
      console.warn(JSON.stringify(entry))
    } else {
      console.log(JSON.stringify(entry))
    }
  }

  return {
    info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
    debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
  }
}