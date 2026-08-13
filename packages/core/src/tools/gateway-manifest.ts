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
  create_shape: {
    enabled: true,
    requiresApproval: true,
    targetOperands: [{ param: 'parent_id', type: 'string' }]
  },
  get_node: { enabled: true, targetOperands: [{ param: 'id', type: 'string' }] },
  get_selection: { enabled: true, targetOperands: [] },
  node_resize: {
    enabled: true,
    requiresApproval: true,
    targetOperands: [{ param: 'id', type: 'string' }]
  }
}

export function remotePolicyForTool(tool: ToolDef): ToolRemotePolicy {
  return tool.remote?.enabled === true
    ? tool.remote
    : (GATEWAY_REMOTE_POLICIES[tool.name] ?? { enabled: false })
}

function validateTargetOperands(tool: ToolDef, policy: ToolRemotePolicy): void {
  if (!policy.enabled) return
  if (!policy.targetOperands) {
    throw new Error(`Remote tool "${tool.name}" must declare targetOperands`)
  }
  const claimedParams = new Set<string>()
  for (const operand of policy.targetOperands) {
    for (const paramName of [operand.param, ...(operand.aliases ?? [])]) {
      if (claimedParams.has(paramName)) {
        throw new Error(
          `Remote tool "${tool.name}" declares duplicate target operand "${paramName}"`
        )
      }
      claimedParams.add(paramName)
      const param = Object.entries(tool.params).find(([name]) => name === paramName)?.[1]
      if (!param || param.type !== operand.type) {
        throw new Error(
          `Remote tool "${tool.name}" target operand "${paramName}" must be a ${operand.type} parameter`
        )
      }
    }
  }
}

function gatewayParamType(param: ParamDef): AgentGatewayPropertySchema['type'] {
  if (param.type === 'color') return 'string'
  if (param.type === 'string[]') return 'array'
  return param.type
}

function paramSchema(param: ParamDef): AgentGatewayPropertySchema {
  const schema: AgentGatewayPropertySchema = {
    description: param.description,
    type: gatewayParamType(param)
  }
  if (param.type === 'string[]') schema.items = { type: 'string' }
  if (param.enum) schema.enum = [...param.enum]
  if (param.min !== undefined) schema.minimum = param.min
  if (param.max !== undefined) schema.maximum = param.max
  if (param.default !== undefined) schema.default = param.default as AgentJSONValue
  return schema
}

export function toolToGatewayAction(tool: ToolDef): GatewayActionSchema | undefined {
  const policy = remotePolicyForTool(tool)
  if (!policy.enabled) return undefined
  validateTargetOperands(tool, policy)
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
