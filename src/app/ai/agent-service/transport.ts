import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import {
  AGENT_CONTINUATION_SCHEMA,
  AGENT_ERROR_SCHEMA,
  AGENT_RUN_SCHEMA,
  parseAgentEvent
} from '@open-pencil/core/agent'
import type {
  AgentErrorCode,
  AgentEvent,
  AgentJSONValue,
  AgentRunReceipt,
  AgentToolResultContinuation
} from '@open-pencil/core/agent'
import { ALL_TOOLS, createGatewayManifest } from '@open-pencil/core/tools'
import type { GatewayActionManifest } from '@open-pencil/core/tools'

import type { EditorStore } from '@/app/editor/active-store'
import { getHostedConfig } from '@/app/hosted/flags'
import type { HostedRequestOptions } from '@/app/hosted/http'
import { IS_BROWSER } from '@/constants'

import { requestToolApprovalFromUser } from './approval'
import { createGatewayToolExecutor } from './execution'
import type { GatewayToolResult, GatewayToolExecutorOptions } from './execution'

type RunState = {
  requestId: string
  idempotencyKey: string
  sessionId?: string
  runId?: string
  lastEventId?: string
  sequence?: number
  receipt?: AgentRunReceipt
  executeTool?: ReturnType<typeof createGatewayToolExecutor>
  finished: boolean
  interrupted: boolean
  textParts: Set<string>
  toolCalls: Set<string>
  pendingContinuations: Map<string, AgentToolResultContinuation>
  cancelling: boolean
  cancelPromise?: Promise<void>
}

export type AgentServiceTransportOptions = HostedRequestOptions & {
  store: EditorStore
  documentId: string
  isTargetActive?: () => boolean
  approve?: GatewayToolExecutorOptions['approve']
}

export class AgentServiceTransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'AgentServiceTransportError'
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

export function latestUserMessage(messages: UIMessage[]): UIMessage {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'user' && messageText(message)) return message
  }
  throw new AgentServiceTransportError(
    'invalid-request',
    'Hosted agent chat requires a user message.'
  )
}

function toAgentJSON(value: unknown): AgentJSONValue {
  const serialized = JSON.stringify(value ?? null)
  return JSON.parse(serialized) as AgentJSONValue
}

function agentArguments(value: AgentJSONValue): Record<string, AgentJSONValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function errorCode(result: GatewayToolResult): AgentErrorCode {
  if (result.ok) return 'run-failed'
  if (result.error.code === 'approval_rejected') return 'tool-rejected'
  if (result.error.code === 'target_mismatch') return 'tool-target-mismatch'
  if (result.error.code === 'invalid_schema') return 'tool-arguments-invalid'
  return result.error.code === 'tool_unavailable' ? 'tool-not-allowed' : 'run-failed'
}

function metadata(state: RunState) {
  return {
    agentService: {
      sessionId: state.sessionId,
      runId: state.runId,
      lastEventId: state.lastEventId,
      sequence: state.sequence,
      receipt: state.receipt
    }
  }
}

function validateOrder(event: AgentEvent, state: RunState) {
  if (state.sequence !== undefined && event.seq !== state.sequence + 1) {
    throw new AgentServiceTransportError(
      'stream-interrupted',
      `Expected agent event sequence ${state.sequence + 1}, received ${event.seq}.`
    )
  }
  if (
    (state.sessionId && event.sessionId !== state.sessionId) ||
    (state.runId && event.runId !== state.runId)
  ) {
    throw new AgentServiceTransportError(
      'session-conflict',
      'Agent event identity changed mid-run.'
    )
  }
  state.sessionId = event.sessionId
  state.runId = event.runId
  state.sequence = event.seq
  state.lastEventId = event.eventId
}

