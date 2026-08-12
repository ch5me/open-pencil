export type ContentRevisionId = `sha256:${string}`

export type AssetId = `asset:${string}`

export interface AssetRevision {
  readonly revisionId: ContentRevisionId
  readonly kind: string
  readonly metadata: Readonly<Record<string, unknown>>
  readonly bytes: Uint8Array
}

export interface AssetBinding {
  readonly assetId: AssetId
  readonly revisionId: ContentRevisionId
}

export interface AssetGcResult {
  readonly releasedRevisionIds: readonly ContentRevisionId[]
  readonly releasedBytes: number
}
