import { describe, expect, test } from 'bun:test'

import {
  AGENT_CONTINUATION_SCHEMA,
  AGENT_EVENT_SCHEMA,
  AGENT_RECEIPT_SCHEMA,
  AGENT_RUN_SCHEMA
} from '@open-pencil/agent-contracts'

import { parseAgentRunRequest, parseAgentToolResultContinuation } from './contracts'
import { AgentGatewayError, requestAgentGateway } from './gateway'

function event(overrides: Record<string, unknown> = {}) {
  return {
    schema: AGENT_EVENT_SCHEMA,
    sessionId: 'session-1',
    runId: 'run-1',
    seq: 1,
    eventId: 'event-1',
    timestamp: '2026-08-12T12:00:00.000Z',
    type: 'run.started',
    data: { requestId: 'request-1' },
    ...overrides
  }
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    schema: AGENT_RECEIPT_SCHEMA,
    receiptId: 'receipt-1',
    requestId: 'request-1',
    sessionId: 'session-1',
    runId: 'run-1',
    status: 'completed',
    acceptedAt: '2026-08-12T12:00:00.000Z',
    completedAt: '2026-08-12T12:00:01.000Z',
    lastSequence: 2,
    gateway: { service: 'test', protocolVersion: '1' },
    ...overrides
  }
}

function sse(...events: Array<Record<string, unknown>>): Response {
  const body = events.map((item) => `id: ${item.eventId}\ndata: ${JSON.stringify(item)}\n\n`).join('')
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

describe('agent gateway contract', () => {
  test('forwards only the verified principal and product request', async () => {
    let captured: Request | undefined
    const response = await requestAgentGateway({
      env: { OPENPENCIL_AGENT_GATEWAY_ORIGIN: 'https://gateway.example' },
      principalId: 'user-1',
      path: '/v1/runs',
      method: 'POST',
      body: { schema: AGENT_RUN_SCHEMA, requestId: 'request-1' },
      expectedIdentity: { requestId: 'request-1' },
      fetch: (async (input, init) => {
        captured = new Request(input, init)
        return sse(event())
      }) as typeof fetch
    })

    expect(captured?.headers.get('x-openpencil-principal')).toBe('user-1')
    expect(captured?.headers.get('authorization')).toBeNull()
    expect(await captured?.json()).toEqual({ schema: AGENT_RUN_SCHEMA, requestId: 'request-1' })
    expect(await response.text()).toContain('"type":"run.started"')
  })

  test('preserves Last-Event-ID and accepts a contiguous resumed stream', async () => {
    let lastEventId: string | null = null
    const response = await requestAgentGateway({
      env: { OPENPENCIL_AGENT_GATEWAY_ORIGIN: 'https://gateway.example' },
      principalId: 'user-1',
      path: '/v1/sessions/session-1/runs/run-1/events',
      method: 'GET',
      lastEventId: 'event-7',
      expectedIdentity: { sessionId: 'session-1', runId: 'run-1' },
      fetch: (async (_input, init) => {
        lastEventId = new Headers(init?.headers).get('last-event-id')
        return sse(
          event({ eventId: 'event-8', seq: 8 }),
          event({
            eventId: 'event-9',
            seq: 9,
            type: 'run.completed',
            data: { receipt: receipt({ lastSequence: 9 }) }
          })
        )
      }) as typeof fetch
    })

    expect(lastEventId).toBe('event-7')
    expect(await response.text()).toContain('event-9')
  })

  test('rejects changed identity, sequence gaps, and receipt conflicts', async () => {
    for (const invalid of [
      [event(), event({ eventId: 'event-2', seq: 2, runId: 'run-2' })],
      [event(), event({ eventId: 'event-2', seq: 3 })],
      [
        event(),
        event({
          eventId: 'event-2',
          seq: 2,
          type: 'run.completed',
          data: { receipt: receipt({ runId: 'run-2' }) }
        })
      ]
    ]) {
      const response = await requestAgentGateway({
        env: { OPENPENCIL_AGENT_GATEWAY_ORIGIN: 'https://gateway.example' },
        principalId: 'user-1',
        path: '/v1/runs',
        method: 'POST',
        fetch: (async () => sse(...invalid)) as unknown as typeof fetch
      })
      await expect(response.text()).rejects.toBeInstanceOf(Error)
    }
  })

  test('preserves typed gateway errors and fails closed without configuration', async () => {
    await expect(
      requestAgentGateway({
        env: { OPENPENCIL_AGENT_GATEWAY_ORIGIN: 'https://gateway.example' },
        principalId: 'user-1',
        path: '/v1/runs',
        method: 'POST',
        fetch: (async () =>
          Response.json(
            { code: 'session-expired', message: 'Resume window expired.' },
            { status: 410 }
          )) as unknown as typeof fetch
      })
    ).rejects.toMatchObject({ status: 410, code: 'session-expired' })

    await expect(
      requestAgentGateway({ env: {}, principalId: 'user-1', path: '/v1/runs', method: 'POST' })
    ).rejects.toBeInstanceOf(AgentGatewayError)
  })

  test('uses the shared request and continuation contract authority', () => {
    expect(() =>
      parseAgentRunRequest({
        schema: AGENT_RUN_SCHEMA,
        requestId: 'request-1',
        idempotencyKey: 'idem-1',
        conversation: { clientId: 'conversation-1' },
        input: { messageId: 'message-1', text: 'Draw a card' },
        context: { documentId: 'document-1', selectedNodeIds: [] },
        tools: { manifestId: 'manifest-1' },
        capabilities: {
          toolResults: true,
          reconnect: true,
          cancellation: true,
          approvals: true
        },
        provider: 'not-allowed'
      })
    ).toThrow('Malformed agent run request')

    expect(() =>
      parseAgentToolResultContinuation({
        schema: AGENT_CONTINUATION_SCHEMA,
        requestId: 'request-1',
        idempotencyKey: 'idem-1',
        sessionId: 'session-1',
        runId: 'run-1',
        callId: 'call-1',
        continuationId: 'continuation-1',
        manifestId: 'manifest-1',
        target: { documentId: 'document-1' },
        status: 'ok'
      })
    ).toThrow('Malformed agent tool result continuation')
  })
})
