import { describe, expect, test } from 'bun:test'

import type { UIMessage } from 'ai'

import { AGENT_EVENT_SCHEMA } from '@open-pencil/core/agent'

import { AgentServiceChatTransport } from '@/app/ai/agent-service/transport'
import { createEditorStore } from '@/app/editor/session'

function event(seq: number, text = 'hello') {
  return {
    schema: AGENT_EVENT_SCHEMA,
    sessionId: 'session-1',
    runId: 'run-1',
    seq,
    eventId: `event-${seq}`,
    timestamp: '2026-08-12T12:00:00.000Z',
    type: 'message.delta',
    data: { messageId: 'message-1', text }
  }
}

function response(events: unknown[]): Response {
  return new Response(
    events
      .map((value) => {
        const { eventId } = value as { eventId: string }
        return `id: ${eventId}\ndata: ${JSON.stringify(value)}\n\n`
      })
      .join(''),
    { headers: { 'Content-Type': 'text/event-stream' } }
  )
}

async function failure(events: unknown[]) {
  const hosted = new AgentServiceChatTransport({
    apiOrigin: 'https://agent.test',
    store: createEditorStore(),
    documentId: 'document-1',
    fetch: async () => response(events)
  })
  const message: UIMessage = {
    id: 'user-1',
    role: 'user',
    parts: [{ type: 'text', text: 'Design' }]
  }
  const stream = await hosted.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat',
    messageId: undefined,
    messages: [message],
    abortSignal: undefined
  })
  for await (const chunk of stream) void chunk
}

describe('hosted event ordering', () => {
  test('accepts an identical immediate replay before failing only for incomplete stream', async () => {
    await expect(failure([event(0), event(0)])).rejects.toMatchObject({
      code: 'stream-interrupted',
      message: 'Agent event stream ended before completion.'
    })
  })

  test('rejects a conflicting duplicate', async () => {
    await expect(failure([event(0), event(0, 'changed')])).rejects.toMatchObject({
      code: 'event-conflict'
    })
  })

  test('rejects reordered and gapped sequences with typed errors', async () => {
    await expect(failure([event(1), event(0)])).rejects.toMatchObject({
      code: 'event-reordered'
    })
    await expect(failure([event(0), event(2)])).rejects.toMatchObject({
      code: 'stream-interrupted',
      message: 'Expected agent event sequence 1, received 2.'
    })
  })

  test('fails loudly when approval.required is never correlated to a tool.call', async () => {
    const approval = {
      ...event(0),
      type: 'approval.required',
      data: { callId: 'call-1', prompt: 'Approve?' }
    }
    const completed = {
      ...event(1),
      type: 'run.completed',
      data: {
        receipt: {
          schema: 'openpencil.agent.receipt.v1',
          receiptId: 'receipt-1',
          requestId: 'request-1',
          sessionId: 'session-1',
          runId: 'run-1',
          status: 'completed',
          acceptedAt: '2026-08-12T12:00:00.000Z',
          completedAt: '2026-08-12T12:00:01.000Z',
          lastSequence: 1,
          gateway: { service: 'test', protocolVersion: '1' }
        }
      }
    }
    await expect(failure([approval, completed])).rejects.toMatchObject({
      code: 'approval-unresolved'
    })
  })
})
