import { AgentContractError, parseAgentEvent } from './contracts'

export type AgentGatewayEnv = {
  OPENPENCIL_AGENT_GATEWAY_ORIGIN?: string
  OPENPENCIL_AGENT_GATEWAY_TOKEN?: string
}

export class AgentGatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AgentGatewayError'
  }
}

export type AgentGatewayRequest = {
  env: AgentGatewayEnv
  principalId: string
  path: string
  method: 'GET' | 'POST'
  body?: unknown
  lastEventId?: string
  signal?: AbortSignal
  fetch?: typeof fetch
  expectedIdentity?: { requestId?: string; sessionId?: string; runId?: string }
}

function gatewayOrigin(env: AgentGatewayEnv): string {
  const origin = env.OPENPENCIL_AGENT_GATEWAY_ORIGIN?.trim()
  if (!origin) {
    throw new AgentGatewayError(
      503,
      'agent-gateway-not-configured',
      'Agent gateway is not configured.'
    )
  }
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    throw new AgentGatewayError(
      500,
      'agent-gateway-origin-invalid',
      'Agent gateway origin is invalid.'
    )
  }
  if (
    url.protocol !== 'https:' &&
    url.hostname !== 'localhost' &&
    url.hostname !== '127.0.0.1' &&
    !url.hostname.endsWith('.localhost')
  ) {
    throw new AgentGatewayError(
      500,
      'agent-gateway-origin-invalid',
      'Agent gateway origin must use HTTPS.'
    )
  }
  return origin.replace(/\/+$/, '')
}

function loopbackOrigin(origin: string): boolean {
  const hostname = new URL(origin).hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost')
}

async function gatewayError(response: Response): Promise<AgentGatewayError> {
  const value = await response.json().catch(() => null)
  const body = value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  const code = typeof body?.code === 'string' ? body.code : 'agent-gateway-request-failed'
  const message =
    typeof body?.message === 'string'
      ? body.message
      : `Agent gateway request failed: ${response.status}`
  return new AgentGatewayError(response.status, code, message)
}

export async function requestAgentGateway(input: AgentGatewayRequest): Promise<Response> {
  const origin = gatewayOrigin(input.env)
  const headers = new Headers({
    Accept: 'text/event-stream',
    'X-OpenPencil-Principal': input.principalId
  })
  if (input.body !== undefined) headers.set('Content-Type', 'application/json')
  if (input.lastEventId) headers.set('Last-Event-ID', input.lastEventId)
  const token = input.env.OPENPENCIL_AGENT_GATEWAY_TOKEN?.trim()
  if (!token && !loopbackOrigin(origin)) {
    throw new AgentGatewayError(
      503,
      'agent-gateway-not-configured',
      'Agent gateway service authentication is not configured.'
    )
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let response: Response
  try {
    response = await (input.fetch ?? fetch)(`${origin}${input.path}`, {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: input.signal
    })
  } catch (error) {
    if (error instanceof AgentGatewayError) throw error
    if (input.signal?.aborted) {
      throw new AgentGatewayError(499, 'agent-run-cancelled', 'Agent run request was cancelled.')
    }
    throw new AgentGatewayError(502, 'agent-gateway-unavailable', 'Agent gateway is unavailable.')
  }
  if (!response.ok) throw await gatewayError(response)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('text/event-stream') || !response.body) {
    throw new AgentGatewayError(
      502,
      'agent-gateway-invalid-stream',
      'Agent gateway did not return an SSE stream.'
    )
  }
  return validateAgentEventStream(response, response.body, input.expectedIdentity)
}

