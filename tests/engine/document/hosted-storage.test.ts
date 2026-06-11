import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core/scene-graph'
import {
  createHostedDocumentBackend,
  type HostedDocumentClient
} from '@/app/document/io/hosted-backend'
import { createHostedClient } from '@/app/document/io/hosted-client'

describe('hosted client + backend contract', () => {
  test('client encodes base64 correctly for round-trip', async () => {
    const original = new Uint8Array([80, 75, 3, 4, 10, 20, 30, 40])
    let capturedBody: string | null = null

    const client = createHostedClient({
      apiOrigin: 'http://localhost:8787',
      sessionToken: () => 'test-token'
    })

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string
      return new Response(
        JSON.stringify({
          documentId: 'doc-1',
          snapshotId: 'snap-1',
          storageKey: 'documents/doc-1/snapshots/snap-1.fig'
        }),
        { status: 201 }
      )
    }) as typeof fetch

    await client.saveAs(original)
    expect(capturedBody).not.toBeNull()
    const body = JSON.parse(capturedBody ?? '')
    expect(body.snapshotBytesBase64).toBeTruthy()
    const decoded = atob(body.snapshotBytesBase64)
    expect(decoded.length).toBe(original.length)
  })

  test('backend with client delegates save to hosted endpoint', async () => {
    let saveCalled = false
    const fakeClient = {
      loadMetadata: async () => ({ mode: 'hosted-docs single-user' as const }),
      open: async () => ({
        graph: new SceneGraph(),
        fileName: 'test',
        sourceFormat: 'fig' as const
      }),
      save: async () => {
        saveCalled = true
        return { documentId: 'doc-1', latestSnapshotId: 'snap-1', sourceFormat: 'fig' }
      },
      saveAs: async () => ({
        documentId: 'doc-2',
        latestSnapshotId: 'snap-2',
        sourceFormat: 'fig'
      }),
      autosave: async () => ({
        documentId: 'doc-1',
        latestSnapshotId: 'snap-3',
        sourceFormat: 'fig'
      })
    } satisfies HostedDocumentClient

    const backend = createHostedDocumentBackend({
      descriptor: { documentId: 'doc-1', latestSnapshotId: 'snap-1', sourceFormat: 'fig' },
      client: fakeClient
    })

    expect(backend.can('save')).toBe(true)
    expect(backend.can('autosave')).toBe(true)
    expect(backend.can('open')).toBe(true)
    expect(backend.hasCapability('hostedSave')).toBe(true)
    expect(backend.hasCapability('localFileSave')).toBe(false)

    await backend.save(new Uint8Array([1, 2, 3]))
    expect(saveCalled).toBe(true)
  })

  test('backend throws hosted-runtime-unavailable without client', async () => {
    const backend = createHostedDocumentBackend({
      descriptor: { documentId: 'doc-1', latestSnapshotId: null, sourceFormat: 'fig' }
    })

    await expect(backend.save(new Uint8Array([1]))).rejects.toThrow(
      'Hosted document runtime is not wired'
    )
  })
})
