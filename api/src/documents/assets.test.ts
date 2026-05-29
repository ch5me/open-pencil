import { describe, expect, test } from 'bun:test'

import { hydrateHostedSnapshotAssets } from './assets'

type FakeObject = {
  arrayBuffer(): Promise<ArrayBuffer>
}

function createBucket(map: Record<string, Uint8Array>) {
  return {
    async get(key: string): Promise<FakeObject | null> {
      const value = map[key]
      if (!value) return null
      return {
        async arrayBuffer(): Promise<ArrayBuffer> {
          const buf = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
          return buf as ArrayBuffer
        }
      }
    }
  }
}

describe('hosted asset hydration', () => {
  test('returns degraded state when assets are missing', async () => {
    const bucket = createBucket({
      'documents/doc/assets/a1': new Uint8Array([1, 2, 3])
    })

    const result = await hydrateHostedSnapshotAssets({
      bucket: bucket as any,
      rows: [
        {
          id: 'a1',
          storage_key: 'documents/doc/assets/a1',
          content_hash: 'sha256:a1',
          media_type: 'image/png',
          byte_length: 3
        },
        {
          id: 'missing',
          storage_key: 'documents/doc/assets/missing',
          content_hash: 'sha256:missing',
          media_type: 'image/png',
          byte_length: 9
        }
      ]
    })

    expect(result.degraded).toBe(true)
    expect(result.missingAssetIds).toEqual(['missing'])
    expect(result.assets[0]?.status).toBe('ready')
    expect(result.assets[1]?.status).toBe('missing')
    expect(result.assets[1]?.bytesBase64).toBeNull()
  })
})
