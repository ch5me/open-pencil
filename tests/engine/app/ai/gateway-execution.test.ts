import { describe, expect, test } from 'bun:test'

import {
  createGatewayToolExecutor,
  type GatewayToolCall,
  type GatewayToolManifest
} from '@/app/ai/agent-service/execution'
import type { EditorStore } from '@/app/editor/active-store'

const manifest: GatewayToolManifest = {
  id: 'manifest-1',
  actions: [{ name: 'create_shape', mutates: true }]
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
})
