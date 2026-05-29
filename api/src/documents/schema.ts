export type HostedDocumentSourceFormat = 'fig' | 'pen'

export type HostedDocumentLifecycleState = 'active' | 'archived'

export type HostedMigrationKind = 'create-empty' | 'import-local' | 'promote-local' | 'duplicate-hosted'

export type HostedMigrationState = 'pending' | 'complete' | 'failed'

export type HostedMigrationSourceKind =
  | 'untitled-memory'
  | 'browser-file-handle'
  | 'tauri-file-path'
  | 'browser-download'
  | 'io-registry'
  | 'hosted-document'

export type HostedAssetKind = 'image' | 'font' | 'binary'

export type HostedSnapshotReason = 'initial-import' | 'manual-save' | 'autosave' | 'duplicate'

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

export type HostedDocumentMetadataBundle = {
  document: HostedDocumentRecord
  snapshot: HostedSnapshotRecord
  assets: HostedAssetRecord[]
  migration: HostedMigrationRecord
}

export const HOSTED_DOCUMENT_TABLES = [
  'hosted_documents',
  'hosted_snapshots',
  'hosted_assets',
  'hosted_document_migrations'
] as const

export function documentSnapshotStorageKey(documentId: string, snapshotId: string) {
  return `documents/${documentId}/snapshots/${snapshotId}.fig`
}

export function documentAssetStorageKey(documentId: string, assetId: string) {
  return `documents/${documentId}/assets/${assetId}`
}
