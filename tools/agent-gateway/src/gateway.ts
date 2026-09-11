import {
  AGENT_ERROR_SCHEMA,
  AGENT_EVENT_SCHEMA,
  AGENT_RECEIPT_SCHEMA,
  parseAgentRunRequest,
  parseAgentToolResultContinuation,
  verifyAgentGatewayToolManifest
} from '@open-pencil/agent-contracts'
import type {
  AgentEvent,
  AgentJSONValue,
  AgentRunReceipt,
  AgentRunRequest,
  AgentToolResultContinuation
} from '@open-pencil/agent-contracts'

import { AgentExecutorError, createDeterministicExecutor } from './executor'
import type { AgentExecutor, AgentToolCall } from './executor'
import { AgentCatalogError, findAgentOption, selectionError } from './options'
import type { AgentCatalogSource } from './options'

interface RunState {
  principal: string
  request: AgentRunRequest
  sessionId: string
  runId: string
  events: AgentEvent[]
  continuation?: AgentToolResultContinuation
  continuationResponseStart?: number
  cancelled: boolean
  selection?: AgentRunRequest['selection']
  optionId: string
  executor: AgentExecutor
  abortController: AbortController
  call?: AgentToolCall
}

export interface AgentGateway {
  fetch(request: Request): Promise<Response>
  reset(): void
}

