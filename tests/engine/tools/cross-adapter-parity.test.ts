import { describe, expect, test } from 'bun:test'

import { valibotSchema } from '@ai-sdk/valibot'
import { tool } from 'ai'
import * as v from 'valibot'
import { z } from 'zod'

import {
  ALL_TOOLS,
  createGatewayManifest,
  toolsToAI,
  type GatewayActionSchema
} from '@open-pencil/core/tools'

import { registerTools } from '#mcp/server'

import { cliSourcePath, repoPath } from '#tests/helpers/paths'

interface RegisteredMCPTool {
  description: string
  inputSchema: z.ZodType
}

interface AISchema {
  description: string
  inputSchema: { jsonSchema: JSONSchema }
}

interface JSONSchema {
  [key: string]: unknown
  properties?: Record<string, unknown>
  required?: unknown[]
  type?: unknown
}

function canonicalSchema(schema: JSONSchema): JSONSchema {
  const { $schema: _dialect, additionalProperties: _additionalProperties, ...canonical } = schema
  if (Array.isArray(canonical.required)) canonical.required = [...canonical.required].sort()
  else if (canonical.type === 'object') canonical.required = []
  return canonical
}

function gatewaySchema(action: GatewayActionSchema): JSONSchema {
  return canonicalSchema(action.inputSchema as JSONSchema)
}

function mcpToolSchema(schema: z.ZodType): JSONSchema {
  const converted = z.toJSONSchema(schema) as JSONSchema
  const properties = converted.properties
  if (properties) {
    const { document_id: _documentId, page_id: _pageId, ...toolProperties } = properties
    converted.properties = toolProperties
  }
  return canonicalSchema(converted)
}

describe('canonical ToolDef cross-adapter parity', () => {
  test('keeps local AI, MCP, CLI eval, and gateway exposure on canonical definitions', async () => {
    const canonicalNames = ALL_TOOLS.map(({ name }) => name).sort()
    const aiTools = toolsToAI(
      ALL_TOOLS,
      { getFigma: () => ({}) as never },
      { v, valibotSchema, tool }
    ) as Record<string, AISchema>

    const mcpTools = new Map<string, RegisteredMCPTool>()
    const mcpServer = {
      registerTool(name: string, config: RegisteredMCPTool) {
        mcpTools.set(name, config)
      }
    }
    registerTools(mcpServer as never, {
      enableEval: true,
      sendRPC: async () => ({ ok: true })
    })

    expect(Object.keys(aiTools).sort()).toEqual(canonicalNames)
    // MCP also owns filesystem/session operations; compare only its ToolDef-backed surface.
    expect([...mcpTools.keys()].filter((name) => canonicalNames.includes(name)).sort()).toEqual(
      canonicalNames
    )

    for (const definition of ALL_TOOLS) {
      expect(aiTools[definition.name]?.description).toBe(definition.description)
      expect(mcpTools.get(definition.name)?.description).toBe(definition.description)
    }

    const manifest = await createGatewayManifest(ALL_TOOLS)
    for (const action of manifest.actions) {
      const aiSchema = aiTools[action.name]?.inputSchema.jsonSchema
      const mcpSchema = mcpTools.get(action.name)?.inputSchema
      expect(aiSchema, `${action.name} missing from local AI`).toBeDefined()
      expect(mcpSchema, `${action.name} missing from MCP`).toBeDefined()
      expect(canonicalSchema(aiSchema ?? {})).toEqual(gatewaySchema(action))
      expect(mcpToolSchema(mcpSchema ?? z.never())).toEqual(gatewaySchema(action))
    }

    // CLI commands are intentionally not ToolDef-generated. Its eval boundary exposes the
    // same FigmaAPI that ToolDef.execute receives, rather than a second named-tool registry.
    const cli = Bun.spawn(
      [
        'bun',
        cliSourcePath('index.ts'),
        'eval',
        repoPath('tests/fixtures/pencil_simple.pen'),
        '--code',
        'return { api: figma.constructor.name, canRead: typeof figma.getNodeById === "function", canCreate: typeof figma.createRectangle === "function" }',
        '--json'
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(cli.stdout).text(),
      new Response(cli.stderr).text(),
      cli.exited
    ])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ api: 'FigmaAPI', canRead: true, canCreate: true })
  })
})
