import {
  type DocumentBackendMetadata,
  type DocumentOpenResult,
  DocumentBackendOperationError
} from '@/app/document/io/backend'
import {
  type HostedDocumentDescriptor,
  type HostedDocumentClient
} from '@/app/document/io/hosted-backend'

import { parseFigFile } from '@open-pencil/core/kiwi'

export type HostedClientOptions = {
  apiOrigin: string
  sessionToken: () => string | null
}

export class HostedApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'HostedApiError'
  }
}

export function createHostedClient(options: HostedClientOptions): HostedDocumentClient {
  async function fetchWithAuth(path: string, init: RequestInit = {}) {
    const token = options.sessionToken()
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    headers.set('Content-Type', 'application/json')

    const url = `${options.apiOrigin}${path}`
    const response = await fetch(url, { ...init, headers, credentials: 'include' })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new HostedApiError(response.status, body.error ?? 'unknown', body.message ?? response.statusText)
    }
    return response.json()
  }

  return {
    async loadMetadata(documentId: string): Promise<DocumentBackendMetadata> {
      const doc = await fetchWithAuth(`/api/documents/${encodeURIComponent(documentId)}/snapshot`)
      return {
        mode: 'hosted-docs single-user',
        sourceFormat: doc.document?.sourceFormat,
        displayName: doc.document?.title,
        hosted: doc.document
          ? {
              documentId: doc.document.id,
              latestSnapshotId: doc.document.currentSnapshotId ?? null,
              sourceFormat: doc.document.sourceFormat
            }
          : undefined
      }
    },

    async open(documentId: string): Promise<DocumentOpenResult> {
      const response = await fetchWithAuth(`/api/documents/${encodeURIComponent(documentId)}/snapshot`)

      if (!response.snapshot?.bytesBase64) {
        throw new DocumentBackendOperationError(
          'hosted-runtime-unavailable',
          'Hosted document snapshot is empty or missing.',
          { backendId: 'hosted-document', mode: 'hosted-docs single-user', operation: 'open' }
        )
      }

      const snapshotBytes = decodeBase64ToUint8Array(response.snapshot.bytesBase64)
      const ab = snapshotBytes.buffer.slice(snapshotBytes.byteOffset, snapshotBytes.byteOffset + snapshotBytes.byteLength) as ArrayBuffer
      const graph = await parseFigFile(ab)

      return {
        graph,
        fileName: response.document?.title ?? documentId,
        sourceFormat: response.document?.sourceFormat ?? 'fig'
      }
    },

    async save(documentId: string, data: Uint8Array): Promise<HostedDocumentDescriptor> {
      const snapshotId = generateSnapshotId()
      const response = await fetchWithAuth(`/api/documents/${encodeURIComponent(documentId)}/snapshot`, {
        method: 'PUT',
        body: JSON.stringify({
          snapshotId,
          snapshotBytesBase64: encodeUint8ArrayToBase64(data),
          reason: 'manual-save'
        })
      })

      return {
        documentId,
        latestSnapshotId: response.snapshotId,
        sourceFormat: 'fig'
      }
    },

    async saveAs(data: Uint8Array): Promise<HostedDocumentDescriptor> {
      const documentId = generateDocumentId()
      const snapshotId = generateSnapshotId()
      const response = await fetchWithAuth('/api/documents', {
        method: 'POST',
        body: JSON.stringify({
          documentId,
          snapshotId,
          title: 'Untitled',
          sourceFormat: 'fig',
          snapshotBytesBase64: encodeUint8ArrayToBase64(data),
          sourceKind: 'untitled-memory'
        })
      })

      return {
        documentId: response.documentId,
        latestSnapshotId: response.snapshotId,
        sourceFormat: 'fig'
      }
    },

    async autosave(documentId: string, data: Uint8Array): Promise<HostedDocumentDescriptor> {
      const snapshotId = generateSnapshotId()
      const response = await fetchWithAuth(`/api/documents/${encodeURIComponent(documentId)}/snapshot`, {
        method: 'PUT',
        body: JSON.stringify({
          snapshotId,
          snapshotBytesBase64: encodeUint8ArrayToBase64(data),
          reason: 'autosave'
        })
      })

      return {
        documentId,
        latestSnapshotId: response.snapshotId,
        sourceFormat: 'fig'
      }
    }
  }
}

function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function encodeUint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function generateDocumentId(): string {
  return `doc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

function generateSnapshotId(): string {
  return `snap_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}
