import type {
  HostedDocumentDescriptor,
  HostedDocumentRecord,
  HostedDocumentSourceFormat,
  HostedSnapshotReason
} from '../types'

/**
 * Public document client. Owns the host-runtime side of the
 * `/api/documents/*` route family. A second-cohort sub-app never calls
 * `/api/documents/*` directly — it goes through this client so the
 * request shape, auth header, and error mapping stay in lock-step with
 * the API.
 *
 * All write operations that touch bytes round-trip them as base64 inside
 * JSON, which matches the Hono Worker contract exactly.
 *
 * @module client/document-client
 */
export interface DocumentClient {
  list(options?: { limit?: number }): Promise<HostedDocumentDescriptor[]>

  loadMetadata(documentId: string): Promise<HostedDocumentMetadata>

  open(documentId: string): Promise<HostedDocumentOpenResult>

  save(documentId: string, data: Uint8Array, reason?: HostedSnapshotReason): Promise<HostedDocumentDescriptor>

  saveAs(data: Uint8Array, options?: HostedDocumentCreateOptions): Promise<HostedDocumentDescriptor>

  delete(documentId: string): Promise<{ documentId: string; deleted: true }>
}

export type HostedDocumentMetadata = {
  sourceFormat: HostedDocumentSourceFormat
  displayName: string
  hosted: {
    documentId: string
    latestSnapshotId: string | null
    sourceFormat: HostedDocumentSourceFormat
  }
}

export type HostedDocumentOpenResult = {
  document: HostedDocumentRecord
  snapshotBytes: Uint8Array
  assets: Array<{ id: string; status: 'ready' | 'missing'; bytes: Uint8Array | null }>
  hydration: {
    degraded: boolean
    missingAssetIds: string[]
    message: string | null
  }
}

export type HostedDocumentCreateOptions = {
  title?: string
  sourceFormat?: HostedDocumentSourceFormat
  sourceKind?: string
  sourceName?: string | null
  sourceFingerprint?: string | null
}
