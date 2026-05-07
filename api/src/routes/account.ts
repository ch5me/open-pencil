import { Hono } from 'hono'

import { getAuthenticatedUser, isCh5Email } from '../auth/session'
import type { Env } from '../env'
import { UserProviderKeyService, type ManagedProviderId } from '../services/user-provider-keys'

type KeyUpdateBody = Partial<Record<ManagedProviderId, string | null>>

export function createAccountRouter() {
  const router = new Hono<{ Bindings: Env }>()

  function hasManagedScenarioCredentials(env: Env): boolean {
    return Boolean(env.SCENARIO_API_SECRET || env.SCENARIO_API_KEY?.includes(':'))
  }

  router.get('/ai-credentials', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const keyService = new UserProviderKeyService(c.env)
    const isManagedCh5 = isCh5Email(user.email)

    return c.json({
      user: {
        email: user.email,
        isCh5Managed: isManagedCh5,
      },
      managed: {
        openrouter: isManagedCh5 && Boolean(c.env.OPENROUTER_API_KEY),
        scenario: isManagedCh5 && hasManagedScenarioCredentials(c.env),
      },
      saved: {
        openrouter: await keyService.has(user.id, 'openrouter'),
        scenario: await keyService.has(user.id, 'scenario'),
      },
    })
  })

  router.put('/ai-credentials', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const body = await c.req.json<KeyUpdateBody>()
    const keyService = new UserProviderKeyService(c.env)

    for (const providerId of ['openrouter', 'scenario'] as const) {
      const nextValue = body[providerId]
      if (nextValue === undefined) continue
      if (nextValue === null || nextValue.trim() === '') {
        await keyService.clear(user.id, providerId)
        continue
      }
      await keyService.set(user.id, providerId, nextValue.trim())
    }

    return c.json({ ok: true })
  })

  return router
}
