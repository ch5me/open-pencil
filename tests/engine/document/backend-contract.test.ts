import { describe, expect, test } from 'bun:test'

import type { EditorState } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/core/scene-graph'

import { DocumentBackendOperationError } from '@/app/document/io/backend'
import { createHostedDocumentBackend } from '@/app/document/io/hosted-backend'
import { createLocalDocumentBackend } from '@/app/document/io/local-backend'

function createState() {
  return { sceneVersion: 7, documentName: 'Example' } as EditorState & { documentName: string }
}

describe('DocumentBackend contract', () => {
  test('local backend exposes local file capabilities and metadata only', async () => {
    const backend = createLocalDocumentBackend({
      state: createState(),
      getFilePath: () => '/tmp/example.fig',
      setFilePath: () => undefined,
      getFileHandle: () => null,
      setFileHandle: () => undefined,
      getDownloadName: () => 'example.fig',
      setDownloadName: () => undefined,
      setSavedVersion: () => undefined,
      setLastWriteTime: () => undefined,
      startWatchingFile: () => undefined
    })

    expect(backend.mode).toBe('local-only')
    expect(backend.can('open')).toBe(true)
    expect(backend.can('autosave')).toBe(true)
    expect(backend.hasCapability('localFileOpen')).toBe(true)
    expect(backend.hasCapability('localFileSave')).toBe(true)
    expect(backend.hasCapability('hostedSave')).toBe(false)
    expect(await backend.loadMetadata()).toEqual({
      mode: 'local-only',
      displayName: 'Example',
      sourceFormat: 'fig',
      local: {
        filePath: '/tmp/example.fig',
        fileHandleName: null,
        downloadName: 'example.fig'
      }
    })
  })

  test('hosted backend rejects local file open without silent promote', async () => {
    const backend = createHostedDocumentBackend({
      descriptor: { documentId: 'doc_123', latestSnapshotId: 'snap_1', sourceFormat: 'fig' }
    })
    const file = new File([new Uint8Array([1, 2, 3])], 'local.fig')

    expect(backend.mode).toBe('hosted-docs single-user')
    expect(backend.hasCapability('hostedSave')).toBe(true)
    expect(backend.hasCapability('localFileOpen')).toBe(false)
    await expect(backend.open({ kind: 'file', file })).rejects.toThrow(
      'Hosted backend cannot open local files'
    )
  })

  test('hosted backend surfaces explicit runtime and source errors', async () => {
    const missingRuntime = createHostedDocumentBackend({
      descriptor: { documentId: 'doc_123', latestSnapshotId: null, sourceFormat: 'pen' }
    })
    const missingSource = createHostedDocumentBackend({ descriptor: null })

    await expect(missingRuntime.save(new Uint8Array([1]))).rejects.toThrow(
      'Hosted document runtime is not wired'
    )
    await expect(missingSource.autosave(new Uint8Array([1]))).rejects.toThrow(
      'canonical hosted document.id'
    )
  })

  test('hosted backend delegates CRUD/autosave to injected client', async () => {
    const graph = new SceneGraph()
    const calls: string[] = []
    const backend = createHostedDocumentBackend({
      descriptor: { documentId: 'doc_123', latestSnapshotId: 'snap_1', sourceFormat: 'fig' },
      client: {
        async loadMetadata(documentId) {
          calls.push(`metadata:${documentId}`)
          return {
            mode: 'hosted-docs single-user',
            hosted: { documentId, latestSnapshotId: 'snap_1', sourceFormat: 'fig' }
          }
        },
        async open(documentId) {
          calls.push(`open:${documentId}`)
          return { graph, fileName: 'Hosted.fig', sourceFormat: 'fig' }
        },
        async save(documentId) {
          calls.push(`save:${documentId}`)
          return { documentId, latestSnapshotId: 'snap_2', sourceFormat: 'fig' }
        },
        async saveAs() {
          calls.push('saveAs')
          return { documentId: 'doc_copy', latestSnapshotId: 'snap_copy', sourceFormat: 'fig' }
        },
        async autosave(documentId) {
          calls.push(`autosave:${documentId}`)
          return { documentId, latestSnapshotId: 'snap_3', sourceFormat: 'fig' }
        }
      }
    })

    await backend.loadMetadata()
    const opened = await backend.open({ kind: 'reload' })
    await backend.save(new Uint8Array([1]))
    await backend.autosave(new Uint8Array([2]))
    await backend.saveAs(new Uint8Array([3]))

    expect(opened?.graph).toBe(graph)
    expect(calls).toEqual([
      'metadata:doc_123',
      'open:doc_123',
      'save:doc_123',
      'autosave:doc_123',
      'saveAs'
    ])
    expect(backend.getMetadata().hosted?.documentId).toBe('doc_copy')
  })

  test('typed backend errors expose code, mode, backend, and operation', async () => {
    const backend = createHostedDocumentBackend({ descriptor: null })

    try {
      await backend.save(new Uint8Array([1]))
      throw new Error('Expected hosted save to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentBackendOperationError)
      const backendError = error as DocumentBackendOperationError
      expect(backendError.code).toBe('missing-source')
      expect(backendError.details).toEqual({
        backendId: 'hosted-document',
        mode: 'hosted-docs single-user',
        operation: 'save'
      })
    }
  })
})
