import type { R2Bucket } from '@cloudflare/workers-types'

export type HostedAssetHydrationStatus = 'ready' | 'missing'

export type HostedAssetHydrationRecord = {
  id: string
  storageKey: string
  contentHash: string
  mediaType: string
  byteLength: number
  status: HostedAssetHydrationStatus
  bytesBase64: string | null
}

export type HostedAssetHydrationResult = {
  assets: HostedAssetHydrationRecord[]
  missingAssetIds: string[]
  degraded: boolean
}

type AssetRow = {
  id: string
  storage_key: string
  content_hash: string
  media_type: string
  byte_length: number
}

export async function hydrateHostedSnapshotAssets(options: {
  bucket: R2Bucket
  rows: AssetRow[]
}): Promise<HostedAssetHydrationResult> {
  const hydrated = await Promise.all(
    options.rows.map(async (row) => {
      const object = await options.bucket.get(row.storage_key)
      if (!object) {
        return {
          id: row.id,
          storageKey: row.storage_key,
          contentHash: row.content_hash,
          mediaType: row.media_type,
          byteLength: row.byte_length,
          status: 'missing' as const,
          bytesBase64: null
        }
      }

      const bytes = new Uint8Array(await object.arrayBuffer())
      return {
        id: row.id,
        storageKey: row.storage_key,
        contentHash: row.content_hash,
        mediaType: row.media_type,
        byteLength: row.byte_length,
        status: 'ready' as const,
        bytesBase64: encodeBase64(bytes)
      }
    })
  )

  const missingAssetIds = hydrated.filter((asset) => asset.status === 'missing').map((asset) => asset.id)

  return {
    assets: hydrated,
    missingAssetIds,
    degraded: missingAssetIds.length > 0
  }
}

function encodeBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}
