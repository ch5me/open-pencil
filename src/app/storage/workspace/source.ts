import type { StorageDocument } from '@/app/integrations/storage'
import {
  activeStorageProviderID,
  createActiveStorageAdapter,
  storageCredentialStatuses,
  storagePreferencesComplete,
  storageProviderRegistry
} from '@/app/integrations/storage'
import { getLocalCanvasStore } from '@/app/storage/local-store'
import type { LocalCanvasStore } from '@/app/storage/local-store/store'
import type { LocalCanvasMeta } from '@/app/storage/local-store/types'
import { reconcileStorageDocuments } from '@/app/storage/reconcile'
import { withCanvasMutationAuthority } from '@/app/storage/sync/authority-lock'
import { onStorageWorkspaceEvent } from '@/app/storage/workspace/events'

export type StorageWorkspaceSnapshot = {
  documents: StorageDocument[]
  configured: boolean
}

type StorageWorkspaceSourceDependencies = {
  getActiveProviderID(): string
  isConfigured(providerID: string): Promise<boolean>
  getLocalStore(): LocalCanvasStore
  listRemoteDocuments(providerID: string): Promise<StorageDocument[]>
}

const defaultDependencies: StorageWorkspaceSourceDependencies = {
  getActiveProviderID: () => activeStorageProviderID.value,
  async isConfigured(providerID) {
    const provider = storageProviderRegistry.get(providerID)
    const statuses = await storageCredentialStatuses(providerID)
    return (
      storagePreferencesComplete(providerID) &&
      provider.credentialFields.every(
        (field) => !field.required || statuses[field.id] === 'configured'
      )
    )
  },
  getLocalStore: getLocalCanvasStore,
  listRemoteDocuments: (providerID) => createActiveStorageAdapter(providerID).listDocuments()
}

function localDocument(metadata: LocalCanvasMeta): StorageDocument {
  return {
    id: metadata.id,
    name: metadata.name,
    updatedAt: metadata.updatedAt,
    metadataAuthoritative: true
  }
}

async function reconcileRemoteWorkspace(
  localStore: LocalCanvasStore,
  providerID: string,
  remote: StorageDocument[]
): Promise<StorageDocument[]> {
  const remoteByID = new Map(remote.map((document) => [document.id, document]))
  const local = (await localStore.listMetas(true)).filter(
    (metadata) => metadata.providerId === providerID
  )
  const ids = new Set([...remoteByID.keys(), ...local.map((metadata) => metadata.id)])

  await Promise.all(
    [...ids].map((id) =>
      withCanvasMutationAuthority(id, async () => {
        const current = await localStore.getMeta(id)
        const remoteDocument = remoteByID.get(id)
        if (remoteDocument) {
          if (current) return
          await localStore.upsertIndexMeta(
            {
              id: remoteDocument.id,
              providerId: providerID,
              name: remoteDocument.name,
              updatedAt: remoteDocument.updatedAt,
              syncStatus: 'synced',
              lastSyncedAt: remoteDocument.updatedAt,
              lastSyncError: null
            },
            { expectedRevision: 0 }
          )
          return
        }
        if (current?.providerId === providerID && current.tombstoned) {
          await localStore.purgeTombstone(id, current.revision)
        }
      })
    )
  )

  const freshLocal = (await localStore.listMetas(true)).filter(
    (metadata) => metadata.providerId === providerID
  )
  const freshByID = new Map(freshLocal.map((metadata) => [metadata.id, metadata]))
  const freshRemote = remote.map((document) => {
    const metadata = freshByID.get(document.id)
    return metadata && !metadata.tombstoned && metadata.updatedAt >= document.updatedAt
      ? localDocument(metadata)
      : document
  })
  return reconcileStorageDocuments(freshLocal, freshRemote).documents
}

export function createStorageWorkspaceSource(
  onSnapshot: (snapshot: StorageWorkspaceSnapshot) => void,
  dependencies: StorageWorkspaceSourceDependencies = defaultDependencies
) {
  return {
    subscribe(listener: () => void): () => void {
      return onStorageWorkspaceEvent((event) => {
        if (event.providerId === dependencies.getActiveProviderID()) listener()
      })
    },

    async refresh(): Promise<StorageDocument[] | null> {
      const providerID = dependencies.getActiveProviderID()
      const configured = await dependencies.isConfigured(providerID)
      const localStore = dependencies.getLocalStore()
      if (!configured) {
        const local = (await localStore.listMetas(true)).filter(
          (metadata) => metadata.providerId === providerID
        )
        const documents = local.filter((metadata) => !metadata.tombstoned).map(localDocument)
        if (dependencies.getActiveProviderID() !== providerID) return null
        onSnapshot({ documents, configured })
        return documents
      }

      const remote = await dependencies.listRemoteDocuments(providerID)
      const documents = await reconcileRemoteWorkspace(localStore, providerID, remote)
      if (dependencies.getActiveProviderID() !== providerID) return null
      onSnapshot({ documents, configured })
      return documents
    },

    async loadPreview(id: string): Promise<Uint8Array | null> {
      const providerID = activeStorageProviderID.value
      const localStore = getLocalCanvasStore()
      const local = await localStore.readThumb(id)
      if (local?.byteLength) return local
      const adapter = createActiveStorageAdapter(providerID)
      if (!adapter.getThumbnail) return null
      const remote = await adapter.getThumbnail(id)
      if (!remote?.byteLength) return null
      if (activeStorageProviderID.value === providerID) await localStore.writeThumb(id, remote)
      return remote
    }
  }
}
