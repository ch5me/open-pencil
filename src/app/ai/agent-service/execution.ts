import type { ToolSet } from 'ai'

import { ALL_TOOLS } from '@open-pencil/core/tools'
import type { ParamDef, ToolDef } from '@open-pencil/core/tools'

import { createAITools } from '@/app/ai/tools'
import type { EditorStore } from '@/app/editor/active-store'

import { requestBoundedToolApproval } from './approval'
import type { ToolApprovalHandler } from './approval'

export interface GatewayToolTarget {
  documentId: string
  pageId: string
}

export interface GatewayToolCall {
  runId: string
  callId: string
  continuationId: string
  manifestId: string
  target: GatewayToolTarget
  toolName: string
  input: Record<string, unknown>
}

export interface GatewayToolManifestEntry {
  name: string
  mutates: boolean
  requiresApproval: boolean
}

export interface GatewayToolManifest {
  id: string
  actions: readonly GatewayToolManifestEntry[]
}

export type GatewayToolErrorCode =
  | 'approval_rejected'
  | 'call_conflict'
  | 'execution_failed'
  | 'invalid_request'
  | 'invalid_schema'
  | 'manifest_mismatch'
  | 'target_mismatch'
  | 'tool_unavailable'

export type GatewayToolResult =
  | { ok: true; callId: string; continuationId: string; output: unknown }
  | {
      ok: false
      callId: string
      continuationId: string
      error: { code: GatewayToolErrorCode; message: string }
    }

export interface GatewayToolExecutorOptions {
  store: EditorStore
  runId: string
  target: () => GatewayToolTarget
  manifest: GatewayToolManifest
  approve?: ToolApprovalHandler
  approvalTimeoutMs?: number
  createTools?: (store: EditorStore) => GatewayToolSet
  isCancelled?: () => boolean
}

type GatewayToolExecute = NonNullable<ToolSet[string]['execute']>
type GatewayToolSet = Partial<Record<string, { execute?: GatewayToolExecute }>>

interface StoredCall {
  fingerprint: string
  result: Promise<GatewayToolResult>
}

function failure(
  call: GatewayToolCall,
  code: GatewayToolErrorCode,
  message: string
): GatewayToolResult {
  return {
    ok: false,
    callId: call.callId,
    continuationId: call.continuationId,
    error: { code, message }
  }
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableValue(child)}`)
      .join(',')}}`
  }
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

function paramIsValid(value: unknown, param: ParamDef): boolean {
  if (value === undefined) return !param.required
  if (param.type === 'string' || param.type === 'color') {
    return typeof value === 'string' && (!param.enum || param.enum.includes(value))
  }
  if (param.type === 'number') {
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (param.min === undefined || value >= param.min) &&
      (param.max === undefined || value <= param.max)
    )
  }
  if (param.type === 'boolean') return typeof value === 'boolean'
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function inputIsValid(input: Record<string, unknown>, definition: ToolDef): boolean {
  return (
    Object.keys(input).every((key) => key in definition.params) &&
    Object.entries(definition.params).every(([key, param]) => paramIsValid(input[key], param))
  )
}

function executable(tools: GatewayToolSet, name: string) {
  const selected = tools[name]
  return typeof selected?.execute === 'function' ? selected.execute : undefined
}

function invalidNodeOperand(
  input: Record<string, unknown>,
  store: EditorStore,
  pageId: string
): boolean {
  return ['id', 'node_id', 'parent_id'].some((key) => {
    const nodeId = input[key]
    return (
      typeof nodeId === 'string' && nodeId !== pageId && !store.graph.isDescendant(nodeId, pageId)
    )
  })
}

async function approveToolCall(
  call: GatewayToolCall,
  target: GatewayToolTarget,
  options: GatewayToolExecutorOptions
): Promise<GatewayToolResult | undefined> {
  const approved = await requestBoundedToolApproval(
    options.approve,
    { runId: call.runId, callId: call.callId, toolName: call.toolName, input: call.input },
    options.approvalTimeoutMs
  )
  if (!approved) {
    return failure(call, 'approval_rejected', 'Mutation approval was rejected or timed out.')
  }
  if (options.isCancelled?.()) {
    return failure(call, 'approval_rejected', 'Tool call was cancelled.')
  }
  const current = options.target()
  if (current.documentId !== target.documentId || current.pageId !== target.pageId) {
    return failure(call, 'target_mismatch', 'Document or page changed while approval was pending.')
  }
  return undefined
}

