import { describe, expect, test } from 'bun:test'

import type { UIMessage } from 'ai'

import {
  AGENT_EVENT_SCHEMA,
  AGENT_RECEIPT_SCHEMA,
  AGENT_RUN_SCHEMA
} from '@open-pencil/core/agent'

import {
  AgentServiceChatTransport,
  AgentServiceTransportError,
  latestUserMessage
} from '@/app/ai/agent-service/transport'
import { createEditorStore } from '@/app/editor/session'

function userMessage(text: string): UIMessage {
  return { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }] }
}

function event(seq: number, type: string, data: Record<string, unknown> = {}) {
  return {
    schema: AGENT_EVENT_SCHEMA,
    sessionId: 'session-1',
    runId: 'run-1',
    seq,
    eventId: `event-${seq}`,
    timestamp: `2026-08-12T12:00:0${Math.min(seq, 9)}.000Z`,
    type,
    data
  }
}

function receipt(lastSequence: number) {
  return {
    schema: AGENT_RECEIPT_SCHEMA,
    receiptId: 'receipt-1',
    requestId: 'request-1',
    sessionId: 'session-1',
    runId: 'run-1',
    status: 'completed',
    acceptedAt: '2026-08-12T12:00:00.000Z',
    completedAt: '2026-08-12T12:00:09.000Z',
    lastSequence,
    gateway: { service: 'test', protocolVersion: '1' }
  }
}

