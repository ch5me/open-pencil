import {
  AGENT_GATEWAY_MANIFEST_VERSION,
  createAgentGatewayManifestId
} from '@open-pencil/agent-contracts'
import type {
  AgentGatewayActionDefinition,
  AgentGatewayPropertySchema,
  AgentJSONValue
} from '@open-pencil/agent-contracts'

import type { ParamDef, ToolDef, ToolRemotePolicy } from './schema'

export const GATEWAY_MANIFEST_VERSION = AGENT_GATEWAY_MANIFEST_VERSION

export type GatewayActionSchema = AgentGatewayActionDefinition

export interface GatewayActionManifest {
  schemaVersion: typeof GATEWAY_MANIFEST_VERSION
  manifestId: `sha256:${string}`
  actions: GatewayActionSchema[]
}

/** Deliberately narrow initial exposure; all unlisted ToolDefs remain remote-disabled. */
export const GATEWAY_REMOTE_POLICIES: Readonly<Partial<Record<string, ToolRemotePolicy>>> = {
  create_shape: { enabled: true, requiresApproval: true },
  get_node: { enabled: true },
  get_selection: { enabled: true },
  node_resize: { enabled: true, requiresApproval: true }
}

function paramSchema(param: ParamDef): AgentGatewayPropertySchema {
  let type: AgentGatewayPropertySchema['type'] = 'string'
  if (param.type === 'color') type = 'string'
  else if (param.type === 'string[]') type = 'array'
  else type = param.type
  const schema: AgentGatewayPropertySchema = {
    description: param.description,
    type
  }
  if (param.type === 'string[]') schema.items = { type: 'string' }
  if (param.enum) schema.enum = [...param.enum]
  if (param.min !== undefined) schema.minimum = param.min
  if (param.max !== undefined) schema.maximum = param.max
  if (param.default !== undefined) schema.default = param.default as AgentJSONValue
  return schema
}

export function toolToGatewayAction(tool: ToolDef): GatewayActionSchema | undefined {
  const declaredPolicy = tool.remote
  const policy =
    declaredPolicy?.enabled === true ? declaredPolicy : GATEWAY_REMOTE_POLICIES[tool.name]
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

export async function createGatewayManifest(
  tools: readonly ToolDef[]
): Promise<GatewayActionManifest> {
  const actions = tools
    .map(toolToGatewayAction)
    .filter((action): action is GatewayActionSchema => action !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name))
  return {
    schemaVersion: GATEWAY_MANIFEST_VERSION,
    actions,
    manifestId: await createAgentGatewayManifestId(actions)
  }
}
