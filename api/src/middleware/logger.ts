import type { MiddlewareHandler } from 'hono'
import { structuredLogger } from '../lib/logger'

const logger = structuredLogger('http')

export function requestLogger(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now()
    const requestId = crypto.randomUUID()

    c.set('requestId', requestId)

    logger.info('request started', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      userAgent: c.req.header('user-agent'),
    })

    await next()

    const elapsed = Date.now() - start
    logger.info('request completed', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      elapsedMs: elapsed,
    })
  }
}