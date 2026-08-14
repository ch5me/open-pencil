import { AGENT_ERROR_SCHEMA, parseAgentOptionCatalog } from '@open-pencil/agent-contracts'
import type {
  AgentOptionCatalog,
  AgentOptionCatalogEntry,
  AgentOptionSelection
} from '@open-pencil/agent-contracts'

const DEFAULT_MAX_AGE_SECONDS = 300
const REQUEST_TIMEOUT_MS = 5_000
const MAX_CLOCK_SKEW_MS = 30_000
const MAX_RESPONSE_BYTES = 256 * 1024
const MAX_SOURCE_DEPTH = 12
const MAX_SOURCE_ENTRIES = 2_048
const FORBIDDEN_FIELD =
  /(?:provider|model|baseurl|api(?:type|key)|credential|account|billing|runtime|container|image|registry|worker|routing|route)/i
const FORBIDDEN_VALUE =
  /(?:https?:\/\/|api[_ -]?(?:key|type)|base[_ -]?url|credential|billing|runtime|container|registry|worker|routing|account[_ -]?(?:id|key|token)|bearer\s+)/i
const ALLOWED_CAPABILITIES = new Set(['tools', 'vision'])
const ALLOWED_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

export type AgentCatalogSource = (principal: string) => Promise<AgentOptionCatalog>

export interface AgentCatalogEnv {
  AGENT_NATIVE_CATALOG_URL?: string
  AGENT_NATIVE_CATALOG_TOKEN?: string
  AGENT_NATIVE_CATALOG_MAX_AGE_SECONDS?: string
}

type CatalogEnvelope = {
  catalog: unknown
  issuedAt: unknown
  expiresAt: unknown
}

export class AgentCatalogError extends Error {
  constructor(
    readonly code: 'options-unavailable' | 'catalog-invalid',
    message: string
  ) {
    super(message)
    this.name = 'AgentCatalogError'
  }

  response(): Response {
    return Response.json(
      {
        schema: AGENT_ERROR_SCHEMA,
        code: this.code,
        message: this.message,
        retryable: this.code === 'options-unavailable',
        phase: 'request'
      },
      { status: 502 }
    )
  }
}

function normalizedKey(key: string): string {
  return key.replaceAll(/[^a-z0-9]/gi, '')
}

function validateSourceShape(value: unknown): void {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }]
  let entries = 0
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    if (current.depth > MAX_SOURCE_DEPTH) {
      throw new AgentCatalogError('catalog-invalid', 'Agent Native catalog is too deeply nested.')
    }
    if (typeof current.value === 'string' && FORBIDDEN_VALUE.test(current.value)) {
      throw new AgentCatalogError(
        'catalog-invalid',
        'Agent Native catalog contains forbidden values.'
      )
    }
    if (!current.value || typeof current.value !== 'object') continue
    const children = Array.isArray(current.value)
      ? current.value.map((child) => [undefined, child] as const)
      : Object.entries(current.value)
    entries += children.length
    if (entries > MAX_SOURCE_ENTRIES) {
      throw new AgentCatalogError('catalog-invalid', 'Agent Native catalog is too large.')
    }
    for (const [key, child] of children) {
      if (key !== undefined && FORBIDDEN_FIELD.test(normalizedKey(key))) {
        throw new AgentCatalogError(
          'catalog-invalid',
          'Agent Native catalog contains forbidden fields.'
        )
      }
      pending.push({ value: child, depth: current.depth + 1 })
    }
  }
}

function parseTimestamp(value: unknown, name: string): number {
  if (typeof value !== 'string')
    throw new AgentCatalogError('catalog-invalid', `${name} is invalid.`)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new AgentCatalogError('catalog-invalid', `${name} is invalid.`)
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp))
    throw new AgentCatalogError('catalog-invalid', `${name} is invalid.`)
  return timestamp
}