function sse(events: unknown[]): Response {
  const text = events
    .map((value) => {
      const id = (value as { eventId: string }).eventId
      return `id: ${id}\ndata: ${JSON.stringify(value)}\n\n`
    })
    .join('')
  return new Response(text, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

async function chunks(stream: ReadableStream<unknown>) {
  const result = []
  for await (const chunk of stream) result.push(chunk)
  return result
}

function transport(fetch: typeof globalThis.fetch) {
  const store = createEditorStore()
  return new AgentServiceChatTransport({
    apiOrigin: 'https://agent.test',
    fetch,
    store,
    documentId: 'document-1'
  })
}

describe('hosted agent service transport', () => {
  test('extracts latest user turn and sends the canonical shared request', async () => {
    expect(latestUserMessage([userMessage('first'), userMessage('latest')]).parts).toEqual([
      { type: 'text', text: 'latest' }
    ])
    expect(() => latestUserMessage([])).toThrow(AgentServiceTransportError)

    let requestBody: Record<string, unknown> | undefined
    const hosted = transport((async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      const requestId = requestBody.requestId as string
      return sse([
        event(0, 'session.created', { requestId }),
        event(1, 'message.delta', { messageId: 'message-1', text: 'Hel' }),
        event(2, 'message.delta', { messageId: 'message-1', text: 'lo' }),
        event(3, 'message.end', { messageId: 'message-1' }),
        event(4, 'run.completed', { receipt: { ...receipt(4), requestId } })
      ])
    }) as unknown as typeof globalThis.fetch)
    const stream = await hosted.sendMessages({
      trigger: 'submit-message',
      chatId: 'client-chat',
      messageId: undefined,
      messages: [userMessage('Design')],
      abortSignal: undefined
    })
    const output = await chunks(stream)
    expect(requestBody?.schema).toBe(AGENT_RUN_SCHEMA)
    expect((requestBody?.conversation as { clientId: string }).clientId).toBe('client-chat')
    expect((requestBody?.context as { documentId: string }).documentId).toBe('document-1')
    expect(output.filter((chunk) => (chunk as { type: string }).type === 'text-start')).toHaveLength(1)
    expect(output).toContainEqual({ type: 'text-delta', id: 'message-1', delta: 'Hel' })
    expect(output.at(-1)).toMatchObject({
      type: 'finish',
      messageMetadata: {
        agentService: {
          sessionId: 'session-1',
          runId: 'run-1',
          receipt: { receiptId: 'receipt-1' }
        }
      }
    })
  })

  test('rejects out-of-order events as a typed transport failure', async () => {
    const hosted = transport((async () =>
      sse([
        event(0, 'run.started', { requestId: 'request-1' }),
        event(2, 'run.completed', { receipt: receipt(2) })
      ])) as unknown as typeof globalThis.fetch)
    const stream = await hosted.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat',
      messageId: undefined,
      messages: [userMessage('Design')],
      abortSignal: undefined
    })
    await expect(chunks(stream)).rejects.toMatchObject({ code: 'stream-interrupted' })
  })

  test('reconnects with canonical run identity and Last-Event-ID', async () => {
    const requests: Array<{ input: string; lastEventId: string | null }> = []
    let call = 0
    const hosted = transport((async (input, init) => {
      requests.push({
        input: String(input),
        lastEventId: new Headers(init?.headers).get('Last-Event-ID')
      })
      call++
      return call === 1
        ? sse([event(0, 'run.started', { requestId: 'request-1' })])
        : sse([event(1, 'run.completed', { receipt: receipt(1) })])
    }) as unknown as typeof globalThis.fetch)
    const first = await hosted.sendMessages({
      trigger: 'submit-message',
      chatId: 'client-chat',
      messageId: undefined,
      messages: [userMessage('Design')],
      abortSignal: undefined
    })
    await expect(chunks(first)).rejects.toMatchObject({ code: 'stream-interrupted' })
    const resumed = await hosted.reconnectToStream()
    expect(resumed).not.toBeNull()
    if (resumed) await chunks(resumed)
    expect(requests[1]).toEqual({
      input: 'https://agent.test/api/agent/sessions/session-1/runs/run-1/events',
      lastEventId: 'event-0'
    })
  })

  test('aborting an active run posts cancellation without fallback', async () => {
    const methods: string[] = []
    const paths: string[] = []
    const abort = new AbortController()
    const hosted = transport((async (input, init) => {
      methods.push(init?.method ?? 'GET')
      paths.push(new URL(String(input)).pathname)
      if (String(input).endsWith('/cancel')) {
        return sse([
          event(1, 'run.cancelled', {
            receipt: { ...receipt(1), status: 'cancelled' }
          })
        ])
      }
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `id: event-0\ndata: ${JSON.stringify(event(0, 'run.started', { requestId: 'request-1' }))}\n\n`
              )
            )
            setTimeout(() => {
              abort.abort()
              controller.close()
            })
          }
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      )
    }) as unknown as typeof globalThis.fetch)
    const stream = await hosted.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat',
      messageId: undefined,
      messages: [userMessage('Design')],
      abortSignal: abort.signal
    })
    await expect(chunks(stream)).rejects.toBeInstanceOf(Error)
    await Bun.sleep(0)
    expect(methods).toEqual(['POST', 'POST'])
    expect(paths[1]).toBe('/api/agent/sessions/session-1/runs/run-1/cancel')
  })
  test('executes a real ToolDef action, posts continuation, and finishes', async () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const requests: Array<{ path: string; body?: Record<string, unknown> }> = []
    let call = 0
    const hosted = new AgentServiceChatTransport({
      apiOrigin: 'https://agent.test',
      store,
      documentId: 'document-1',
      approve: async () => true,
      fetch: (async (input, init) => {
        const path = new URL(String(input)).pathname
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
        requests.push({ path, body })
        call++
        if (call === 1) {
          const requestId = body?.requestId as string
          const manifestId = (body?.tools as { manifestId: string }).manifestId
          return sse([
            event(0, 'run.started', { requestId }),
            event(1, 'tool.call', {
              callId: 'call-1',
              continuationId: 'continue-1',
              manifestId,
              name: 'create_shape',
              arguments: { type: 'RECTANGLE', x: 10, y: 20, width: 100, height: 80 },
              target: { documentId: 'document-1', pageId }
            })
          ])
        }
        const continuation = body as { requestId: string }
        return sse([
          event(2, 'message.delta', { messageId: 'message-1', text: 'Created.' }),
          event(3, 'message.end', { messageId: 'message-1' }),
          event(4, 'run.completed', {
            receipt: { ...receipt(4), requestId: continuation.requestId }
          })
        ])
      }) as unknown as typeof globalThis.fetch
    })

    const before = store.graph.getChildren(pageId).length
    const stream = await hosted.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat',
      messageId: undefined,
      messages: [userMessage('Create a rectangle')],
      abortSignal: undefined
    })
    const output = await chunks(stream)
    expect(store.graph.getChildren(pageId)).toHaveLength(before + 1)
    expect(requests[1]?.path).toBe('/api/agent/sessions/session-1/runs/run-1/tool-results')
    expect(requests[1]?.body).toMatchObject({
      status: 'ok',
      callId: 'call-1',
      continuationId: 'continue-1'
    })
    expect(output).toContainEqual({ type: 'text-delta', id: 'message-1', delta: 'Created.' })
    store.undo.undo()
    expect(store.graph.getChildren(pageId)).toHaveLength(before)
  })

})
