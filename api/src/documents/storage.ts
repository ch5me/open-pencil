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
export async function writeSnapshotToR2(input: SnapshotWriteResult & {
  bucket: R2Bucket
  bytes: Uint8Array
}): Promise<SnapshotWriteResult> {
  const object = await input.bucket.put(input.storageKey, input.bytes, {
    httpMetadata: { contentType: 'application/octet-stream' }
  })
  return {
    storageKey: input.storageKey,
    byteLength: input.byteLength,
    etag: object.httpEtag
  }
}

/**
 * Convenience: create snapshot write input and execute.
 */
export async function createAndWriteSnapshot(options: SnapshotWriteInput): Promise<SnapshotWriteResult> {
  const storageKey = documentSnapshotStorageKey(options.documentId, options.snapshotId)
  return writeSnapshotToR2({
    bucket: options.bucket,
    storageKey,
    bytes: options.bytes,
    byteLength: options.bytes.byteLength
  })
}

/**
 * Write an asset object to the ASSETS R2 bucket.
 * Deterministic key: documents/{documentId}/assets/{assetId}
 */
export async function writeAssetToR2(input: AssetWriteResult & {
  bucket: R2Bucket
  bytes: Uint8Array
}): Promise<AssetWriteResult> {
  const object = await input.bucket.put(input.storageKey, input.bytes, {
    httpMetadata: { contentType: input.mediaType }
  })
  return {
    storageKey: input.storageKey,
    byteLength: input.byteLength,
    etag: object.httpEtag
  }
}

/**
 * Convenience: create asset write input and execute.
 */
export async function createAndWriteAsset(options: AssetWriteInput): Promise<AssetWriteResult> {
  const storageKey = documentAssetStorageKey(options.documentId, options.assetId)
  return writeAssetToR2({
    bucket: options.bucket,
    storageKey,
    bytes: options.bytes,
    byteLength: options.bytes.byteLength,
    mediaType: options.mediaType
  })
}
