export type PsdWarningCode =
  | "unsupported-color-mode"
  | "unsupported-bit-depth"
  | "unsupported-layer-feature"
  | "hostile-file-limit";

export interface PsdLimits {
  readonly maxBytes: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxLayers: number;
  readonly maxDecodedBytes: number;
  readonly maxExpansionRatio: number;
  readonly maxRenderBytes: number;
}

export const DEFAULT_PSD_LIMITS: PsdLimits = {
  maxBytes: 512 * 1024 * 1024,
  maxWidth: 32_768,
  maxHeight: 32_768,
  maxLayers: 4096,
  maxDecodedBytes: 2 * 1024 * 1024 * 1024,
  maxExpansionRatio: 128,
  maxRenderBytes: 512 * 1024 * 1024,
};

export interface PsdHeader {
  readonly version: 1 | 2;
  readonly channels: number;
  readonly height: number;
  readonly width: number;
  readonly bitsPerChannel: number;
  readonly colorMode: number;
}

export interface PsdLayerMetadata {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly editable: boolean;
  readonly warnings: readonly PsdWarningCode[];
}

export interface PsdImportResult {
  readonly header: PsdHeader;
  readonly layers: readonly PsdLayerMetadata[];
  readonly warnings: readonly PsdWarningCode[];
  readonly degraded: boolean;
  readonly staged: true;
}

export interface PsdExportInput {
  readonly width: number;
  readonly height: number;
  readonly layers: readonly PsdLayerMetadata[];
}

export class PsdUnsupportedError extends Error {
  readonly code = "unsupported-psd";
}

export class PsdHostileFileError extends Error {
  readonly code = "hostile-psd-file";
}