async function executeToolCall(
  call: GatewayToolCall,
  execute: GatewayToolExecute,
  isCancelled?: () => boolean
): Promise<GatewayToolResult> {
  if (isCancelled?.()) {
    return failure(call, 'approval_rejected', 'Tool call was cancelled.')
  }
  try {
    const output = await execute(call.input, { toolCallId: call.callId, messages: [] })
    if (
      output &&
      typeof output === 'object' &&
      'error' in output &&
      typeof output.error === 'string'
    ) {
      return failure(call, 'execution_failed', 'Tool execution failed.')
    }
    return { ok: true, callId: call.callId, continuationId: call.continuationId, output }
  } catch {
    return failure(call, 'execution_failed', 'Tool execution failed.')
  }
}

export function createGatewayToolExecutor(options: GatewayToolExecutorOptions) {
  const definitions = new Map(ALL_TOOLS.map((definition) => [definition.name, definition]))
  const manifest = new Map(options.manifest.actions.map((action) => [action.name, action]))
  const exposedDefinitions = ALL_TOOLS.filter((definition) => manifest.has(definition.name))
  const tools = options.createTools
    ? options.createTools(options.store)
    : createAITools(options.store, exposedDefinitions)
  const calls = new Map<string, StoredCall>()
  const continuations = new Map<string, string>()

  async function executeNew(call: GatewayToolCall): Promise<GatewayToolResult> {
    if (options.isCancelled?.()) {
      return failure(call, 'approval_rejected', 'Tool call was cancelled.')
    }
    if (call.runId !== options.runId) {
      return failure(call, 'target_mismatch', 'Tool call belongs to another run.')
    }
    const target = options.target()
    if (call.target.documentId !== target.documentId || call.target.pageId !== target.pageId) {
      return failure(call, 'target_mismatch', 'Document or page target no longer matches.')
    }
    if (call.manifestId !== options.manifest.id) {
      return failure(call, 'manifest_mismatch', 'Tool manifest does not match this run.')
    }

    const definition = definitions.get(call.toolName)
    const action = manifest.get(call.toolName)
    const execute = executable(tools, call.toolName)
    if (!definition || !action || !execute || action.mutates !== !!definition.mutates) {
      return failure(call, 'tool_unavailable', 'Tool is unavailable in the negotiated manifest.')
    }
    if (!inputIsValid(call.input, definition)) {
      return failure(call, 'invalid_schema', 'Tool input does not match the action schema.')
    }
    if (invalidNodeOperand(call.input, options.store, target.pageId)) {
      return failure(
        call,
        'target_mismatch',
        'Tool input references a node outside the target page.'
      )
    }
    if (action.requiresApproval) {
      const rejection = await approveToolCall(call, target, options)
      if (rejection) return rejection
    }
    return executeToolCall(call, execute, options.isCancelled)
  }

  return async (call: GatewayToolCall): Promise<GatewayToolResult> => {
    if (!call.callId || !call.continuationId || !call.toolName) {
      return failure(call, 'invalid_request', 'Tool call identifiers and action name are required.')
    }
    const fingerprint = stableValue(call)
    const continuationCall = continuations.get(call.continuationId)
    if (continuationCall && continuationCall !== call.callId) {
      return failure(
        call,
        'call_conflict',
        'Continuation identifier was already used by another call.'
      )
    }
    const existing = calls.get(call.callId)
    if (existing) {
      return existing.fingerprint === fingerprint
        ? existing.result
        : failure(call, 'call_conflict', 'Call identifier was already used with different input.')
    }

    continuations.set(call.continuationId, call.callId)
    const result = executeNew(call)
    calls.set(call.callId, { fingerprint, result })
    return result
  }
}
