import {
  parseAgentEvent as parseSharedAgentEvent,
  parseAgentRunRequest as parseSharedAgentRunRequest,
  parseAgentToolResultContinuation as parseSharedAgentToolResultContinuation
} from '@open-pencil/agent-contracts'
import type {
  AgentEvent,
  AgentRunRequest,
  AgentToolResultContinuation
} from '@open-pencil/agent-contracts'

export type { AgentEvent, AgentRunRequest, AgentToolResultContinuation }

export class AgentContractError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AgentContractError'
  }
}

function parse<T>(label: string, parser: (value: unknown) => T, value: unknown): T {
  try {
    return parser(value)
  } catch {
    throw new AgentContractError('invalid-request', `Malformed ${label}.`)
  }
}

export function parseAgentRunRequest(value: unknown): AgentRunRequest {
  return parse('agent run request', parseSharedAgentRunRequest, value)
}

export function parseAgentToolResultContinuation(value: unknown): AgentToolResultContinuation {
  return parse('agent tool result continuation', parseSharedAgentToolResultContinuation, value)
}

export function parseAgentEvent(value: unknown): AgentEvent {
  try {
    return parseSharedAgentEvent(value)
  } catch {
    throw new AgentContractError('malformed-gateway-event', 'Malformed agent gateway event.')
  }
}
