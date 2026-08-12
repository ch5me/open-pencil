import { describe, expect, test } from 'bun:test'

import {
  createGatewayManifest,
  defineTool,
  GATEWAY_REMOTE_POLICIES,
  toolToGatewayAction
} from '@open-pencil/core/tools'

describe('gateway ToolDef manifest', () => {
  const resize = defineTool({
    name: 'node_resize',
    description: 'Resize',
    mutates: true,
    params: {
      width: { type: 'number', description: 'Width', required: true, min: 1 },
      id: { type: 'string', description: 'Node ID', required: true }
    },
    execute: () => ({ ok: true })
  })
  const privateTool = defineTool({
    name: 'private_action',
    description: 'Private',
    params: {},
    execute: () => null
  })

  test('is default-disabled and exposes a small mutation allowlist', () => {
    expect(privateTool.remote).toEqual({ enabled: false })
    expect(toolToGatewayAction(privateTool)).toBeUndefined()
    expect(GATEWAY_REMOTE_POLICIES.node_resize).toEqual({ enabled: true, requiresApproval: true })
    expect(toolToGatewayAction(resize)?.mutates).toBe(true)
  })

  test('derives deterministic strict JSON Schema solely from ToolDef params', async () => {
    const first = await createGatewayManifest([privateTool, resize])
    const second = await createGatewayManifest([resize, privateTool])
    expect(first).toEqual(second)
    expect(first.manifestId).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(first.actions[0]?.inputSchema).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { description: 'Node ID', type: 'string' },
        width: { description: 'Width', minimum: 1, type: 'number' }
      },
      required: ['id', 'width']
    })
  })

  test('binds manifest identity to canonical content', async () => {
    const changed = defineTool({ ...resize, description: 'Resize precisely' })
    expect((await createGatewayManifest([resize])).manifestId).not.toBe(
      (await createGatewayManifest([changed])).manifestId
    )
  })
})
