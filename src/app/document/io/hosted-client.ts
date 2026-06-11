import { parseFigFile } from '@open-pencil/core/kiwi'

import {
  createFederationClient,
  HostedApiError,
  type FederationClient,
  type HostedDocumentDescriptor,
  type HostedSnapshotReason
} from '@open-pencil/federation'

import {
  type DocumentBackendMetadata,
  type DocumentOpenResult,
  DocumentBackendOperationError
} from '@/app/document/io/backend'
import { type HostedDocumentClient } from '@/app/document/io/hosted-backend'

export type { HostedDocumentDescriptor }

export type HostedClientOptions = {
  apiOrigin: string
  sessionToken: () => string | null
}

let _client: FederationClient | null = null
let _clientOptions: HostedClientOptions | null = null

function getFederationClient(options: HostedClientOptions): FederationClient {
  if (_client && _clientOptions === options) return _client
  _client = createFederationClient({
    apiOrigin: options.apiOrigin,
    getToken: () => options.sessionToken()
  })
  _clientOptions = options
  return _client
}

export { HostedApiError }

export function createHostedClient(options: HostedClientOptions): HostedDocumentClient {
  const client = getFederationClient(options)

  async function open(documentId: string): Promise<DocumentOpenResult> {
    let opened: Awaited<ReturnType<FederationClient['documents']['open']>>
    try {
      opened = await client.documents.open(documentId)
    } catch (error) {
      if (error instanceof HostedApiError && error.status === 404) {
        throw new DocumentBackendOperationError(
          'missing-source',
          'Hosted document not found in the federation service.',
          { backendId: 'hosted-document', mode: 'hosted-docs single-user', operation: 'open' }
        )
      }
      throw new DocumentBackendOperationError(
        'hosted-runtime-unavailable',
        'Hosted document runtime did not return a snapshot.',
        { backendId: 'hosted-document', mode: 'hosted-docs single-user', operation: 'open' }
      )
    }

    if (!opened.snapshotBytes.byteLength) {
      throw new DocumentBackendOperationError(
        'hosted-runtime-unavailable',
        'Hosted document snapshot is empty or missing.',
        { backendId: 'hosted-document', mode: 'hosted-docs single-user', operation: 'open' }
      )
    }

    const ab = opened.snapshotBytes.buffer.slice(
      opened.snapshotBytes.byteOffset,
      opened.snapshotBytes.byteOffset + opened.snapshotBytes.byteLength
    ) as ArrayBuffer
    const graph = await parseFigFile(ab)

    return {
      graph,
      fileName: opened.document.title,
      sourceFormat: opened.document.sourceFormat
    }
  }

  return {
    async loadMetadata(documentId): Promise<DocumentBackendMetadata> {
      const meta = await client.documents.loadMetadata(documentId)
      return {
        mode: 'hosted-docs single-user',
        sourceFormat: meta.sourceFormat,
        displayName: meta.displayName,
        hosted: {
          documentId: meta.hosted.documentId,
          latestSnapshotId: meta.hosted.latestSnapshotId,
          sourceFormat: meta.hosted.sourceFormat
        }
      }
    },

    open,

    async save(
      documentId: string,
      data: Uint8Array,
      reason: HostedSnapshotReason = 'manual-save'
    ): Promise<HostedDocumentDescriptor> {
      const saved = await client.documents.save(documentId, data, reason)
      return {
        documentId: saved.documentId,
        latestSnapshotId: saved.latestSnapshotId,
        sourceFormat: 'fig'
      }
    },

    async saveAs(data: Uint8Array): Promise<HostedDocumentDescriptor> {
      return client.documents.saveAs(data)
    },

    async autosave(
      documentId: string,
      data: Uint8Array
    ): Promise<HostedDocumentDescriptor> {
      return client.documents.save(documentId, data, 'autosave')
    }
  }
}
