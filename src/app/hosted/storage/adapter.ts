import { createHostedRequester, HostedAPIError, type HostedRequestOptions } from '@/app/hosted/http'
import type {
  StorageAdapter,
  StorageDocument,
  StorageDocumentMetadata,
  StorageProviderRuntime
} from '@/app/integrations/storage/types'

export const ELF_HOSTED_STORAGE_PROVIDER_ID = 'hosted-elf'

type HostedDocumentRecord = {
  id: string
  title: string
  updatedAt: string
}

type HostedSnapshotResponse = {
  document?: HostedDocumentRecord
  snapshot?: {
    bytesBase64?: string
  }
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function snapshotId(): string {
  return `snap_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`
}

function toStorageDocument(document: HostedDocumentRecord): StorageDocument {
  return {
    id: document.id,
    name: document.title,
    updatedAt: document.updatedAt,
    metadataAuthoritative: true
  }
}

export function createHostedStorageAdapter(
  _runtime?: StorageProviderRuntime,
  options: HostedRequestOptions = {}
): StorageAdapter {
  const request = createHostedRequester(options)

  return {
    async testConnection() {
      const session = await request<{ user: { id: string } | null }>('/api/session')
      return session.user
        ? { ok: true, message: 'Connected to ELF hosted storage' }
        : { ok: false, message: 'ELF session is not authenticated' }
    },

    async listDocuments() {
      const response = await request<{ documents: HostedDocumentRecord[] }>('/api/documents')
      return response.documents.map(toStorageDocument)
    },

    async getDocument(id, onProgress) {
      const response = await request<HostedSnapshotResponse>(
        `/api/documents/${encodeURIComponent(id)}/snapshot`
      )
      const encoded = response.snapshot?.bytesBase64
      if (!encoded) {
        throw new HostedAPIError(
          409,
          'missing-snapshot',
          `Hosted document ${id} has no readable snapshot.`
        )
      }
      const bytes = decodeBase64(encoded)
      onProgress?.({ transferredBytes: bytes.byteLength, totalBytes: bytes.byteLength })
      return bytes
    },

    async putDocument(id, bytes, metadata, onProgress) {
      const encoded = encodeBase64(bytes)
      const nextSnapshotId = snapshotId()
      try {
        await request(`/api/documents/${encodeURIComponent(id)}/snapshot`, {
          method: 'PUT',
          body: JSON.stringify({
            snapshotId: nextSnapshotId,
            snapshotBytesBase64: encoded,
            reason: 'autosave',
            title: metadata.name
          })
        })
      } catch (error) {
        if (!(error instanceof HostedAPIError) || error.code !== 'not-found') throw error
        await request('/api/documents', {
          method: 'POST',
          body: JSON.stringify({
            documentId: id,
            snapshotId: nextSnapshotId,
            title: metadata.name,
            sourceFormat: 'fig',
            snapshotBytesBase64: encoded,
            sourceKind: 'open-pencil-storage'
          })
        })
      }
      onProgress?.({ transferredBytes: bytes.byteLength, totalBytes: bytes.byteLength })
    },

    async deleteDocument(id) {
      await request(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },

    async getDocumentMetadata(id): Promise<StorageDocumentMetadata | null> {
      try {
        const response = await request<HostedSnapshotResponse>(
          `/api/documents/${encodeURIComponent(id)}/snapshot`
        )
        return response.document
          ? { name: response.document.title, updatedAt: response.document.updatedAt }
          : null
      } catch (error) {
        if (error instanceof HostedAPIError && error.code === 'not-found') return null
        throw error
      }
    },

    getUsage() {
      return Promise.reject(
        new HostedAPIError(
          501,
          'usage-unavailable',
          'Hosted storage usage is not exposed by the ELF API.'
        )
      )
    }
  }
}
