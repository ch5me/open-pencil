import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env } from '../env'
import { createBetterAuth } from '../auth/better-auth'

export function createAiRouter() {
  const router = new Hono<{ Bindings: Env }>()

  async function ensureAuthorized(c: Context<{ Bindings: Env }>) {
    const authHeader = c.req.header('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length)
      const row = await c.env.DB.prepare('SELECT userId FROM sessions WHERE token = ? AND expiresAt > ?')
        .bind(token, Date.now())
        .first<{ userId: string }>()
      return row?.userId ?? null
    }

    const auth = createBetterAuth(c.env.DB, {
      RESEND_API_KEY: c.env.RESEND_API_KEY,
      PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
      BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
      BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
    })
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    return session?.session?.userId ?? null
  }

  async function handleAnthropicMessage(c: Context<{ Bindings: Env }>) {
    const userId = await ensureAuthorized(c)
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const body = await c.req.json<{ messages: Array<{ role: string; content: string }>; model?: string; max_tokens?: number }>()
    const apiKey = c.env.ANTHROPIC_API_KEY ?? c.env.OPENAI_API_KEY

    if (!apiKey) return c.json({ error: 'AI not configured' }, 503)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: body.model ?? 'claude-sonnet-4-20250514',
        max_tokens: body.max_tokens ?? 1024,
        messages: body.messages,
      }),
    })

    if (!response.ok) return c.json({ error: await response.text() }, response.status)
    return c.json(await response.json())
  }

  router.post('/chat', async (c) => {
    return handleAnthropicMessage(c)
  })

  router.post('/messages', async (c) => {
    return handleAnthropicMessage(c)
  })

  router.post('/chat/completions', async (c) => {
    const userId = await ensureAuthorized(c)
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const body = await c.req.json<{ messages: Array<{ role: string; content: string }>; model?: string; max_tokens?: number }>()
    const apiKey = c.env.OPENAI_API_KEY
    if (!apiKey) return c.json({ error: 'AI not configured' }, 503)

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: body.model ?? 'gpt-4.1-mini',
        messages: body.messages,
        max_tokens: body.max_tokens ?? 1024,
      }),
    })

    if (!response.ok) return c.json({ error: await response.text() }, response.status)
    return c.json(await response.json())
  })

  router.post('/image', async (c) => {
    const userId = await ensureAuthorized(c)
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json<{ prompt: string; model?: string }>()
    const apiKey = c.env.OPENAI_API_KEY ?? c.env.ANTHROPIC_API_KEY

    if (!apiKey) {
      return c.json({ error: 'AI not configured' }, 503)
    }

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: body.model ?? 'dall-e-3',
        prompt: body.prompt,
        n: 1,
        size: '1024x1024',
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      return c.json({ error }, response.status)
    }

    const data = await response.json()
    return c.json(data)
  })

  return router
}
