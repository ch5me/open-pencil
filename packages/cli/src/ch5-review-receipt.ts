import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'

import type { LintMessage } from '@open-pencil/core/lint'

const DIGEST = /^sha256:[0-9a-f]{64}$/u
const CONTEXT_SCHEMA = 'ch5.open-pencil-lint-context/1'
const RECEIPT_SCHEMA = 'ch5.open-pencil-lint/3'
const MAX_CONTEXT_BYTES = 1024 * 1024

interface JSONObject {
  [key: string]: unknown
}

interface TargetCensusEntry {
  producerRuleId: string
  nodeId: string
  sourceOccurrenceId: string | null
  target: {
    nodeId: string
    proofTargetKey: string
  } | null
}

export interface Ch5ReviewContext {
  schema: typeof CONTEXT_SCHEMA
  projectId: string
  requestDigest: string
  sourceIdentityDigest: string
  rulesetContentDigest: string
  targetCensus: TargetCensusEntry[]
  documentLocator: string
  documentId?: string
  revision?: string
}

export interface StableDocument {
  bytes: Uint8Array
  format: 'fig' | 'pen'
  locator: string
  sha256: string
  byteLength: number
}

function object(value: unknown, label: string): JSONObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value as JSONObject
}

function exactKeys(value: JSONObject, allowed: readonly string[], label: string) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key))
  if (extras.length > 0) throw new Error(`${label} has unsupported field(s): ${extras.join(', ')}`)
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${label} must be a non-empty string`)
  return value
}

function digest(value: unknown, label: string): string {
  const parsed = string(value, label)
  if (!DIGEST.test(parsed)) throw new Error(`${label} must be sha256:<64 lowercase hex>`)
  return parsed
}

function parseTarget(value: unknown, index: number): TargetCensusEntry {
  const label = `context.targetCensus[${index}]`
  const entry = object(value, label)
  exactKeys(entry, ['producerRuleId', 'nodeId', 'sourceOccurrenceId', 'target'], label)
  const sourceOccurrenceId =
    entry.sourceOccurrenceId === null
      ? null
      : digest(entry.sourceOccurrenceId, `${label}.sourceOccurrenceId`)
  const target = entry.target === null ? null : object(entry.target, `${label}.target`)
  if ((sourceOccurrenceId === null) === (target === null)) {
    throw new Error(`${label} must bind exactly one sourceOccurrenceId or target`)
  }
  if (sourceOccurrenceId !== null) {
    throw new Error(
      `${label} cannot bind sourceOccurrenceId; OpenPencil emits design-lint evidence only`
    )
  }
  if (target) exactKeys(target, ['nodeId', 'proofTargetKey'], `${label}.target`)
  return {
    producerRuleId: string(entry.producerRuleId, `${label}.producerRuleId`),
    nodeId: string(entry.nodeId, `${label}.nodeId`),
    sourceOccurrenceId,
    target: target
      ? {
          nodeId: string(target.nodeId, `${label}.target.nodeId`),
          proofTargetKey: digest(target.proofTargetKey, `${label}.target.proofTargetKey`)
        }
      : null
  }
}

function validateLocator(value: unknown): string {
  const locator = string(value, 'context.documentLocator')
  if (!/^[A-Za-z0-9._/-]+$/u.test(locator) || locator.startsWith('/'))
    throw new Error('context.documentLocator must be canonical project-relative POSIX')
  const segments = locator.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'))
    throw new Error('context.documentLocator must be canonical project-relative POSIX')
  const extension = extname(locator)
  if (extension !== '.fig' && extension !== '.pen')
    throw new Error('context.documentLocator must end in .fig or .pen')
  return locator
}

async function stableRead(
  path: string,
  maxBytes?: number
): Promise<{ bytes: Uint8Array; realPath: string }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile()) throw new Error(`input is not a regular file: ${path}`)
    if (before.nlink !== 1n) throw new Error(`input has unsafe hard links: ${path}`)
    if (maxBytes !== undefined && before.size > BigInt(maxBytes))
      throw new Error(`input exceeds ${maxBytes} bytes: ${path}`)
    const bytes = new Uint8Array(await handle.readFile())
    const after = await handle.stat({ bigint: true })
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      BigInt(bytes.byteLength) !== after.size
    ) {
      throw new Error(`input changed while reading: ${path}`)
    }
    const pathStat = await lstat(path, { bigint: true })
    if (pathStat.dev !== after.dev || pathStat.ino !== after.ino) {
      throw new Error(`input path changed while reading: ${path}`)
    }
    return { bytes, realPath: await realpath(path) }
  } finally {
    await handle.close()
  }
}

export async function readCh5ReviewContext(path: string): Promise<Ch5ReviewContext> {
  const { bytes } = await stableRead(path, MAX_CONTEXT_BYTES)
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('CH5 review context must contain valid JSON')
  }
  const context = object(parsed, 'context')
  exactKeys(
    context,
    [
      'schema',
      'projectId',
      'requestDigest',
      'sourceIdentityDigest',
      'rulesetContentDigest',
      'targetCensus',
      'documentLocator',
      'documentId',
      'revision'
    ],
    'context'
  )
  if (context.schema !== CONTEXT_SCHEMA) throw new Error(`context.schema must be ${CONTEXT_SCHEMA}`)
  if (!Array.isArray(context.targetCensus) || context.targetCensus.length === 0) {
    throw new Error('context.targetCensus must be a non-empty array')
  }
  const targetCensus = context.targetCensus
    .map(parseTarget)
    .sort(
      (a, b) => a.producerRuleId.localeCompare(b.producerRuleId) || a.nodeId.localeCompare(b.nodeId)
    )
  const targetKeys = targetCensus.map((entry) => `${entry.producerRuleId}\0${entry.nodeId}`)
  if (new Set(targetKeys).size !== targetKeys.length)
    throw new Error('context.targetCensus contains duplicate entries')
  const result: Ch5ReviewContext = {
    schema: CONTEXT_SCHEMA,
    projectId: string(context.projectId, 'context.projectId'),
    requestDigest: digest(context.requestDigest, 'context.requestDigest'),
    sourceIdentityDigest: digest(context.sourceIdentityDigest, 'context.sourceIdentityDigest'),
    rulesetContentDigest: digest(context.rulesetContentDigest, 'context.rulesetContentDigest'),
    targetCensus,
    documentLocator: validateLocator(context.documentLocator)
  }
  if (context.documentId !== undefined)
    result.documentId = string(context.documentId, 'context.documentId')
  if (context.revision !== undefined) result.revision = string(context.revision, 'context.revision')
  return result
}

export async function readStableDocument(
  filePath: string,
  locator: string
): Promise<StableDocument> {
  const projectRoot = await realpath(process.cwd())
  const expectedPath = resolve(projectRoot, ...locator.split('/'))
  const suppliedPath = resolve(filePath)
  if (relative(projectRoot, expectedPath).startsWith(`..${sep}`) || expectedPath === projectRoot) {
    throw new Error('documentLocator escapes project root')
  }
  if (suppliedPath !== expectedPath) throw new Error('lint file must match context.documentLocator')
  const { bytes, realPath } = await stableRead(expectedPath)
  if (realPath !== expectedPath) throw new Error('documentLocator must not resolve through links')
  const extension = extname(locator)
  const format = extension === '.fig' ? 'fig' : 'pen'
  return {
    bytes,
    format,
    locator,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    byteLength: bytes.byteLength
  }
}

export function checkedNodesForContext(context: Ch5ReviewContext) {
  return context.targetCensus
    .map(({ producerRuleId: ruleId, nodeId }) => ({ ruleId, nodeId }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.nodeId.localeCompare(b.nodeId))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const input = value as JSONObject
  const output: JSONObject = {}
  for (const key of Object.keys(input).sort()) output[key] = canonicalize(input[key])
  return output
}

function computeExecutionDigest(input: {
  document: {
    format: 'fig' | 'pen'
    sha256: string
    byteLength: number
    documentId?: string
    revision?: string
  }
  rulesetContentDigest: string
  mappings: TargetCensusEntry[]
}) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(input)))
    .digest('hex')}`
}

