/**
 * Public hosted document record shapes. These are the JSON shapes that
 * `/api/documents/*` endpoints exchange with sub-apps. Sub-apps must treat
 * the `id` fields as opaque strings and never parse them.
 *
 * @module types/document
 */

import type {
  HostedAssetKind,
  HostedDocumentLifecycleState,
  HostedDocumentSourceFormat,
  HostedMigrationKind,
  HostedMigrationSourceKind,
  HostedMigrationState,
  HostedSnapshotReason
} from './identity'

/** Hosted document metadata as returned by /api/documents. */
export type HostedDocumentRecord = {
  id: string
  ownerUserId: string
  title: string
  sourceFormat: HostedDocumentSourceFormat
  currentSnapshotId: string
  currentSnapshotStorageKey: string
  lifecycleState: HostedDocumentLifecycleState
  createdAt: string
  updatedAt: string
}

/** Hosted snapshot metadata. */
export type HostedSnapshotRecord = {
  id: string
  documentId: string
  ownerUserId: string
  parentSnapshotId: string | null
  storageKey: string
  byteLength: number
  contentHash: string
  reason: HostedSnapshotReason
  createdAt: string
}

/** Hosted asset metadata. */
export type HostedAssetRecord = {
  id: string
  documentId: string
  ownerUserId: string
  snapshotId: string
  kind: HostedAssetKind
  storageKey: string
  contentHash: string
  byteLength: number
  mediaType: string
  createdAt: string
}

/** Hosted migration provenance record. */
export type HostedMigrationRecord = {
  id: string
  documentId: string
  ownerUserId: string
  kind: HostedMigrationKind
  sourceKind: HostedMigrationSourceKind
  sourceFormat: HostedDocumentSourceFormat
  sourceName: string | null
  sourceFingerprint: string | null
  initialSnapshotId: string
  state: HostedMigrationState
  errorCode: string | null
  createdAt: string
  completedAt: string | null
}

/** Bundle of all metadata for a single hosted document, returned by /api/documents/:id/snapshot. */
export type HostedDocumentMetadataBundle = {
  document: HostedDocumentRecord
  snapshot: HostedSnapshotRecord
  assets: HostedAssetRecord[]
  migration: HostedMigrationRecord
}

// ---------------------------------------------------------------------------
// Convenience descriptors (for use as in-memory handles — not API payloads)
// ---------------------------------------------------------------------------

/** Opaque handle to a hosted document after a list/create/load call. */
export type HostedDocumentDescriptor = {
  documentId: string
  latestSnapshotId: string | null
  sourceFormat: HostedDocumentSourceFormat | string
  displayName?: string
}
