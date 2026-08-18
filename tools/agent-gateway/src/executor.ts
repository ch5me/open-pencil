import { createOpenAI } from '@ai-sdk/openai'
import { generateText, jsonSchema, tool } from 'ai'
import type {
  AgentGatewayActionDefinition,
  AgentJSONValue,
  AgentRunRequest,
  AgentToolResultContinuation
} from '@open-pencil/agent-contracts'

const DEFAULT_LITELLM_ORIGIN = 'https://litellm.ch5.me/v1'

export type AgentToolCall = {
  callId: string
  name: string
  arguments: AgentJSONValue
}

export type AgentExecutionStart =
  | { kind: 'completed'; text: readonly string[] }
  | { kind: 'tool-call'; text: readonly string[]; call: AgentToolCall }

export interface AgentExecutor {
  start(input: {
    request: AgentRunRequest
    optionId: string
    optionLabel: string
    effort?: string
    signal: AbortSignal
  }): Promise<AgentExecutionStart>
  continue(input: {
    request: AgentRunRequest
    optionId: string
    call: AgentToolCall
    continuation: AgentToolResultContinuation
    signal: AbortSignal
  }): Promise<string>
}

export class AgentExecutorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentExecutorError'
  }
}

function toAgentJSONValue(value: unknown): AgentJSONValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value
  }
  if (Array.isArray(value)) return value.map(toAgentJSONValue)
  if (typeof value === 'object') {
    const result: Record<string, AgentJSONValue> = {}
    for (const [key, item] of Object.entries(value)) result[key] = toAgentJSONValue(item)
    return result
  }
  throw new AgentExecutorError('Agent returned non-JSON tool arguments.')
}

function toolsFromManifest(definitions: AgentGatewayActionDefinition[]) {
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: jsonSchema(definition.inputSchema)
      })
    ])
  )
}

function logServingEvidence(
  requestId: string,
  optionId: string,
  response: {
    id: string
    headers?: Record<string, string>
  }
): void {
  const headers = response.headers
  process.stdout.write(
    `${JSON.stringify({
      event: 'openpencil.agent.served',
      requestId,
      responseId: response.id,
      requestedModel: optionId,
      servedModel: headers?.['x-ch5-served-model'] ?? null,
      servedProvider: headers?.['x-ch5-served-provider'] ?? null,
      servedRoute: headers?.['x-ch5-served-route'] ?? null,
      liteLlmCallId: headers?.['x-litellm-call-id'] ?? null
    })}\n`
  )
}

function promptFor(request: AgentRunRequest): string {
  const selection =
    request.context.selectedNodeIds.length > 0
      ? `Selected node ids: ${request.context.selectedNodeIds.join(', ')}.`
      : 'No nodes are selected.'
  return [
    'You are the CH5 OpenPencil design agent.',
    'Use only the supplied OpenPencil tools for design mutations.',
    'Make one focused tool call that directly satisfies the user request.',
    `Document id: ${request.context.documentId}.`,
    request.context.pageId ? `Page id: ${request.context.pageId}.` : '',
    selection,
    `User request: ${request.input.text}`
  ]
    .filter(Boolean)
    .join('\n')
}

export function createLiteLlmExecutor(env: NodeJS.ProcessEnv): AgentExecutor {
  const apiKey = env.LITELLM_API_KEY?.trim()
  if (!apiKey) throw new AgentExecutorError('LiteLLM service credential is not configured.')
  const provider = createOpenAI({
    baseURL: env.LITELLM_BASE_URL?.trim() || DEFAULT_LITELLM_ORIGIN,
    apiKey,
    name: 'ch5-litellm'
  })

  return {
    async start({ request, optionId, signal }) {
      const result = await generateText({
        model: provider.chat(optionId),
        prompt: promptFor(request),
        tools: toolsFromManifest(request.tools.definitions),
        toolChoice: 'auto',
        maxOutputTokens: 800,
        abortSignal: signal
      })
      logServingEvidence(request.requestId, optionId, result.response)
      if (result.toolCalls.length === 0) {
        return {
          kind: 'completed',
          text: [result.text || 'No design action was requested.']
        }
      }
      if (result.toolCalls.length !== 1) {
        throw new AgentExecutorError('Agent returned more than one design action.')
      }
      const call = result.toolCalls[0]
      if (!call) throw new AgentExecutorError('Agent tool call is missing.')
      return {
        kind: 'tool-call',
        text: [result.text || 'I can make that change.'],
        call: {
          callId: call.toolCallId,
          name: call.toolName,
          arguments: toAgentJSONValue(call.input)
        }
      }
    },
    async continue({ request, optionId, call, continuation, signal }) {
      const result = await generateText({
        model: provider.chat(optionId),
        prompt: [
          `The OpenPencil action ${call.name} completed successfully.`,
          `Original request: ${request.input.text}`,
          `Tool result: ${JSON.stringify(continuation.output ?? null)}`,
          'Confirm the completed change in one concise sentence.'
        ].join('\n'),
        maxOutputTokens: 160,
        abortSignal: signal
      })
      logServingEvidence(request.requestId, optionId, result.response)
      return result.text || 'The design change is ready.'
    }
  }
}

export function createDeterministicExecutor(): AgentExecutor {
  return {
    async start({ optionLabel, effort }) {
      return {
        kind: 'tool-call',
        text: [`Using ${optionLabel} (${effort ?? 'default'}), I can make `, 'that change. '],
        call: {
          callId: 'call-1',
          name: 'create_shape',
          arguments: {
            type: 'RECTANGLE',
            x: 120,
            y: 120,
            width: 240,
            height: 160,
            name: 'Gateway rectangle'
          }
        }
      }
    },
    async continue() {
      return 'The rectangle is ready.'
    }
  }
}
