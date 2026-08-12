import type { SerializedSceneGraph } from '#core/kiwi/fig/parse/transfer'
import type { FontExportSnapshot } from '#core/text/fonts'

import type { ExportFormat } from './render'

export interface RasterWorkerOptions {
  scale?: number
  format?: ExportFormat
  quality?: number
  trimTransparent?: boolean
}

export interface RasterWorkerRequest {
  kind: 'raster'
  graph: SerializedSceneGraph
  pageId: string
  nodeIds: string[]
  options: RasterWorkerOptions
  canvasKitWASMURL: string
  fontSnapshot: FontExportSnapshot
}

export interface FixedThumbnailWorkerRequest {
  kind: 'fixed-thumbnail'
  graph: SerializedSceneGraph
  pageId: string
  width: number
  height: number
  canvasKitWASMURL: string
  fontSnapshot: FontExportSnapshot
}

export type RasterExportWorkerRequest = RasterWorkerRequest | FixedThumbnailWorkerRequest

interface RasterWorkerSuccess {
  kind: 'raster'
  bytes?: Uint8Array
  error?: never
}

interface RasterWorkerFailure {
  kind: 'raster'
  bytes?: never
  error: string
}

interface FixedThumbnailWorkerSuccess {
  kind: 'fixed-thumbnail'
  width: number
  height: number
  bytes?: Uint8Array
  error?: never
}

interface FixedThumbnailWorkerFailure {
  kind: 'fixed-thumbnail'
  width: number
  height: number
  bytes?: never
  error: string
}

export type RasterWorkerResponse =
  | RasterWorkerSuccess
  | RasterWorkerFailure
  | FixedThumbnailWorkerSuccess
  | FixedThumbnailWorkerFailure