function projectCatalog(value: unknown, maxAgeSeconds: number, now: number): AgentOptionCatalog {
  validateSourceShape(value)
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  if (!record || !Object.hasOwn(record, 'catalog')) {
    throw new AgentCatalogError('catalog-invalid', 'Agent Native catalog envelope is required.')
  }
  const envelope = record as CatalogEnvelope
  const keys = Object.keys(envelope)
  if (keys.some((key) => !['catalog', 'issuedAt', 'expiresAt'].includes(key))) {
    throw new AgentCatalogError('catalog-invalid', 'Agent Native catalog envelope is malformed.')
  }
  const issuedAt = parseTimestamp(envelope.issuedAt, 'issuedAt')
  const expiresAt = parseTimestamp(envelope.expiresAt, 'expiresAt')
  if (
    issuedAt > now + MAX_CLOCK_SKEW_MS ||
    issuedAt > expiresAt ||
    now - issuedAt > maxAgeSeconds * 1_000 ||
    now > expiresAt
  ) {
    throw new AgentCatalogError('catalog-invalid', 'Agent Native catalog is stale.')
  }
  try {
    const catalog = parseAgentOptionCatalog(envelope.catalog)
    for (const option of catalog.options) {
      if (
        option.capabilities.some((capability) => !ALLOWED_CAPABILITIES.has(capability)) ||
        option.efforts.some((effort) => !ALLOWED_EFFORTS.has(effort))
      ) {
        throw new AgentCatalogError(
          'catalog-invalid',
          'Agent Native catalog contains unsupported choices.'
        )
      }
    }
    return catalog
  } catch (error) {
    if (error instanceof AgentCatalogError) throw error
    throw new AgentCatalogError('catalog-invalid', 'Agent Native catalog is malformed.')
  }
}

function catalogURL(env: AgentCatalogEnv): URL {
  const configured = env.AGENT_NATIVE_CATALOG_URL?.trim()
  if (!configured)
    throw new AgentCatalogError('options-unavailable', 'Agent Native catalog is not configured.')
  let url: URL
  try {
    url = new URL(configured)
  } catch {
    throw new AgentCatalogError('options-unavailable', 'Agent Native catalog URL is invalid.')
  }
  const localHostname =
    url.hostname === '127.0.0.1' ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost')
  if (url.protocol !== 'https:' && !localHostname) {
    throw new AgentCatalogError('options-unavailable', 'Agent Native catalog URL must use HTTPS.')
  }
  if (url.protocol === 'https:' && !env.AGENT_NATIVE_CATALOG_TOKEN?.trim()) {
    throw new AgentCatalogError(
      'options-unavailable',
      'Agent Native catalog credential is not configured.'
    )
  }
  return url
}

export function createAgentCatalogSource(
  env: AgentCatalogEnv,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now
): AgentCatalogSource {
  const url = catalogURL(env)
  const maxAgeSeconds = Number(env.AGENT_NATIVE_CATALOG_MAX_AGE_SECONDS ?? DEFAULT_MAX_AGE_SECONDS)
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new AgentCatalogError(
      'options-unavailable',
      'Agent Native catalog freshness bound is invalid.'
    )
  }
  return async (principal) => {
    if (!principal.trim()) {
      throw new AgentCatalogError('options-unavailable', 'Verified principal required.')
    }
    const headers = new Headers({ Accept: 'application/json' })
    const token = env.AGENT_NATIVE_CATALOG_TOKEN?.trim()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    headers.set('X-OpenPencil-Principal', principal)
    let response: Response
    try {
      response = await fetcher(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    } catch {
      throw new AgentCatalogError('options-unavailable', 'Agent Native catalog is unavailable.')
    }
    if (!response.ok)
      throw new AgentCatalogError('options-unavailable', 'Agent Native catalog is unavailable.')
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new AgentCatalogError('catalog-invalid', 'Agent Native catalog is too large.')
    }
    let text: string
    try {
      text = await response.text()
    } catch {
      throw new AgentCatalogError('catalog-invalid', 'Agent Native catalog is malformed.')
    }
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new AgentCatalogError('catalog-invalid', 'Agent Native catalog is too large.')
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      throw new AgentCatalogError('catalog-invalid', 'Agent Native catalog is malformed.')
    }
    return projectCatalog(value, maxAgeSeconds, now())
  }
}

export function findAgentOption(
  catalog: AgentOptionCatalog,
  selection: AgentOptionSelection
): AgentOptionCatalogEntry | undefined {
  return catalog.options.find((option) => option.optionId === selection.optionId)
}

export function selectionError(
  catalog: AgentOptionCatalog,
  selection: AgentOptionSelection | undefined
): string | undefined {
  if (!selection) return undefined
  const option = findAgentOption(catalog, selection)
  if (!option) return `Unknown agent option: ${selection.optionId}.`
  if (selection.effort && !option.efforts.includes(selection.effort)) {
    return `Unknown effort ${selection.effort} for agent option ${selection.optionId}.`
  }
}
