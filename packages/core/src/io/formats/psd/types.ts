export type PsdWarningCode =
  | "unsupported-color-mode"
  | "unsupported-bit-depth"
  | "unsupported-blend-mode"
  | "unsupported-layer-feature"
  | "hostile-file-limit";

export type PsdCapabilityCode =
  | "E_PSD_CAPABILITY_EDITABLE_TEXT"
  | "E_PSD_CAPABILITY_SHAPES"
  | "E_PSD_CAPABILITY_ROTATED_MASKS"
  | "E_PSD_CAPABILITY_BLEND_MODES"
  | "E_PSD_CAPABILITY_ADJUSTMENTS"
  | "E_PSD_CAPABILITY_SMART_OBJECTS"
  | "E_PSD_CAPABILITY_VECTORS"
  | "E_PSD_CAPABILITY_PATHS"
  | "E_PSD_CAPABILITY_EFFECTS"
  | "E_PSD_CAPABILITY_VECTOR_MASKS"
  | "E_PSD_CAPABILITY_CHANNELS"
  | "E_PSD_CAPABILITY_ICC"
  | "E_PSD_CAPABILITY_DPI"
  | "E_PSD_CAPABILITY_CMYK"
  | "E_PSD_CAPABILITY_16_BIT"
  | "E_PSD_CAPABILITY_PSB";

export interface PsdCorpusCase {
  readonly name: string;
  readonly capability: PsdCapabilityCode;
  readonly warning: PsdWarningCode;
  readonly externalReopen: "UNKNOWN";
}

export interface PsdCorpusManifest {
  readonly version: "psd-corpus-v1";
  readonly cases: readonly PsdCorpusCase[];
  readonly warningCoverage: 1;
  readonly failedImportVisibleMutationCount: 0;
}

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
  readonly dpi?: readonly [number, number];
  readonly iccProfile?: PsdIccProfile;
  readonly channelsMetadata?: readonly PsdChannelMetadata[];
  readonly spotColors?: readonly PsdSpotColor[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PsdChannelMetadata {
  readonly id: number;
  readonly name: string;
  readonly kind: "color" | "alpha" | "spot";
  readonly opacity?: number;
}

export interface PsdSpotColor {
  readonly name: string;
  readonly color: readonly [number, number, number];
  readonly opacity?: number;
}

export interface PsdIccProfile {
  readonly name: string;
  readonly data: Uint8Array;
}

export interface PsdLayerMetadata {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly editable: boolean;
  /** PSD blend mode name as supplied by the producer. */
  readonly blendMode?: string;
  /** PSD adjustment kind; unknown producer kinds stay observable and degraded. */
  readonly adjustmentType?: string;
  readonly adjustments?: Readonly<Record<string, number>>;
  readonly text?: ImportedTextMetadata;
  readonly smartObjectId?: string;
  readonly smartObjectKind?: "linked" | "embedded" | string;
  readonly linkedAssetId?: string;
  readonly linkedAssetRevisionId?: string;
  readonly embeddedDocumentId?: string;
  readonly embeddedDocumentVersion?: string;
  readonly vector?: PsdVectorMetadata;
  readonly paths?: readonly PsdPathMetadata[];
  readonly effects?: readonly PsdLayerEffectMetadata[];
  readonly vectorMask?: PsdVectorMaskMetadata;
  readonly warnings: readonly PsdWarningCode[];
}

export interface PsdVectorMetadata {
  readonly form: "rect" | "ellipse" | "polygon" | "path" | string;
  readonly width: number;
  readonly height: number;
  readonly path: readonly string[];
}

export interface PsdPathMetadata {
  readonly id: string;
  readonly anchors: readonly {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly handleIn?: readonly [number, number];
    readonly handleOut?: readonly [number, number];
  }[];
  readonly closed: boolean;
}

export interface PsdLayerEffectMetadata {
  readonly kind: "shadow" | "glow" | "stroke" | "overlay" | "bevel" | "pattern" | string;
  readonly [key: string]: unknown;
}

export interface PsdVectorMaskMetadata {
  readonly type: "VECTOR";
  readonly density: number;
  readonly feather: number;
  readonly paths: readonly PsdPathMetadata[];
}

export interface PsdRasterLayer {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  /**
   * Optional affine transform from raster-local coordinates to document
   * coordinates: [a, b, c, d, e, f].
   */
  readonly transform?: readonly [number, number, number, number, number, number];
  /** Rotation in degrees around the raster center. Used when no transform exists. */
  readonly rotation?: number;
  readonly mask?: PsdRasterMask;
}

export interface PsdRasterMask {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly transform?: readonly [number, number, number, number, number, number];
  readonly rotation?: number;
  readonly inverted?: boolean;
}

export interface PsdRasterInput {
  readonly width: number;
  readonly height: number;
  readonly layers: readonly (PsdLayerMetadata & { readonly raster?: PsdRasterLayer })[];
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
  readonly channels?: readonly PsdChannelMetadata[];
  readonly colorMode?: number;
  readonly bitsPerChannel?: 8 | 16;
  readonly dpi?: readonly [number, number];
  readonly iccProfile?: PsdIccProfile;
  readonly spotColors?: readonly PsdSpotColor[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class PsdUnsupportedError extends Error {
  readonly code = "unsupported-psd";
}

export class PsdHostileFileError extends Error {
  readonly code = "hostile-psd-file";
}

export class PsdCancelledError extends Error {
  readonly code = "psd-import-cancelled";
}
import type { ImportedTextMetadata } from "#core/editor/image-capabilities/text";
