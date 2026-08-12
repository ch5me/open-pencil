import { afterEach, describe, expect, test } from 'bun:test'

import type { StorageDocument } from '@/app/integrations/storage'
import { createMemoryLocalCanvasStore } from '@/app/storage/local-store'
import { withCanvasMutationAuthority } from '@/app/storage/sync/authority-lock'
import { createStorageWorkspaceSource } from '@/app/storage/workspace/source'

const originalNavigator = globalThis.navigator

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

function installSerializedLocks() {
  const tails = new Map<string, Promise<void>>()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: async <T>(name: string, action: () => Promise<T>) => {
          const previous = tails.get(name) ?? Promise.resolve()
          let release!: () => void
          const current = new Promise<void>((resolve) => {
            release = resolve
          })
          tails.set(name, current)
          await previous
          try {
            return await action()
          } finally {
            release()
          }
        }
      }
    }
  })
}

function remoteDocument(id: string, name = 'Remote'): StorageDocument {
  return {
    id,
    name,
    updatedAt: '2026-08-12T00:00:00.000Z',
    metadataAuthoritative: true
  }
}

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator
  })
})

describe('storage workspace refresh interleavings', () => {
  test('save committed during remote listing remains authoritative', async () => {
    installSerializedLocks()
    const store = createMemoryLocalCanvasStore()
    const listing = deferred<StorageDocument[]>()
    const source = createStorageWorkspaceSource(() => undefined, {
      getActiveProviderID: () => 's3-compatible',
      isConfigured: async () => true,
      getLocalStore: () => store,
      listRemoteDocuments: () => listing.promise
    })

    const refresh = source.refresh()
    await Promise.resolve()
    await withCanvasMutationAuthority('canvas-1', async () => {
      await store.publishCanvas(
        {
          id: 'canvas-1',
          providerId: 's3-compatible',
          name: 'Local save',
          updatedAt: '2026-08-12T01:00:00.000Z',
          figBytes: new Uint8Array([1])
        },
        { expectedRevision: 0 }
      )
    })
    listing.resolve([remoteDocument('canvas-1', 'Stale remote')])

    expect(await refresh).toEqual([
      {
        id: 'canvas-1',
        name: 'Local save',
        updatedAt: '2026-08-12T01:00:00.000Z',
        metadataAuthoritative: true
      }
    ])
    expect(await store.getMeta('canvas-1')).toMatchObject({
      name: 'Local save',
      revision: 1,
      syncStatus: 'pending',
      lastSyncedAt: null,
      tombstoned: false
    })
  })

  test('delete committed during remote listing remains tombstoned', async () => {
    installSerializedLocks()
    const store = createMemoryLocalCanvasStore()
    await store.writeCanvas({
      id: 'canvas-1',
      providerId: 's3-compatible',
      name: 'Local',
      figBytes: new Uint8Array([1]),
      syncStatus: 'synced'
    })
    const listing = deferred<StorageDocument[]>()
    const source = createStorageWorkspaceSource(() => undefined, {
      getActiveProviderID: () => 's3-compatible',
      isConfigured: async () => true,
      getLocalStore: () => store,
      listRemoteDocuments: () => listing.promise
    })

    const refresh = source.refresh()
    await Promise.resolve()
    await withCanvasMutationAuthority('canvas-1', async () => {
      await store.publishCanvasDeletion('canvas-1')
    })
    listing.resolve([remoteDocument('canvas-1')])

    expect(await refresh).toEqual([])
    expect(await store.getMeta('canvas-1')).toMatchObject({
      revision: 2,
      syncStatus: 'pending',
      tombstoned: true
    })
  })
})
