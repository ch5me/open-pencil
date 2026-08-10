import type { Mat3 } from "#core/canvas/matrix";
import type { Rect, Vector } from "#core/types";

export interface GeometryTransform {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
}

export class InvalidTransformError extends Error {
  readonly code = "invalid-transform";
}

export interface GeometrySelection {
  readonly bounds: Rect;
  readonly transforms: readonly Mat3[];
}

export interface HitTestOptions {
  readonly tolerance?: number;
  /** Minimum source alpha (0-255) required for a pixel hit. */
  readonly alphaThreshold?: number;
}

export interface RasterPixelSource {
  readonly width: number;
  readonly height: number;
  readonly pixels: ArrayLike<number>;
}

export interface RasterLayer {
  readonly id: string;
  readonly transform: GeometryTransform;
  readonly source: RasterPixelSource;
  readonly visible?: boolean;
  readonly locked?: boolean;
}

export type ResizeHandle =
  | "top-left"
  | "top"
  | "top-right"
  | "right"
  | "bottom-right"
  | "bottom"
  | "bottom-left"
  | "left";

export interface ResizeOptions {
  readonly lockAspect?: boolean;
  readonly snap?: number;
}

export type { Rect, Vector };
