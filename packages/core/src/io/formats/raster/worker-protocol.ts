import type { SerializedSceneGraph } from "#core/kiwi/fig/parse/transfer";
import type { LoadedFontData } from "#core/text/fonts";

import type { ExportFormat } from "./render";

export interface RasterWorkerOptions {
  scale?: number;
  format?: ExportFormat;
  quality?: number;
  trimTransparent?: boolean;
}

export interface RasterWorkerRequest {
  graph: SerializedSceneGraph;
  pageId: string;
  nodeIds: string[];
  options: RasterWorkerOptions;
  canvasKitWasmUrl: string;
  fonts: LoadedFontData[];
}

export interface RasterWorkerResponse {
  bytes?: Uint8Array;
  error?: string;
}
