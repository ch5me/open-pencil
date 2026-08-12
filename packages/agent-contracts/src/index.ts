import * as v from 'valibot'

export const AGENT_RUN_SCHEMA = 'openpencil.agent.run.v1' as const
export const AGENT_EVENT_SCHEMA = 'openpencil.agent.event.v1' as const
export const AGENT_ERROR_SCHEMA = 'openpencil.agent.error.v1' as const
export const AGENT_CONTINUATION_SCHEMA = 'openpencil.agent.continuation.v1' as const
export const AGENT_RECEIPT_SCHEMA = 'openpencil.agent.receipt.v1' as const
export const AGENT_PROTOCOL_VERSION = '1' as const
export const AGENT_GATEWAY_MANIFEST_VERSION = '1' as const

const MAX_DETAIL_BYTES = 64 * 1024
const MAX_DETAIL_DEPTH = 12
const MAX_DETAIL_ENTRIES = 1_000
const MAX_GATEWAY_ACTIONS = 128
const MAX_GATEWAY_PROPERTIES = 128
const FORBIDDEN_FIELDS = new Set([
  'account',
  'billing',
  'container',
  'deployment',
  'image',
  'machine',
  'model',
  'provider',
  'region',
  'registry',
  'runtime',
  'worker'
])

type JsonPrimitive = boolean | number | string | null
export type AgentJSONValue = JsonPrimitive | AgentJSONValue[] | { [key: string]: AgentJSONValue }

export interface AgentGatewayActionDefinition {
  name: string
  description: string
  mutates: boolean
  requiresApproval: boolean
  inputSchema: {
    type: 'object'
    additionalProperties: false
    properties: Record<string, AgentGatewayPropertySchema>
    required: string[]
  }
}

export interface AgentGatewayPropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array'
  description: string
  items?: { type: 'string' }
  enum?: string[]
  minimum?: number
  maximum?: number
  default?: AgentJSONValue
}

export interface AgentGatewayToolManifest {
  manifestId: `sha256:${string}`
  definitions: AgentGatewayActionDefinition[]
}

export interface AgentRunRequest {
  schema: typeof AGENT_RUN_SCHEMA
  requestId: string
  idempotencyKey: string
  conversation: { clientId: string; sessionId?: string }
  input: { messageId: string; text: string }
  context: { documentId: string; pageId?: string; selectedNodeIds: string[] }
  tools: AgentGatewayToolManifest
  capabilities: {
    toolResults: boolean
    reconnect: boolean
    cancellation: boolean
    approvals: boolean
  }
}

export type AgentErrorCode =
  | 'unauthorized'
  | 'invalid-request'
  | 'protocol-version-unsupported'
  | 'session-not-found'
  | 'session-expired'
  | 'session-conflict'
  | 'capability-mismatch'
  | 'tool-not-allowed'
  | 'tool-arguments-invalid'
  | 'tool-target-mismatch'
  | 'tool-rejected'
  | 'tool-timeout'
  | 'gateway-unavailable'
  | 'stream-interrupted'
  | 'cancellation-failed'
  | 'run-failed'

export type AgentErrorPhase = 'request' | 'stream' | 'tool' | 'resume' | 'cancellation'

export interface AgentError {
  schema: typeof AGENT_ERROR_SCHEMA
  code: AgentErrorCode
  message: string
  retryable: boolean
  phase: AgentErrorPhase
  requestId?: string
  sessionId?: string
  runId?: string
  details?: AgentJSONValue
}

export interface AgentRunReceipt {
  schema: typeof AGENT_RECEIPT_SCHEMA
  receiptId: string
  requestId: string
  sessionId: string
  runId: string
  status: 'accepted' | 'cancelled' | 'completed' | 'failed'
  acceptedAt: string
  completedAt?: string
  lastSequence: number
  gateway: { service: string; protocolVersion: typeof AGENT_PROTOCOL_VERSION }
}

