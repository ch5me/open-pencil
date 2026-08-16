import { describe, expect, test } from 'bun:test'

import {
  AGENT_CONTINUATION_SCHEMA,
  AGENT_ERROR_SCHEMA,
  AGENT_OPTIONS_SCHEMA,
  AGENT_RUN_SCHEMA,
  parseAgentOptionCatalog,
  parseAgentError,
  parseAgentRunRequest,
  parseAgentToolResultContinuation
} from './index'

function catalog() {
  return {
    schema: AGENT_OPTIONS_SCHEMA,
    options: [
      {
        optionId: 'option-balanced',
        label: 'Balanced',
        group: 'Recommended',
        description: 'Balances speed and quality.',
        capabilities: ['tools', 'vision'],
        efforts: ['low', 'medium', 'high'],
        selected: true,
        default: true
      }
    ]
  }
}

function runRequest() {
  return {
    schema: AGENT_RUN_SCHEMA,
    requestId: 'request-1',
    idempotencyKey: 'request-dedupe-1',
    conversation: { clientId: 'client-1' },
    input: { messageId: 'message-1', text: 'Create a card' },
    context: { documentId: 'document-1', selectedNodeIds: [] },
    tools: {
      manifestId: `sha256:${'a'.repeat(64)}`,
      definitions: [
        {
          name: 'create_card',
          description: 'Create a card.',
          mutates: true,
          requiresApproval: true,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: []
          }
        }
      ]
    },
    capabilities: { toolResults: true, reconnect: true, cancellation: true, approvals: true }
  }
}

describe('agent option contracts', () => {
  test('parses a provider-neutral versioned catalog', () => {
    expect(parseAgentOptionCatalog(catalog())).toEqual(catalog())
  })

  test('accepts a full live catalog without relaxing nested detail bounds', () => {
    const value = {
      schema: AGENT_OPTIONS_SCHEMA,
      options: Array.from({ length: 256 }, (_, index) => ({
        optionId: `option-${index}`,
        label: `Option ${index}`,
        group: 'Recommended',
        description: 'Available through the managed gateway.',
        capabilities: ['tools'],
        efforts: []
      }))
    }
    expect(parseAgentOptionCatalog(value)).toEqual(value)
  })

  test('rejects malformed catalogs and infrastructure leakage', () => {
    expect(() => parseAgentOptionCatalog({ ...catalog(), schema: 'unknown' })).toThrow()
    for (const field of [
      'providerId',
      'baseUrl',
      'credentialState',
      'apiType',
      'accountId',
      'billingPlan',
      'runtimeId',
      'containerImage',
      'workerId'
    ]) {
      const value = structuredClone(catalog())
      Object.assign(value.options[0], { [field]: 'private' })
      expect(() => parseAgentOptionCatalog(value)).toThrow()
    }
  })

  test('accepts optional selection while preserving selection-less requests', () => {
    expect(parseAgentRunRequest(runRequest())).toEqual(runRequest())
    const selected = { ...runRequest(), selection: { optionId: 'option-balanced', effort: 'high' } }
    expect(parseAgentRunRequest(selected)).toEqual(selected)
    expect(() =>
      parseAgentRunRequest({
        ...selected,
        selection: { ...selected.selection, providerId: 'private' }
      })
    ).toThrow()
  })

  test('rejects provider configuration hidden in recursive safe JSON fields', () => {
    for (const field of ['baseUrl', 'credentialState', 'apiType', 'apiKey']) {
      expect(() =>
        parseAgentError({
          schema: AGENT_ERROR_SCHEMA,
          code: 'run-failed',
          message: 'Failed.',
          retryable: false,
          phase: 'request',
          details: { nested: { [field]: 'private' } }
        })
      ).toThrow()
      expect(() =>
        parseAgentToolResultContinuation({
          schema: AGENT_CONTINUATION_SCHEMA,
          requestId: 'request-1',
          idempotencyKey: 'continuation-1',
          sessionId: 'session-1',
          runId: 'run-1',
          callId: 'call-1',
          continuationId: 'continuation-1',
          manifestId: `sha256:${'a'.repeat(64)}`,
          target: { documentId: 'document-1' },
          status: 'ok',
          output: { nested: { [field]: 'private' } }
        })
      ).toThrow()
    }
  })
})
