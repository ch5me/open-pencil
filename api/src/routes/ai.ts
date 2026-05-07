import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env } from '../env'
import { getAuthenticatedUser, isCh5Email } from '../auth/session'
import { UserProviderKeyService } from '../services/user-provider-keys'

export function createAiRouter() {
  const router = new Hono<{ Bindings: Env }>()

  function jsonError(message: string, status: number): Response {
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  async function ensureAuthorized(c: Context<{ Bindings: Env }>) {
    return getAuthenticatedUser(c)
  }

  async function resolveOpenRouterKey(c: Context<{ Bindings: Env }>, userId: string, email: string) {
    if (isCh5Email(email) && c.env.OPENROUTER_API_KEY) return c.env.OPENROUTER_API_KEY
    const keyService = new UserProviderKeyService(c.env)
    return keyService.get(userId, 'openrouter')
  }

  async function resolveScenarioKey(c: Context<{ Bindings: Env }>, userId: string, email: string) {
    if (isCh5Email(email) && c.env.SCENARIO_API_KEY) return c.env.SCENARIO_API_KEY
    const keyService = new UserProviderKeyService(c.env)
    return keyService.get(userId, 'scenario')
  }

  function getScenarioAuthorizationParts(c: Context<{ Bindings: Env }>, credential: string) {
    if (credential.includes(':')) {
      const [apiKey, ...rest] = credential.split(':')
      const apiSecret = rest.join(':')
      if (apiKey && apiSecret) return { apiKey, apiSecret }
    }

    const apiSecret = c.env.SCENARIO_API_SECRET ?? c.env.SCENARIO_SECRET_API_KEY
    if (apiSecret) {
      return { apiKey: credential, apiSecret }
    }

    throw new Error('Scenario credentials must be configured as key:secret or key + SCENARIO_API_SECRET')
  }

  async function submitScenarioJob(
    c: Context<{ Bindings: Env }>,
    credential: string,
    body: { prompt: string; model?: string; aspectRatio?: string }
  ) {
    const { apiKey, apiSecret } = getScenarioAuthorizationParts(c, credential)
    const modelId = body.model ?? 'model_flux-1-dev'
    const response = await fetch(`https://api.cloud.scenario.com/v1/generate/custom/${modelId}`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: body.prompt,
        aspectRatio: body.aspectRatio ?? '1:1',
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(error || `Scenario submit failed (${response.status})`)
    }

    return {
      authHeader: `Basic ${btoa(`${apiKey}:${apiSecret}`)}`,
      payload: (await response.json()) as { job?: { jobId?: string } },
    }
  }

  async function pollScenarioJob(authHeader: string, jobId: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(`https://api.cloud.scenario.com/v1/jobs/${jobId}`, {
        headers: { authorization: authHeader },
      })
      if (!response.ok) {
        const error = await response.text()
        throw new Error(error || `Scenario status failed (${response.status})`)
      }

      const payload = (await response.json()) as {
        job?: {
          status?: string
          result?: { images?: Array<{ url?: string }> }
          failureReason?: string
        }
      }
      const status = payload.job?.status
      if (status === 'success') return payload
      if (status === 'failed' || status === 'canceled') {
        throw new Error(payload.job?.failureReason ?? `Scenario job ${status}`)
      }

      await new Promise((resolve) => setTimeout(resolve, 2500))
    }

    throw new Error('Scenario job polling timed out')
  }

  async function handleAnthropicMessage(c: Context<{ Bindings: Env }>) {
    const user = await ensureAuthorized(c)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

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

    if (!response.ok) return jsonError(await response.text(), response.status)
    return c.json(await response.json())
  }

  router.post('/chat', async (c) => {
    return handleAnthropicMessage(c)
  })

  router.post('/messages', async (c) => {
    return handleAnthropicMessage(c)
  })

  router.post('/chat/completions', async (c) => {
    const user = await ensureAuthorized(c)
    if (!user) return c.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await c.req.json<Record<string, unknown>>()
    const model = typeof body.model === 'string' && body.model ? body.model : 'openai/gpt-4.1'
    const openRouterKey = await resolveOpenRouterKey(c, user.id, user.email)
    if (!openRouterKey) {
      return c.json({ error: 'Hosted AI is not configured for this account' }, { status: 403 })
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${openRouterKey}`,
        'content-type': 'application/json',
        'HTTP-Referer': c.env.PUBLIC_SITE_URL ?? c.env.PUBLIC_APP_URL ?? 'https://pencil.ch5.me',
        'X-OpenRouter-Title': 'OpenPencil',
      },
      body: JSON.stringify({
        ...body,
        model,
        max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : 1024,
      }),
    })

    if (!response.ok) return jsonError(await response.text(), response.status)
    return c.json(await response.json())
  })

  router.post('/image', async (c) => {
    const user = await ensureAuthorized(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await c.req.json<{ prompt: string; model?: string }>()
    const scenarioKey = await resolveScenarioKey(c, user.id, user.email)
    if (scenarioKey) {
      try {
        const { authHeader, payload } = await submitScenarioJob(c, scenarioKey, body)
        const jobId = payload.job?.jobId
        if (!jobId) {
          return c.json({ error: 'Scenario response missing job id' }, { status: 502 })
        }

        const result = await pollScenarioJob(authHeader, jobId)
        return c.json(result)
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 })
      }
    }

    const apiKey = c.env.OPENAI_API_KEY ?? c.env.ANTHROPIC_API_KEY

    if (!apiKey) {
      return c.json({ error: 'AI not configured' }, { status: 503 })
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
      return jsonError(error, response.status)
    }

    const data = await response.json()
    return c.json(data)
  })

  return router
}
