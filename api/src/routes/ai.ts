import { Hono } from 'hono'
import type { Env } from '../env'

export function createAiRouter() {
  const router = new Hono<{ Bindings: Env }>()

  router.post('/chat', async (c) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json<{ messages: Array<{ role: string; content: string }>; model?: string }>()
    const apiKey = c.env.ANTHROPIC_API_KEY ?? c.env.OPENAI_API_KEY

    if (!apiKey) {
      return c.json({ error: 'AI not configured' }, 503)
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: body.model ?? 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: body.messages,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      return c.json({ error }, response.status)
    }

    const data = await response.json()
    return c.json(data)
  })

  router.post('/image', async (c) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
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
