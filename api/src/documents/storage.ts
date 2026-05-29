import type { R2Bucket } from '@cloudflare/workers-types'
import {
  documentSnapshotStorageKey,
  documentAssetStorageKey
} from './schema'

export type SnapshotWriteInput = {
  bucket: R2Bucket
  documentId: string
  snapshotId: string
  bytes: Uint8Array
}

export type SnapshotWriteResult = {
  storageKey: string
  byteLength: number
  etag: string
}

export type AssetWriteInput = {
  bucket: R2Bucket
  documentId: string
  assetId: string
  bytes: Uint8Array
  mediaType: string
}

export type AssetWriteResult = {
  storageKey: string
  byteLength: number
  etag: string
}

/**
 * Write a snapshot object to the DOCUMENTS R2 bucket.
 * Deterministic key: documents/{documentId}/snapshots/{snapshotId}.fig
 */
export async function writeSnapshotToR2(input: SnapshotWriteInput): Promise<SnapshotWriteResult> {
  const storageKey = documentSnapshotStorageKey(input.documentId, input.snapshotId)
  const object = await input.bucket.put(storageKey, input.bytes, {
    httpMetadata: { contentType: 'application/octet-stream' }
  })
  return {
    storageKey,
    byteLength: input.bytes.byteLength,
    etag: object.httpEtag
  }
}

/**
 * Write an asset object to the ASSETS R2 bucket.
 * Deterministic key: documents/{documentId}/assets/{assetId}
 */
export async function writeAssetToR2(input: AssetWriteInput): Promise<AssetWriteResult> {
  const storageKey = documentAssetStorageKey(input.documentId, input.assetId)
  const object = await input.bucket.put(storageKey, input.bytes, {
    httpMetadata: { contentType: input.mediaType }
  })
  return {
    storageKey,
    byteLength: input.bytes.byteLength,
    etag: object.httpEtag
  }
}
