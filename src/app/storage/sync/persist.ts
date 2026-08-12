import { extractFigThumbnailFromReader } from '@open-pencil/fig'

import type { StorageProviderID } from '@/app/integrations/storage/types'
import { evictLocalFigCache } from '@/app/storage/cache-eviction'
import { getLocalCanvasStore } from '@/app/storage/local-store'
import type { LocalCanvasStore } from '@/app/storage/local-store/store'
import { withCanvasMutationAuthority } from '@/app/storage/sync/authority-lock'
import { kickSyncEngine } from '@/app/storage/sync/engine'
import { emitStorageWorkspaceEvent } from '@/app/storage/workspace/events'

export type StoragePersistenceDependencies = {
  store: LocalCanvasStore
  kickSync(): void
}

export type PersistStorageCanvasOptions = {
  providerId: StorageProviderID
  canvasId: string
  name: string
  figBytes: Uint8Array
  commitIfCurrent?: <T>(
    commit: (markCommitted: () => void, throwIfCancelled: () => void) => Promise<T>
  ) => Promise<T>
}

export class StorageSaveConflictError extends Error {
  readonly canvasId: string

  constructor(canvasId: string) {
    super(`Document changed in another context before this save could commit: ${canvasId}`)
    this.name = 'StorageSaveConflictError'
    this.canvasId = canvasId
  }
}

/** Write locally before scheduling remote synchronization. */
export async function persistStorageCanvasLocally(
  options: PersistStorageCanvasOptions,
  dependencies?: StoragePersistenceDependencies
): Promise<{ revision: number }> {
  const runtime = dependencies ?? {
    store: getLocalCanvasStore(),
    kickSync: () => void kickSyncEngine()
  }
  const thumbnailBytes = await extractFigThumbnailFromReader({
    size: options.figBytes.byteLength,
    async read(start, endExclusive) {
      return options.figBytes.subarray(start, endExclusive)
    }
  })
  return (
    options.commitIfCurrent ??
    ((commit) =>
      commit(
        () => undefined,
        () => undefined
      ))
  )(async (markCommitted, throwIfCancelled) => {
    throwIfCancelled()
    const publication = await withCanvasMutationAuthority(options.canvasId, async () => {
      const expectedRevision = (await runtime.store.getMeta(options.canvasId))?.revision ?? 0
      throwIfCancelled()
      // IndexedDB commit is irreversible; cancellation must stop before this transaction starts.
      markCommitted()
      return runtime.store.publishCanvas(
        {
          id: options.canvasId,
          providerId: options.providerId,
          name: options.name,
          figBytes: options.figBytes,
          thumbBytes: thumbnailBytes,
          syncStatus: 'pending'
        },
        { expectedRevision }
      )
    })
    if (!publication) {
      throw new StorageSaveConflictError(options.canvasId)
    }
    runtime.kickSync()
    emitStorageWorkspaceEvent({
      providerId: options.providerId,
      documentId: options.canvasId,
      kind: 'changed'
    })
    return { revision: publication.metadata.revision }
  })
}

export type SeedStorageCanvasOptions = {
  providerId: StorageProviderID
  canvasId: string
  name: string
  updatedAt: string
  figBytes: Uint8Array
  thumbnailBytes?: Uint8Array | null
  markSynced?: boolean
  expectedRevision?: number
}

export async function seedStorageCanvasFromRemote(
  options: SeedStorageCanvasOptions
): Promise<void> {
  const store = getLocalCanvasStore()
  const expectedRevision =
    options.expectedRevision ?? (await store.getMeta(options.canvasId))?.revision ?? 0
  const metadata = await store.seedCanvas(
    {
      id: options.canvasId,
      providerId: options.providerId,
      name: options.name,
      updatedAt: options.updatedAt,
      figBytes: options.figBytes,
      thumbBytes: options.thumbnailBytes,
      revision: expectedRevision + 1,
      syncStatus: options.markSynced === false ? 'pending' : 'synced'
    },
    { expectedRevision }
  )
  if (!metadata) return
  if (options.markSynced === false) return
  await store.updateMeta(
    options.canvasId,
    {
      lastSyncedAt: options.updatedAt || new Date().toISOString(),
      syncStatus: 'synced',
      lastSyncError: null
    },
    { expectedRevision: metadata.revision }
  )
  await evictLocalFigCache(new Set([options.canvasId]))
}
