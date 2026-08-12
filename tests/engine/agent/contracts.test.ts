import { describe, expect, test } from 'bun:test'

import {
  AGENT_CONTINUATION_SCHEMA,
  AGENT_ERROR_SCHEMA,
  AGENT_EVENT_SCHEMA,
  AGENT_RECEIPT_SCHEMA,
  AGENT_RUN_SCHEMA,
  createAgentGatewayManifestId,
  parseAgentError,
  parseAgentEvent,
  parseAgentRunReceipt,
  parseAgentRunRequest,
  parseAgentToolResultContinuation,
  verifyAgentGatewayToolManifest
} from '@open-pencil/core/agent'

const receipt = {
  schema: AGENT_RECEIPT_SCHEMA,
  receiptId: 'receipt',
  requestId: 'request',
  sessionId: 'session',
  runId: 'run',
  status: 'completed',
  acceptedAt: '2026-08-12T12:00:00.000Z',
  completedAt: '2026-08-12T12:00:01.000Z',
  lastSequence: 9,
  gateway: { service: 'local-test', protocolVersion: '1' }
}

const error = {
  schema: AGENT_ERROR_SCHEMA,
  code: 'session-conflict',
  message: 'Different result',
  retryable: false,
  phase: 'tool'
}

describe('agent gateway contracts', () => {
  test('parses valid requests, events, errors, receipts, and continuations', async () => {
    const definitions = [
      {
        name: 'get_node',
        description: 'Get a node',
        mutates: false,
        requiresApproval: false,
        inputSchema: {
          type: 'object' as const,
          additionalProperties: false as const,
          properties: {},
          required: []
        }
      }
    ]
    expect(
      parseAgentRunRequest({
        schema: AGENT_RUN_SCHEMA,
        requestId: 'request',
        idempotencyKey: 'once',
        conversation: { clientId: 'conversation' },
        input: { messageId: 'message', text: 'Draw a card' },
        context: { documentId: 'document', selectedNodeIds: [] },
        tools: { manifestId: await createAgentGatewayManifestId(definitions), definitions },
        capabilities: {
          toolResults: true,
          reconnect: true,
          cancellation: true,
          approvals: true
        }
      }).requestId
    ).toBe('request')
    expect(
      parseAgentEvent({
        schema: AGENT_EVENT_SCHEMA,
        sessionId: 'session',
        runId: 'run',
        seq: 9,
        eventId: 'event-9',
        timestamp: '2026-08-12T12:00:01.000Z',
        type: 'run.completed',
        data: { receipt }
      }).type
    ).toBe('run.completed')
    expect(parseAgentError(error).code).toBe('session-conflict')
    expect(parseAgentRunReceipt(receipt).status).toBe('completed')
    expect(
      parseAgentToolResultContinuation({
        schema: AGENT_CONTINUATION_SCHEMA,
        requestId: 'request',
        idempotencyKey: 'once',
        sessionId: 'session',
        runId: 'run',
        callId: 'call',
        continuationId: 'continuation',
        manifestId: 'sha256:abc',
        target: { documentId: 'document' },
        status: 'error',
        error
      }).callId
    ).toBe('call')
  })

  test('rejects malformed gateway definitions and verifies content identity', async () => {
    const definitions = [
      {
        name: 'get_node',
        description: 'Get a node',
        mutates: false,
        requiresApproval: false,
        inputSchema: {
          type: 'object' as const,
          additionalProperties: false as const,
          properties: {},
          required: []
        }
      }
    ]
    const manifestId = await createAgentGatewayManifestId(definitions)
    expect(await verifyAgentGatewayToolManifest({ manifestId, definitions })).toBe(true)
    expect(
      await verifyAgentGatewayToolManifest({
        manifestId: `sha256:${'0'.repeat(64)}`,
        definitions
      })
    ).toBe(false)
    const base = {
      schema: AGENT_RUN_SCHEMA,
      requestId: 'request',
      idempotencyKey: 'once',
      conversation: { clientId: 'conversation' },
      input: { messageId: 'message', text: 'Inspect' },
      context: { documentId: 'document', selectedNodeIds: [] },
      capabilities: { toolResults: true, reconnect: true, cancellation: true, approvals: true }
    }
    expect(() =>
      parseAgentRunRequest({
        ...base,
        tools: { manifestId, definitions: [...definitions, definitions[0]] }
      })
    ).toThrow()
    expect(() =>
      parseAgentRunRequest({
        ...base,
        tools: { manifestId, definitions: [{ ...definitions[0], runtime: 'hidden' }] }
      })
    ).toThrow()
  })

  test('fails closed on unknown versions and recursively forbidden infrastructure', () => {
    expect(() =>
      parseAgentRunReceipt({ ...receipt, schema: 'openpencil.agent.receipt.v2' })
    ).toThrow()
    expect(() =>
      parseAgentEvent({
        schema: AGENT_EVENT_SCHEMA,
        sessionId: 'session',
        runId: 'run',
        seq: 1,
        eventId: 'event',
        timestamp: '2026-08-12T12:00:00.000Z',
        type: 'tool.call',
        data: {
          callId: 'call',
          continuationId: 'continuation',
          manifestId: 'manifest',
          name: 'get_node',
          arguments: { nested: { provider: 'secret' } },
          target: { documentId: 'document' }
        }
      })
    ).toThrow()
    expect(() => parseAgentError({ ...error, details: { runtime_id: 'hidden' } })).toThrow()
    for (const key of [
      'providerAccount',
      'billingAuthority',
      'runtimeUrl',
      'containerImage',
      'workerPool',
      'modelAlias',
      'registryHost',
      'machineType',
      'deploymentTarget',
      'regionCode'
    ]) {
      expect(() => parseAgentError({ ...error, details: { [key]: 'hidden' } })).toThrow()
    }
  })

  test('binds terminal events to terminal receipt truth', () => {
    expect(() =>
      parseAgentEvent({
        schema: AGENT_EVENT_SCHEMA,
        sessionId: 'session',
        runId: 'run',
        seq: 9,
        eventId: 'event-9',
        timestamp: '2026-08-12T12:00:01.000Z',
        type: 'run.completed',
        data: { receipt: { ...receipt, status: 'failed' } }
      })
    ).toThrow()
    expect(() =>
      parseAgentEvent({
        schema: AGENT_EVENT_SCHEMA,
        sessionId: 'session',
        runId: 'run',
        seq: 9,
        eventId: 'event-9',
        timestamp: '2026-08-12T12:00:01.000Z',
        type: 'run.completed',
        data: { receipt: { ...receipt, lastSequence: 8 } }
      })
    ).toThrow()
    expect(() =>
      parseAgentRunReceipt({ ...receipt, completedAt: '2026-08-12T11:59:59.000Z' })
    ).toThrow()
  })

  test('rejects malformed and oversized payloads', () => {
    expect(() =>
      parseAgentEvent({
        schema: AGENT_EVENT_SCHEMA,
        sessionId: 'session',
        runId: 'run',
        seq: -1,
        eventId: 'event',
        timestamp: '2026-08-12T12:00:00.000Z',
        type: 'message.delta',
        data: { messageId: 'message', text: 'hello' }
      })
    ).toThrow()
    expect(() => parseAgentError({ ...error, details: { text: 'x'.repeat(70_000) } })).toThrow()
    expect(() =>
      parseAgentToolResultContinuation({
        schema: AGENT_CONTINUATION_SCHEMA,
        requestId: 'request',
        idempotencyKey: 'once',
        sessionId: 'session',
        runId: 'run',
        callId: 'call',
        continuationId: 'continuation',
        manifestId: 'manifest',
        target: { documentId: 'document' },
        status: 'ok'
      })
    ).toThrow()
  })
})
