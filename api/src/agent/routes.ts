import { Hono, type Context } from 'hono'

import { AGENT_ERROR_SCHEMA } from '@open-pencil/agent-contracts'
import type { AgentError, AgentErrorCode, AgentErrorPhase } from '@open-pencil/agent-contracts'

import { requireSession } from '../auth'
import {
  AgentContractError,
  parseAgentRunRequest,
  parseAgentToolResultContinuation
} from './contracts'
import type { AgentGatewayEnv } from './gateway'
import { AgentGatewayError, requestAgentGateway, requestAgentOptions } from './gateway'

type AgentRouteEnv = {
  Bindings: AgentGatewayEnv
  Variables: { userId: string; sessionToken: string }
}

export const agentRoutes = new Hono<AgentRouteEnv>()

agentRoutes.use('*', requireSession())

agentRoutes.get('/options', async (c) => {
  try {
    const catalog = await requestAgentOptions({
      env: c.env,
      principalId: principal(c),
      signal: c.req.raw.signal
    })
    c.header('Cache-Control', 'private, no-store')
    return c.json(catalog)
  } catch (error) {
    const response = gatewayResponseError(error)
    if (response) return response
    throw error
  }
})

function principal(c: Context<AgentRouteEnv>): string {
  return c.get('userId')
}

async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new AgentContractError('invalid-json', 'Request body must be valid JSON.')
  }
}

function gatewayResponseError(error: unknown): Response | undefined {
  if (error instanceof AgentContractError) {
    const code: AgentErrorCode =
      error.code === 'invalid-request' ? 'invalid-request' : 'gateway-unavailable'
    const phase: AgentErrorPhase = error.code === 'invalid-request' ? 'request' : 'stream'
    const body: AgentError = {
      schema: AGENT_ERROR_SCHEMA,
      code,
      message: error.message,
      retryable: code === 'gateway-unavailable',
      phase
    }
    return Response.json(body, { status: 400 })
  }
  if (error instanceof AgentGatewayError) {
    return Response.json(error.error, { status: error.status })
  }
  return undefined
}

async function streamRequest(
  c: Context<AgentRouteEnv>,
  path: string,
  body?: unknown,
  method: 'GET' | 'POST' = 'POST',
  expectedIdentity?: { requestId?: string; sessionId?: string; runId?: string }
): Promise<Response> {
  try {
    return await requestAgentGateway({
      env: c.env,
      principalId: principal(c),
      path,
      method,
      body,
      lastEventId: c.req.header('last-event-id'),
      signal: c.req.raw.signal,
      expectedIdentity
    })
  } catch (error) {
    const response = gatewayResponseError(error)
    if (response) return response
    throw error
  }
}

agentRoutes.post('/runs', async (c) => {
  try {
    const body = parseAgentRunRequest(await jsonBody(c.req.raw))
    return await streamRequest(c, '/v1/runs', body, 'POST', {
      requestId: body.requestId
    })
  } catch (error) {
    const response = gatewayResponseError(error)
    if (response) return response
    throw error
  }
})

agentRoutes.post('/sessions/:sessionId/runs/:runId/tool-results', async (c) => {
  try {
    const body = parseAgentToolResultContinuation(await jsonBody(c.req.raw))
    const sessionId = c.req.param('sessionId')
    const runId = c.req.param('runId')
    if (body.sessionId !== sessionId || body.runId !== runId) {
      throw new AgentGatewayError(409, {
        schema: AGENT_ERROR_SCHEMA,
        code: 'session-conflict',
        message: 'Tool result identity does not match the requested session and run.',
        retryable: false,
        phase: 'tool',
        requestId: body.requestId,
        sessionId,
        runId
      })
    }
    return await streamRequest(
      c,
      `/v1/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/tool-results`,
      body,
      'POST',
      { requestId: body.requestId, sessionId, runId }
    )
  } catch (error) {
    const response = gatewayResponseError(error)
    if (response) return response
    throw error
  }
})

agentRoutes.post('/sessions/:sessionId/runs/:runId/cancel', (c) => {
  const sessionId = c.req.param('sessionId')
  const runId = c.req.param('runId')
  return streamRequest(
    c,
    `/v1/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/cancel`,
    undefined,
    'POST',
    { sessionId, runId }
  )
})

agentRoutes.get('/sessions/:sessionId/runs/:runId/events', (c) => {
  const sessionId = c.req.param('sessionId')
  const runId = c.req.param('runId')
  return streamRequest(
    c,
    `/v1/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/events`,
    undefined,
    'GET',
    { sessionId, runId }
  )
})
