import { afterEach, expect, test } from 'bun:test'

import {
  AGENT_CONTINUATION_SCHEMA,
  AGENT_RUN_SCHEMA,
  parseAgentEvent
} from '@open-pencil/agent-contracts'

import { createFakeGateway } from '../src/gateway'

const gateway = createFakeGateway()
const runRequest = {
  schema: AGENT_RUN_SCHEMA,
  requestId: 'request-1',
  idempotencyKey: 'key-1',
  conversation: { clientId: 'conversation-1' },
  input: { messageId: 'message-1', text: 'Create a rectangle' },
  context: { documentId: 'document-1', pageId: 'page-1', selectedNodeIds: [] },
  tools: { manifestId: 'manifest-1' },
  capabilities: { toolResults: true, reconnect: true, cancellation: true, approvals: true }
} as const

afterEach(() => gateway.reset())

function startRun(body: unknown = runRequest): Promise<Response> {
  return gateway.fetch(
    new Request('http://gateway.test/v1/runs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-openpencil-principal': 'stub-user-001'
      },
      body: JSON.stringify(body)
    })
  )
}

function gatewayRequest(path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers)
  headers.set('x-openpencil-principal', 'stub-user-001')
  return new Request(`http://gateway.test${path}`, { ...init, headers })
}

function events(text: string) {
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((frame) =>
      parseAgentEvent(
        JSON.parse(
          frame
            .split('\n')
            .find((line) => line.startsWith('data:'))
            ?.slice(5)
            .trim() ?? 'null'
        )
      )
    )
}

test('streams a real action, accepts continuation, and returns an opaque receipt', async () => {
  const initial = events(await (await startRun()).text())
  const call = initial.find((event) => event.type === 'tool.call')
  expect(call?.type).toBe('tool.call')
  if (!call || call.type !== 'tool.call') throw new Error('Missing tool call')

  const response = await gateway.fetch(
    gatewayRequest(`/v1/sessions/${call.sessionId}/runs/${call.runId}/tool-results`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schema: AGENT_CONTINUATION_SCHEMA,
        requestId: runRequest.requestId,
        idempotencyKey: 'result-1',
        sessionId: call.sessionId,
        runId: call.runId,
        callId: call.data.callId,
        continuationId: call.data.continuationId,
        manifestId: call.data.manifestId,
        target: call.data.target,
        status: 'ok',
        output: { id: 'rectangle-1' }
      })
    })
  )
  const continued = events(await response.text())
  const completed = continued.find((event) => event.type === 'run.completed')
  expect(completed?.type).toBe('run.completed')
  if (!completed || completed.type !== 'run.completed') throw new Error('Missing completion')
  expect(completed.data.receipt.gateway).toEqual({
    service: 'openpencil-local-agent-gateway',
    protocolVersion: '1'
  })
  expect(JSON.stringify(completed.data.receipt)).not.toMatch(
    /provider|model|billing|runtime|worker/i
  )
})

test('supports malformed failure, cancellation, and Last-Event-ID resume', async () => {
  expect(
    await (
      await startRun({
        ...runRequest,
        idempotencyKey: 'malformed',
        input: { ...runRequest.input, text: '[malformed]' }
      })
    ).text()
  ).toContain('data: {not-json}')

  const initial = events(await (await startRun()).text())
  const run = initial[0]
  if (!run) throw new Error('Missing run')
  const resumed = await gateway.fetch(
    gatewayRequest(`/v1/sessions/${run.sessionId}/runs/${run.runId}/events`, {
      headers: { 'last-event-id': 'event-3' }
    })
  )
  const replay = events(await resumed.text())
  expect(replay[0]?.seq).toBe(4)

  const cancelled = await gateway.fetch(
    gatewayRequest(`/v1/sessions/${run.sessionId}/runs/${run.runId}/cancel`, {
      method: 'POST'
    })
  )
  const cancelledEvent = events(await cancelled.text())[0]
  expect(cancelledEvent?.type).toBe('run.cancelled')

  const repeated = await gateway.fetch(
    gatewayRequest(`/v1/sessions/${run.sessionId}/runs/${run.runId}/cancel`, {
      method: 'POST'
    })
  )
  expect(events(await repeated.text())[0]?.eventId).toBe(cancelledEvent?.eventId)

  const unknownCursor = await gateway.fetch(
    gatewayRequest(`/v1/sessions/${run.sessionId}/runs/${run.runId}/events`, {
      headers: { 'last-event-id': 'missing-event' }
    })
  )
  expect(unknownCursor.status).toBe(410)
})
