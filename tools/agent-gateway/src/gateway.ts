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
  AgentRunReceipt,
  AgentRunRequest,
  AgentToolResultContinuation
} from '@open-pencil/agent-contracts'

interface RunState {
  principal: string
  request: AgentRunRequest
  sessionId: string
  runId: string
  events: AgentEvent[]
  continuation?: AgentToolResultContinuation
  cancelled: boolean
}

export interface FakeGateway {
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
  argumentsValue: Record<string, unknown>
): boolean {
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
  idempotency: Map<string, RunState>
): Promise<Response> {
  let body: AgentRunRequest
  try {
    body = parseAgentRunRequest(await request.json())
  } catch {
    return json({ code: 'invalid-request', message: 'Malformed run request.' }, 400)
  }
  if (!(await verifyAgentGatewayToolManifest(body.tools))) {
    return json({ code: 'invalid-request', message: 'Manifest identity mismatch.' }, 400)
  }
  const action = body.tools.definitions.find((definition) => definition.name === 'create_shape')
  if (!action) {
    return json({ code: 'tool-not-allowed', message: 'Requested tool is not defined.' }, 403)
  }
  if (!action.mutates || !action.requiresApproval) {
    return json({ code: 'invalid-request', message: 'Action policy diverges from runtime.' }, 400)
  }
  const actionArguments = {
    type: 'RECTANGLE',
    x: 120,
    y: 120,
    width: 240,
    height: 160,
    name: 'Gateway rectangle'
  }
  if (!actionAcceptsArguments(action, actionArguments)) {
    return json({ code: 'invalid-request', message: 'Action schema diverges from runtime.' }, 400)
  }
  const principal = request.headers.get('x-openpencil-principal')
  if (!principal)
    return json({ code: 'unauthorized', message: 'Verified principal required.' }, 401)
  const idempotencyKey = `${principal}/${body.idempotencyKey}`
  const existing = idempotency.get(idempotencyKey)
  if (existing) return sse(existing.events)

  const state: RunState = {
    principal,
    request: body,
    sessionId: body.conversation.sessionId ?? `session-${body.conversation.clientId}`,
    runId: `run-${body.requestId}`,
    events: [],
    cancelled: false
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
  push(state, {
    type: 'message.delta',
    data: { messageId: 'assistant-1', text: 'I can make ' }
  })
  push(state, {
    type: 'message.delta',
    data: { messageId: 'assistant-1', text: 'that change. ' }
  })
  push(state, {
    type: 'tool.call',
    data: {
      callId: 'call-1',
      continuationId: 'continuation-1',
      manifestId: body.tools.manifestId,
      name: 'create_shape',
      arguments: actionArguments,
      target: { documentId: body.context.documentId, pageId: body.context.pageId }
    }
  })
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
      ? sse(state.events.filter((event) => event.seq > 5))
      : json({ code: 'session-conflict', message: 'Conflicting tool result.' }, 409)
  }
  state.continuation = continuation
  if (continuation.status !== 'ok') {
    const failed = push(state, {
      type: 'run.failed',
      data: {
        error: continuation.error ?? {
          schema: AGENT_ERROR_SCHEMA,
          code: 'tool-rejected',
          message: 'Tool was rejected.',
          retryable: false,
          phase: 'tool'
        }
      }
    })
    return sse([failed])
  }
  const next = [
    push(state, { type: 'tool.result', data: { callId: continuation.callId } }),
    push(state, {
      type: 'message.delta',
      data: { messageId: 'assistant-1', text: 'The rectangle is ready.' }
    }),
    push(state, { type: 'message.end', data: { messageId: 'assistant-1' } })
  ]
  const completed = push(state, {
    type: 'run.completed',
    data: { receipt: receipt(state, 'completed') }
  })
  return sse([...next, completed])
}

export function createFakeGateway(): FakeGateway {
  const runs = new Map<string, RunState>()
  const idempotency = new Map<string, RunState>()

  return {
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/health') return json({ ok: true })

      if (request.method === 'POST' && url.pathname === '/v1/runs') {
        return startRun(request, runs, idempotency)
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