function validateAgentEventStream(
  response: Response,
  body: ReadableStream<Uint8Array>,
  expectedIdentity?: { requestId?: string; sessionId?: string; runId?: string }
): Response {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let identity: { sessionId: string; runId: string } | undefined
  let previousSequence: number | undefined
  const eventIds = new Set<string>()
  let newRunPhase: 'session' | 'started' | 'active' = 'session'
  let terminal = false
  const validatesNewRunLifecycle =
    expectedIdentity?.requestId !== undefined &&
    expectedIdentity.sessionId === undefined &&
    expectedIdentity.runId === undefined

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true }).replaceAll('\r\n', '\n')
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        if (!frame.trim() || frame.startsWith(':')) {
          controller.enqueue(encoder.encode(`${frame}\n\n`))
          continue
        }
        const lines = frame.split('\n')
        const id = lines
          .find((line) => line.startsWith('id:'))
          ?.slice(3)
          .trim()
        const dataLines = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
        if (!id || dataLines.length === 0) {
          throw new AgentContractError(
            'malformed-gateway-event',
            'SSE event requires id and data fields.'
          )
        }
        let value: unknown
        try {
          value = JSON.parse(dataLines.join('\n'))
        } catch {
          throw new AgentContractError('malformed-gateway-event', 'SSE event data must be JSON.')
        }
        const event = parseAgentEvent(value)
        if (terminal) {
          throw new AgentContractError(
            'event-sequence-invalid',
            'Agent stream continued after a terminal event.'
          )
        }
        if (event.eventId !== id) {
          throw new AgentContractError('event-identity-mismatch', 'SSE id does not match eventId.')
        }
        if (eventIds.has(event.eventId)) {
          throw new AgentContractError('event-identity-mismatch', 'Agent event ID was duplicated.')
        }
        if (
          expectedIdentity &&
          ((expectedIdentity.sessionId && event.sessionId !== expectedIdentity.sessionId) ||
            (expectedIdentity.runId && event.runId !== expectedIdentity.runId))
        ) {
          throw new AgentContractError(
            'event-identity-mismatch',
            'Agent event identity does not match the requested run.'
          )
        }
        if (!identity) {
          identity = event
        } else if (identity.sessionId !== event.sessionId || identity.runId !== event.runId) {
          throw new AgentContractError(
            'event-identity-mismatch',
            'Agent event identity changed within a stream.'
          )
        }
        if (previousSequence !== undefined && event.seq !== previousSequence + 1) {
          throw new AgentContractError(
            'event-sequence-invalid',
            'Agent event sequence is not contiguous.'
          )
        }
        if (validatesNewRunLifecycle) {
          if (
            previousSequence === undefined &&
            (event.seq !== 0 || event.type !== 'session.created')
          ) {
            throw new AgentContractError(
              'event-sequence-invalid',
              'New agent runs must begin with session.created at sequence 0.'
            )
          }
          if (newRunPhase === 'session') {
            newRunPhase = 'started'
          } else if (newRunPhase === 'started') {
            if (event.type !== 'run.started') {
              throw new AgentContractError(
                'event-sequence-invalid',
                'New agent runs must start before emitting run activity.'
              )
            }
            newRunPhase = 'active'
          } else if (event.type === 'session.created' || event.type === 'run.started') {
            throw new AgentContractError(
              'event-sequence-invalid',
              'Agent run lifecycle markers cannot repeat.'
            )
          }
        }
        if (
          expectedIdentity?.requestId &&
          (event.type === 'session.created' || event.type === 'run.started') &&
          event.data.requestId !== expectedIdentity.requestId
        ) {
          throw new AgentContractError(
            'event-identity-mismatch',
            'Agent event request identity does not match the requested run.'
          )
        }
        if (event.type === 'receipt') {
          throw new AgentContractError(
            'event-sequence-invalid',
            'Standalone receipt events are not supported.'
          )
        }
        terminal =
          event.type === 'run.completed' ||
          event.type === 'run.cancelled' ||
          event.type === 'run.failed'
        if (
          (event.type === 'run.completed' ||
            event.type === 'run.cancelled' ||
            event.type === 'receipt') &&
          (event.data.receipt.sessionId !== event.sessionId ||
            event.data.receipt.runId !== event.runId ||
            (expectedIdentity?.requestId &&
              event.data.receipt.requestId !== expectedIdentity.requestId))
        ) {
          throw new AgentContractError(
            'event-identity-mismatch',
            'Agent receipt identity does not match the event stream.'
          )
        }
        previousSequence = event.seq
        eventIds.add(event.eventId)
        controller.enqueue(encoder.encode(`${frame}\n\n`))
      }
    },
    flush() {
      buffer += decoder.decode()
      if (buffer.trim()) {
        throw new AgentContractError('malformed-gateway-event', 'Agent SSE stream ended mid-event.')
      }
      if (previousSequence === undefined) {
        throw new AgentContractError(
          'malformed-gateway-event',
          'Agent SSE stream contained no events.'
        )
      }
    }
  })
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-cache, no-store')
  headers.set('Content-Type', 'text/event-stream; charset=utf-8')
  headers.set('X-Accel-Buffering', 'no')
  return new Response(body.pipeThrough(transform), { status: response.status, headers })
}
