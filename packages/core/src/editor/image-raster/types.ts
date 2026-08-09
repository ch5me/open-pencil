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

const RASTER_OPERATIONS: ReadonlySet<RasterOperation> = new Set([
  "replace",
  "crop",
  "relink",
  "resample",
  "paint",
  "eraser",
  "clone",
  "healing",
  "dodge-burn",
  "smudge",
  "blur-sharpen",
]);

function isRevisionId(value: string): value is `sha256:${string}` {
  return /^sha256:[0-9a-f]{64}$/u.test(value);
}

export function validateRasterSource(source: RasterSource): RasterSource {
  if (
    !source.sourceId ||
    !isRevisionId(source.revisionId) ||
    !Number.isInteger(source.width) ||
    !Number.isInteger(source.height) ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    throw new RasterMaskError("invalid raster source");
  }
  return structuredClone(source);
}

export function validateRasterMask(mask: RasterMask): RasterMask {
  if (
    !mask.maskId ||
    !isRevisionId(mask.revisionId) ||
    !mask.thumbnailId ||
    !Array.isArray(mask.transform) ||
    mask.transform.length !== 6 ||
    mask.transform.some((value) => !Number.isFinite(value))
  ) {
    throw new RasterMaskError("invalid raster mask");
  }
  return structuredClone(mask);
}

export function createRasterMutation(
  operation: RasterOperation,
  source: RasterSource,
  transactionId: `tx:${string}`,
): RasterMutation {
  if (!RASTER_OPERATIONS.has(operation) || !/^tx:.+/u.test(transactionId)) {
    throw new RasterMaskError("invalid raster mutation");
  }
  return { operation, source: validateRasterSource(source), transactionId };
}
