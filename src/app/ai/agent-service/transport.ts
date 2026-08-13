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
import {
  clearAgentSession,
  loadAgentSession,
  resolveAgentResumeStore,
  saveAgentSession
} from './session'
import type { AgentResumeStore } from './session'

type RunState = {
  requestId: string
  idempotencyKey: string
  sessionId?: string
  runId?: string
  lastEventId?: string
  lastEventFingerprint?: string
  sequence?: number
  receipt?: AgentRunReceipt
  receiptId?: string
  manifestId?: string
  executeTool?: ReturnType<typeof createGatewayToolExecutor>
  finished: boolean
  interrupted: boolean
  textParts: Set<string>
  toolCalls: Set<string>
  recoveredToolCalls: Set<string>
  pendingApprovals: Set<string>
  pendingContinuations: Map<string, AgentToolResultContinuation>
  cancelling: boolean
  cancelPromise?: Promise<void>
  identityReady: Promise<'ready'>
  resolveIdentity: (value: 'ready') => void
  restored?: boolean
}

export type AgentServiceTransportOptions = HostedRequestOptions & {
  store: EditorStore
  documentId: string
  clientId?: string
  resumeStore?: AgentResumeStore
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

function eventFingerprint(event: AgentEvent): string {
  return JSON.stringify(event)
}

function validateOrder(event: AgentEvent, state: RunState): 'new' | 'replay' {
  const fingerprint = eventFingerprint(event)
  if (state.sequence !== undefined && event.seq === state.sequence) {
    if (event.eventId === state.lastEventId && fingerprint === state.lastEventFingerprint) {
      return 'replay'
    }
    throw new AgentServiceTransportError(
      'event-conflict',
      `Agent event sequence ${event.seq} was replayed with conflicting content.`
    )
  }
  if (state.sequence !== undefined && event.seq < state.sequence) {
    throw new AgentServiceTransportError(
      'event-reordered',
      `Agent event sequence ${event.seq} arrived after sequence ${state.sequence}.`
    )
  }
  if (state.sequence !== undefined && event.seq > state.sequence + 1) {
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
  state.lastEventFingerprint = fingerprint
  state.resolveIdentity('ready')
  return 'new'
}

function bindReceiptIdentity(event: AgentEvent, state: RunState): void {
  const receipt =
    event.type === 'receipt' ||
    event.type === 'run.completed' ||
    event.type === 'run.cancelled' ||
    event.type === 'run.failed'
      ? event.data.receipt
      : undefined
  if (receipt && state.receiptId && receipt.receiptId !== state.receiptId) {
    throw new AgentServiceTransportError(
      'session-conflict',
      'Agent receipt identity changed mid-run.'
    )
  }
  if (receipt) state.receiptId = receipt.receiptId
}

function acknowledgeToolResult(callId: string, state: RunState): void {
  if (state.toolCalls.has(callId)) return
  throw new AgentServiceTransportError(
    'tool-result-conflict',
    `Tool result acknowledgement does not match call ${callId}.`
  )
}

function acknowledgeApprovalRequirement(callId: string, state: RunState): void {
  if (state.toolCalls.has(callId) || state.pendingApprovals.has(callId)) {
    throw new AgentServiceTransportError(
      'approval-conflict',
      `Approval lifecycle for tool call ${callId} is duplicated or late.`
    )
  }
  state.pendingApprovals.add(callId)
}

function mapEvent(event: AgentEvent, state: RunState): UIMessageChunk[] {
  bindReceiptIdentity(event, state)
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
      state.pendingApprovals.delete(event.data.callId)
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
      acknowledgeToolResult(event.data.callId, state)
      return []
    case 'approval.required':
      acknowledgeApprovalRequirement(event.data.callId, state)
      return []
    case 'receipt':
      state.receipt = event.data.receipt
      return []
    case 'run.completed':
      if (state.pendingApprovals.size > 0) {
        throw new AgentServiceTransportError(
          'approval-unresolved',
          'Agent run completed with an uncorrelated approval requirement.'
        )
      }
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
  private readonly resumeStore: AgentResumeStore | undefined
  private readonly clientId: string

  constructor(private readonly options: AgentServiceTransportOptions) {
    this.requestFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.resumeStore = resolveAgentResumeStore(options.resumeStore)
    this.clientId = options.clientId ?? options.documentId
    const persisted = loadAgentSession(this.resumeStore, options.documentId, this.clientId)
    if (persisted) {
      const identity = Promise.withResolvers<'ready'>()
      this.active = {
        requestId: persisted.requestId,
        idempotencyKey: persisted.idempotencyKey,
        sessionId: persisted.sessionId,
        runId: persisted.runId,
        lastEventId: persisted.lastEventId,
        lastEventFingerprint: persisted.lastEventFingerprint,
        sequence: persisted.sequence,
        receiptId: persisted.receiptId,
        manifestId: persisted.manifestId,
        finished: false,
        interrupted: true,
        textParts: new Set(),
        toolCalls: new Set(persisted.executedToolCallIds),
        recoveredToolCalls: new Set(persisted.executedToolCallIds),
        pendingApprovals: new Set(persisted.pendingApprovalCallIds),
        pendingContinuations: new Map(
          persisted.pendingContinuation
            ? [[persisted.pendingContinuation.callId, persisted.pendingContinuation]]
            : []
        ),
        cancelling: false,
        identityReady: identity.promise,
        resolveIdentity: identity.resolve,
        restored: true
      }
      identity.resolve('ready')
    }
  }

  hasRestoredRun(): boolean {
    return this.active?.restored === true
  }

  private persist(state: RunState): boolean {
    if (!state.sessionId || !state.runId || !state.lastEventId || state.sequence === undefined)
      return false
    const pendingContinuation = state.pendingContinuations.values().next().value
    return saveAgentSession(this.resumeStore, {
      documentId: this.options.documentId,
      clientId: this.clientId,
      requestId: state.requestId,
      idempotencyKey: state.idempotencyKey,
      sessionId: state.sessionId,
      runId: state.runId,
      lastEventId: state.lastEventId,
      lastEventFingerprint: state.lastEventFingerprint,
      sequence: state.sequence,
      receiptId: state.receiptId,
      manifestId: state.manifestId ?? '',
      pendingApprovalCallIds: [...state.pendingApprovals],
      executedToolCallIds: [...state.toolCalls],
      pendingContinuation
    })
  }

  private clearPersisted(): void {
    clearAgentSession(this.resumeStore, this.options.documentId, this.clientId)
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

  private interruptedExecutionContinuation(
    event: Extract<AgentEvent, { type: 'tool.call' }>
  ): AgentToolResultContinuation {
    return this.continuation(event, {
      ok: false,
      callId: event.data.callId,
      continuationId: event.data.continuationId,
      error: {
        code: 'execution_failed',
        message: 'Tool execution was interrupted after its durable retry fence was written.'
      }
    })
  }

  private ensureApprovalMatches(
    event: Extract<AgentEvent, { type: 'tool.call' }>,
    state: RunState,
    action: GatewayActionManifest['actions'][number] | undefined
  ): void {
    if (!state.pendingApprovals.has(event.data.callId)) return
    if (action?.requiresApproval === true) return
    throw new AgentServiceTransportError(
      'approval-conflict',
      `Approval requirement does not map to an approval-gated action for call ${event.data.callId}.`
    )
  }

  private executor(state: RunState, event: Extract<AgentEvent, { type: 'tool.call' }>) {
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
    return { executeTool: state.executeTool, manifest }
  }

  private async consumeToolCall(
    event: Extract<AgentEvent, { type: 'tool.call' }>,
    state: RunState,
    controller: ReadableStreamDefaultController<UIMessageChunk>
  ): Promise<void> {
    const duplicateToolCall = state.toolCalls.has(event.data.callId)
    if (state.recoveredToolCalls.has(event.data.callId)) {
      throw new AgentServiceTransportError(
        'event-conflict',
        `Recovered tool call ${event.data.callId} cannot be executed again.`
      )
    }
    const { executeTool, manifest } = this.executor(state, event)
    const manifestAction = manifest.actions.find((action) => action.name === event.data.name)
    this.ensureApprovalMatches(event, state, manifestAction)
    for (const chunk of mapEvent(event, state)) controller.enqueue(chunk)

    const eventPageId =
      event.data.target.pageId ??
      (manifestAction?.mutates ? '' : this.options.store.state.currentPageId)
    const call = {
      runId: event.runId,
      callId: event.data.callId,
      continuationId: event.data.continuationId,
      manifestId: event.data.manifestId,
      target: {
        documentId: event.data.target.documentId,
        pageId: eventPageId
      },
      toolName: event.data.name,
      input: agentArguments(event.data.arguments)
    }
    let result: GatewayToolResult
    if (manifestAction?.mutates) {
      // Persist an at-most-once fence before mutation. A crash can lose the
      // result, but recovery must never replay an action with unknown outcome.
      const interrupted = this.interruptedExecutionContinuation(event)
      state.pendingContinuations.set(event.data.callId, interrupted)
      const fenced = this.persist(state)
      result =
        fenced || (!IS_BROWSER && !this.resumeStore)
          ? await executeTool(call)
          : {
              ok: false,
              callId: event.data.callId,
              continuationId: event.data.continuationId,
              error: {
                code: 'execution_failed',
                message: 'Tool execution requires durable reload recovery state.'
              }
            }
    } else {
      result = await executeTool(call)
    }
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
    this.persist(state)
    const continuationResponse = await this.response(
      `/api/agent/sessions/${encodeURIComponent(event.sessionId)}/runs/${encodeURIComponent(event.runId)}/tool-results`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(continuation)
      }
    )
    state.pendingContinuations.delete(event.data.callId)
    this.persist(state)
    await this.consumeInto(continuationResponse, state, controller)
  }

  private async consumeInto(
    response: Response,
    state: RunState,
    controller: ReadableStreamDefaultController<UIMessageChunk>
  ): Promise<void> {
    if (!response.body)
      throw new AgentServiceTransportError('stream-interrupted', 'Missing stream body.')
    for await (const event of sseEvents(response.body)) {
      if (validateOrder(event, state) === 'replay') continue
      if (event.type !== 'tool.call') this.persist(state)
      if (event.type === 'tool.call') await this.consumeToolCall(event, state, controller)
      else for (const chunk of mapEvent(event, state)) controller.enqueue(chunk)
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
          this.clearPersisted()
        } catch (error) {
          if (
            (error instanceof AgentServiceTransportError && error.code === 'stream-interrupted') ||
            state.pendingContinuations.size > 0
          ) {
            state.interrupted = true
          } else {
            state.finished = true
            this.clearPersisted()
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
      if (this.active.restored) {
        throw new AgentServiceTransportError(
          'session-conflict',
          'A persisted agent run must be reconnected before starting a new session.'
        )
      }
      if (!this.active.interrupted) {
        throw new AgentServiceTransportError('session-conflict', 'An agent run is already active.')
      }
      await this.cancel(this.active)
    }
    const message = latestUserMessage(messages)
    this.manifest ??= await createGatewayManifest(ALL_TOOLS)
    const previousSessionId = this.active?.finished ? this.active.sessionId : undefined
    const requestId = crypto.randomUUID()
    const identity = Promise.withResolvers<'ready'>()
    const state: RunState = {
      requestId,
      idempotencyKey: crypto.randomUUID(),
      finished: false,
      interrupted: false,
      textParts: new Set(),
      toolCalls: new Set(),
      recoveredToolCalls: new Set(),
      pendingApprovals: new Set(),
      pendingContinuations: new Map(),
      cancelling: false,
      identityReady: identity.promise,
      resolveIdentity: identity.resolve
    }
    this.active = state
    const requestCancellation = () => {
      state.cancelPromise = this.cancel(state)
    }
    if (abortSignal?.aborted) requestCancellation()
    else abortSignal?.addEventListener('abort', requestCancellation, { once: true })
    state.manifestId = this.manifest.manifestId
    const response = await this.response('/api/agent/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema: AGENT_RUN_SCHEMA,
        requestId,
        idempotencyKey: state.idempotencyKey,
        conversation: {
          clientId: this.options.clientId ?? chatId,
          ...(previousSessionId ? { sessionId: previousSessionId } : {})
        },
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
    this.manifest ??= await createGatewayManifest(ALL_TOOLS)
    if (state.manifestId && this.manifest.manifestId !== state.manifestId) {
      throw new AgentServiceTransportError(
        'capability-mismatch',
        'The hosted agent action manifest changed before recovery.'
      )
    }
    state.manifestId = this.manifest.manifestId
    // The AI SDK discards an interrupted response's open text parts. Let resumed
    // deltas establish fresh parts while retaining tool-call replay guards.
    state.textParts.clear()
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
      state.restored = false
      this.persist(state)
      return this.stream(response, state)
    }
    const response = await this.response(
      `/api/agent/sessions/${encodeURIComponent(state.sessionId)}/runs/${encodeURIComponent(state.runId)}/events`,
      { method: 'GET', headers: { 'Last-Event-ID': state.lastEventId } }
    )
    state.restored = false
    return this.stream(response, state)
  }

  private cancel(state: RunState): Promise<void> {
    if (state.finished) return Promise.resolve()
    if (state.cancelPromise) return state.cancelPromise
    state.cancelPromise = (async () => {
      state.cancelling = true
      state.interrupted = false
      if (!state.runId) {
        await state.identityReady
      }
      if (!state.runId || !state.sessionId) {
        throw new AgentServiceTransportError(
          'cancellation-failed',
          'Gateway did not provide cancellable run identity.'
        )
      }
      const { rejectPermissionsForSession } = await import('@/app/ai/acp/permission')
      rejectPermissionsForSession(state.runId)
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
          if (validateOrder(event, state) === 'replay') continue
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
