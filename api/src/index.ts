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
  })
  const { signUp } = betterAuth.api
  const body = await c.req.json<{ email: string; password: string; name?: string }>()
  const result = await signUp(body.email, body.password, { name: body.name })
  return c.json(result)
})

app.post('/api/auth/sign-in', async (c) => {
  const betterAuth = createBetterAuth(c.env.DB, {
    RESEND_API_KEY: c.env.RESEND_API_KEY,
    PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
  })
  const { signIn } = betterAuth.api
  const body = await c.req.json<{ email: string; password: string }>()
  const result = await signIn(body.email, body.password)
  return c.json(result)
})

app.post('/api/auth/sign-out', async (c) => {
  const betterAuth = createBetterAuth(c.env.DB, {
    RESEND_API_KEY: c.env.RESEND_API_KEY,
    PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
  })
  const { signOut } = betterAuth.api
  await signOut(c.req.header('cookie') ?? '')
  return c.json({ ok: true })
})

app.get('/api/auth/session', async (c) => {
  const betterAuth = createBetterAuth(c.env.DB, {
    RESEND_API_KEY: c.env.RESEND_API_KEY,
    PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
  })
  const { getSession } = betterAuth.api
  const session = await getSession(c.req.header('cookie') ?? '')
  return c.json({ session })
})

app.post('/api/auth/otp/send', async (c) => {
  const betterAuth = createBetterAuth(c.env.DB, {
    RESEND_API_KEY: c.env.RESEND_API_KEY,
    PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
  })
  const body = await c.req.json<{ email: string }>()
  const { sendOTP } = betterAuth.api
  await sendOTP(body.email)
  return c.json({ ok: true })
})

app.post('/api/auth/otp/verify', async (c) => {
  const betterAuth = createBetterAuth(c.env.DB, {
    RESEND_API_KEY: c.env.RESEND_API_KEY,
    PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
  })
  const body = await c.req.json<{ email: string; otp: string }>()
  const { verifyOTP } = betterAuth.api
  const result = await verifyOTP(body.email, body.otp)
  return c.json(result)
})

app.all('/api/auth/*', async (c) => {
  const betterAuth = createBetterAuth(c.env.DB, {
    RESEND_API_KEY: c.env.RESEND_API_KEY,
    PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
  })
  return betterAuth.handler(c.req.raw)
})

app.route('/api/documents', createDocumentsRouter())
app.route('/api/share', createSharingRouter())
app.route('/api/ai', createAiRouter())
app.route('/api/collab', createCollabRouter())

export default app
export { DocumentRoomDO }