export type AgentEventData =
  | { type: 'session.created'; data: { requestId: string } }
  | { type: 'run.started'; data: { requestId: string } }
  | { type: 'message.start'; data: { messageId: string; role: 'assistant' } }
  | { type: 'message.delta'; data: { messageId: string; text: string } }
  | { type: 'message.end'; data: { messageId: string } }
  | {
      type: 'tool.call'
      data: {
        callId: string
        continuationId: string
        manifestId: string
        name: string
        arguments: AgentJSONValue
        target: { documentId: string; pageId?: string }
      }
    }
  | { type: 'approval.required'; data: { callId: string; prompt: string } }
  | { type: 'tool.result'; data: { callId: string } }
  | { type: 'run.completed'; data: { receipt: AgentRunReceipt } }
  | { type: 'run.failed'; data: { error: AgentError } }
  | { type: 'run.cancelled'; data: { receipt: AgentRunReceipt } }
  | { type: 'receipt'; data: { receipt: AgentRunReceipt } }

export type AgentEvent = AgentEventData & {
  schema: typeof AGENT_EVENT_SCHEMA
  sessionId: string
  runId: string
  seq: number
  eventId: string
  timestamp: string
}

export interface AgentToolResultContinuation {
  schema: typeof AGENT_CONTINUATION_SCHEMA
  requestId: string
  idempotencyKey: string
  sessionId: string
  runId: string
  callId: string
  continuationId: string
  manifestId: string
  target: { documentId: string; pageId?: string }
  status: 'ok' | 'error' | 'rejected'
  output?: AgentJSONValue
  error?: AgentError
  approvalId?: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : undefined
}

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  const object = record(value)
  if (!object) return false
  const allowed = new Set([...required, ...optional])
  return (
    required.every((key) => key in object) && Object.keys(object).every((key) => allowed.has(key))
  )
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}

function shortText(value: unknown, max = 16_384): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value))
}

function forbiddenField(key: string): boolean {
  const normalized = key.replaceAll(/[-_]/gu, '').toLowerCase()
  if (normalized === 'constructor' || normalized === 'prototype' || normalized === 'proto')
    return true
  return [...FORBIDDEN_FIELDS].some((field) => normalized.includes(field))
}

