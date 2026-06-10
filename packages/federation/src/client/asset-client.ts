import type { HostedAssetKind } from '../types/identity'

/**
 * Public asset client. Owns the `/api/documents/:id/assets/*` route family.
 * Sub-apps upload and delete binary assets (images, fonts, raw blobs) that
 * are referenced from hosted snapshots.
 *
 * @module client/asset-client
 */
export interface AssetClient {
  write(request: AssetWriteRequest): Promise<AssetWriteResult>
  delete(documentId: string, assetId: string): Promise<{ assetId: string; deleted: true }>
}

export type AssetWriteRequest = {
  documentId: string
  assetId: string
  snapshotId: string
  kind: HostedAssetKind
  bytes: Uint8Array
  mediaType: string
}

export type AssetWriteResult = {
  assetId: string
  storageKey: string
  byteLength: number
}
