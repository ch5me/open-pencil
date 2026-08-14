import { afterEach, describe, expect, test } from 'bun:test'

import {
  AGENT_CONTINUATION_SCHEMA,
  AGENT_ERROR_SCHEMA,
  AGENT_EVENT_SCHEMA,
  AGENT_OPTIONS_SCHEMA,
  AGENT_RUN_SCHEMA
} from '@open-pencil/agent-contracts'

import { DEV_STUB_ELF_TOKEN } from '../auth'
import { app, type Env } from '../index'

const PRINCIPAL_ID = 'stub-user-001'
const SERVICE_CREDENTIAL = 'gateway-service-credential'
const originalFetch = globalThis.fetch

const env = {
  ALLOW_DEV_STUB_AUTH: '1',
  OPENPENCIL_AGENT_GATEWAY_ORIGIN: 'https://gateway.example',
  OPENPENCIL_AGENT_GATEWAY_TOKEN: SERVICE_CREDENTIAL
} as Env

afterEach(() => {
  globalThis.fetch = originalFetch
})

function authenticatedHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers)
  result.set('Authorization', `Bearer ${DEV_STUB_ELF_TOKEN}`)
  return result
}

function runRequest() {
  return {
    schema: AGENT_RUN_SCHEMA,
    requestId: 'request-1',
    idempotencyKey: `idem-${'1'.repeat(8)}`,
    conversation: { clientId: 'client-1' },
    input: { messageId: 'message-1', text: 'Create a card' },
    context: { documentId: 'document-1', selectedNodeIds: [] },
    tools: {
      manifestId: `sha256:${'a'.repeat(64)}`,
      definitions: [
        {
          name: 'create_card',
          description: 'Create a card.',
          mutates: true,
          requiresApproval: true,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: []
          }
        }
      ]
    },
    capabilities: {
      toolResults: true,
      reconnect: true,
      cancellation: true,
      approvals: true
    }
  }
}

function continuation(sessionId = 'session-1', runId = 'run-1') {
  return {
    schema: AGENT_CONTINUATION_SCHEMA,
    requestId: 'request-1',
    idempotencyKey: `idem-cont-${'1'.repeat(8)}`,
    sessionId,
    runId,
    callId: 'call-1',
    continuationId: 'continuation-1',
    manifestId: `sha256:${'a'.repeat(64)}`,
    target: { documentId: 'document-1' },
    status: 'ok',
    output: { nodeId: 'node-1' }
  }
}

function agentEvent(overrides: Record<string, unknown> = {}) {
  return {
    schema: AGENT_EVENT_SCHEMA,
    sessionId: 'session-1',
    runId: 'run-1',
    seq: 1,
    eventId: 'event-1',
    timestamp: '2026-08-13T12:00:00.000Z',
    type: 'run.started',
    data: { requestId: 'request-1' },
    ...overrides
  }
}

