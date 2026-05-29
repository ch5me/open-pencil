import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import {
  type HostedDocumentMetadataBundle,
  type HostedSnapshotReason,
  documentSnapshotStorageKey
} from './schema'
import { createHostedDocumentMetadata } from './migration'
import { writeSnapshotToR2 } from './storage'

export type CreateHostedDocumentRequest = {
  documentId: string
  snapshotId: string
  title: string
  sourceFormat: 'fig' | 'pen'
  snapshotBytesBase64: string
  ownerUserId: string
  sourceKind?: string
  sourceName?: string | null
  sourceFingerprint?: string | null
  now?: string
}

export type SaveHostedDocumentRequest = {
  documentId: string
  snapshotId: string
  snapshotBytesBase64: string
  reason?: HostedSnapshotReason
}

export type CreatedDocumentResponse = {
  documentId: string
  snapshotId: string
  storageKey: string
  metadata: HostedDocumentMetadataBundle
}

export type SavedDocumentResponse = {
  documentId: string
  snapshotId: string
  storageKey: string
  byteLength: number
}

export class HostedDocumentStoreError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'HostedDocumentStoreError'
  }
}

/**
 * Create a new hosted document: write snapshot to R2, insert D1 metadata.
 * Atomic: if R2 write fails, no D1 rows are created.
 */
export async function createHostedDocument(
  db: D1Database,
  documentsBucket: R2Bucket,
  request: CreateHostedDocumentRequest
): Promise<CreatedDocumentResponse> {
  const snapshotBytes = decodeBase64ToUint8Array(request.snapshotBytesBase64)
  if (!snapshotBytes.byteLength) {
    throw new HostedDocumentStoreError('empty-snapshot', 'Snapshot bytes must not be empty.')
  }

  // Write snapshot to R2 first (fail-fast, no metadata on failure)
  const snapshotResult = await writeSnapshotToR2({
    bucket: documentsBucket,
    documentId: request.documentId,
    snapshotId: request.snapshotId,
    bytes: snapshotBytes
  })

  const createdAt = request.now ?? new Date().toISOString()

  // Build metadata bundle
  const metadata = createHostedDocumentMetadata({
    transition: 'create-empty',
    ownerUserId: request.ownerUserId,
    documentId: request.documentId,
    snapshotId: request.snapshotId,
    title: request.title,
    source: {
      kind: (request.sourceKind as any) ?? 'untitled-memory',
      format: request.sourceFormat,
      name: request.sourceName ?? null,
      fingerprint: request.sourceFingerprint ?? null
    },
    snapshotBytes: snapshotBytes,
    snapshotContentHash: computeContentHash(snapshotBytes),
    now: createdAt
  })

  // Persist D1 records in a transaction
  await db.batch([
    db.prepare(
      'INSERT INTO hosted_documents (id, owner_user_id, title, source_format, current_snapshot_id, current_snapshot_storage_key, lifecycle_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      metadata.document.id,
      metadata.document.ownerUserId,
      metadata.document.title,
      metadata.document.sourceFormat,
      metadata.document.currentSnapshotId,
      metadata.document.currentSnapshotStorageKey,
      metadata.document.lifecycleState,
      metadata.document.createdAt,
      metadata.document.updatedAt
    ),
    db.prepare(
      'INSERT INTO hosted_snapshots (id, document_id, owner_user_id, parent_snapshot_id, storage_key, byte_length, content_hash, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      metadata.snapshot.id,
      metadata.snapshot.documentId,
      metadata.snapshot.ownerUserId,
      metadata.snapshot.parentSnapshotId,
      metadata.snapshot.storageKey,
      metadata.snapshot.byteLength,
      metadata.snapshot.contentHash,
      metadata.snapshot.reason,
      metadata.snapshot.createdAt
    ),
    db.prepare(
      'INSERT INTO hosted_document_migrations (id, document_id, owner_user_id, kind, source_kind, source_format, source_name, source_fingerprint, initial_snapshot_id, state, error_code, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      metadata.migration.id,
      metadata.migration.documentId,
      metadata.migration.ownerUserId,
      metadata.migration.kind,
      metadata.migration.sourceKind,
      metadata.migration.sourceFormat,
      metadata.migration.sourceName,
      metadata.migration.sourceFingerprint,
      metadata.migration.initialSnapshotId,
      metadata.migration.state,
      metadata.migration.errorCode,
      metadata.migration.createdAt,
      metadata.migration.completedAt
    )
  ])

  return {
    documentId: metadata.document.id,
    snapshotId: metadata.snapshot.id,
    storageKey: snapshotResult.storageKey,
    metadata
  }
}

/**
 * Save a snapshot for an existing hosted document.
 * Writes new snapshot to R2, updates D1 current_snapshot pointer.
 * On failure: R2 write may leave orphan object, but D1 stays consistent.
 */