function mapEvent(event: AgentEvent, state: RunState): UIMessageChunk[] {
  switch (event.type) {
    case 'session.created':
    case 'run.started':
      return state.sequence === event.seq && event.seq <= 1
        ? [{ type: 'start', messageMetadata: metadata(state) }]
        : []
    case 'message.start':
      if (state.textParts.has(event.data.messageId)) return []
      state.textParts.add(event.data.messageId)
      return [{ type: 'text-start', id: event.data.messageId }]
    case 'message.delta': {
      const chunks: UIMessageChunk[] = []
      if (!state.textParts.has(event.data.messageId)) {
        state.textParts.add(event.data.messageId)
        chunks.push({ type: 'text-start', id: event.data.messageId })
      }
      chunks.push({ type: 'text-delta', id: event.data.messageId, delta: event.data.text })
      return chunks
    }
    case 'message.end':
      return [{ type: 'text-end', id: event.data.messageId }]
    case 'tool.call':
      if (state.toolCalls.has(event.data.callId)) return []
      state.toolCalls.add(event.data.callId)
      return [
        {
          type: 'tool-input-available',
          toolCallId: event.data.callId,
          toolName: event.data.name,
          input: event.data.arguments,
          providerExecuted: false
        }
      ]
    case 'tool.result':
      return []
    case 'approval.required':
      return []
    case 'receipt':
      state.receipt = event.data.receipt
      return []
    case 'run.completed':
      state.receipt = event.data.receipt
      state.finished = true
      return [{ type: 'finish', finishReason: 'stop', messageMetadata: metadata(state) }]
    case 'run.cancelled':
      state.receipt = event.data.receipt
      state.finished = true
      throw new AgentServiceTransportError('cancelled', 'Agent run was cancelled.')
    case 'run.failed':
      state.finished = true
      throw new AgentServiceTransportError(event.data.error.code, event.data.error.message)
  }
  return []
}

async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    let done = false
    while (!done) {
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await reader.read()
      } catch {
        throw new AgentServiceTransportError(
          'stream-interrupted',
          'Agent event stream disconnected.'
        )
      }
      done = result.done
      buffer += decoder.decode(result.value, { stream: !done }).replaceAll('\r\n', '\n')
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const id = frame
          .split('\n')
          .find((line) => line.startsWith('id:'))
          ?.slice(3)
          .trim()
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (!data) continue
        let value: unknown
        try {
          value = JSON.parse(data)
        } catch {
          throw new AgentServiceTransportError(
            'stream-interrupted',
            'Agent stream contained malformed JSON.'
          )
        }
        let event: AgentEvent
        try {
          event = parseAgentEvent(value)
        } catch {
          throw new AgentServiceTransportError(
            'stream-interrupted',
            'Agent stream contained a malformed event.'
          )
        }
        if (!id || event.eventId !== id) {
          throw new AgentServiceTransportError(
            'stream-interrupted',
            'SSE event identity is invalid.'
          )
        }
        yield event
      }
    }
    if (buffer.trim()) {
      throw new AgentServiceTransportError('stream-interrupted', 'Agent stream ended mid-event.')
    }
  } finally {
    reader.releaseLock()
  }
}

export class AgentServiceChatTransport implements ChatTransport<UIMessage> {
  private active?: RunState
  private readonly requestFetch: typeof fetch
  private manifest?: GatewayActionManifest