function safeJSON(value: unknown): value is AgentJSONValue {
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

function validGatewayProperty(value: unknown): value is AgentGatewayPropertySchema {
  if (!exact(value, ['type', 'description'], ['items', 'enum', 'minimum', 'maximum', 'default'])) {
    return false
  }
  const property = value as Record<string, unknown>
  if (
    !['string', 'number', 'boolean', 'array'].includes(property.type as string) ||
    !shortText(property.description, 4_096)
  ) {
    return false
  }
  if ('items' in property) {
    if (property.type !== 'array' || !exact(property.items, ['type'])) return false
    if ((property.items as Record<string, unknown>).type !== 'string') return false
  } else if (property.type === 'array') return false
  if (
    'enum' in property &&
    (property.type !== 'string' ||
      !Array.isArray(property.enum) ||
      property.enum.length === 0 ||
      property.enum.length > 128 ||
      !property.enum.every((item) => shortText(item)) ||
      new Set(property.enum).size !== property.enum.length)
  ) {
    return false
  }
  for (const bound of ['minimum', 'maximum'] as const) {
    if (
      bound in property &&
      (typeof property[bound] !== 'number' || !Number.isFinite(property[bound]))
    )
      return false
  }
  if (
    'minimum' in property &&
    'maximum' in property &&
    (property.minimum as number) > (property.maximum as number)
  ) {
    return false
  }
  return !('default' in property) || safeJSON(property.default)
}

function validGatewayAction(value: unknown): value is AgentGatewayActionDefinition {
  if (!exact(value, ['name', 'description', 'mutates', 'requiresApproval', 'inputSchema']))
    return false
  const action = value as Record<string, unknown>
  const inputSchema = record(action.inputSchema)
  if (
    !identifier(action.name) ||
    forbiddenField(action.name) ||
    !shortText(action.description, 16_384) ||
    typeof action.mutates !== 'boolean' ||
    typeof action.requiresApproval !== 'boolean' ||
    !inputSchema ||
    !exact(inputSchema, ['type', 'additionalProperties', 'properties', 'required']) ||
    inputSchema.type !== 'object' ||
    inputSchema.additionalProperties !== false
  ) {
    return false
  }
  const properties = record(inputSchema.properties)
  if (!properties || Object.keys(properties).length > MAX_GATEWAY_PROPERTIES) return false
  if (
    !Object.entries(properties).every(
      ([name, schema]) => identifier(name) && !forbiddenField(name) && validGatewayProperty(schema)
    )
  ) {
    return false
  }
  return (
    Array.isArray(inputSchema.required) &&
    inputSchema.required.length <= MAX_GATEWAY_PROPERTIES &&
    inputSchema.required.every((name) => identifier(name) && Object.hasOwn(properties, name)) &&
    new Set(inputSchema.required).size === inputSchema.required.length
  )
}

function validGatewayTools(value: unknown): value is AgentGatewayToolManifest {
  if (!exact(value, ['manifestId', 'definitions'])) return false
  const tools = value as Record<string, unknown>
  return (
    typeof tools.manifestId === 'string' &&
    /^sha256:[0-9a-f]{64}$/u.test(tools.manifestId) &&
    Array.isArray(tools.definitions) &&
    tools.definitions.length > 0 &&
    tools.definitions.length <= MAX_GATEWAY_ACTIONS &&
    tools.definitions.every(validGatewayAction) &&
    new Set(tools.definitions.map((definition) => definition.name)).size ===
      tools.definitions.length &&
    safeJSON(value)
  )
}

function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`
  const object = record(value)
  if (object) {
    return `{${Object.entries(object)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJSON(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export async function createAgentGatewayManifestId(
  definitions: readonly AgentGatewayActionDefinition[]
): Promise<`sha256:${string}`> {
  const content = {
    schemaVersion: AGENT_GATEWAY_MANIFEST_VERSION,
    actions: definitions
  }
  const bytes = new TextEncoder().encode(canonicalJSON(content))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `sha256:${hex}`
}

export async function verifyAgentGatewayToolManifest(
  tools: AgentGatewayToolManifest
): Promise<boolean> {
  return (
    validGatewayTools(tools) &&
    tools.manifestId === (await createAgentGatewayManifestId(tools.definitions))
  )
}

const ERROR_CODES = new Set<AgentErrorCode>([
  'unauthorized',
  'invalid-request',
  'protocol-version-unsupported',
  'session-not-found',
  'session-expired',
  'session-conflict',
  'capability-mismatch',
  'tool-not-allowed',
  'tool-arguments-invalid',
  'tool-target-mismatch',
  'tool-rejected',
  'tool-timeout',
  'gateway-unavailable',
  'stream-interrupted',
  'cancellation-failed',
  'run-failed'
])
const ERROR_PHASES = new Set<AgentErrorPhase>([
  'request',
  'stream',
  'tool',
  'resume',
  'cancellation'
])

function validTarget(value: unknown, includeSelection: boolean): boolean {
  const required = includeSelection ? ['documentId', 'selectedNodeIds'] : ['documentId']
  const target = record(value)
  if (!target || !exact(target, required, ['pageId'])) return false
  if (!identifier(target.documentId) || ('pageId' in target && !identifier(target.pageId)))
    return false
  return (
    !includeSelection ||
    (Array.isArray(target.selectedNodeIds) &&
      target.selectedNodeIds.length <= 1_000 &&
      target.selectedNodeIds.every(identifier))
  )
}

function validError(value: unknown): value is AgentError {
  if (
    !exact(
      value,
      ['schema', 'code', 'message', 'retryable', 'phase'],
      ['requestId', 'sessionId', 'runId', 'details']
    )
  ) {
    return false
  }
  const error = value as Record<string, unknown>
  return (
    error.schema === AGENT_ERROR_SCHEMA &&
    ERROR_CODES.has(error.code as AgentErrorCode) &&
    shortText(error.message, 4_096) &&
    typeof error.retryable === 'boolean' &&
    ERROR_PHASES.has(error.phase as AgentErrorPhase) &&
    ['requestId', 'sessionId', 'runId'].every((key) => !(key in error) || identifier(error[key])) &&
    (!('details' in error) || safeJSON(error.details))
  )
}

function validReceipt(value: unknown): value is AgentRunReceipt {
  if (
    !exact(
      value,
      [
        'schema',
        'receiptId',
        'requestId',
        'sessionId',
        'runId',
        'status',
        'acceptedAt',
        'lastSequence',
        'gateway'
      ],
      ['completedAt']
    )
  ) {
    return false
  }
  const receipt = value as Record<string, unknown>
  const gateway = record(receipt.gateway)
  const status = receipt.status as AgentRunReceipt['status']
  const acceptedAt = Date.parse(receipt.acceptedAt as string)
  const completedAt =
    'completedAt' in receipt ? Date.parse(receipt.completedAt as string) : undefined
  return (
    receipt.schema === AGENT_RECEIPT_SCHEMA &&
    [receipt.receiptId, receipt.requestId, receipt.sessionId, receipt.runId].every(identifier) &&
    ['accepted', 'cancelled', 'completed', 'failed'].includes(status) &&
    timestamp(receipt.acceptedAt) &&
    (status === 'accepted'
      ? !('completedAt' in receipt)
      : timestamp(receipt.completedAt) && completedAt !== undefined && completedAt >= acceptedAt) &&
    Number.isSafeInteger(receipt.lastSequence) &&
    (receipt.lastSequence as number) >= 0 &&
    !!gateway &&
    exact(gateway, ['service', 'protocolVersion']) &&
    identifier(gateway.service) &&
    gateway.protocolVersion === AGENT_PROTOCOL_VERSION
  )
}

function validRequest(value: unknown): value is AgentRunRequest {
  if (
    !exact(value, [
      'schema',
      'requestId',
      'idempotencyKey',
      'conversation',
      'input',
      'context',
      'tools',
      'capabilities'
    ])
  ) {
    return false
  }
  const request = value as Record<string, unknown>
  const conversation = record(request.conversation)
  const input = record(request.input)
  const tools = record(request.tools)
  const capabilities = record(request.capabilities)
  return (
    request.schema === AGENT_RUN_SCHEMA &&
    identifier(request.requestId) &&
    identifier(request.idempotencyKey) &&
    !!conversation &&
    exact(conversation, ['clientId'], ['sessionId']) &&
    identifier(conversation.clientId) &&
    (!('sessionId' in conversation) || identifier(conversation.sessionId)) &&
    !!input &&
    exact(input, ['messageId', 'text']) &&
    identifier(input.messageId) &&
    shortText(input.text) &&
    validTarget(request.context, true) &&
    !!tools &&
    validGatewayTools(tools) &&
    !!capabilities &&
    exact(capabilities, ['toolResults', 'reconnect', 'cancellation', 'approvals']) &&
    Object.values(capabilities).every((capability) => typeof capability === 'boolean') &&
    safeJSON(value)
  )
}

function validEvent(value: unknown): value is AgentEvent {
  if (
    !exact(value, ['schema', 'sessionId', 'runId', 'seq', 'eventId', 'timestamp', 'type', 'data'])
  ) {
    return false
  }
  const event = value as Record<string, unknown>
  if (
    event.schema !== AGENT_EVENT_SCHEMA ||
    !identifier(event.sessionId) ||
    !identifier(event.runId) ||
    !Number.isSafeInteger(event.seq) ||
    (event.seq as number) < 0 ||
    !identifier(event.eventId) ||
    !timestamp(event.timestamp) ||
    typeof event.type !== 'string'
  ) {
    return false
  }
  const data = record(event.data)
  if (!data) return false
  switch (event.type) {
    case 'session.created':
    case 'run.started':
      return exact(data, ['requestId']) && identifier(data.requestId)
    case 'message.start':
      return (
        exact(data, ['messageId', 'role']) &&
        identifier(data.messageId) &&
        data.role === 'assistant'
      )
    case 'message.delta':
      return (
        exact(data, ['messageId', 'text']) &&
        identifier(data.messageId) &&
        typeof data.text === 'string' &&
        data.text.length <= 16_384
      )
    case 'message.end':
      return exact(data, ['messageId']) && identifier(data.messageId)
    case 'tool.call':
      return (
        exact(data, ['callId', 'continuationId', 'manifestId', 'name', 'arguments', 'target']) &&
        [data.callId, data.continuationId, data.manifestId, data.name].every(identifier) &&
        safeJSON(data.arguments) &&
        validTarget(data.target, false)
      )
    case 'approval.required':
      return (
        exact(data, ['callId', 'prompt']) &&
        identifier(data.callId) &&
        shortText(data.prompt, 4_096)
      )
    case 'tool.result':
      return exact(data, ['callId']) && identifier(data.callId)
    case 'run.completed':
      return (
        exact(data, ['receipt']) &&
        validReceipt(data.receipt) &&
        data.receipt.status === 'completed' &&
        data.receipt.lastSequence === event.seq
      )
    case 'run.cancelled':
      return (
        exact(data, ['receipt']) &&
        validReceipt(data.receipt) &&
        data.receipt.status === 'cancelled' &&
        data.receipt.lastSequence === event.seq
      )
    case 'receipt':
      return exact(data, ['receipt']) && validReceipt(data.receipt)
    case 'run.failed':
      return exact(data, ['error']) && validError(data.error)
    default:
      return false
  }
}

function validContinuation(value: unknown): value is AgentToolResultContinuation {
  if (
    !exact(
      value,
      [
        'schema',
        'requestId',
        'idempotencyKey',
        'sessionId',
        'runId',
        'callId',
        'continuationId',
        'manifestId',
        'target',
        'status'
      ],
      ['output', 'error', 'approvalId']
    )
  ) {
    return false
  }
  const continuation = value as Record<string, unknown>
  if (
    continuation.schema !== AGENT_CONTINUATION_SCHEMA ||
    ![
      continuation.requestId,
      continuation.idempotencyKey,
      continuation.sessionId,
      continuation.runId,
      continuation.callId,
      continuation.continuationId,
      continuation.manifestId
    ].every(identifier) ||
    !validTarget(continuation.target, false) ||
    !['ok', 'error', 'rejected'].includes(continuation.status as string) ||
    ('approvalId' in continuation && !identifier(continuation.approvalId))
  ) {
    return false
  }
  if (continuation.status === 'ok') {
    return 'output' in continuation && !('error' in continuation) && safeJSON(continuation.output)
  }
  return !('output' in continuation) && 'error' in continuation && validError(continuation.error)
}

function parser<T>(label: string, guard: (value: unknown) => value is T) {
  const schema = v.pipe(v.unknown(), v.check(guard, `Malformed ${label}`))
  return (value: unknown): T => v.parse(schema, value) as T
}

export const parseAgentRunRequest = parser('agent run request', validRequest)
export const parseAgentEvent = parser('agent event', validEvent)
export const parseAgentError = parser('agent error', validError)
export const parseAgentRunReceipt = parser('agent run receipt', validReceipt)
export const parseAgentToolResultContinuation = parser(
  'agent tool result continuation',
  validContinuation
)