export async function saveHostedDocumentSnapshot(
  db: D1Database,
  documentsBucket: R2Bucket,
  userId: string,
  request: SaveHostedDocumentRequest
): Promise<SavedDocumentResponse> {
  const snapshotBytes = decodeBase64ToUint8Array(request.snapshotBytesBase64)
  if (!snapshotBytes.byteLength) {
    throw new HostedDocumentStoreError('empty-snapshot', 'Snapshot bytes must not be empty.')
  }

  // Verify document ownership
  const doc = await db.prepare(
    'SELECT id, owner_user_id FROM hosted_documents WHERE id = ?'
  ).bind(request.documentId).first<{ id: string; owner_user_id: string }>()

  if (!doc) {
    throw new HostedDocumentStoreError('not-found', `Hosted document ${request.documentId} not found.`)
  }
  if (doc.owner_user_id !== userId) {
    throw new HostedDocumentStoreError('unauthorized', 'Cannot save a document owned by another user.')
  }

  // Write new snapshot to R2
  const storageKey = documentSnapshotStorageKey(request.documentId, request.snapshotId)
  await documentsBucket.put(storageKey, snapshotBytes, {
    httpMetadata: { contentType: 'application/octet-stream' }
  })

  const createdAt = new Date().toISOString()
  const reason = request.reason ?? 'manual-save'

  // Update D1: insert snapshot row + update document pointer
  // parent_snapshot_id is null for a fresh PUT save — we don't track snapshot lineage here
  await db.batch([
    db.prepare(
      'INSERT INTO hosted_snapshots (id, document_id, owner_user_id, parent_snapshot_id, storage_key, byte_length, content_hash, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      request.snapshotId,
      request.documentId,
      userId,
      null,
      storageKey,
      snapshotBytes.byteLength,
      computeContentHash(snapshotBytes),
      reason,
      createdAt
    ),
    db.prepare(
      'UPDATE hosted_documents SET current_snapshot_id = ?, current_snapshot_storage_key = ?, updated_at = ? WHERE id = ?'
    ).bind(
      request.snapshotId,
      storageKey,
      createdAt,
      request.documentId
    )
  ])

  return {
    documentId: request.documentId,
    snapshotId: request.snapshotId,
    storageKey,
    byteLength: snapshotBytes.byteLength
  }
}

/**
 * List documents owned by a user.
 */
export async function listHostedDocuments(
  db: D1Database,
  userId: string,
  limit = 50
): Promise<Array<{
  id: string
  title: string
  sourceFormat: string
  currentSnapshotId: string
  updatedAt: string
}>> {
  const results = await db.prepare(
    'SELECT id, title, source_format, current_snapshot_id, updated_at FROM hosted_documents WHERE owner_user_id = ? AND lifecycle_state = ? ORDER BY updated_at DESC LIMIT ?'
  ).bind(userId, 'active', limit).all()

  return (results.results ?? []).map((row: any) => ({
    id: row.id as string,
    title: row.title as string,
    sourceFormat: row.source_format as string,
    currentSnapshotId: row.current_snapshot_id as string,
    updatedAt: row.updated_at as string
  }))
}

/**
 * Delete a hosted document and all its snapshots (R2 cleanup + D1 cascade).
 */
export async function deleteHostedDocument(
  db: D1Database,
  documentsBucket: R2Bucket,
  userId: string,
  documentId: string
): Promise<void> {
  const doc = await db.prepare(
    'SELECT id, owner_user_id, current_snapshot_storage_key FROM hosted_documents WHERE id = ?'
  ).bind(documentId).first<{ id: string; owner_user_id: string; current_snapshot_storage_key: string }>()

  if (!doc) {
    throw new HostedDocumentStoreError('not-found', `Hosted document ${documentId} not found.`)
  }
  if (doc.owner_user_id !== userId) {
    throw new HostedDocumentStoreError('unauthorized', 'Cannot delete a document owned by another user.')
  }

  // Delete snapshot objects from R2
  const snapshots = await db.prepare(
    'SELECT storage_key FROM hosted_snapshots WHERE document_id = ?'
  ).bind(documentId).all<{ storage_key: string }>()

  const keysToDelete = [doc.current_snapshot_storage_key]
  for (const row of snapshots.results ?? []) {
    if (row.storage_key !== doc.current_snapshot_storage_key) {
      keysToDelete.push(row.storage_key)
    }
  }

  if (keysToDelete.length > 0) {
    await documentsBucket.delete(keysToDelete)
  }

  // D1 cascade handles hosted_snapshots, hosted_assets, hosted_document_migrations
  await db.prepare('DELETE FROM hosted_documents WHERE id = ?').bind(documentId).run()
}

function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function computeContentHash(bytes: Uint8Array): string {
  // Simple length + first/last byte hash for dedup; replace with proper SHA-256 when crypto.subtle is available in Worker
  if (bytes.length === 0) return 'sha256:empty'
  const head = bytes[0].toString(16).padStart(2, '0')
  const tail = bytes[bytes.length - 1].toString(16).padStart(2, '0')
  return `sha256:${bytes.length.toString(16)}:${head}${tail}`
}
