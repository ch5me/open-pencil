import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import { createHostedRequester, type HostedRequestOptions } from '@/app/hosted/http'

export type FireflyRuntimeReceipt = {
  runtimeId: string
  traceId: string
  billingAuthority: 'firefly'
  billingReference: string
}

type FireflyRuntimeChatResponse = {
  text: string
  receipt: FireflyRuntimeReceipt
}

export class FireflyChatTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FireflyChatTransportError'
  }
}

function messageText(message: UIMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<(typeof message.parts)[number], { type: 'text' }> =>
        part.type === 'text'
    )
    .map((part) => part.text)
    .join('\n')
    .trim()
}

export function latestUserMessage(messages: UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    const text = messageText(message)
    if (text) return text
  }
  throw new FireflyChatTransportError('Firefly chat requires a user message.')
}

export function createFireflyChatTransport(
  options: HostedRequestOptions = {}
): ChatTransport<UIMessage> {
  const request = createHostedRequester(options)

  return {
    async sendMessages({ chatId, messages, abortSignal }) {
      const result = await request<FireflyRuntimeChatResponse>('/api/runtime/chat', {
        method: 'POST',
        signal: abortSignal,
        body: JSON.stringify({
          message: latestUserMessage(messages),
          chatSessionId: chatId
        })
      })
      if (!result.receipt?.runtimeId || !result.receipt.traceId) {
        throw new FireflyChatTransportError(
          'Firefly runtime response is missing runtime or billing identity.'
        )
      }

      const partId = crypto.randomUUID()
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.enqueue({
            type: 'start',
            messageMetadata: { fireflyRuntimeReceipt: result.receipt }
          })
          controller.enqueue({ type: 'text-start', id: partId })
          controller.enqueue({ type: 'text-delta', id: partId, delta: result.text })
          controller.enqueue({ type: 'text-end', id: partId })
          controller.enqueue({
            type: 'finish',
            finishReason: 'stop',
            messageMetadata: { fireflyRuntimeReceipt: result.receipt }
          })
          controller.close()
        }
      })
    },

    reconnectToStream() {
      return Promise.resolve(null)
    }
  }
}
