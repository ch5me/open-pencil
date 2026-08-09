export type RasterDisplayMode = "overlay" | "grayscale" | "isolate";

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