type RunRoute = {
  state: RunState
  action: 'tool-results' | 'cancel' | 'events'
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

function actionAcceptsArguments(
  action: AgentRunRequest['tools']['definitions'][number],
  argumentsValue: AgentJSONValue
): boolean {
  if (
    argumentsValue === null ||
    typeof argumentsValue !== 'object' ||
    Array.isArray(argumentsValue)
  ) {
    return false
  }
  const { properties, required } = action.inputSchema
  return (
    Object.keys(argumentsValue).every((name) => Object.hasOwn(properties, name)) &&
    required.every((name) => Object.hasOwn(argumentsValue, name)) &&
    Object.entries(argumentsValue).every(([name, value]) => {
      const property = properties[name]
      if (!property) return false
      if (property.type === 'array') {
        return Array.isArray(value) && value.every((item) => typeof item === 'string')
      }
      return typeof value === property.type
    })
  )
}

function receipt(state: RunState, status: AgentRunReceipt['status']): AgentRunReceipt {
  return {
    schema: AGENT_RECEIPT_SCHEMA,
    receiptId: `receipt-${state.runId}`,
    requestId: state.request.requestId,
    sessionId: state.sessionId,
    runId: state.runId,
    status,
    acceptedAt: '2026-08-12T12:00:00.000Z',
    ...(status === 'accepted' ? {} : { completedAt: '2026-08-12T12:00:01.000Z' }),
    lastSequence: Math.max(0, state.events.length),
    gateway: { service: 'openpencil-local-agent-gateway', protocolVersion: '1' }
  }
}

function push(
  state: RunState,
  event: Omit<AgentEvent, 'schema' | 'sessionId' | 'runId' | 'seq' | 'eventId' | 'timestamp'>
): AgentEvent {
  const seq = state.events.length
  const value = {
    schema: AGENT_EVENT_SCHEMA,
    sessionId: state.sessionId,
    runId: state.runId,
    seq,
    eventId: `event-${seq}`,
    timestamp: `2026-08-12T12:00:${String(seq).padStart(2, '0')}.000Z`,
    ...event
  } as AgentEvent
  state.events.push(value)
  return value
}

function sse(events: AgentEvent[], malformed = false): Response {
  const body = malformed
    ? 'id: broken\ndata: {not-json}\n\n'
    : events.map((event) => `id: ${event.eventId}\ndata: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(body, {
    headers: {
      'cache-control': 'no-cache, no-transform',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no'
    }
  })
}

function interruptedSse(events: AgentEvent[]): Response {
  const encoder = new TextEncoder()
  let sent = false
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (sent) {
          controller.error(new Error('Deterministic gateway disconnect'))
          return
        }
        sent = true
        controller.enqueue(
          encoder.encode(
            events
              .map((event) => `id: ${event.eventId}\ndata: ${JSON.stringify(event)}\n\n`)
              .join('')
          )
        )
      }
    }),
    {
      headers: {
        'cache-control': 'no-cache, no-transform',
        'content-type': 'text/event-stream; charset=utf-8',
        'x-accel-buffering': 'no'
      }
    }
  )
}

function runKey(principal: string, sessionId: string, runId: string): string {
  return `${principal}/${sessionId}/${runId}`
}

function resolveRunRoute(
  request: Request,
  url: URL,
  runs: Map<string, RunState>
): RunRoute | Response {
  const match = url.pathname.match(
    /^\/v1\/sessions\/([^/]+)\/runs\/([^/]+)\/(tool-results|cancel|events)$/
  )
  if (!match) return json({ code: 'session-not-found', message: 'Run not found.' }, 404)
  const principal = request.headers.get('x-openpencil-principal')
  if (!principal)
    return json({ code: 'unauthorized', message: 'Verified principal required.' }, 401)
  const state = runs.get(
    runKey(principal, decodeURIComponent(match[1]), decodeURIComponent(match[2]))
  )
  if (!state) return json({ code: 'session-not-found', message: 'Run not found.' }, 404)
  return { state, action: match[3] as RunRoute['action'] }
}

async function startRun(
  request: Request,
  runs: Map<string, RunState>,
  idempotency: Map<string, RunState>,
  catalogSource: AgentCatalogSource,
  executor: AgentExecutor
): Promise<Response> {
  const principal = request.headers.get('x-openpencil-principal')
  if (!principal)
    return json({ code: 'unauthorized', message: 'Verified principal required.' }, 401)
  let body: AgentRunRequest
  try {
    body = parseAgentRunRequest(await request.json())
  } catch {
    return json({ code: 'invalid-request', message: 'Malformed run request.' }, 400)
  }
  const idempotencyKey = `${principal}/${body.idempotencyKey}`
  const existing = idempotency.get(idempotencyKey)
  if (existing) return sse(existing.events)

  let catalog
  try {
    catalog = await catalogSource(principal)
  } catch (error) {
    if (error instanceof AgentCatalogError) return error.response()
    return new AgentCatalogError(
      'options-unavailable',
      'Agent Native catalog is unavailable.'
    ).response()
  }
  const invalidSelection = selectionError(catalog, body.selection)
  if (invalidSelection) return json({ code: 'invalid-request', message: invalidSelection }, 400)
  if (!(await verifyAgentGatewayToolManifest(body.tools))) {
    return json({ code: 'invalid-request', message: 'Manifest identity mismatch.' }, 400)
  }
  const option = body.selection
    ? findAgentOption(catalog, body.selection)
    : (catalog.options.find((candidate) => candidate.default) ?? catalog.options[0])
  if (!option) {
    return json({ code: 'options-unavailable', message: 'No agent option is available.' }, 503)
  }

  const state: RunState = {
    principal,
    request: body,
    sessionId: body.conversation.sessionId ?? `session-${body.conversation.clientId}`,
    runId: `run-${body.requestId}`,
    events: [],
    cancelled: false,
    selection: body.selection,
    optionId: option.optionId,
    executor,
    abortController: new AbortController()
  }
  runs.set(runKey(principal, state.sessionId, state.runId), state)
  idempotency.set(idempotencyKey, state)
  if (body.input.text.includes('[malformed]')) return sse([], true)

  push(state, { type: 'session.created', data: { requestId: body.requestId } })
  push(state, { type: 'run.started', data: { requestId: body.requestId } })
  push(state, {
    type: 'message.start',
    data: { messageId: 'assistant-1', role: 'assistant' }
  })
  try {
    const execution = await executor.start({
      request: body,
      optionId: option.optionId,
      optionLabel: option.label,
      effort: body.selection?.effort,
      signal: state.abortController.signal
    })
    if (state.cancelled) return sse(state.events)
    for (const text of execution.text) {
      push(state, {
        type: 'message.delta',
        data: { messageId: 'assistant-1', text }
      })
    }
    if (execution.kind === 'completed') {
      push(state, { type: 'message.end', data: { messageId: 'assistant-1' } })
      push(state, {
        type: 'run.completed',
        data: { receipt: receipt(state, 'completed') }
      })
      return sse(state.events)
    }
    const action = body.tools.definitions.find(
      (definition) => definition.name === execution.call.name
    )
    if (!action) {
      runs.delete(runKey(principal, state.sessionId, state.runId))
      idempotency.delete(idempotencyKey)
      return json({ code: 'tool-not-allowed', message: 'Requested tool is not defined.' }, 403)
    }
    if (!action.mutates || !action.requiresApproval) {
      runs.delete(runKey(principal, state.sessionId, state.runId))
      idempotency.delete(idempotencyKey)
      return json({ code: 'invalid-request', message: 'Action policy diverges from runtime.' }, 400)
    }
    if (!actionAcceptsArguments(action, execution.call.arguments)) {
      runs.delete(runKey(principal, state.sessionId, state.runId))
      idempotency.delete(idempotencyKey)
      return json({ code: 'invalid-request', message: 'Action schema diverges from runtime.' }, 400)
    }
    state.call = execution.call
    push(state, {
      type: 'tool.call',
      data: {
        callId: execution.call.callId,
        continuationId: `continuation-${execution.call.callId}`,
        manifestId: body.tools.manifestId,
        name: execution.call.name,
        arguments: execution.call.arguments,
        target: { documentId: body.context.documentId, pageId: body.context.pageId }
      }
    })
  } catch (error) {
    if (state.cancelled) return sse(state.events)
    const message = error instanceof AgentExecutorError ? error.message : 'Agent execution failed.'
    push(state, {
      type: 'run.failed',
      data: {
        error: {
          schema: AGENT_ERROR_SCHEMA,
          code: 'run-failed',
          message,
          retryable: true,
          phase: 'request',
          requestId: body.requestId,
          sessionId: state.sessionId,
          runId: state.runId
        },
        receipt: receipt(state, 'failed')
      }
    })
  }
  if (body.input.text.includes('[disconnect-once]')) return interruptedSse(state.events.slice(0, 5))
  return sse(state.events)
}

function resumeRun(request: Request, state: RunState): Response {
  const lastEventId = request.headers.get('last-event-id')
  const matchedIndex = lastEventId
    ? state.events.findIndex((event) => event.eventId === lastEventId)
    : -1
  if (lastEventId && matchedIndex === -1) {
    return json({ code: 'session-expired', message: 'Resume cursor is unknown.' }, 410)
  }
  return sse(state.events.slice(matchedIndex + 1))
}

function cancelRun(state: RunState): Response {
  const existing = state.events.find((event) => event.type === 'run.cancelled')
  if (existing) return sse([existing])
  state.cancelled = true
  state.abortController.abort()
  const event = push(state, {
    type: 'run.cancelled',
    data: { receipt: receipt(state, 'cancelled') }
  })
  return sse([event])
}

async function continueRun(request: Request, state: RunState): Promise<Response> {
  if (state.cancelled) {
    return json({ code: 'session-conflict', message: 'Cancelled run cannot continue.' }, 409)
  }
  let continuation: AgentToolResultContinuation
  try {
    continuation = parseAgentToolResultContinuation(await request.json())
  } catch {
    return json({ code: 'invalid-request', message: 'Malformed tool result.' }, 400)
  }
  if (continuation.sessionId !== state.sessionId || continuation.runId !== state.runId) {
    return json({ code: 'session-conflict', message: 'Run identity conflicts.' }, 409)
  }
  if (state.continuation) {
    return JSON.stringify(state.continuation) === JSON.stringify(continuation)
      ? sse(state.events.slice(state.continuationResponseStart))
      : json({ code: 'session-conflict', message: 'Conflicting tool result.' }, 409)
  }
  const call = state.call
  if (
    !call ||
    continuation.callId !== call.callId ||
    continuation.continuationId !== `continuation-${call.callId}` ||
    continuation.manifestId !== state.request.tools.manifestId ||
    continuation.target.documentId !== state.request.context.documentId ||
    continuation.target.pageId !== state.request.context.pageId
  ) {
    return json({ code: 'session-conflict', message: 'Tool result identity conflicts.' }, 409)
  }
  state.continuation = continuation
  state.continuationResponseStart = state.events.length
  if (continuation.status !== 'ok') {
    const failed = push(state, {
      type: 'run.failed',
      data: {
        error: {
          ...(continuation.error ?? {
            schema: AGENT_ERROR_SCHEMA,
            code: 'tool-rejected',
            message: 'Tool was rejected.',
            retryable: false,
            phase: 'tool'
          }),
          requestId: state.request.requestId,
          sessionId: state.sessionId,
          runId: state.runId
        },
        receipt: receipt(state, 'failed')
      }
    })
    return sse([failed])
  }
  const next = [push(state, { type: 'tool.result', data: { callId: continuation.callId } })]
  try {
    const text = await state.executor.continue({
      request: state.request,
      optionId: state.optionId,
      call,
      continuation,
      signal: state.abortController.signal
    })
    if (text) {
      next.push(
        push(state, {
          type: 'message.delta',
          data: { messageId: 'assistant-1', text }
        })
      )
    }
  } catch (error) {
    const message = error instanceof AgentExecutorError ? error.message : 'Agent execution failed.'
    const failed = push(state, {
      type: 'run.failed',
      data: {
        error: {
          schema: AGENT_ERROR_SCHEMA,
          code: 'run-failed',
          message,
          retryable: true,
          phase: 'tool',
          requestId: state.request.requestId,
          sessionId: state.sessionId,
          runId: state.runId
        },
        receipt: receipt(state, 'failed')
      }
    })
    return sse([...next, failed])
  }
  next.push(push(state, { type: 'message.end', data: { messageId: 'assistant-1' } }))
  const completed = push(state, {
    type: 'run.completed',
    data: { receipt: receipt(state, 'completed') }
  })
  return sse([...next, completed])
}

export function createAgentGateway(
  catalogSource: AgentCatalogSource,
  executor: AgentExecutor
): AgentGateway {
  const runs = new Map<string, RunState>()
  const idempotency = new Map<string, RunState>()

  return {
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/health') {
        try {
          await catalogSource('health-check')
          return json({ ok: true, ready: true })
        } catch {
          return json({ ok: true, ready: false }, 503)
        }
      }

      if (request.method === 'GET' && url.pathname === '/v1/options') {
        const principal = request.headers.get('x-openpencil-principal')
        if (!principal)
          return json({ code: 'unauthorized', message: 'Verified principal required.' }, 401)
        try {
          return json(await catalogSource(principal))
        } catch (error) {
          if (error instanceof AgentCatalogError) return error.response()
          return new AgentCatalogError(
            'options-unavailable',
            'Agent Native catalog is unavailable.'
          ).response()
        }
      }

      if (request.method === 'POST' && url.pathname === '/v1/runs') {
        return startRun(request, runs, idempotency, catalogSource, executor)
      }

      const route = resolveRunRoute(request, url, runs)
      if (route instanceof Response) return route
      if (request.method === 'GET' && route.action === 'events')
        return resumeRun(request, route.state)
      if (request.method === 'POST' && route.action === 'cancel') return cancelRun(route.state)
      if (request.method === 'POST' && route.action === 'tool-results') {
        return continueRun(request, route.state)
      }
      return json({ code: 'invalid-request', message: 'Method not allowed.' }, 405)
    },
    reset() {
      runs.clear()
      idempotency.clear()
    }
  }
}

export function createFakeGateway(catalogSource: AgentCatalogSource): AgentGateway {
  return createAgentGateway(catalogSource, createDeterministicExecutor())
}