function eventStream(events: Array<Record<string, unknown>>, init?: ResponseInit): Response {
  const body = events
    .map((event) => `id: ${String(event.eventId)}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('')
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'text/event-stream')
  return new Response(body, { ...init, headers })
}

describe('generic hosted agent API routes', () => {
  test('proxies an authenticated principal to the provider-neutral option catalog', async () => {
    let forwarded: Request | undefined
    globalThis.fetch = (async (input, init) => {
      forwarded = new Request(input, init)
      return Response.json({
        schema: AGENT_OPTIONS_SCHEMA,
        options: [
          {
            optionId: 'option-balanced',
            label: 'Balanced',
            group: 'Recommended',
            description: 'Balances speed and quality.',
            capabilities: ['tools'],
            efforts: ['low', 'high'],
            default: true
          }
        ]
      })
    }) as typeof fetch

    const response = await app.request(
      '/api/agent/options',
      { headers: authenticatedHeaders() },
      env
    )
    expect(response.status).toBe(200)
    expect(forwarded?.method).toBe('GET')
    expect(forwarded?.url).toBe('https://gateway.example/v1/options')
    expect(forwarded?.headers.get('x-openpencil-principal')).toBe(PRINCIPAL_ID)
    expect(forwarded?.headers.get('authorization')).toBe(`Bearer ${SERVICE_CREDENTIAL}`)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('rejects malformed or infrastructure-bearing option catalogs', async () => {
    for (const body of [
      { schema: AGENT_OPTIONS_SCHEMA, options: 'invalid' },
      {
        schema: AGENT_OPTIONS_SCHEMA,
        options: [
          {
            optionId: 'option-private',
            label: 'Private',
            group: 'Other',
            description: 'Invalid.',
            capabilities: [],
            efforts: [],
            runtimeId: 'leaked'
          }
        ]
      },
      {
        schema: AGENT_OPTIONS_SCHEMA,
        options: [
          {
            optionId: 'option-private',
            label: 'Private',
            group: 'Other',
            description: 'Invalid.',
            capabilities: [{ nested: { provider: 'leaked' } }],
            efforts: []
          }
        ]
      }
    ]) {
      globalThis.fetch = (async () => Response.json(body)) as typeof fetch
      const response = await app.request(
        '/api/agent/options',
        { headers: authenticatedHeaders() },
        env
      )
      expect(response.status).toBe(502)
      await expect(response.json()).resolves.toMatchObject({
        schema: AGENT_ERROR_SCHEMA,
        code: 'catalog-invalid',
        phase: 'request'
      })
    }
  })

  test('rejects missing and invalid ELF sessions', async () => {
    const missing = await app.request('/api/agent/runs', { method: 'POST' }, env)
    expect(missing.status).toBe(401)
    await expect(missing.json()).resolves.toEqual({
      error: 'unauthorized',
      reason: 'missing-session'
    })

    const invalid = await app.request(
      '/api/agent/runs',
      { method: 'POST', headers: { Authorization: 'Bearer invalid-session' } },
      env
    )
    expect(invalid.status).toBe(401)
    await expect(invalid.json()).resolves.toEqual({
      error: 'unauthorized',
      reason: 'invalid-token'
    })
  })

  test('mounts run forwarding without exposing product or service credentials', async () => {
    let forwarded: Request | undefined
    globalThis.fetch = (async (input, init) => {
      forwarded = new Request(input, init)
      return eventStream(
        [
          agentEvent({
            seq: 0,
            eventId: 'event-0',
            type: 'session.created'
          }),
          agentEvent()
        ],
        { status: 206, headers: { 'X-Gateway-Proof': 'stream-preserved' } }
      )
    }) as typeof fetch

    const response = await app.request(
      '/api/agent/runs',
      {
        method: 'POST',
        headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(runRequest())
      },
      env
    )

    expect(forwarded?.url).toBe('https://gateway.example/v1/runs')
    expect(forwarded?.headers.get('x-openpencil-principal')).toBe(PRINCIPAL_ID)
    expect(forwarded?.headers.get('authorization')).toBe(`Bearer ${SERVICE_CREDENTIAL}`)
    expect(forwarded?.headers.get('authorization')).not.toContain(DEV_STUB_ELF_TOKEN)
    expect(await forwarded?.json()).toEqual(runRequest())
    expect(response.status).toBe(206)
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('x-gateway-proof')).toBe('stream-preserved')
    expect(response.headers.get('authorization')).toBeNull()
    const browserBody = await response.text()
    expect(browserBody).toContain('"type":"run.started"')
    expect(browserBody).not.toContain(SERVICE_CREDENTIAL)
    expect(browserBody).not.toContain(DEV_STUB_ELF_TOKEN)
  })

  test('validates and forwards hosted option selection', async () => {
    let forwarded: Request | undefined
    globalThis.fetch = (async (input, init) => {
      forwarded = new Request(input, init)
      return eventStream([
        agentEvent({ seq: 0, eventId: 'event-0', type: 'session.created' }),
        agentEvent()
      ])
    }) as typeof fetch
    const selected = { ...runRequest(), selection: { optionId: 'option-balanced', effort: 'high' } }
    const response = await app.request(
      '/api/agent/runs',
      {
        method: 'POST',
        headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(selected)
      },
      env
    )
    expect(response.status).toBe(200)
    expect(await forwarded?.json()).toEqual(selected)
    await response.text()

    const invalid = await app.request(
      '/api/agent/runs',
      {
        method: 'POST',
        headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ...selected,
          selection: { ...selected.selection, providerId: 'private' }
        })
      },
      env
    )
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({ code: 'invalid-request' })
  })

  test('returns a typed conflict before forwarding mismatched continuation identity', async () => {
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      return eventStream([agentEvent()])
    }) as typeof fetch

    const response = await app.request(
      '/api/agent/sessions/session-1/runs/run-1/tool-results',
      {
        method: 'POST',
        headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(continuation('different-session'))
      },
      env
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      schema: AGENT_ERROR_SCHEMA,
      code: 'session-conflict',
      message: 'Tool result identity does not match the requested session and run.',
      retryable: false,
      phase: 'tool',
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1'
    })
    expect(fetchCalled).toBe(false)
  })

  test('forwards continuation, cancellation, and cursor-based resume routes', async () => {
    const forwarded: Request[] = []
    globalThis.fetch = (async (input, init) => {
      forwarded.push(new Request(input, init))
      return eventStream([agentEvent()])
    }) as typeof fetch

    const responses = []
    responses.push(
      await app.request(
        '/api/agent/sessions/session-1/runs/run-1/tool-results',
        {
          method: 'POST',
          headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(continuation())
        },
        env
      )
    )
    responses.push(
      await app.request(
        '/api/agent/sessions/session-1/runs/run-1/cancel',
        { method: 'POST', headers: authenticatedHeaders() },
        env
      )
    )
    responses.push(
      await app.request(
        '/api/agent/sessions/session-1/runs/run-1/events',
        { method: 'GET', headers: authenticatedHeaders({ 'Last-Event-ID': 'event-7' }) },
        env
      )
    )

    await Promise.all(responses.map((response) => response.text()))
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200])
    expect(
      forwarded.map((request) => `${request.method} ${new URL(request.url).pathname}`)
    ).toEqual([
      'POST /v1/sessions/session-1/runs/run-1/tool-results',
      'POST /v1/sessions/session-1/runs/run-1/cancel',
      'GET /v1/sessions/session-1/runs/run-1/events'
    ])
    expect(forwarded[2]?.headers.get('last-event-id')).toBe('event-7')
    expect(
      forwarded.every((request) => request.headers.get('x-openpencil-principal') === PRINCIPAL_ID)
    ).toBe(true)
    expect(
      forwarded.every(
        (request) => request.headers.get('authorization') === `Bearer ${SERVICE_CREDENTIAL}`
      )
    ).toBe(true)
  })
})
