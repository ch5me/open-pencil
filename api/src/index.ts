import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './env'
import { initSentry } from './sentry'
import { runMigrations } from './db/migrate'
import { requestLogger } from './middleware/logger'
import { createBetterAuth } from './auth/better-auth'
import { createDocumentsRouter } from './routes/documents'
import { createSharingRouter } from './routes/sharing'
import { createAiRouter } from './routes/ai'
import { createCollabRouter } from './routes/collab'
import { DocumentRoomDO } from './collab/DocumentRoomDO'

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors({
  origin: (origin) => origin,
  credentials: true,
}))

app.use('*', async (c, next) => {
  await initSentry(c.env)
  await next()
})

app.use('*', requestLogger())

app.get('/health', (c) => c.json({ status: 'ok' }))

app.get('/api/version', (c) => {
  const meta = c.env.VERSION_METADATA
  return c.json({
    version: meta?.version ?? '0.0.0',
    deployedAt: meta?.deployedAt ?? 'unknown',
    stage: meta?.deployedAt ? 'production' : 'development',
  })
})

app.post('/api/auth/sign-up', async (c) => {
  const betterAuth = createBetterAuth(c.env.DB, {
    RESEND_API_KEY: c.env.RESEND_API_KEY,
    PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
  })
  const body = await c.req.json<{ email: string; password: string; name?: string }>()
  return betterAuth.handler(new Request(new URL('/sign-up/email', c.req.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: body.email, password: body.password, name: body.name }),
  }))
})

app.post('/api/auth/sign-in', async (c) => {
  const betterAuth = createBetterAuth(c.env.DB, {
    RESEND_API_KEY: c.env.RESEND_API_KEY,
    PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
  })
  const body = await c.req.json<{ email: string; password: string }>()
  return betterAuth.handler(new Request(new URL('/sign-in/email', c.req.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: body.email, password: body.password }),
  }))
})

app.post('/api/auth/sign-out', async (c) => {
  const betterAuth = createBetterAuth(c.env.DB, {
    RESEND_API_KEY: c.env.RESEND_API_KEY,
    PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
  })
  return betterAuth.handler(new Request(new URL('/sign-out', c.req.url), {
    method: 'POST',
    headers: c.req.raw.headers,
  }))
})

app.get('/api/auth/session', async (c) => {
  const betterAuth = createBetterAuth(c.env.DB, {
    RESEND_API_KEY: c.env.RESEND_API_KEY,
    PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
  })
  const session = await betterAuth.api.getSession({ headers: c.req.raw.headers })
  return c.json({ session })
})

app.post('/api/auth/otp/send', async (c) => {
  const betterAuth = createBetterAuth(c.env.DB, {
    RESEND_API_KEY: c.env.RESEND_API_KEY,
    PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
  })
  const body = await c.req.json<{ email: string }>()
  return betterAuth.handler(new Request(new URL('/email-otp/send-verification-otp', c.req.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: body.email, type: 'sign-in' }),
  }))
})

app.post('/api/auth/otp/verify', async (c) => {
  const betterAuth = createBetterAuth(c.env.DB, {
    RESEND_API_KEY: c.env.RESEND_API_KEY,
    PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
  })
  const body = await c.req.json<{ email: string; otp: string }>()
  return betterAuth.handler(new Request(new URL('/email-otp/verify-email', c.req.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: body.email, otp: body.otp }),
  }))
})

app.all('/api/auth/*', async (c) => {
  const betterAuth = createBetterAuth(c.env.DB, {
    RESEND_API_KEY: c.env.RESEND_API_KEY,
    PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
  })
  return betterAuth.handler(c.req.raw)
})

app.route('/api/documents', createDocumentsRouter())
app.route('/api/share', createSharingRouter())
app.route('/api/ai', createAiRouter())
app.route('/api/collab', createCollabRouter())

export default app
export { DocumentRoomDO }
