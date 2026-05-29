import { describe, expect, test } from 'bun:test'

import worker from './index'
import { DEV_STUB_ELF_TOKEN } from './auth'

const TEST_USER = 'stub-user-001'

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
      const list = Array.isArray(keys) ? keys : [keys]
      for (const key of list) delete store[key]
    }
  }
}

function createMockDb(rows: Record<string, any[]>) {
  return {
    prepare(sql: string) {
      return {
        bind(...bindings: any[]) {
          return {
            async first<T>(): Promise<T | null> {
              if (sql.includes('FROM hosted_documents')) {
                const documentId = bindings[0]
                return (rows.hosted_documents ?? []).find((row) => row.id === documentId) ?? null
              }
              if (sql.includes('FROM hosted_assets')) {
                const [assetId, documentId] = bindings
                return (rows.hosted_assets ?? []).find((row) => row.id === assetId && row.document_id === documentId) ?? null
              }
              return null
            },
            async all<T>() {
              return { results: [] as T[] }
            },
            async run() {
              if (sql.startsWith('INSERT INTO hosted_assets')) {
                rows.hosted_assets ??= []
                rows.hosted_assets.push({
                  id: bindings[0],
                  document_id: bindings[1],
                  owner_user_id: bindings[2],
                  snapshot_id: bindings[3],
                  kind: bindings[4],
                  storage_key: bindings[5],
                  content_hash: bindings[6],
                  byte_length: bindings[7],
                  media_type: bindings[8],
                  created_at: bindings[9]
                })
              }
              if (sql.startsWith('DELETE FROM hosted_assets')) {
                rows.hosted_assets = (rows.hosted_assets ?? []).filter((row) => row.id !== bindings[0])
              }
              return { success: true }
            }
          }
        }
      }
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      for (const statement of statements) await statement.run()
    }
  }
}

function createEnv() {
  const assets: Record<string, Uint8Array> = {}
  const rows: Record<string, any[]> = {
    hosted_documents: [{
      id: 'doc-assets',
      owner_user_id: TEST_USER,
      title: 'Asset test',
      source_format: 'fig',
      current_snapshot_id: 'snap-assets',
      current_snapshot_storage_key: 'documents/doc-assets/snapshots/snap-assets.fig',
      lifecycle_state: 'active',
      created_at: '2026-05-29T00:00:00Z',
      updated_at: '2026-05-29T00:00:00Z'
    }],
    hosted_assets: []
  }
  return {
    env: {
      DB: createMockDb(rows),
      DOCUMENTS: createMockBucket({}),
      ASSETS: createMockBucket(assets),
      DOCUMENT_ROOM: {} as any
    },
    assets,
    rows
  }
}

function apiRequest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${DEV_STUB_ELF_TOKEN}`)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return new Request(`http://localhost${path}`, { ...init, headers })
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

describe('hosted document asset API routes', () => {
  test('POST /api/documents/:documentId/assets writes asset metadata and bytes', async () => {
    const { env, assets, rows } = createEnv()
    const response = await worker.fetch(apiRequest('/api/documents/doc-assets/assets', {
      method: 'POST',
      body: JSON.stringify({
        assetId: 'img-1',
        snapshotId: 'snap-assets',
        kind: 'image',
        bytesBase64: encodeBase64(new Uint8Array([1, 2, 3])),
        mediaType: 'image/png'
      })
    }), env as any)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      assetId: 'img-1',
      storageKey: 'documents/doc-assets/assets/img-1',
      byteLength: 3
    })
    expect(assets['documents/doc-assets/assets/img-1']).toEqual(new Uint8Array([1, 2, 3]))
    expect(rows.hosted_assets).toHaveLength(1)
  })

  test('DELETE /api/documents/:documentId/assets/:assetId removes asset metadata and bytes', async () => {
    const { env, assets, rows } = createEnv()
    assets['documents/doc-assets/assets/img-2'] = new Uint8Array([4, 5, 6])
    rows.hosted_assets.push({
      id: 'img-2',
      document_id: 'doc-assets',
      owner_user_id: TEST_USER,
      storage_key: 'documents/doc-assets/assets/img-2'
    })

    const response = await worker.fetch(apiRequest('/api/documents/doc-assets/assets/img-2', {
      method: 'DELETE'
    }), env as any)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ assetId: 'img-2', deleted: true })
    expect(assets['documents/doc-assets/assets/img-2']).toBeUndefined()
    expect(rows.hosted_assets).toEqual([])
  })
})
