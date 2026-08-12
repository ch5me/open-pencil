import { describe, expect, test } from 'bun:test'

import {
  parseAgentError,
  parseAgentEvent,
  parseAgentRunReceipt,
  parseAgentRunRequest,
  parseAgentToolResultContinuation
} from '@open-pencil/core/agent'

const receipt = {
  schemaVersion: '1', sessionId: 'session', runId: 'run', requestId: 'request',
  traceId: 'trace', lastEventId: 'event-9', status: 'completed'
}

describe('agent gateway contracts', () => {
  test('parses valid requests, events, errors, receipts, and continuations', () => {
    expect(parseAgentRunRequest({
      schemaVersion: '1', requestId: 'request', idempotencyKey: 'once', conversationId: 'conversation',
      messageId: 'message', input: 'Draw a card', target: { documentId: 'document', selectionIds: [] },
      actionManifestId: 'sha256:abc', capabilities: ['actions']
    }).requestId).toBe('request')
    expect(parseAgentEvent({ schemaVersion: '1', eventId: 'event-9', sequence: 9, traceId: 'trace', type: 'run.completed', receipt }).type).toBe('run.completed')
    const error = { schemaVersion: '1', code: 'conflict', message: 'Different result', retryable: false, traceId: 'trace' }
    expect(parseAgentError(error).code).toBe('conflict')
    expect(parseAgentRunReceipt(receipt).status).toBe('completed')
    expect(parseAgentToolResultContinuation({ schemaVersion: '1', requestId: 'request', idempotencyKey: 'once', sessionId: 'session', runId: 'run', callId: 'call', outcome: { type: 'error', error } }).callId).toBe('call')
  })

  test('fails closed on unknown versions and recursively forbidden infrastructure', () => {
    expect(() => parseAgentRunReceipt({ ...receipt, schemaVersion: '2' })).toThrow()
    expect(() => parseAgentEvent({ schemaVersion: '1', eventId: 'event', sequence: 1, traceId: 'trace', type: 'action.result', callId: 'call', result: { nested: { provider: 'secret' } } })).toThrow()
    expect(() => parseAgentError({ schemaVersion: '1', code: 'conflict', message: 'bad', retryable: false, traceId: 'trace', details: { runtime_id: 'hidden' } })).toThrow()
  })

  test('rejects malformed and oversized payloads', () => {
    expect(() => parseAgentEvent({ schemaVersion: '1', eventId: 'event', sequence: -1, traceId: 'trace', type: 'message.delta', messageId: 'message', text: 'hello' })).toThrow()
    expect(() => parseAgentEvent({ schemaVersion: '1', eventId: 'event', sequence: 1, traceId: 'trace', type: 'action.result', callId: 'call', result: { text: 'x'.repeat(70_000) } })).toThrow()
    expect(() => parseAgentToolResultContinuation({ schemaVersion: '1', requestId: 'request', idempotencyKey: 'once', sessionId: 'session', runId: 'run', callId: 'call', outcome: { type: 'result' } })).toThrow()
  })
})
