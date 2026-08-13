import { describe, expect, test } from 'bun:test'

import type { UIMessage } from 'ai'

import {
  AGENT_EVENT_SCHEMA,
  AGENT_RECEIPT_SCHEMA,
  parseAgentRunRequest,
  parseAgentToolResultContinuation
} from '@open-pencil/core/agent'

import { AgentServiceChatTransport } from '@/app/ai/agent-service/transport'
import {
  clearToolLogEntries,
  didHitStepLimit,
  getToolLogEntries,
  MAX_AGENT_STEPS,
  recordStepUsage
} from '@/app/ai/tools'
import { createEditorStore } from '@/app/editor/session'

function userMessage(): UIMessage {
  return { id: 'message-user', role: 'user', parts: [{ type: 'text', text: 'Create' }] }
}

function event(seq: number, type: string, data: Record<string, unknown> = {}) {
  return {
    schema: AGENT_EVENT_SCHEMA,
    sessionId: 'session-1',
    runId: 'run-1',
    seq,
    eventId: `event-${seq}`,
    timestamp: '2026-08-12T12:00:00.000Z',
    type,
    data
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

async function consume(stream: ReadableStream<unknown>): Promise<void> {
  for await (const chunk of stream) void chunk
}

describe('hosted tool lifecycle', () => {
  test('routes tool.call through the canonical AI wrapper lifecycle exactly once', async () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const beforeCount = store.graph.getChildren(pageId).length
    let snapshots = 0
    let renders = 0
    let graphUpdates = 0
    let flashes: string[] = []
    let approvals = 0
    let request = 0
    const snapshotPage = store.snapshotPage.bind(store)
    store.snapshotPage = () => {
      snapshots++
      return snapshotPage()
    }
    const requestRender = store.requestRender.bind(store)
    store.requestRender = () => {
      renders++
      requestRender()
    }
    store.aiFlashDone = (nodeIds) => {
      flashes = nodeIds
    }
    store.graph.onNodeEvents({ updated: () => graphUpdates++ })
    clearToolLogEntries(store)
    for (let index = 0; index < MAX_AGENT_STEPS - 1; index++) {
      recordStepUsage(
        {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          timestamp: index
        },
        store
      )
    }

    const hosted = new AgentServiceChatTransport({
      apiOrigin: 'https://agent.test',
      store,
      documentId: 'document-1',
      approve: ({ callId, toolName }) => {
        approvals++
        expect({ callId, toolName }).toEqual({ callId: 'call-1', toolName: 'create_shape' })
        return true
      },
      fetch: async (_input, init) => {
        request++
        if (request === 1) {
          const run = parseAgentRunRequest(JSON.parse(String(init?.body)) as unknown)
          const call = event(2, 'tool.call', {
            callId: 'call-1',
            continuationId: 'continue-1',
            manifestId: run.tools.manifestId,
            name: 'create_shape',
            arguments: { type: 'RECTANGLE', x: 10, y: 20, width: 100, height: 80 },
            target: { documentId: 'document-1', pageId }
          })
          return response([
            event(0, 'run.started', { requestId: run.requestId }),
            event(1, 'approval.required', { callId: 'call-1', prompt: 'Create a shape?' }),
            call
          ])
        }
        const continuation = parseAgentToolResultContinuation(
          JSON.parse(String(init?.body)) as unknown
        )
        return response([
          // A reconnect/retry may replay the last acknowledged event. It must not execute again.
          event(2, 'tool.call', {
            callId: 'call-1',
            continuationId: 'continue-1',
            manifestId: continuation.manifestId,
            name: 'create_shape',
            arguments: { type: 'RECTANGLE', x: 10, y: 20, width: 100, height: 80 },
            target: { documentId: 'document-1', pageId }
          }),
          event(3, 'run.completed', {
            receipt: {
              schema: AGENT_RECEIPT_SCHEMA,
              receiptId: 'receipt-1',
              requestId: continuation.requestId,
              sessionId: 'session-1',
              runId: 'run-1',
              status: 'completed',
              acceptedAt: '2026-08-12T12:00:00.000Z',
              completedAt: '2026-08-12T12:00:01.000Z',
              lastSequence: 3,
              gateway: { service: 'test', protocolVersion: '1' }
            }
          })
        ])
      }
    })

    const stream = await hosted.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat',
      messageId: undefined,
      messages: [userMessage()],
      abortSignal: undefined
    })
    await consume(stream)

    expect(store.graph.getChildren(pageId)).toHaveLength(beforeCount + 1)
    expect(approvals).toBe(1)
    expect(snapshots).toBe(2)
    expect(renders).toBe(1)
    // The canonical after-execute lifecycle recomputes the graph before requesting render.
    expect(graphUpdates).toBeGreaterThan(0)
    expect(flashes).toHaveLength(1)
    expect(getToolLogEntries(store)).toHaveLength(1)
    expect(didHitStepLimit(store)).toBeFalse()
    recordStepUsage(
      {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        timestamp: MAX_AGENT_STEPS
      },
      store
    )
    expect(didHitStepLimit(store)).toBeTrue()
    store.undo.undo()
    expect(store.graph.getChildren(pageId)).toHaveLength(beforeCount)
  })
})
