import { describe, expect, test } from 'bun:test'
import {
  createHostedDocument,
  saveHostedDocumentSnapshot,
  writeHostedAsset,
  deleteHostedAsset,
  listHostedDocuments,
  deleteHostedDocument,
  HostedDocumentStoreError
} from './crud'

const TEST_USER = 'test-user-001'

function createMockBucket(store: Record<string, Uint8Array>) {
  return {
    async put(key: string, data: Uint8Array | ArrayBuffer | Blob | string) {
      let bytes: Uint8Array
      if (data instanceof Uint8Array) bytes = data
      else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data)
      else bytes = new Uint8Array([1, 2, 3])
      store[key] = bytes
      return { httpEtag: '"mock-etag"' }
    },
    async get(key: string) {
      const bytes = store[key]
      if (!bytes) return null
      return { arrayBuffer: () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
    },
    async delete(keys: string | string[]) {
      const ks = Array.isArray(keys) ? keys : [keys]
      for (const k of ks) delete store[k]
    }
  }
}

function createMockDb(rows: Record<string, any[]>) {
  const preparedStatements: { sql: string; bindings: any[] }[] = []
  return {
    prepare(sql: string) {
      return {
        bind(...bindings: any[]) {
          return {
            async first<T>(): Promise<T | null> {
              preparedStatements.push({ sql, bindings })
              const tableName = sql.match(/FROM\s+(\w+)/)?.[1]
              if (!tableName) return null
              const tableRows = rows[tableName] ?? []
              return (tableRows.find((r: any) => r.id === bindings[0]) ?? null) as T
            },
            async all<T>() {
              preparedStatements.push({ sql, bindings })
              const tableName = sql.match(/FROM\s+(\w+)/)?.[1]
              if (!tableName) return { results: [] as T[] }
              let tableRows = [...(rows[tableName] ?? [])]
              if (sql.includes('WHERE owner_user_id = ?') && sql.includes('lifecycle_state')) {
                const ownerId = bindings[0]
                const state = bindings[1]
                tableRows = tableRows.filter((r: any) => r.owner_user_id === ownerId && r.lifecycle_state === state)
              } else if (sql.includes('WHERE owner_user_id = ?')) {
                tableRows = tableRows.filter((r: any) => r.owner_user_id === bindings[0])
              }
              if (sql.includes('ORDER BY updated_at DESC')) {
                tableRows.sort((a: any, b: any) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
              }
              const limitMatch = sql.match(/LIMIT\s+\?/)
              if (limitMatch && bindings.length > 0) {
                const lastBinding = bindings[bindings.length - 1]
                if (typeof lastBinding === 'number') {
                  tableRows = tableRows.slice(0, lastBinding)
                }
              }
              return { results: tableRows as T[] }
            },
            async run() {
              preparedStatements.push({ sql, bindings })
              if (sql.startsWith('INSERT INTO')) {
                const tableName = sql.match(/INTO\s+(\w+)/)?.[1]
                if (tableName && !rows[tableName]) rows[tableName] = []
                const cols = sql.match(/\(([^)]+)\)/)?.[1]?.split(',').map(s => s.trim()) ?? []
                const obj: Record<string, any> = {}
                cols.forEach((c, i) => { obj[c] = bindings[i] })
                if (tableName) rows[tableName].push(obj)
              }
              if (sql.startsWith('UPDATE hosted_documents')) {
                const docId = bindings[3]
                const tableRows = rows.hosted_documents ?? []
                const row = tableRows.find((r: any) => r.id === docId)
                if (row) {
                  row.current_snapshot_id = bindings[0]
                  row.current_snapshot_storage_key = bindings[1]
                  row.updated_at = bindings[2]
                }
              }
              if (sql.startsWith('DELETE')) {
                const tableName = sql.match(/FROM\s+(\w+)/)?.[1]
                if (tableName) {
                  rows[tableName] = []
                }
              }
              return { success: true }
            }
          }
        }
      }
    },
    async batch(statements: any[]) {
      for (const stmt of statements) {
        await stmt.run()
      }
    },
    _preparedStatements() {
      return preparedStatements
    }
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

const SAMPLE_BYTES = new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4])

