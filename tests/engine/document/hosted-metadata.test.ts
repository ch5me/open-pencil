import { describe, expect, test } from 'bun:test'

import {
  HostedDocumentMigrationError,
  createHostedDocumentMetadata,
  rejectUnsupportedHostedDocumentTransition
} from '../../../api/src/documents/migration'
import {
  ROOM_PENDING_UPDATE_COMPACTION_COUNT,
  appendPendingRoomUpdate,
  compactPersistedRoomState,
  createEmptyPersistedRoomState,
  shouldCompactPersistedRoomState
} from '../../../api/src/documents/room-persistence'
import { HOSTED_DOCUMENT_TABLES } from '../../../api/src/documents/schema'
import { HOSTED_DOCUMENT_SCHEMA_SQL } from '../../../api/src/documents/schema.sql'

describe('hosted document metadata model', () => {
  test('promotes a local .pen document into hosted metadata with owner, snapshot, asset, and lineage', () => {
    const bundle = createHostedDocumentMetadata({
      transition: 'promote-local',
      ownerUserId: 'user_123',
      documentId: 'document_123',
      snapshotId: 'snapshot_123',
      title: 'Local sketch',
      source: {
        kind: 'io-registry',
        format: 'pen',
        name: 'sketch.pen',
        fingerprint: 'sha256:source'
      },
      snapshotBytes: new Uint8Array([1, 2, 3]),
      snapshotContentHash: 'sha256:snapshot',
      assets: [
        {
          id: 'asset_123',
          kind: 'image',
          contentHash: 'sha256:asset',
          byteLength: 42,
          mediaType: 'image/png'
        }
      ],
      now: '2026-05-28T00:00:00.000Z'
    })

    expect(bundle.document).toEqual({
      id: 'document_123',
      ownerUserId: 'user_123',
      title: 'Local sketch',
      sourceFormat: 'pen',
      currentSnapshotId: 'snapshot_123',
      currentSnapshotStorageKey: 'documents/document_123/snapshots/snapshot_123.fig',
      lifecycleState: 'active',
      createdAt: '2026-05-28T00:00:00.000Z',
      updatedAt: '2026-05-28T00:00:00.000Z'
    })
    expect(bundle.snapshot).toMatchObject({
      id: 'snapshot_123',
      documentId: 'document_123',
      ownerUserId: 'user_123',
      parentSnapshotId: null,
      storageKey: 'documents/document_123/snapshots/snapshot_123.fig',
      byteLength: 3,
      contentHash: 'sha256:snapshot',
      reason: 'initial-import'
    })
    expect(bundle.assets).toEqual([
      {
        id: 'asset_123',
        documentId: 'document_123',
        ownerUserId: 'user_123',
        snapshotId: 'snapshot_123',
        kind: 'image',
        storageKey: 'documents/document_123/assets/asset_123',
        contentHash: 'sha256:asset',
        byteLength: 42,
        mediaType: 'image/png',
        createdAt: '2026-05-28T00:00:00.000Z'
      }
    ])
    expect(bundle.migration).toMatchObject({
      documentId: 'document_123',
      ownerUserId: 'user_123',
      kind: 'promote-local',
      sourceKind: 'io-registry',
      sourceFormat: 'pen',
      sourceName: 'sketch.pen',
      sourceFingerprint: 'sha256:source',
      initialSnapshotId: 'snapshot_123',
      state: 'complete',
      errorCode: null
    })
  })

  test('duplicates hosted metadata with parent snapshot lineage', () => {
    const bundle = createHostedDocumentMetadata({
      transition: 'duplicate-hosted',
      ownerUserId: 'user_123',
      documentId: 'document_copy',
      snapshotId: 'snapshot_copy',
      title: 'Copy',
      source: {
        kind: 'hosted-document',
        format: 'fig',
        name: 'Original',
        fingerprint: 'document_original:snapshot_original'
      },
      parentSnapshotId: 'snapshot_original',
      snapshotBytes: new Uint8Array([9]),
      snapshotContentHash: 'sha256:copy'
    })

    expect(bundle.snapshot.parentSnapshotId).toBe('snapshot_original')
    expect(bundle.snapshot.reason).toBe('duplicate')
    expect(bundle.migration.kind).toBe('duplicate-hosted')
    expect(bundle.migration.sourceKind).toBe('hosted-document')
  })

  test('rejects invalid migration states with typed errors and no bundle', () => {
    expect(() =>
      createHostedDocumentMetadata({
        transition: 'import-local',
        ownerUserId: null,
        documentId: 'document_123',
        snapshotId: 'snapshot_123',
        title: 'Missing owner',
        source: { kind: 'browser-file-handle', format: 'fig', name: 'a.fig', fingerprint: null },
        snapshotBytes: new Uint8Array([1]),
        snapshotContentHash: 'sha256:snapshot'
      })
    ).toThrow(HostedDocumentMigrationError)

    try {
      createHostedDocumentMetadata({
        transition: 'import-local',
        ownerUserId: 'user_123',
        documentId: 'document_123',
        snapshotId: 'snapshot_123',
        title: 'Missing asset metadata',
        source: { kind: 'browser-file-handle', format: 'fig', name: 'a.fig', fingerprint: null },
        snapshotBytes: new Uint8Array([1]),
        snapshotContentHash: 'sha256:snapshot',
        assets: [{ id: 'asset_123', kind: 'image', contentHash: '', byteLength: 0, mediaType: '' }]
      })
    } catch (error) {
      expect(error).toBeInstanceOf(HostedDocumentMigrationError)
      const typed = error as HostedDocumentMigrationError
      expect(typed.code).toBe('missing-asset-metadata')
      expect(typed.details).toEqual({
        transition: 'import-local',
        sourceKind: 'browser-file-handle',
        sourceFormat: 'fig'
      })
    }
  })

  test('rejects unsupported automatic transitions explicitly', () => {
    expect(() =>
      rejectUnsupportedHostedDocumentTransition('local-open', 'browser-file-handle', 'fig')
    ).toThrow(HostedDocumentMigrationError)

    try {
      rejectUnsupportedHostedDocumentTransition('hosted-room-join')
    } catch (error) {
      const typed = error as HostedDocumentMigrationError
      expect(typed.code).toBe('unsupported-transition')
      expect(typed.details.transition).toBe('hosted-room-join')
    }
  })

  test('D1 schema declares all hosted metadata tables and ownership columns', () => {
    for (const table of HOSTED_DOCUMENT_TABLES) {
      expect(HOSTED_DOCUMENT_SCHEMA_SQL).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
    }
    expect(HOSTED_DOCUMENT_SCHEMA_SQL).toContain('owner_user_id TEXT NOT NULL')
    expect(HOSTED_DOCUMENT_SCHEMA_SQL).toContain('current_snapshot_storage_key TEXT NOT NULL')
    expect(HOSTED_DOCUMENT_SCHEMA_SQL).toContain(
      'parent_snapshot_id TEXT REFERENCES hosted_snapshots(id)'
    )
    expect(HOSTED_DOCUMENT_SCHEMA_SQL).toContain(
      "kind TEXT NOT NULL CHECK (kind IN ('create-empty', 'import-local', 'promote-local', 'duplicate-hosted'))"
    )
  })

  test('hosted collab compaction rules reset pending replay queue after threshold snapshots', () => {
    let state = createEmptyPersistedRoomState()
    for (let index = 0; index < ROOM_PENDING_UPDATE_COMPACTION_COUNT; index += 1) {
      state = appendPendingRoomUpdate(state, `update-${index}`, 12)
    }

    expect(shouldCompactPersistedRoomState(state)).toBe(true)

    const compacted = compactPersistedRoomState(
      state,
      'snapshot-base64',
      'threshold',
      '2026-05-29T12:00:00.000Z'
    )

    expect(compacted.pendingUpdateCount).toBe(0)
    expect(compacted.pendingUpdateBytes).toBe(0)
    expect(compacted.snapshotBase64).toBe('snapshot-base64')
    expect(compacted.lastCompactionReason).toBe('threshold')
  })
})
