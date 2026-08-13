import { describe, expect, test } from 'bun:test'

import { defineTool } from '@open-pencil/core/tools'

import {
  createGatewayToolExecutor,
  type GatewayToolCall,
  type GatewayToolManifest
} from '@/app/ai/agent-service/execution'
import type { EditorStore } from '@/app/editor/active-store'
import { createEditorStore } from '@/app/editor/session'

const manifest: GatewayToolManifest = {
  id: 'manifest-1',
  actions: [{ name: 'create_shape', mutates: true, requiresApproval: true }]
}

const baseCall: GatewayToolCall = {
  runId: 'run-1',
  callId: 'call-1',
  continuationId: 'continuation-1',
  manifestId: manifest.id,
  target: { documentId: 'document-1', pageId: 'page-1' },
  toolName: 'create_shape',
  input: { type: 'RECTANGLE', x: 0, y: 0, width: 10, height: 10 }
}

function setup(options: { approve?: () => boolean | Promise<boolean> } = {}) {
  let executions = 0
  const tools = {
    create_shape: {
      execute: async (_input: unknown) => {
        executions++
        return { id: 'created-1' }
      }
    }
  }
  const execute = createGatewayToolExecutor({
    store: {} as EditorStore,
    runId: baseCall.runId,
    target: () => baseCall.target,
    manifest,
    approve: options.approve ?? (() => true),
    createTools: () => tools
  })
  return { execute, executionCount: () => executions }
}

