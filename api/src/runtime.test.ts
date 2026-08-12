import { describe, expect, test } from 'bun:test'

import { FireflyRuntimeError, sendFireflyRuntimeChat } from './runtime'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('Firefly runtime gateway', () => {
  test('claims, rechecks health, sends chat, and preserves billing trace', async () => {
    const paths: string[] = []
    let statusCalls = 0
    const result = await sendFireflyRuntimeChat(
      {
        env: {
          FIREFLY_API_ORIGIN: 'https://api.elf.test',
          FIREFLY_AUTH_ORIGIN: 'https://app.elf.test'
        },
        sessionToken: 'delegated-token',
        fetch: (async (url, init) => {
          paths.push(`${init?.method ?? 'GET'} ${new URL(String(url)).pathname}`)
          if (String(url).endsWith('/api/firefly-auth/exchange')) {
            expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer delegated-token')
            return json({ token: 'runtime-token' })
          }
          if (String(url).endsWith('/runtime/status')) {
            statusCalls++
            return json(
              statusCalls === 1
                ? { runtimeId: null, state: 'unprovisioned', health: 'offline' }
                : { runtimeId: 'runtime-1', state: 'ready', health: 'healthy' }
            )
          }
          if (String(url).endsWith('/runtime/claim')) {
            return json({ ok: true, runtimeId: 'runtime-1' })
          }
          expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer runtime-token')
          return json({ ok: true, traceId: 'trace-1', response: 'done' })
        }) as typeof fetch
      },
      { message: 'Build it' }
    )

    expect(paths).toEqual([
      'POST /api/firefly-auth/exchange',
      'GET /runtime/status',
      'POST /runtime/claim',
      'GET /runtime/status',
      'POST /chat/send'
    ])
    expect(result.receipt).toEqual({
      runtimeId: 'runtime-1',
      traceId: 'trace-1',
      billingAuthority: 'firefly',
      billingReference: 'trace-1'
    })
  })

  test('fails closed for unhealthy runtime and missing billing trace', async () => {
    await expect(
      sendFireflyRuntimeChat(
        {
          env: {
            FIREFLY_API_ORIGIN: 'https://api.elf.test',
            FIREFLY_AUTH_ORIGIN: 'https://app.elf.test'
          },
          sessionToken: 'token',
          fetch: (async (url) =>
            String(url).endsWith('/api/firefly-auth/exchange')
              ? json({ token: 'runtime-token' })
              : json({
                  runtimeId: 'runtime-1',
                  state: 'starting',
                  health: 'degraded'
                })) as typeof fetch
        },
        { message: 'Build it' }
      )
    ).rejects.toMatchObject({ code: 'runtime-unhealthy' })

    let call = 0
    await expect(
      sendFireflyRuntimeChat(
        {
          env: {
            FIREFLY_API_ORIGIN: 'https://api.elf.test',
            FIREFLY_AUTH_ORIGIN: 'https://app.elf.test'
          },
          sessionToken: 'token',
          fetch: (async (url) => {
            if (String(url).endsWith('/api/firefly-auth/exchange')) {
              return json({ token: 'runtime-token' })
            }
            call++
            return call === 1
              ? json({ runtimeId: 'runtime-1', state: 'ready', health: 'healthy' })
              : json({ ok: true, response: 'unsafe' })
          }) as typeof fetch
        },
        { message: 'Build it' }
      )
    ).rejects.toBeInstanceOf(FireflyRuntimeError)
  })

  test('fails closed when runtime token exchange is rejected', async () => {
    await expect(
      sendFireflyRuntimeChat(
        {
          env: {
            FIREFLY_API_ORIGIN: 'https://api.elf.test',
            FIREFLY_AUTH_ORIGIN: 'https://app.elf.test'
          },
          sessionToken: 'openpencil-token',
          fetch: (async () => json({ error: 'invalid' }, 401)) as typeof fetch
        },
        { message: 'Build it' }
      )
    ).rejects.toMatchObject({ code: 'runtime-token-exchange-failed', status: 401 })
  })
})