  constructor(private readonly options: AgentServiceTransportOptions) {
    this.requestFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  private headers(extra?: HeadersInit): Headers {
    const headers = new Headers(extra)
    headers.set('Accept', 'text/event-stream')
    const token =
      this.options.sessionToken?.() ??
      (IS_BROWSER ? window.openPencil?.test?.hostedAuthToken : undefined)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return headers
  }

  private async response(path: string, init: RequestInit): Promise<Response> {
    const origin = this.options.apiOrigin ?? getHostedConfig().apiOrigin
    if (!origin)
      throw new AgentServiceTransportError('gateway-unavailable', 'Agent API is not configured.')
    const response = await this.requestFetch(`${origin}${path}`, {
      ...init,
      credentials: 'include',
      headers: this.headers(init.headers)
    })
    if (!response.ok || !response.body) {
      const error = (await response.json().catch(() => null)) as {
        code?: string
        message?: string
      } | null
      throw new AgentServiceTransportError(
        error?.code ?? 'gateway-unavailable',
        error?.message ?? response.statusText,
        response.status
      )
    }
    return response
  }

  private continuation(
    event: Extract<AgentEvent, { type: 'tool.call' }>,
    result: GatewayToolResult
  ): AgentToolResultContinuation {
    const base = {
      schema: AGENT_CONTINUATION_SCHEMA,
      requestId: this.active?.requestId ?? '',
      idempotencyKey: `${this.active?.idempotencyKey}:${event.data.callId}`,
      sessionId: event.sessionId,
      runId: event.runId,
      callId: event.data.callId,
      continuationId: event.data.continuationId,
      manifestId: event.data.manifestId,
      target: event.data.target
    } as const
    if (result.ok) {
      return { ...base, status: 'ok', output: toAgentJSON(result.output) }
    }
    const rejected = result.error.code === 'approval_rejected'
    return {
      ...base,
      status: rejected ? 'rejected' : 'error',
      error: {
        schema: AGENT_ERROR_SCHEMA,
        code: errorCode(result),
        message: result.error.message,
        retryable: false,
        phase: 'tool',
        requestId: base.requestId,
        sessionId: base.sessionId,
        runId: base.runId
      }
    }
  }

  private async consumeInto(
    response: Response,
    state: RunState,
    controller: ReadableStreamDefaultController<UIMessageChunk>
  ): Promise<void> {
    if (!response.body)
      throw new AgentServiceTransportError('stream-interrupted', 'Missing stream body.')
    for await (const event of sseEvents(response.body)) {
      validateOrder(event, state)
      const duplicateToolCall = event.type === 'tool.call' && state.toolCalls.has(event.data.callId)
      for (const chunk of mapEvent(event, state)) controller.enqueue(chunk)
      if (event.type !== 'tool.call') continue

      const manifest = this.manifest
      if (!manifest)
        throw new AgentServiceTransportError('capability-mismatch', 'Tool manifest is missing.')
      state.executeTool ??= createGatewayToolExecutor({
        store: this.options.store,
        runId: event.runId,
        target: () =>
          this.options.isTargetActive?.() === false
            ? { documentId: '', pageId: '' }
            : {
                documentId: this.options.documentId,
                pageId: this.options.store.state.currentPageId
              },
        manifest: {
          id: manifest.manifestId,
          actions: manifest.actions.map(({ name, mutates, requiresApproval }) => ({
            name,
            mutates,
            requiresApproval
          }))
        },
        approve: this.options.approve ?? requestToolApprovalFromUser,
        isCancelled: () => state.cancelling
      })
      const input = agentArguments(event.data.arguments)
      const manifestAction = manifest.actions.find((action) => action.name === event.data.name)
      const eventPageId =
        event.data.target.pageId ??
        (manifestAction?.mutates ? '' : this.options.store.state.currentPageId)
      const result = await state.executeTool({
        runId: event.runId,
        callId: event.data.callId,
        continuationId: event.data.continuationId,
        manifestId: event.data.manifestId,
        target: {
          documentId: event.data.target.documentId,
          pageId: eventPageId
        },
        toolName: event.data.name,
        input
      })
      if (!duplicateToolCall) {
        controller.enqueue(
          result.ok
            ? {
                type: 'tool-output-available',
                toolCallId: result.callId,
                output: result.output,
                providerExecuted: false
              }
            : {
                type: 'tool-output-error',
                toolCallId: result.callId,
                errorText: result.error.message,
                providerExecuted: false
              }
        )
      }
      const continuation = this.continuation(event, result)
      state.pendingContinuations.set(event.data.callId, continuation)
      const continuationResponse = await this.response(
        `/api/agent/sessions/${encodeURIComponent(event.sessionId)}/runs/${encodeURIComponent(event.runId)}/tool-results`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(continuation)
        }
      )
      state.pendingContinuations.delete(event.data.callId)
      await this.consumeInto(continuationResponse, state, controller)
    }
  }

