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
  graph: SerializedSceneGraph
  pageId: string
  nodeIds: string[]
  options: RasterWorkerOptions
  canvasKitWASMURL: string
  fontSnapshot: FontExportSnapshot
}

export interface RasterWorkerResponse {
  bytes?: Uint8Array
  error?: string
}
