import * as v from 'valibot'

export const AGENT_CONTRACT_VERSION = '1' as const

const MAX_DETAIL_BYTES = 64 * 1024
const MAX_DETAIL_DEPTH = 12
const MAX_DETAIL_ENTRIES = 1_000
const FORBIDDEN_FIELDS = new Set([
  'account',
  'billing',
  'container',
  'deployment',
  'image',
  'model',
  'provider',
  'region',
  'registry',
  'runtime',
  'worker'
])

function forbiddenField(key: string): boolean {
  const normalized = key.replaceAll(/[-_]/gu, '').toLowerCase()
  if (normalized === 'constructor' || normalized === 'prototype' || normalized === 'proto') return true
  return [...FORBIDDEN_FIELDS].some(
    (field) => normalized === field || normalized === `${field}id` || normalized === `${field}name`
  )
}

type JsonPrimitive = boolean | number | string | null
export type AgentJsonValue = JsonPrimitive | AgentJsonValue[] | { [key: string]: AgentJsonValue }

export interface AgentRunRequest {
  schemaVersion: typeof AGENT_CONTRACT_VERSION
  requestId: string
  idempotencyKey: string
  conversationId: string
  messageId: string
  input: string
  target: { documentId: string; pageId?: string; selectionIds: string[] }
  actionManifestId: string
  capabilities: string[]
  lastEventId?: string
}

export type AgentErrorCode =
  | 'cancelled'
  | 'conflict'
  | 'expired'
  | 'invalid_request'
  | 'permission_denied'
  | 'service_unavailable'
  | 'unknown_action'

export interface AgentError {
  schemaVersion: typeof AGENT_CONTRACT_VERSION
  code: AgentErrorCode
  message: string
  retryable: boolean
  traceId: string
  details?: AgentJsonValue
}

export type AgentEventData =
  | { type: 'session.started'; sessionId: string }
  | { type: 'run.started'; sessionId: string; runId: string }
  | { type: 'message.started'; messageId: string; role: 'assistant' }
  | { type: 'message.delta'; messageId: string; text: string }
  | { type: 'message.finished'; messageId: string }
  | { type: 'action.requested'; callId: string; name: string; arguments: AgentJsonValue }
  | { type: 'approval.requested'; callId: string; prompt: string }
  | { type: 'action.result'; callId: string; result: AgentJsonValue }
  | { type: 'action.error'; callId: string; error: AgentError }
  | { type: 'run.completed'; receipt: AgentRunReceipt }
  | { type: 'run.failed'; error: AgentError }
  | { type: 'run.cancelled'; reason?: string }

export type AgentEvent = AgentEventData & {
  schemaVersion: typeof AGENT_CONTRACT_VERSION
  eventId: string
  sequence: number
  traceId: string
}

export interface AgentRunReceipt {
  schemaVersion: typeof AGENT_CONTRACT_VERSION
  sessionId: string
  runId: string
  requestId: string
  traceId: string
  lastEventId: string
  status: 'cancelled' | 'completed' | 'failed'
}

export interface AgentToolResultContinuation {
  schemaVersion: typeof AGENT_CONTRACT_VERSION
  requestId: string
  idempotencyKey: string
  sessionId: string
  runId: string
  callId: string
  outcome:
    | { type: 'result'; result: AgentJsonValue }
    | { type: 'error'; error: AgentError }
    | { type: 'rejected'; reason: string }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : undefined
}

function exact(value: unknown, keys: readonly string[], optional: readonly string[] = []) {
  const object = record(value)
  if (!object) return false
  const allowed = new Set([...keys, ...optional])
  return keys.every((key) => key in object) && Object.keys(object).every((key) => allowed.has(key))
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}

function shortText(value: unknown, max = 16_384): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function safeJson(value: unknown): value is AgentJsonValue {
  let entries = 0
  const visit = (current: unknown, depth: number): boolean => {
    if (++entries > MAX_DETAIL_ENTRIES || depth > MAX_DETAIL_DEPTH) return false
    if (current === null || typeof current === 'boolean' || typeof current === 'string') return true
    if (typeof current === 'number') return Number.isFinite(current)
    if (Array.isArray(current)) return current.every((item) => visit(item, depth + 1))
    const object = record(current)
    if (!object) return false
    return Object.entries(object).every(
      ([key, item]) => !forbiddenField(key) && visit(item, depth + 1)
    )
  }
  if (!visit(value, 0)) return false
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_DETAIL_BYTES
  } catch {
    return false
  }
}

function versioned(value: unknown): value is Record<string, unknown> {
  const object = record(value)
  return object?.schemaVersion === AGENT_CONTRACT_VERSION && safeJson(value)
}

const ERROR_CODES = new Set<AgentErrorCode>([
  'cancelled',
  'conflict',
  'expired',
  'invalid_request',
  'permission_denied',
  'service_unavailable',
  'unknown_action'
])