  private stream(response: Response, state: RunState): ReadableStream<UIMessageChunk> {
    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        try {
          state.interrupted = false
          await this.consumeInto(response, state, controller)
          if (state.cancelPromise) await state.cancelPromise
          if (!state.finished) {
            throw new AgentServiceTransportError(
              'stream-interrupted',
              'Agent event stream ended before completion.'
            )
          }
          controller.close()
        } catch (error) {
          if (
            (error instanceof AgentServiceTransportError && error.code === 'stream-interrupted') ||
            state.pendingContinuations.size > 0
          ) {
            state.interrupted = true
          } else {
            state.finished = true
          }
          controller.error(error)
        }
      }
    })
  }

  async sendMessages({
    chatId,
    messages,
    abortSignal
  }: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]) {
    if (this.active && !this.active.finished) {
      if (!this.active.interrupted) {
        throw new AgentServiceTransportError('session-conflict', 'An agent run is already active.')
      }
      await this.cancel(this.active)
    }
    const message = latestUserMessage(messages)
    this.manifest ??= await createGatewayManifest(ALL_TOOLS)
    const requestId = crypto.randomUUID()
    const state: RunState = {
      requestId,
      idempotencyKey: crypto.randomUUID(),
      finished: false,
      interrupted: false,
      textParts: new Set(),
      toolCalls: new Set(),
      pendingContinuations: new Map(),
      cancelling: false
    }
    this.active = state
    abortSignal?.addEventListener(
      'abort',
      () => {
        state.cancelPromise = this.cancel(state)
      },
      { once: true }
    )
    const response = await this.response('/api/agent/runs', {
      method: 'POST',
      signal: abortSignal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema: AGENT_RUN_SCHEMA,
        requestId,
        idempotencyKey: state.idempotencyKey,
        conversation: { clientId: chatId },
        input: { messageId: message.id, text: messageText(message) },
        context: {
          documentId: this.options.documentId,
          pageId: this.options.store.state.currentPageId,
          selectedNodeIds: [...this.options.store.state.selectedIds]
        },
        tools: {
          manifestId: this.manifest.manifestId,
          definitions: this.manifest.actions
        },
        capabilities: {
          toolResults: true,
          reconnect: true,
          cancellation: true,
          approvals: true
        }
      })
    })
    return this.stream(response, state)
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    const state = this.active
    if (
      !state ||
      state.finished ||
      !state.interrupted ||
      !state.sessionId ||
      !state.runId ||
      !state.lastEventId
    )
      return null
    const pending = state.pendingContinuations.values().next().value
    if (pending) {
      const response = await this.response(
        `/api/agent/sessions/${encodeURIComponent(state.sessionId)}/runs/${encodeURIComponent(state.runId)}/tool-results`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pending)
        }
      )
      state.pendingContinuations.delete(pending.callId)
      return this.stream(response, state)
    }
    const response = await this.response(
      `/api/agent/sessions/${encodeURIComponent(state.sessionId)}/runs/${encodeURIComponent(state.runId)}/events`,
      { method: 'GET', headers: { 'Last-Event-ID': state.lastEventId } }
    )
    return this.stream(response, state)
  }

  private cancel(state: RunState): Promise<void> {
    if (state.finished) return Promise.resolve()
    if (state.cancelPromise) return state.cancelPromise
    state.cancelPromise = (async () => {
      state.cancelling = true
      state.interrupted = false
      if (!state.runId) {
        state.finished = true
        return
      }
      const { rejectPermissionsForSession } = await import('@/app/ai/acp/permission')
      rejectPermissionsForSession(state.runId)
      if (!state.sessionId) {
        state.finished = true
        return
      }
      try {
        const response = await this.response(
          `/api/agent/sessions/${encodeURIComponent(state.sessionId)}/runs/${encodeURIComponent(state.runId)}/cancel`,
          { method: 'POST' }
        )
        if (!response.body)
          throw new AgentServiceTransportError(
            'cancellation-failed',
            'Cancellation receipt is missing.'
          )
        let confirmed = false
        for await (const event of sseEvents(response.body)) {
          validateOrder(event, state)
          if (event.type !== 'run.cancelled' || confirmed) {
            throw new AgentServiceTransportError(
              'cancellation-failed',
              'Gateway did not confirm cancellation.'
            )
          }
          confirmed = true
          state.receipt = event.data.receipt
        }
        if (!confirmed || state.receipt?.status !== 'cancelled') {
          throw new AgentServiceTransportError(
            'cancellation-failed',
            'Gateway did not confirm cancellation.'
          )
        }
        state.finished = true
      } catch (error) {
        state.cancelling = false
        state.cancelPromise = undefined
        throw new AgentServiceTransportError(
          'cancellation-failed',
          error instanceof Error ? error.message : 'Agent cancellation failed.'
        )
      }
    })()
    return state.cancelPromise
  }
}

export function createAgentServiceChatTransport(
  options: AgentServiceTransportOptions
): ChatTransport<UIMessage> {
  return new AgentServiceChatTransport(options)
}
