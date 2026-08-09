import type { Vector } from "#core/types";

import {
  InvalidTransformError,
  type GeometryTransform,
  type ResizeHandle,
  type ResizeOptions,
} from "./types";

export function snapValue(value: number, grid: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(grid) || grid <= 0) {
    throw new InvalidTransformError("snap grid must be positive and finite");
  }
  return Math.round(value / grid) * grid;
}

export function resizeTransform(
  transform: GeometryTransform,
  handle: ResizeHandle,
  delta: Vector,
  options: ResizeOptions = {},
): GeometryTransform {
  const horizontal = handle.includes("right") ? 1 : handle.includes("left") ? -1 : 0;
  const vertical = handle.includes("bottom") ? 1 : handle.includes("top") ? -1 : 0;
  const width = Math.max(1, transform.width + horizontal * delta.x);
  const height = Math.max(1, transform.height + vertical * delta.y);
  const ratio = transform.width / transform.height;
  const lockedWidth =
    options.lockAspect && vertical !== 0 && horizontal === 0 ? Math.max(1, height * ratio) : width;
  const lockedHeight =
    options.lockAspect && (horizontal !== 0 || vertical === 0)
      ? Math.max(1, lockedWidth / ratio)
      : height;
  const next = {
    ...transform,
    width: options.lockAspect ? lockedWidth : width,
    height: options.lockAspect ? lockedHeight : height,
  };
  if (options.snap) {
    return {
      ...next,
      width: snapValue(next.width, options.snap),
      height: snapValue(next.height, options.snap),
    };
  }
  return next;
}

export function updateNumericTransform(
  transform: GeometryTransform,
  updates: Partial<Pick<GeometryTransform, "x" | "y" | "width" | "height" | "rotation">>,
): GeometryTransform {
  const next = { ...transform, ...updates };
  if (next.width < 0 || next.height < 0) throw new InvalidTransformError("size cannot be negative");
  return next;
}

export function flipTransform(transform: GeometryTransform, axis: "x" | "y"): GeometryTransform {
  return axis === "x"
    ? { ...transform, scaleX: -(transform.scaleX ?? 1) }
    : { ...transform, scaleY: -(transform.scaleY ?? 1) };
}
