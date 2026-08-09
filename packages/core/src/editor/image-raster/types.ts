export type RasterDisplayMode = "overlay" | "grayscale" | "isolate";
export type RasterOperation =
  | "replace"
  | "crop"
  | "relink"
  | "resample"
  | "paint"
  | "eraser"
  | "clone"
  | "healing"
  | "dodge-burn"
  | "smudge"
  | "blur-sharpen";

export interface RasterSource {
  readonly sourceId: string;
  readonly revisionId: `sha256:${string}`;
  readonly width: number;
  readonly height: number;
}

export interface RasterMutation {
  readonly operation: RasterOperation;
  readonly source: RasterSource;
  readonly transactionId: `tx:${string}`;
}

export interface RasterMask {
  readonly maskId: string;
  readonly revisionId: `sha256:${string}`;
  readonly thumbnailId: string;
  readonly enabled: boolean;
  readonly inverted: boolean;
  readonly displayMode: RasterDisplayMode;
  readonly transform: readonly [number, number, number, number, number, number];
}

export class RasterMaskError extends Error {
  readonly code = "raster-mask-error";
}

export class RasterCapabilityUnavailableError extends Error {
  readonly code = "E_CAPABILITY_RASTER_UNAVAILABLE";
}

export function createRasterMutation(
  operation: RasterOperation,
  source: RasterSource,
  transactionId: `tx:${string}`,
): RasterMutation {
  if (!source.sourceId || source.width <= 0 || source.height <= 0) {
    throw new RasterMaskError("invalid raster source");
  }
  return { operation, source: structuredClone(source), transactionId };
}