describe('hosted document CRUD', () => {
  test('create writes snapshot and inserts D1 metadata', async () => {
    const store: Record<string, Uint8Array> = {}
    const rows: Record<string, any[]> = {}
    const bucket = createMockBucket(store)
    const db = createMockDb(rows)

    const result = await createHostedDocument(db as any, bucket as any, {
      documentId: 'doc-001',
      snapshotId: 'snap-001',
      title: 'Test Doc',
      sourceFormat: 'fig',
      snapshotBytesBase64: encodeBase64(SAMPLE_BYTES),
      ownerUserId: TEST_USER,
      sourceKind: 'untitled-memory'
    })

    expect(result.documentId).toBe('doc-001')
    expect(result.snapshotId).toBe('snap-001')
    expect(result.storageKey).toBe('documents/doc-001/snapshots/snap-001.fig')
    expect(store[result.storageKey]).toEqual(SAMPLE_BYTES)
    expect(result.metadata.document.title).toBe('Test Doc')
    expect(result.metadata.snapshot.reason).toBe('initial-import')
    expect(result.metadata.migration.kind).toBe('create-empty')
    expect(result.metadata.migration.state).toBe('complete')
  })

  test('create rejects empty snapshot bytes', async () => {
    const store: Record<string, Uint8Array> = {}
    const rows: Record<string, any[]> = {}
    const bucket = createMockBucket(store)
    const db = createMockDb(rows)

    await expect(
      createHostedDocument(db as any, bucket as any, {
        documentId: 'doc-002',
        snapshotId: 'snap-002',
        title: 'Empty',
        sourceFormat: 'fig',
        snapshotBytesBase64: '',
        ownerUserId: TEST_USER
      })
    ).rejects.toThrow(HostedDocumentStoreError)

    expect(store).toEqual({})
  })

  test('save updates snapshot pointer and writes new R2 object', async () => {
    const store: Record<string, Uint8Array> = {}
    const rows: Record<string, any[]> = {
      hosted_documents: [{
        id: 'doc-003',
        owner_user_id: TEST_USER,
        title: 'Saved Doc',
        source_format: 'fig',
        current_snapshot_id: 'snap-old',
        current_snapshot_storage_key: 'documents/doc-003/snapshots/snap-old.fig',
        lifecycle_state: 'active',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      }],
      hosted_snapshots: []
    }
    const bucket = createMockBucket(store)
    const db = createMockDb(rows)

    const newBytes = new Uint8Array([10, 20, 30, 40])
    const result = await saveHostedDocumentSnapshot(db as any, bucket as any, TEST_USER, {
      documentId: 'doc-003',
      snapshotId: 'snap-new',
      snapshotBytesBase64: encodeBase64(newBytes),
      reason: 'manual-save'
    })

    expect(result.documentId).toBe('doc-003')
    expect(result.snapshotId).toBe('snap-new')
    expect(result.storageKey).toBe('documents/doc-003/snapshots/snap-new.fig')
    expect(store[result.storageKey]).toEqual(newBytes)
    expect(rows.hosted_documents[0].current_snapshot_id).toBe('snap-new')
  })

  test('save rejects wrong user', async () => {
    const store: Record<string, Uint8Array> = {}
    const rows: Record<string, any[]> = {
      hosted_documents: [{
        id: 'doc-004',
        owner_user_id: 'other-user',
        title: 'Not Mine',
        source_format: 'fig',
        current_snapshot_id: 'snap-001',
        current_snapshot_storage_key: 'k',
        lifecycle_state: 'active',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      }]
    }
    const bucket = createMockBucket(store)
    const db = createMockDb(rows)

    await expect(
      saveHostedDocumentSnapshot(db as any, bucket as any, TEST_USER, {
        documentId: 'doc-004',
        snapshotId: 'snap-new',
        snapshotBytesBase64: encodeBase64(new Uint8Array([1]))
      })
    ).rejects.toMatchObject({ code: 'unauthorized' })
  })

  test('save rejects missing document', async () => {
    const store: Record<string, Uint8Array> = {}
    const rows: Record<string, any[]> = {}
    const bucket = createMockBucket(store)
    const db = createMockDb(rows)

    await expect(
      saveHostedDocumentSnapshot(db as any, bucket as any, TEST_USER, {
        documentId: 'doc-nonexistent',
        snapshotId: 'snap-new',
        snapshotBytesBase64: encodeBase64(new Uint8Array([1]))
      })
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  test('list returns documents for owner', async () => {
    const rows: Record<string, any[]> = {
      hosted_documents: [
        { id: 'doc-a', owner_user_id: TEST_USER, title: 'A', source_format: 'fig', current_snapshot_id: 's1', lifecycle_state: 'active', updated_at: '2026-05-01T00:00:00Z' },
        { id: 'doc-b', owner_user_id: TEST_USER, title: 'B', source_format: 'pen', current_snapshot_id: 's2', lifecycle_state: 'active', updated_at: '2026-05-02T00:00:00Z' },
        { id: 'doc-c', owner_user_id: 'other', title: 'C', source_format: 'fig', current_snapshot_id: 's3', lifecycle_state: 'active', updated_at: '2026-05-03T00:00:00Z' }
      ]
    }
    const db = createMockDb(rows)

    const docs = await listHostedDocuments(db as any, TEST_USER)
    expect(docs).toHaveLength(2)
    expect(docs[0].title).toBe('B')
    expect(docs[1].title).toBe('A')
  })

  test('delete removes document, snapshots, and asset R2 objects', async () => {
    const docStore: Record<string, Uint8Array> = {
      'documents/doc-005/snapshots/snap-001.fig': SAMPLE_BYTES,
      'documents/doc-005/snapshots/snap-002.fig': new Uint8Array([1, 2])
    }
    const assetStore: Record<string, Uint8Array> = {
      'documents/doc-005/assets/img-1': new Uint8Array([99]),
      'documents/doc-005/assets/img-2': new Uint8Array([88])
    }
    const rows: Record<string, any[]> = {
      hosted_documents: [{
        id: 'doc-005',
        owner_user_id: TEST_USER,
        title: 'To Delete',
        source_format: 'fig',
        current_snapshot_id: 'snap-002',
        current_snapshot_storage_key: 'documents/doc-005/snapshots/snap-002.fig',
        lifecycle_state: 'active',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      }],
      hosted_snapshots: [
        { storage_key: 'documents/doc-005/snapshots/snap-001.fig' },
        { storage_key: 'documents/doc-005/snapshots/snap-002.fig' }
      ],
      hosted_assets: [
        { storage_key: 'documents/doc-005/assets/img-1' },
        { storage_key: 'documents/doc-005/assets/img-2' }
      ]
    }
    const bucket = createMockBucket(docStore)
    const assetsBucket = createMockBucket(assetStore)
    const db = createMockDb(rows)

    await deleteHostedDocument(db as any, bucket as any, assetsBucket as any, TEST_USER, 'doc-005')

    expect(rows.hosted_documents).toEqual([])
    expect(Object.keys(docStore)).toEqual([])
    expect(Object.keys(assetStore)).toEqual([])
  })

  test('write asset creates R2 object and D1 record', async () => {
    const assetStore: Record<string, Uint8Array> = {}
    const rows: Record<string, any[]> = {
      hosted_documents: [{
        id: 'doc-006',
        owner_user_id: TEST_USER,
        title: 'Asset Doc',
        source_format: 'fig',
        current_snapshot_id: 'snap-006',
        current_snapshot_storage_key: 'documents/doc-006/snapshots/snap-006.fig',
        lifecycle_state: 'active',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      }]
    }
    const assetsBucket = createMockBucket(assetStore)
    const db = createMockDb(rows)

    const imgBytes = new Uint8Array([137, 80, 78, 71])
    const result = await writeHostedAsset(db as any, assetsBucket as any, TEST_USER, {
      documentId: 'doc-006',
      assetId: 'img-001',
      snapshotId: 'snap-006',
      kind: 'image',
      bytesBase64: encodeBase64(imgBytes),
      mediaType: 'image/png'
    })

    expect(result.assetId).toBe('img-001')
    expect(result.storageKey).toBe('documents/doc-006/assets/img-001')
    expect(result.byteLength).toBe(4)
    expect(assetStore[result.storageKey]).toEqual(imgBytes)
    expect(rows.hosted_assets).toHaveLength(1)
    expect(rows.hosted_assets[0].kind).toBe('image')
  })

  test('write asset rejects wrong user', async () => {
    const assetStore: Record<string, Uint8Array> = {}
    const rows: Record<string, any[]> = {
      hosted_documents: [{
        id: 'doc-007',
        owner_user_id: 'other-user',
        title: 'Not Mine',
        source_format: 'fig',
        current_snapshot_id: 'snap-x',
        current_snapshot_storage_key: 'k',
        lifecycle_state: 'active',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      }]
    }
    const assetsBucket = createMockBucket(assetStore)
    const db = createMockDb(rows)

    await expect(
      writeHostedAsset(db as any, assetsBucket as any, TEST_USER, {
        documentId: 'doc-007',
        assetId: 'img-x',
        snapshotId: 'snap-x',
        kind: 'image',
        bytesBase64: encodeBase64(new Uint8Array([1])),
        mediaType: 'image/png'
      })
    ).rejects.toMatchObject({ code: 'unauthorized' })
  })

  test('delete asset removes R2 object and D1 record', async () => {
    const assetStore: Record<string, Uint8Array> = {
      'documents/doc-008/assets/img-del': new Uint8Array([55])
    }
    const rows: Record<string, any[]> = {
      hosted_documents: [{
        id: 'doc-008',
        owner_user_id: TEST_USER,
        title: 'Delete Asset Doc',
        source_format: 'fig',
        current_snapshot_id: 'snap-008',
        current_snapshot_storage_key: 'documents/doc-008/snapshots/snap-008.fig',
        lifecycle_state: 'active',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      }],
      hosted_assets: [{
        id: 'img-del',
        storage_key: 'documents/doc-008/assets/img-del'
      }]
    }
    const assetsBucket = createMockBucket(assetStore)
    const db = createMockDb(rows)

    const result = await deleteHostedAsset(db as any, assetsBucket as any, TEST_USER, 'doc-008', 'img-del')

    expect(result.assetId).toBe('img-del')
    expect(Object.keys(assetStore)).toEqual([])
    expect(rows.hosted_assets).toEqual([])
  })

  test('delete asset rejects when asset not found', async () => {
    const assetStore: Record<string, Uint8Array> = {}
    const rows: Record<string, any[]> = {
      hosted_documents: [{
        id: 'doc-009',
        owner_user_id: TEST_USER,
        title: 'Doc',
        source_format: 'fig',
        current_snapshot_id: 'snap-x',
        current_snapshot_storage_key: 'k',
        lifecycle_state: 'active',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      }]
    }
    const assetsBucket = createMockBucket(assetStore)
    const db = createMockDb(rows)

    await expect(
      deleteHostedAsset(db as any, assetsBucket as any, TEST_USER, 'doc-009', 'nonexistent')
    ).rejects.toMatchObject({ code: 'not-found' })
  })
})