describe('gateway tool execution', () => {
  test('executes through the injected AI wrapper and replays an identical continuation', async () => {
    const harness = setup()
    const first = await harness.execute(baseCall)
    const replay = await harness.execute(structuredClone(baseCall))

    expect(first).toEqual({
      ok: true,
      callId: baseCall.callId,
      continuationId: baseCall.continuationId,
      output: { id: 'created-1' }
    })
    expect(replay).toEqual(first)
    expect(harness.executionCount()).toBe(1)
  })

  test('rejects conflicting call and continuation reuse', async () => {
    const harness = setup()
    await harness.execute(baseCall)

    const changed = await harness.execute({ ...baseCall, input: { ...baseCall.input, width: 20 } })
    const reused = await harness.execute({
      ...baseCall,
      callId: 'call-2',
      toolName: 'create_shape'
    })

    expect(changed).toMatchObject({ ok: false, error: { code: 'call_conflict' } })
    expect(reused).toMatchObject({ ok: false, error: { code: 'call_conflict' } })
    expect(harness.executionCount()).toBe(1)
  })

  test('validates run, target, manifest, and action schema before execution', async () => {
    const harness = setup()
    const wrongRun = await harness.execute({ ...baseCall, runId: 'other', callId: 'wrong-run' })
    const wrongTarget = await harness.execute({
      ...baseCall,
      callId: 'wrong-target',
      continuationId: 'wrong-target',
      target: { ...baseCall.target, pageId: 'other' }
    })
    const wrongManifest = await harness.execute({
      ...baseCall,
      callId: 'wrong-manifest',
      continuationId: 'wrong-manifest',
      manifestId: 'other'
    })
    const invalidInput = await harness.execute({
      ...baseCall,
      callId: 'invalid-input',
      continuationId: 'invalid-input',
      input: { ...baseCall.input, width: 0 }
    })

    expect(wrongRun).toMatchObject({ ok: false, error: { code: 'target_mismatch' } })
    expect(wrongTarget).toMatchObject({ ok: false, error: { code: 'target_mismatch' } })
    expect(wrongManifest).toMatchObject({ ok: false, error: { code: 'manifest_mismatch' } })
    expect(invalidInput).toMatchObject({ ok: false, error: { code: 'invalid_schema' } })
    expect(harness.executionCount()).toBe(0)
  })

  test('defaults mutation approval to rejection and bounds a pending approval', async () => {
    const noApproval = createGatewayToolExecutor({
      store: {} as EditorStore,
      runId: baseCall.runId,
      target: () => baseCall.target,
      manifest,
      createTools: () => ({ create_shape: { execute: async (_input: unknown) => ({}) } })
    })
    const rejected = await noApproval(baseCall)
    const timedOut = await createGatewayToolExecutor({
      store: {} as EditorStore,
      runId: baseCall.runId,
      target: () => baseCall.target,
      manifest,
      approve: () =>
        new Promise<boolean>((resolve) => {
          void resolve
        }),
      approvalTimeoutMs: 1,
      createTools: () => ({ create_shape: { execute: async (_input: unknown) => ({}) } })
    })({ ...baseCall, callId: 'timeout', continuationId: 'timeout' })

    expect(rejected).toMatchObject({ ok: false, error: { code: 'approval_rejected' } })
    expect(timedOut).toMatchObject({ ok: false, error: { code: 'approval_rejected' } })
  })

  test('fences execution when cancellation races approval', async () => {
    let cancelled = false
    let approve: ((value: boolean) => void) | undefined
    const harness = setup({
      approve: () =>
        new Promise<boolean>((resolve) => {
          approve = resolve
        })
    })
    const execute = createGatewayToolExecutor({
      store: {} as EditorStore,
      runId: baseCall.runId,
      target: () => baseCall.target,
      manifest,
      approve: () =>
        new Promise<boolean>((resolve) => {
          approve = resolve
        }),
      isCancelled: () => cancelled,
      createTools: () => ({
        create_shape: {
          execute: async (_input: unknown) => {
            throw new Error('Cancelled tool must not execute')
          }
        }
      })
    })

    const pending = execute(baseCall)
    cancelled = true
    approve?.(true)

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: 'approval_rejected' }
    })
    expect(harness.executionCount()).toBe(0)
  })

  test('rejects node operands outside the authorized page', async () => {
    const store = createEditorStore()
    const targetPageId = store.state.currentPageId
    const otherPage = store.graph.addPage('Other page')
    const foreignNode = store.graph.createNode('RECTANGLE', otherPage.id, {
      name: 'Foreign rectangle'
    })
    let executions = 0
    const execute = createGatewayToolExecutor({
      store,
      runId: baseCall.runId,
      target: () => ({ documentId: 'document-1', pageId: targetPageId }),
      manifest: {
        id: 'manifest-1',
        actions: [{ name: 'node_resize', mutates: true, requiresApproval: true }]
      },
      approve: () => true,
      createTools: () => ({
        node_resize: {
          execute: async (_input: unknown) => {
            executions++
            return {}
          }
        }
      })
    })

    const result = await execute({
      ...baseCall,
      target: { documentId: 'document-1', pageId: targetPageId },
      toolName: 'node_resize',
      input: { id: foreignNode.id, width: 20, height: 20 }
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'target_mismatch' } })
    expect(executions).toBe(0)
  })

  test('accepts same-page scalar operands and rejects cross-page scalar operands', async () => {
    const store = createEditorStore()
    const targetPageId = store.state.currentPageId
    const localNode = store.graph.createNode('RECTANGLE', targetPageId, { name: 'Local' })
    const otherPage = store.graph.addPage('Other')
    const foreignNode = store.graph.createNode('RECTANGLE', otherPage.id, { name: 'Foreign' })
    let executions = 0
    const execute = createGatewayToolExecutor({
      store,
      runId: baseCall.runId,
      target: () => ({ documentId: 'document-1', pageId: targetPageId }),
      manifest: {
        id: 'manifest-1',
        actions: [{ name: 'node_resize', mutates: true, requiresApproval: true }]
      },
      approve: () => true,
      createTools: () => ({
        node_resize: { execute: async () => ({ execution: ++executions }) }
      })
    })

    const local = await execute({
      ...baseCall,
      target: { documentId: 'document-1', pageId: targetPageId },
      toolName: 'node_resize',
      input: { id: localNode.id, width: 20, height: 20 }
    })
    const foreign = await execute({
      ...baseCall,
      callId: 'foreign',
      continuationId: 'foreign',
      target: { documentId: 'document-1', pageId: targetPageId },
      toolName: 'node_resize',
      input: { id: foreignNode.id, width: 20, height: 20 }
    })

    expect(local).toMatchObject({ ok: true })
    expect(foreign).toMatchObject({ ok: false, error: { code: 'target_mismatch' } })
    expect(executions).toBe(1)
  })

  test('validates string-array operands and their aliases', async () => {
    const definition = defineTool({
      name: 'batch_nodes',
      description: 'Batch nodes',
      remote: {
        enabled: true,
        targetOperands: [{ param: 'ids', aliases: ['node_ids'], type: 'string[]' }]
      },
      params: {
        ids: { type: 'string[]', description: 'Node IDs' },
        node_ids: { type: 'string[]', description: 'Alias node IDs' }
      },
      execute: () => null
    })
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const local = store.graph.createNode('RECTANGLE', pageId, { name: 'Local' })
    const otherPage = store.graph.addPage('Other')
    const foreign = store.graph.createNode('RECTANGLE', otherPage.id, { name: 'Foreign' })
    let executions = 0
    const execute = createGatewayToolExecutor({
      store,
      definitions: [definition],
      runId: baseCall.runId,
      target: () => ({ documentId: 'document-1', pageId }),
      manifest: {
        id: 'manifest-1',
        actions: [{ name: definition.name, mutates: false, requiresApproval: false }]
      },
      createTools: () => ({
        [definition.name]: { execute: async () => ({ execution: ++executions }) }
      })
    })
    const call = (input: Record<string, unknown>, suffix: string): GatewayToolCall => ({
      ...baseCall,
      callId: suffix,
      continuationId: suffix,
      target: { documentId: 'document-1', pageId },
      toolName: definition.name,
      input
    })

    expect(await execute(call({ ids: [local.id] }, 'local'))).toMatchObject({ ok: true })
    expect(await execute(call({ ids: [local.id, foreign.id] }, 'foreign'))).toMatchObject({
      ok: false,
      error: { code: 'target_mismatch' }
    })
    expect(await execute(call({ node_ids: [local.id] }, 'alias-local'))).toMatchObject({ ok: true })
    expect(await execute(call({ node_ids: [foreign.id] }, 'alias-foreign'))).toMatchObject({
      ok: false,
      error: { code: 'target_mismatch' }
    })
    expect(await execute(call({ ids: [local.id, 42] }, 'malformed'))).toMatchObject({
      ok: false,
      error: { code: 'invalid_schema' }
    })
    expect(executions).toBe(2)
  })
})
