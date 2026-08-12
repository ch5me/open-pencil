import type { ParamDef, ToolDef, ToolRemotePolicy } from './schema'

export const GATEWAY_MANIFEST_VERSION = '1' as const

export interface GatewayActionSchema {
  name: string
  description: string
  mutates: boolean
  requiresApproval: boolean
  inputSchema: {
    type: 'object'
    additionalProperties: false
    properties: Record<string, Record<string, unknown>>
    required: string[]
  }
}

export interface GatewayActionManifest {
  schemaVersion: typeof GATEWAY_MANIFEST_VERSION
  manifestId: `sha256:${string}`
  actions: GatewayActionSchema[]
}

/** Deliberately narrow initial exposure; all unlisted ToolDefs remain remote-disabled. */
export const GATEWAY_REMOTE_POLICIES: Readonly<Record<string, ToolRemotePolicy>> = {
  get_node: { enabled: true },
  get_selection: { enabled: true },
  node_resize: { enabled: true, requiresApproval: true }
}

function paramSchema(param: ParamDef): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    description: param.description,
    type: param.type === 'color' ? 'string' : param.type === 'string[]' ? 'array' : param.type
  }
  if (param.type === 'string[]') schema.items = { type: 'string' }
  if (param.enum) schema.enum = [...param.enum]
  if (param.min !== undefined) schema.minimum = param.min
  if (param.max !== undefined) schema.maximum = param.max
  if (param.default !== undefined) schema.default = param.default
  return schema
}

export function toolToGatewayAction(tool: ToolDef): GatewayActionSchema | undefined {
  const policy = tool.remote?.enabled ? tool.remote : GATEWAY_REMOTE_POLICIES[tool.name]
  if (!policy?.enabled) return undefined
  const entries = Object.entries(tool.params).sort(([left], [right]) => left.localeCompare(right))
  return {
    name: tool.name,
    description: tool.description,
    mutates: tool.mutates ?? false,
    requiresApproval: policy.requiresApproval ?? false,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(entries.map(([name, param]) => [name, paramSchema(param)])),
      required: entries.filter(([, param]) => param.required).map(([name]) => name)
    }
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createGatewayManifest(tools: readonly ToolDef[]): Promise<GatewayActionManifest> {
  const actions = tools
    .map(toolToGatewayAction)
    .filter((action): action is GatewayActionSchema => action !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name))
  const content = { schemaVersion: GATEWAY_MANIFEST_VERSION, actions }
  return { ...content, manifestId: `sha256:${await sha256(canonicalJson(content))}` }
}
