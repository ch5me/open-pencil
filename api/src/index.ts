import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './env'
import { initSentry } from './sentry'
import { requestLogger } from './middleware/logger'
import { createBetterAuth } from './auth/better-auth'
import { createDocumentsRouter } from './routes/documents'
import { createSharingRouter } from './routes/sharing'
import { createAiRouter } from './routes/ai'
import { createCollabRouter } from './routes/collab'
import { createAccountRouter } from './routes/account'
import { DocumentRoomDO } from './collab/DocumentRoomDO'
import { getApiVersionInfo } from './version'

const app = new Hono<{ Bindings: Env }>()

function createAllowedOriginSet(env: Env): Set<string> {
  const allowed = new Set<string>([
    'http://web.openpencil.localhost:5173',
    'http://localhost:5173',
    'https://pencil.ch5.me',
    'https://staging.pencil.ch5.me',
  ])

  if (env.PUBLIC_APP_URL) allowed.add(env.PUBLIC_APP_URL)
  if (env.PUBLIC_SITE_URL) allowed.add(env.PUBLIC_SITE_URL)

  return allowed
}

app.use('*', async (c, next) => {
  const allowedOrigins = createAllowedOriginSet(c.env)
  return cors({
    origin: (origin) => (origin && allowedOrigins.has(origin) ? origin : undefined),
    credentials: true,
  })(c, next)
})

app.use('*', async (c, next) => {
  await initSentry(c.env)
  await next()
})

app.use('*', requestLogger())

app.get('/health', (c) => c.json({ status: 'ok' }))

app.get('/api/version', (c) => {
  let stage: 'development' | 'staging' | 'production' = 'development'
  if (c.env.NODE_ENV === 'staging') stage = 'staging'
  if (c.env.NODE_ENV === 'production') stage = 'production'
  const versionInfo = getApiVersionInfo(c.env.VERSION_METADATA)
  return c.json({
    ...versionInfo,
    stage,
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
  return betterAuth.handler(new Request(new URL('/api/auth/sign-up/email', c.req.url), {
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
  return betterAuth.handler(new Request(new URL('/api/auth/sign-in/email', c.req.url), {
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
  return betterAuth.handler(new Request(new URL('/api/auth/sign-out', c.req.url), {
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
  return c.json(session ?? { user: null, session: null })
})

app.post('/api/auth/otp/send', async (c) => {
  const betterAuth = createBetterAuth(c.env.DB, {
    RESEND_API_KEY: c.env.RESEND_API_KEY,
    PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
  })
  const body = await c.req.json<{ email: string }>()
  return betterAuth.handler(new Request(new URL('/api/auth/email-otp/send-verification-otp', c.req.url), {
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
  return betterAuth.handler(new Request(new URL('/api/auth/email-otp/verify-email', c.req.url), {
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
app.route('/api/account', createAccountRouter())
app.route('/api/collab', createCollabRouter())

export default app
export { DocumentRoomDO }
