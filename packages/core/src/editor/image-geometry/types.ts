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
}

export type { Rect, Vector };
