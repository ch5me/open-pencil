import { parseAgentToolResultContinuation } from '@open-pencil/core/agent'
import type { AgentToolResultContinuation } from '@open-pencil/core/agent'

import { IS_BROWSER } from '@/constants'

const SESSION_VERSION = 2
const SESSION_PREFIX = 'openpencil:hosted-agent:'
const MAX_SESSION_BYTES = 16_384
const MAX_ID_LENGTH = 256
const SESSION_TTL_MS = 24 * 60 * 60 * 1_000

export type AgentResumeStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type PersistedAgentSession = {
  version: typeof SESSION_VERSION
  expiresAt: number
  documentId: string
  clientId: string
  requestId: string
  idempotencyKey: string
  sessionId: string
  runId: string
  lastEventId: string
  lastEventFingerprint?: string
  sequence: number
  receiptId?: string
  manifestId: string
  pendingApprovalCallIds?: string[]
  executedToolCallIds?: string[]
  pendingContinuation?: AgentToolResultContinuation
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
}

function sessionKey(documentId: string, clientId: string): string {
  return `${SESSION_PREFIX}${encodeURIComponent(documentId)}:${encodeURIComponent(clientId)}`
}

function removeSession(storage: AgentResumeStore, key: string): void {
  try {
    storage.removeItem(key)
  } catch (error) {
    // Storage cleanup is best-effort and must not break chat recovery.
    void error
  }
}

function browserResumeStore(): AgentResumeStore | undefined {
  if (!IS_BROWSER) return undefined
  try {
    // oxlint-disable-next-line open-pencil/no-direct-storage-access -- This module owns bounded hosted resume persistence.
    return window.sessionStorage
  } catch {
    return undefined
  }
}

function isStoredIdentity(value: unknown): value is PersistedAgentSession {
  if (!value || typeof value !== 'object') return false
  return (
    'version' in value &&
    value.version === SESSION_VERSION &&
    'expiresAt' in value &&
    typeof value.expiresAt === 'number' &&
    'documentId' in value &&
    validId(value.documentId) &&
    'clientId' in value &&
    validId(value.clientId) &&
    hasRunIds(value) &&
    'manifestId' in value &&
    validId(value.manifestId) &&
    'sequence' in value &&
    Number.isSafeInteger(value.sequence) &&
    validLastEventFingerprint(value) &&
    validPendingApprovalCallIds(value) &&
    validExecutedToolCallIds(value) &&
    validReceiptId(value)
  )
}

function validExecutedToolCallIds(value: object): boolean {
  if (!('executedToolCallIds' in value) || value.executedToolCallIds === undefined) return true
  return (
    Array.isArray(value.executedToolCallIds) &&
    value.executedToolCallIds.length <= 256 &&
    value.executedToolCallIds.every(validId)
  )
}

function validPendingApprovalCallIds(value: object): boolean {
  if (!('pendingApprovalCallIds' in value) || value.pendingApprovalCallIds === undefined)
    return true
  return (
    Array.isArray(value.pendingApprovalCallIds) &&
    value.pendingApprovalCallIds.length <= 16 &&
    value.pendingApprovalCallIds.every(validId)
  )
}

function validLastEventFingerprint(value: object): boolean {
  if (!('lastEventFingerprint' in value) || value.lastEventFingerprint === undefined) return true
  return (
    typeof value.lastEventFingerprint === 'string' &&
    value.lastEventFingerprint.length > 0 &&
    value.lastEventFingerprint.length <= MAX_SESSION_BYTES
  )
}

type StoredRunIds = Pick<
  PersistedAgentSession,
  'requestId' | 'idempotencyKey' | 'sessionId' | 'runId' | 'lastEventId'
>

function hasRunIds(value: object): value is object & StoredRunIds {
  return (
    'requestId' in value &&
    validId(value.requestId) &&
    'idempotencyKey' in value &&
    validId(value.idempotencyKey) &&
    'sessionId' in value &&
    validId(value.sessionId) &&
    'runId' in value &&
    validId(value.runId) &&
    'lastEventId' in value &&
    validId(value.lastEventId)
  )
}

function validReceiptId(value: object): boolean {
  if (!('receiptId' in value) || value.receiptId === undefined) return true
  return validId(value.receiptId)
}

export function resolveAgentResumeStore(storage?: AgentResumeStore): AgentResumeStore | undefined {
  return storage ?? browserResumeStore()
}

export function loadAgentSession(
  storage: AgentResumeStore | undefined,
  documentId: string,
  clientId: string,
  now = Date.now()
): PersistedAgentSession | undefined {
  if (!storage) return undefined
  const key = sessionKey(documentId, clientId)
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    return undefined
  }
  if (!raw) return undefined
  if (raw.length > MAX_SESSION_BYTES) {
    removeSession(storage, key)
    return undefined
  }
  try {
    const value: unknown = JSON.parse(raw)
    if (
      !isStoredIdentity(value) ||
      value.expiresAt <= now ||
      value.documentId !== documentId ||
      value.clientId !== clientId
    ) {
      throw new Error('Invalid hosted agent session')
    }
    const continuation = value.pendingContinuation
      ? parseAgentToolResultContinuation(value.pendingContinuation)
      : undefined
    if (
      continuation &&
      (continuation.requestId !== value.requestId ||
        continuation.sessionId !== value.sessionId ||
        continuation.runId !== value.runId)
    ) {
      throw new Error('Invalid hosted agent session')
    }
    return { ...value, pendingContinuation: continuation }
  } catch {
    removeSession(storage, key)
    return undefined
  }
}

export function saveAgentSession(
  storage: AgentResumeStore | undefined,
  value: Omit<PersistedAgentSession, 'version' | 'expiresAt'>,
  now = Date.now()
): boolean {
  if (!storage) return false
  const persisted: PersistedAgentSession = {
    version: SESSION_VERSION,
    expiresAt: now + SESSION_TTL_MS,
    ...value
  }
  const raw = JSON.stringify(persisted)
  const key = sessionKey(value.documentId, value.clientId)
  if (raw.length > MAX_SESSION_BYTES) {
    removeSession(storage, key)
    return false
  }
  try {
    storage.setItem(key, raw)
    return true
  } catch {
    return false
  }
}

export function clearAgentSession(
  storage: AgentResumeStore | undefined,
  documentId: string,
  clientId: string
): void {
  if (storage) removeSession(storage, sessionKey(documentId, clientId))
}