function validError(value: unknown): value is AgentError {
  if (!versioned(value) || !exact(value, ['schemaVersion', 'code', 'message', 'retryable', 'traceId'], ['details'])) return false
  return (
    ERROR_CODES.has(value.code as AgentErrorCode) &&
    shortText(value.message, 4_096) &&
    typeof value.retryable === 'boolean' &&
    identifier(value.traceId) &&
    (!('details' in value) || safeJson(value.details))
  )
}

function validReceipt(value: unknown): value is AgentRunReceipt {
  if (!versioned(value) || !exact(value, ['schemaVersion', 'sessionId', 'runId', 'requestId', 'traceId', 'lastEventId', 'status'])) return false
  return (
    identifier(value.sessionId) && identifier(value.runId) && identifier(value.requestId) &&
    identifier(value.traceId) && identifier(value.lastEventId) &&
    ['cancelled', 'completed', 'failed'].includes(value.status as string)
  )
}

function validRequest(value: unknown): value is AgentRunRequest {
  if (!versioned(value) || !exact(value, ['schemaVersion', 'requestId', 'idempotencyKey', 'conversationId', 'messageId', 'input', 'target', 'actionManifestId', 'capabilities'], ['lastEventId'])) return false
  const target = record(value.target)
  return !!target && exact(target, ['documentId', 'selectionIds'], ['pageId']) &&
    [value.requestId, value.idempotencyKey, value.conversationId, value.messageId, value.actionManifestId].every(identifier) &&
    shortText(value.input) && identifier(target.documentId) && (!('pageId' in target) || identifier(target.pageId)) &&
    Array.isArray(target.selectionIds) && target.selectionIds.length <= 1_000 && target.selectionIds.every(identifier) &&
    Array.isArray(value.capabilities) && value.capabilities.length <= 64 && value.capabilities.every(identifier) &&
    (!('lastEventId' in value) || identifier(value.lastEventId))
}

function validEvent(value: unknown): value is AgentEvent {
  if (!versioned(value)) return false
  const base = ['schemaVersion', 'eventId', 'sequence', 'traceId', 'type']
  if (!identifier(value.eventId) || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0 || !identifier(value.traceId) || typeof value.type !== 'string') return false
  const specs: Record<string, [string[], string[]]> = {
    'session.started': [['sessionId'], []], 'run.started': [['sessionId', 'runId'], []],
    'message.started': [['messageId', 'role'], []], 'message.delta': [['messageId', 'text'], []],
    'message.finished': [['messageId'], []], 'action.requested': [['callId', 'name', 'arguments'], []],
    'approval.requested': [['callId', 'prompt'], []], 'action.result': [['callId', 'result'], []],
    'action.error': [['callId', 'error'], []], 'run.completed': [['receipt'], []],
    'run.failed': [['error'], []], 'run.cancelled': [[], ['reason']]
  }
  const spec = specs[value.type]
  if (!spec || !exact(value, [...base, ...spec[0]], spec[1])) return false
  if ('sessionId' in value && !identifier(value.sessionId)) return false
  if ('runId' in value && !identifier(value.runId)) return false
  if ('messageId' in value && !identifier(value.messageId)) return false
  if ('callId' in value && !identifier(value.callId)) return false
  if (value.type === 'message.started' && value.role !== 'assistant') return false
  if ('text' in value && (typeof value.text !== 'string' || value.text.length > 16_384)) return false
  if ('name' in value && !identifier(value.name)) return false
  if ('prompt' in value && !shortText(value.prompt, 4_096)) return false
  if ('reason' in value && !shortText(value.reason, 4_096)) return false
  if ('arguments' in value && !safeJson(value.arguments)) return false
  if ('result' in value && !safeJson(value.result)) return false
  if ('error' in value && !validError(value.error)) return false
  if ('receipt' in value && !validReceipt(value.receipt)) return false
  return true
}

function validContinuation(value: unknown): value is AgentToolResultContinuation {
  if (!versioned(value) || !exact(value, ['schemaVersion', 'requestId', 'idempotencyKey', 'sessionId', 'runId', 'callId', 'outcome'])) return false
  if (![value.requestId, value.idempotencyKey, value.sessionId, value.runId, value.callId].every(identifier)) return false
  const outcome = record(value.outcome)
  if (!outcome || typeof outcome.type !== 'string') return false
  if (outcome.type === 'result') return exact(outcome, ['type', 'result']) && safeJson(outcome.result)
  if (outcome.type === 'error') return exact(outcome, ['type', 'error']) && validError(outcome.error)
  return outcome.type === 'rejected' && exact(outcome, ['type', 'reason']) && shortText(outcome.reason, 4_096)
}

function parser<T>(label: string, guard: (value: unknown) => value is T) {
  const schema = v.pipe(v.unknown(), v.check(guard, `Malformed ${label}`))
  return (value: unknown): T => v.parse(schema, value)
}

export const parseAgentRunRequest = parser('agent run request', validRequest)
export const parseAgentEvent = parser('agent event', validEvent)
export const parseAgentError = parser('agent error', validError)
export const parseAgentRunReceipt = parser('agent run receipt', validReceipt)
export const parseAgentToolResultContinuation = parser('agent tool result continuation', validContinuation)
