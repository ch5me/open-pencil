import { describe, expect, test } from 'bun:test'

import type { UIMessage } from 'ai'

import {
  createFireflyChatTransport,
  FireflyChatTransportError,
  latestUserMessage
} from '@/app/ai/runtime/firefly'

function userMessage(text: string): UIMessage {
  return { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }] }
}

describe('Firefly chat transport', () => {
  test('extracts the latest non-empty user turn', () => {
    expect(
      latestUserMessage([
        userMessage('first'),
        { id: 'assistant', role: 'assistant', parts: [{ type: 'text', text: 'reply' }] },
        userMessage('latest')
      ])
    ).toBe('latest')
    expect(() => latestUserMessage([])).toThrow(FireflyChatTransportError)
  })

  test('returns text only with exact runtime and billing receipt', async () => {
    const transport = createFireflyChatTransport({
      apiOrigin: 'https://openpencil.example.test',
      fetch: (async () =>
        new Response(
          JSON.stringify({
            text: 'Firefly response',
            receipt: {
              runtimeId: 'runtime-1',
              traceId: 'trace-1',
              billingAuthority: 'firefly',
              billingReference: 'trace-1'
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )) as typeof fetch
    })

    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage('Design this')],
      abortSignal: undefined
    })
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)

    expect(chunks).toContainEqual({
      type: 'text-delta',
      id: expect.any(String),
      delta: 'Firefly response'
    })
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      messageMetadata: {
        fireflyRuntimeReceipt: {
          runtimeId: 'runtime-1',
          traceId: 'trace-1',
          billingAuthority: 'firefly'
        }
      }
    })
  })

  test('fails closed when Firefly omits served identity', async () => {
    const transport = createFireflyChatTransport({
      apiOrigin: 'https://openpencil.example.test',
      fetch: (async () =>
        new Response(JSON.stringify({ text: 'unsafe', receipt: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })) as typeof fetch
    })

    await expect(
      transport.sendMessages({
        trigger: 'submit-message',
        chatId: 'chat-1',
        messageId: undefined,
        messages: [userMessage('Design this')],
        abortSignal: undefined
      })
    ).rejects.toThrow('missing runtime or billing identity')
  })
})
