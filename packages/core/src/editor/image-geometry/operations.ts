import type { Vector } from "#core/types";

import {
  InvalidTransformError,
  type GeometryTransform,
  type ResizeHandle,
  type ResizeOptions,
} from "./types";
import { validateTransform } from "./transform";

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
  validateTransform(transform);
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    throw new InvalidTransformError("resize delta must be finite");
  }
  if (options.snap !== undefined && (!Number.isFinite(options.snap) || options.snap <= 0)) {
    throw new InvalidTransformError("snap grid must be positive and finite");
  }

  const horizontal = handle.includes("right") ? 1 : handle.includes("left") ? -1 : 0;
  const vertical = handle.includes("bottom") ? 1 : handle.includes("top") ? -1 : 0;
  let width = Math.max(1, transform.width + horizontal * delta.x);
  let height = Math.max(1, transform.height + vertical * delta.y);
  const ratio = transform.width / transform.height;
  if (options.lockAspect) {
    if (Math.abs(delta.x) >= Math.abs(delta.y)) {
      height = Math.max(1, width / ratio);
    } else {
      width = Math.max(1, height * ratio);
    }
  }
  const next = {
    ...transform,
    x: horizontal < 0 ? transform.x + transform.width - width : transform.x,
    y: vertical < 0 ? transform.y + transform.height - height : transform.y,
    width,
    height,
  };
  if (options.snap) {
    return {
      ...next,
      width: Math.max(1, snapValue(next.width, options.snap)),
      height: Math.max(1, snapValue(next.height, options.snap)),
    };
  }
  return next;
}

export function updateNumericTransform(
  transform: GeometryTransform,
  updates: Partial<Pick<GeometryTransform, "x" | "y" | "width" | "height" | "rotation">>,
): GeometryTransform {
  validateTransform(transform);
  const next = { ...transform, ...updates };
  validateTransform(next);
  return next;
}

export function flipTransform(transform: GeometryTransform, axis: "x" | "y"): GeometryTransform {
  validateTransform(transform);
  return axis === "x"
    ? { ...transform, scaleX: -(transform.scaleX ?? 1) }
    : { ...transform, scaleY: -(transform.scaleY ?? 1) };
}