export function createCh5ReviewReceipt(input: {
  context: Ch5ReviewContext
  document: StableDocument
  producerVersion: string
  implementationDigest: string
  startedAt: string
  finishedAt: string
  checkedNodes: Array<{ ruleId: string; nodeId: string }>
  messages: LintMessage[]
  errorCount: number
  warningCount: number
  infoCount: number
}) {
  const checkedNodes = [...input.checkedNodes].sort(
    (a, b) => a.ruleId.localeCompare(b.ruleId) || a.nodeId.localeCompare(b.nodeId)
  )
  const executedMappings = checkedNodes.map(({ ruleId: producerRuleId, nodeId }) => ({
    producerRuleId,
    nodeId
  }))
  const document = {
    format: input.document.format,
    sha256: input.document.sha256,
    byteLength: input.document.byteLength,
    ...(input.context.documentId === undefined ? {} : { documentId: input.context.documentId }),
    ...(input.context.revision === undefined ? {} : { revision: input.context.revision })
  }
  const executionDigest = computeExecutionDigest({
    document,
    rulesetContentDigest: input.context.rulesetContentDigest,
    mappings: input.context.targetCensus
  })
  return {
    schema: RECEIPT_SCHEMA,
    projectId: input.context.projectId,
    requestDigest: input.context.requestDigest,
    sourceIdentityDigest: input.context.sourceIdentityDigest,
    rulesetContentDigest: input.context.rulesetContentDigest,
    executionDigest,
    targetCensus: input.context.targetCensus,
    documentLocator: input.document.locator,
    document,
    producer: {
      name: '@open-pencil/cli',
      version: input.producerVersion,
      implementationDigest: input.implementationDigest
    },
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    checkedNodes,
    executedMappings,
    messages: input.messages,
    errorCount: input.errorCount,
    warningCount: input.warningCount,
    infoCount: input.infoCount
  }
}
